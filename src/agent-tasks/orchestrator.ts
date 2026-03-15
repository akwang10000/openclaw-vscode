import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import type {
  AgentTaskCancelInput,
  AgentTaskEvent,
  AgentTaskListFilter,
  AgentTaskProvider,
  AgentTaskProviderTurnInput,
  AgentTaskRespondInput,
  AgentTaskSnapshot,
  AgentTaskStartInput,
  AgentTaskStatus,
} from "./types";

interface AgentOrchestratorOptions {
  storagePath: string;
  taskHistoryLimit: number;
  providers: Record<string, AgentTaskProvider>;
  emitGatewayEvent: (event: AgentTaskEvent) => Promise<void>;
  onSnapshotChange?: (snapshot: AgentTaskSnapshot) => void;
  onError?: (message: string) => void;
  onWarn?: (message: string) => void;
}

interface RuntimeState {
  activeTaskId: string | null;
  runningHandles: Map<string, { cancel: () => void }>;
}

interface TaskIndexEntry {
  taskId: string;
  provider: string;
  status: AgentTaskStatus;
  updatedAt: number;
}

export class AgentOrchestrator {
  private readonly storagePath: string;
  private readonly tasksPath: string;
  private readonly indexPath: string;
  private readonly taskHistoryLimit: number;
  private readonly providers: Record<string, AgentTaskProvider>;
  private readonly emitGatewayEvent: (event: AgentTaskEvent) => Promise<void>;
  private readonly onSnapshotChange: (snapshot: AgentTaskSnapshot) => void;
  private readonly onError: (message: string) => void;
  private readonly onWarn: (message: string) => void;
  private readonly runtime: RuntimeState = {
    activeTaskId: null,
    runningHandles: new Map(),
  };
  private readonly snapshots = new Map<string, AgentTaskSnapshot>();
  private initialized = false;

  constructor(options: AgentOrchestratorOptions) {
    this.storagePath = options.storagePath;
    this.tasksPath = path.join(this.storagePath, "tasks");
    this.indexPath = path.join(this.tasksPath, "index.json");
    this.taskHistoryLimit = Math.max(10, options.taskHistoryLimit);
    this.providers = options.providers;
    this.emitGatewayEvent = options.emitGatewayEvent;
    this.onSnapshotChange = options.onSnapshotChange ?? (() => {});
    this.onError = options.onError ?? (() => {});
    this.onWarn = options.onWarn ?? (() => {});
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    fs.mkdirSync(this.tasksPath, { recursive: true });
    this.loadSnapshots();

    for (const snapshot of this.snapshots.values()) {
      if (snapshot.status === "running") {
        snapshot.status = "interrupted";
        snapshot.lastError = "Task was interrupted because VS Code restarted.";
        snapshot.finishedAt = Date.now();
        snapshot.updatedAt = snapshot.finishedAt;
        await this.persistSnapshot(snapshot);
      }
      this.syncTaskActivity(snapshot);
    }

    this.initialized = true;
    this.kickQueue();
  }

  dispose(): void {
    for (const [taskId, handle] of this.runtime.runningHandles.entries()) {
      try {
        handle.cancel();
      } catch (err) {
        this.onError(`Failed to cancel agent task ${taskId}: ${String(err)}`);
      }
    }
    this.runtime.runningHandles.clear();
    this.runtime.activeTaskId = null;
  }

  async startTask(input: AgentTaskStartInput): Promise<AgentTaskSnapshot> {
    this.ensureInitialized();
    const provider = this.providers[input.provider];
    if (!provider) {
      throw new Error(`Unsupported agent provider: ${input.provider}`);
    }

    const now = Date.now();
    const taskId = randomUUID();
    const snapshot: AgentTaskSnapshot = {
      taskId,
      provider: input.provider,
      mode: input.mode ?? "agent",
      status: "queued",
      prompt: input.prompt,
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
      turn: 0,
      history: [],
    };
    this.snapshots.set(taskId, snapshot);
    await this.persistSnapshot(snapshot);
    this.syncTaskActivity(snapshot);
    this.kickQueue();
    return snapshot;
  }

  async getTaskStatus(taskId: string): Promise<AgentTaskSnapshot> {
    this.ensureInitialized();
    return this.getSnapshot(taskId);
  }

  async listTasks(filter: AgentTaskListFilter = {}): Promise<AgentTaskSnapshot[]> {
    this.ensureInitialized();
    const limit = Math.max(1, Math.min(filter.limit ?? 20, 200));
    return [...this.snapshots.values()]
      .filter((snapshot) => !filter.status || snapshot.status === filter.status)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  async getTaskResult(taskId: string): Promise<{
    taskId: string;
    provider: string;
    status: AgentTaskStatus;
    resultText?: string;
    latestOutput?: string;
    decisionRequest?: AgentTaskSnapshot["decisionRequest"];
    lastError?: string;
  }> {
    this.ensureInitialized();
    const snapshot = this.getSnapshot(taskId);
    return {
      taskId: snapshot.taskId,
      provider: snapshot.provider,
      status: snapshot.status,
      resultText: snapshot.resultText,
      latestOutput: snapshot.latestOutput,
      decisionRequest: snapshot.decisionRequest,
      lastError: snapshot.lastError,
    };
  }

  async respondToTask(input: AgentTaskRespondInput): Promise<AgentTaskSnapshot> {
    this.ensureInitialized();
    const snapshot = this.getSnapshot(input.taskId);
    if (snapshot.status !== "waiting_decision") {
      throw new Error(`Task ${input.taskId} is not waiting for a decision`);
    }
    const request = snapshot.decisionRequest;
    if (!request) {
      throw new Error(`Task ${input.taskId} has no pending decision request`);
    }
    if (!request.options.some((option) => option.id === input.choice)) {
      throw new Error(`Unknown decision option: ${input.choice}`);
    }

    snapshot.status = "queued";
    snapshot.updatedAt = Date.now();
    snapshot.decisionRequest = undefined;
    const lastTurn = snapshot.history.at(-1);
    if (lastTurn) {
      lastTurn.decisionChoice = input.choice;
      lastTurn.decisionNotes = input.notes;
    }
    await this.persistSnapshot(snapshot);
    this.syncTaskActivity(snapshot);
    this.kickQueue({
      taskId: snapshot.taskId,
      decisionChoice: input.choice,
      decisionNotes: input.notes,
    });
    return snapshot;
  }

  async cancelTask(input: AgentTaskCancelInput): Promise<AgentTaskSnapshot> {
    this.ensureInitialized();
    const snapshot = this.getSnapshot(input.taskId);

    if (snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "cancelled") {
      return snapshot;
    }

    const handle = this.runtime.runningHandles.get(input.taskId);
    if (handle) {
      handle.cancel();
    }

    snapshot.status = "cancelled";
    snapshot.finishedAt = Date.now();
    snapshot.updatedAt = snapshot.finishedAt;
    snapshot.lastError = undefined;
    await this.persistSnapshot(snapshot);
    this.runtime.runningHandles.delete(input.taskId);
    if (this.runtime.activeTaskId === input.taskId) {
      this.runtime.activeTaskId = null;
    }
    this.syncTaskActivity(snapshot);
    await this.emitEvent({
      type: "agent.task.cancelled",
      taskId: snapshot.taskId,
      provider: snapshot.provider,
      status: snapshot.status,
      ts: snapshot.updatedAt,
      turn: snapshot.turn,
      sessionId: snapshot.sessionId,
    });
    this.kickQueue();
    return snapshot;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("Agent orchestrator is not initialized");
    }
  }

  private getSnapshot(taskId: string): AgentTaskSnapshot {
    const snapshot = this.snapshots.get(taskId);
    if (!snapshot) {
      throw new Error(`Unknown task: ${taskId}`);
    }
    return snapshot;
  }

  private loadSnapshots(): void {
    this.snapshots.clear();
    const indexEntries = this.readIndex();
    for (const entry of indexEntries) {
      const snapshot = this.tryReadSnapshot(entry.taskId);
      if (snapshot) {
        this.snapshots.set(snapshot.taskId, snapshot);
      }
    }
  }

  private readIndex(): TaskIndexEntry[] {
    if (!fs.existsSync(this.indexPath)) {
      return [];
    }
    try {
      const raw = fs.readFileSync(this.indexPath, "utf8");
      const parsed = JSON.parse(raw) as TaskIndexEntry[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      this.onError(`Failed to read agent task index: ${String(err)}`);
      return [];
    }
  }

  private tryReadSnapshot(taskId: string): AgentTaskSnapshot | null {
    try {
      const filePath = this.getTaskFilePath(taskId);
      const raw = fs.readFileSync(filePath, "utf8");
      return JSON.parse(raw) as AgentTaskSnapshot;
    } catch (err) {
      this.onError(`Failed to read agent task ${taskId}: ${String(err)}`);
      return null;
    }
  }

  private getTaskDir(taskId: string): string {
    return path.join(this.tasksPath, taskId);
  }

  private getTaskFilePath(taskId: string): string {
    return path.join(this.getTaskDir(taskId), "task.json");
  }

  private getTaskEventsPath(taskId: string): string {
    return path.join(this.getTaskDir(taskId), "events.jsonl");
  }

  private async persistSnapshot(snapshot: AgentTaskSnapshot): Promise<void> {
    fs.mkdirSync(this.getTaskDir(snapshot.taskId), { recursive: true });
    fs.writeFileSync(this.getTaskFilePath(snapshot.taskId), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    this.persistIndex();
    this.pruneHistory();
  }

  private persistIndex(): void {
    const entries: TaskIndexEntry[] = [...this.snapshots.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((snapshot) => ({
        taskId: snapshot.taskId,
        provider: snapshot.provider,
        status: snapshot.status,
        updatedAt: snapshot.updatedAt,
      }));
    fs.writeFileSync(this.indexPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  }

  private pruneHistory(): void {
    const terminal = [...this.snapshots.values()]
      .filter((snapshot) => snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "cancelled")
      .sort((a, b) => b.updatedAt - a.updatedAt);
    for (const snapshot of terminal.slice(this.taskHistoryLimit)) {
      this.snapshots.delete(snapshot.taskId);
      try {
        fs.rmSync(this.getTaskDir(snapshot.taskId), { recursive: true, force: true });
      } catch (err) {
        this.onError(`Failed to prune task ${snapshot.taskId}: ${String(err)}`);
      }
    }
    this.persistIndex();
  }

  private async appendEvent(taskId: string, event: AgentTaskEvent): Promise<void> {
    fs.mkdirSync(this.getTaskDir(taskId), { recursive: true });
    fs.appendFileSync(this.getTaskEventsPath(taskId), `${JSON.stringify(event)}\n`, "utf8");
  }

  private async emitEvent(event: AgentTaskEvent): Promise<void> {
    await this.appendEvent(event.taskId, event);
    try {
      await this.emitGatewayEvent(event);
    } catch (err) {
      this.onWarn(`Failed to emit gateway event ${event.type}: ${String(err)}`);
    }
  }

  private syncTaskActivity(snapshot: AgentTaskSnapshot): void {
    this.onSnapshotChange(snapshot);
  }

  private buildTurnInput(
    snapshot: AgentTaskSnapshot,
    options?: { decisionChoice?: string; decisionNotes?: string }
  ): AgentTaskProviderTurnInput {
    const prompt = options?.decisionChoice
      ? [
          `Continue the existing task after the user selected option "${options.decisionChoice}".`,
          options.decisionNotes ? `User notes: ${options.decisionNotes}` : "",
          "If the task was originally a plan task, continue in planning mode and refine the chosen option without making code changes.",
        ].filter(Boolean).join("\n")
      : snapshot.prompt;

    return {
      taskId: snapshot.taskId,
      turn: snapshot.turn + 1,
      mode: snapshot.mode,
      prompt,
      cwd: snapshot.cwd ?? ".",
      timeoutMs: snapshot.timeoutMs,
      metadata: snapshot.metadata,
      sessionId: snapshot.sessionId,
      decisionChoice: options?.decisionChoice,
      decisionNotes: options?.decisionNotes,
      onEvent: (event) => {
        void this.handleProviderEvent(snapshot.taskId, event);
      },
    };
  }

  private async handleProviderEvent(taskId: string, event: AgentTaskEvent): Promise<void> {
    const snapshot = this.getSnapshot(taskId);
    snapshot.updatedAt = event.ts;

    if (event.type === "agent.task.started" || event.type === "agent.task.resumed") {
      snapshot.status = "running";
      snapshot.startedAt ??= event.ts;
      snapshot.turn = event.turn;
      snapshot.latestProgress = event.type === "agent.task.resumed"
        ? `Resumed turn ${event.turn}`
        : `Started turn ${event.turn}`;
    } else if (event.type === "agent.task.progress") {
      snapshot.status = "running";
      snapshot.turn = event.turn;
      snapshot.latestProgress = event.message;
    } else if (event.type === "agent.task.output") {
      snapshot.status = "running";
      snapshot.turn = event.turn;
      snapshot.latestOutput = event.text;
    } else if (event.type === "agent.task.decision_required") {
      snapshot.status = "waiting_decision";
      snapshot.turn = event.turn;
      snapshot.decisionRequest = {
        question: event.question,
        options: event.options,
        recommendedOption: event.recommendedOption,
        contextSummary: event.contextSummary,
      };
      snapshot.latestProgress = event.question;
    } else if (event.type === "agent.task.completed") {
      snapshot.status = "completed";
      snapshot.turn = event.turn;
      snapshot.sessionId = event.sessionId ?? snapshot.sessionId;
      snapshot.resultText = event.resultText;
      snapshot.latestOutput = event.resultText;
      snapshot.finishedAt = event.ts;
      snapshot.decisionRequest = undefined;
      snapshot.lastError = undefined;
    } else if (event.type === "agent.task.failed") {
      snapshot.status = "failed";
      snapshot.turn = event.turn;
      snapshot.sessionId = event.sessionId ?? snapshot.sessionId;
      snapshot.lastError = event.error;
      snapshot.finishedAt = event.ts;
      snapshot.decisionRequest = undefined;
    } else if (event.type === "agent.task.cancelled") {
      snapshot.status = "cancelled";
      snapshot.turn = event.turn;
      snapshot.sessionId = event.sessionId ?? snapshot.sessionId;
      snapshot.finishedAt = event.ts;
      snapshot.decisionRequest = undefined;
    }

    await this.persistSnapshot(snapshot);
    this.syncTaskActivity(snapshot);
    await this.emitEvent(event);
  }

  private kickQueue(options?: { taskId?: string; decisionChoice?: string; decisionNotes?: string }): void {
    if (this.runtime.activeTaskId) {
      return;
    }

    const next = options?.taskId
      ? this.snapshots.get(options.taskId) ?? null
      : [...this.snapshots.values()]
        .filter((snapshot) => snapshot.status === "queued")
        .sort((a, b) => a.createdAt - b.createdAt)[0] ?? null;

    if (!next || next.status !== "queued") {
      return;
    }

    void this.runTask(next.taskId, options?.decisionChoice, options?.decisionNotes);
  }

  private async runTask(taskId: string, decisionChoice?: string, decisionNotes?: string): Promise<void> {
    const snapshot = this.getSnapshot(taskId);
    const provider = this.providers[snapshot.provider];
    if (!provider) {
      snapshot.status = "failed";
      snapshot.lastError = `Missing provider: ${snapshot.provider}`;
      snapshot.finishedAt = Date.now();
      snapshot.updatedAt = snapshot.finishedAt;
      await this.persistSnapshot(snapshot);
      this.syncTaskActivity(snapshot);
      return;
    }

    if (this.runtime.activeTaskId) {
      return;
    }

    this.runtime.activeTaskId = taskId;
    const turnInput = this.buildTurnInput(snapshot, { decisionChoice, decisionNotes });
    const turnRecord = {
      turn: turnInput.turn,
      kind: decisionChoice ? "respond" : "start",
      prompt: turnInput.prompt,
      startedAt: Date.now(),
      decisionChoice,
      decisionNotes,
    } as AgentTaskSnapshot["history"][number];
    snapshot.turn = turnInput.turn;
    snapshot.updatedAt = turnRecord.startedAt;
    snapshot.history.push(turnRecord);
    await this.persistSnapshot(snapshot);

    const runtimeHandle = snapshot.sessionId
      ? provider.resumeTask(turnInput)
      : provider.startTask(turnInput);
    this.runtime.runningHandles.set(taskId, { cancel: runtimeHandle.cancel });

    try {
      const result = await runtimeHandle.done;
      snapshot.sessionId = result.sessionId ?? snapshot.sessionId;
      turnRecord.completedAt = Date.now();
      turnRecord.sessionId = snapshot.sessionId;
      turnRecord.finalText = result.finalText;
      turnRecord.decisionRequest = result.decisionRequest;
      turnRecord.error = result.error;

      if (result.cancelled) {
        snapshot.status = "cancelled";
        snapshot.finishedAt = Date.now();
        snapshot.updatedAt = snapshot.finishedAt;
        await this.persistSnapshot(snapshot);
        await this.emitEvent({
          type: "agent.task.cancelled",
          taskId,
          provider: snapshot.provider,
          status: "cancelled",
          ts: snapshot.finishedAt,
          turn: snapshot.turn,
          sessionId: snapshot.sessionId,
        });
      } else if (result.error) {
        snapshot.status = "failed";
        snapshot.lastError = result.error;
        snapshot.finishedAt = Date.now();
        await this.handleProviderEvent(taskId, {
          type: "agent.task.failed",
          taskId,
          provider: snapshot.provider,
          status: "failed",
          ts: snapshot.finishedAt,
          turn: snapshot.turn,
          error: result.error,
          sessionId: snapshot.sessionId,
        });
      } else if (result.decisionRequest) {
        await this.handleProviderEvent(taskId, {
          type: "agent.task.decision_required",
          taskId,
          provider: snapshot.provider,
          status: "waiting_decision",
          ts: Date.now(),
          turn: snapshot.turn,
          question: result.decisionRequest.question,
          options: result.decisionRequest.options,
          recommendedOption: result.decisionRequest.recommendedOption,
          contextSummary: result.decisionRequest.contextSummary,
        });
      } else {
        await this.handleProviderEvent(taskId, {
          type: "agent.task.completed",
          taskId,
          provider: snapshot.provider,
          status: "completed",
          ts: Date.now(),
          turn: snapshot.turn,
          resultText: result.finalText ?? "",
          sessionId: snapshot.sessionId,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      snapshot.lastError = message;
      snapshot.status = "failed";
      snapshot.finishedAt = Date.now();
      snapshot.updatedAt = snapshot.finishedAt;
      await this.persistSnapshot(snapshot);
      this.syncTaskActivity(snapshot);
      await this.emitEvent({
        type: "agent.task.failed",
        taskId,
        provider: snapshot.provider,
        status: "failed",
        ts: snapshot.finishedAt,
        turn: snapshot.turn,
        error: message,
        sessionId: snapshot.sessionId,
      });
    } finally {
      this.runtime.runningHandles.delete(taskId);
      if (this.runtime.activeTaskId === taskId) {
        this.runtime.activeTaskId = null;
      }
      this.syncTaskActivity(snapshot);
      this.kickQueue();
    }
  }
}
