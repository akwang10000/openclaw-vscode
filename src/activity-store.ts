import { EventEmitter } from "events";

export interface Activity {
  id: number | string;
  command: string;
  category: string;
  intent: string;
  params: unknown;
  status: "running" | "waiting" | "ok" | "error";
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  payload?: unknown;
  error?: string;
}

interface AgentTaskActivityDetails {
  provider: string;
  status: "queued" | "running" | "waiting_decision" | "completed" | "failed" | "cancelled" | "interrupted";
  prompt: string;
  turn: number;
  latestOutput?: string;
  latestProgress?: string;
  decisionRequest?: unknown;
  resultText?: string;
  error?: string;
  updatedAt: number;
  createdAt: number;
}

const CATEGORY_MAP: Record<string, string> = {
  "vscode.file": "File",
  "vscode.dir": "File",
  "vscode.editor": "Editor",
  "vscode.lang": "Language",
  "vscode.code": "Language",
  "vscode.git": "Git",
  "vscode.test": "Test",
  "vscode.debug": "Debug",
  "vscode.terminal": "Terminal",
  "vscode.diagnostics": "Diagnostics",
  "vscode.workspace": "Workspace",
  "vscode.agent.task": "Agent Task",
};

function getCategory(command: string): string {
  const prefix = command.split(".").slice(0, 2).join(".");
  return CATEGORY_MAP[prefix] || "Other";
}

/** Generate a human-readable intent description */
export function describeIntent(command: string, params: unknown): string {
  const p = (params || {}) as Record<string, unknown>;
  switch (command) {
    case "vscode.file.read": return `Read ${shortPath(p.path)}`;
    case "vscode.file.write": return `Write ${shortPath(p.path)}`;
    case "vscode.file.edit": return `Edit ${shortPath(p.path)}`;
    case "vscode.file.delete": return `Delete ${shortPath(p.path)}`;
    case "vscode.dir.list": return `List ${shortPath(p.path) || "/"}`;

    case "vscode.editor.active": return "Get active editor";
    case "vscode.editor.openFiles": return "List open files";
    case "vscode.editor.selections": return "Get selections";
    case "vscode.diagnostics.get": return p.path ? `Diagnostics ${shortPath(p.path)}` : "Get diagnostics";
    case "vscode.workspace.info": return "Workspace info";

    case "vscode.lang.definition": return `Go to definition ${shortPath(p.path)}:${p.line}`;
    case "vscode.lang.references": return `Find references ${shortPath(p.path)}:${p.line}`;
    case "vscode.lang.hover": return `Hover info ${shortPath(p.path)}:${p.line}`;
    case "vscode.lang.symbols": return p.path ? `Symbols in ${shortPath(p.path)}` : `Search symbols "${p.query ?? ""}"`;
    case "vscode.lang.rename": return `Rename -> ${p.newName}`;
    case "vscode.lang.codeActions": return `Code actions ${shortPath(p.path)}:${p.line}`;
    case "vscode.lang.applyCodeAction": return "Apply code action";
    case "vscode.code.format": return `Format ${shortPath(p.path)}`;

    case "vscode.git.status": return "Git status";
    case "vscode.git.diff": return p.path ? `Diff ${shortPath(p.path)}` : "Diff all";
    case "vscode.git.log": return `Git log${p.limit ? ` (${p.limit})` : ""}`;
    case "vscode.git.blame": return `Blame ${shortPath(p.path)}`;
    case "vscode.git.stage": return `Stage ${shortPaths(p.paths) || "all"}`;
    case "vscode.git.unstage": return `Unstage ${shortPaths(p.paths) || "all"}`;
    case "vscode.git.commit": return `Commit: ${truncStr(String(p.message || ""), 40)}`;
    case "vscode.git.stash": return `Stash ${p.action || "push"}`;

    case "vscode.test.list": return "List tests";
    case "vscode.test.run": return p.path ? `Run tests in ${shortPath(p.path)}` : `Run tests${p.debug ? " (debug)" : ""}`;
    case "vscode.test.results": return "Test results";

    case "vscode.debug.launch":
      return typeof p.name === "string" && p.name
        ? `Launch debug ${p.name}`
        : p.config
          ? "Launch debug with custom config"
          : "Launch debug";
    case "vscode.debug.stop": return "Stop debug";
    case "vscode.debug.breakpoint": return `Breakpoint ${shortPath(p.path)}:${p.line}`;
    case "vscode.debug.evaluate": return `Eval: ${truncStr(String(p.expression || ""), 30)}`;
    case "vscode.debug.stackTrace": return "Stack trace";
    case "vscode.debug.variables": return "Variables";
    case "vscode.debug.status": return "Debug status";

    case "vscode.terminal.run": return `Run: ${truncStr(String(p.command || ""), 60)}`;

    case "vscode.agent.run": return `Agent: ${truncStr(String(p.prompt || ""), 50)}`;
    case "vscode.agent.status": return "Agent status";
    case "vscode.agent.setup": return "Agent setup";
    case "vscode.agent.task.start": return `Start ${String(p.provider || "agent")} task`;
    case "vscode.agent.task.status": return `Task status ${truncStr(String(p.taskId || ""), 16)}`;
    case "vscode.agent.task.list": return "List agent tasks";
    case "vscode.agent.task.respond": return `Respond to ${truncStr(String(p.taskId || ""), 16)}`;
    case "vscode.agent.task.cancel": return `Cancel ${truncStr(String(p.taskId || ""), 16)}`;
    case "vscode.agent.task.result": return `Task result ${truncStr(String(p.taskId || ""), 16)}`;
    default: return command.replace("vscode.", "");
  }
}

function shortPath(p: unknown): string {
  if (!p || typeof p !== "string") return "";
  const parts = p.split("/");
  return parts.length > 3 ? "..." + parts.slice(-2).join("/") : p;
}

function shortPaths(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) {
    return "";
  }
  const paths = value
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .slice(0, 2)
    .map((entry) => shortPath(entry));
  if (!paths.length) {
    return "";
  }
  return value.length > 2 ? `${paths.join(", ")}...` : paths.join(", ");
}

function truncStr(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function summarizePrompt(prompt: string, provider: string): string {
  const lines = prompt
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .filter((line) => {
      const lower = line.toLowerCase();
      return !(
        lower.startsWith("do not modify files") ||
        lower.startsWith("return only ") ||
        lower.startsWith("important constraint") ||
        lower.startsWith("the user selected option") ||
        lower.startsWith("user notes:") ||
        lower.startsWith("if the task was originally")
      );
    });
  const firstLine = lines[0] ?? "";
  const firstSentence = firstLine.split(/(?<=[.!?])\s+/)[0] ?? "";
  const summary = normalizeWhitespace(firstSentence || firstLine);
  return summary ? truncStr(summary.replace(/[.]+$/, ""), 80) : `${provider} task`;
}

function summarizeStatusText(value: string): string {
  const summary = normalizeWhitespace(value);
  return truncStr(summary.replace(/[.]+$/, ""), 72);
}

function isUsefulProgressText(value: string): boolean {
  const trimmed = normalizeWhitespace(value);
  if (!trimmed) {
    return false;
  }
  if (
    trimmed === "codex.event" ||
    trimmed === "item.completed" ||
    /^Started turn \d+$/i.test(trimmed) ||
    /^Resumed turn \d+$/i.test(trimmed) ||
    /^\d{4}-\d{2}-\d{2}[ T]/.test(trimmed)
  ) {
    return false;
  }
  const noisyFragments = [
    "thread-stream-state-changed",
    "codex_core::features",
    "rmcp::transport::worker",
    "missing-content-type",
    "local-environments is not supported",
  ];
  return !noisyFragments.some((fragment) => trimmed.includes(fragment));
}

export function describeAgentTaskIntent(taskId: string, details: AgentTaskActivityDetails): string {
  const summary = summarizePrompt(details.prompt, details.provider);
  const decisionRequest = details.decisionRequest as { question?: unknown } | undefined;
  const usefulProgress = details.latestProgress && isUsefulProgressText(details.latestProgress)
    ? summarizeStatusText(details.latestProgress)
    : "";
  const usefulError = details.error ? summarizeStatusText(details.error) : "";
  const waitingLabel =
    decisionRequest && typeof decisionRequest.question === "string" && decisionRequest.question.trim()
      ? summarizeStatusText(decisionRequest.question)
      : summary;

  switch (details.status) {
    case "queued":
      return `Preparing task: ${summary}`;
    case "running":
      return usefulProgress ? `Working on: ${summary} | ${usefulProgress}` : `Working on: ${summary}`;
    case "waiting_decision":
      return `Waiting for decision: ${waitingLabel}`;
    case "completed":
      return `Completed: ${summary}`;
    case "failed":
      return usefulError ? `Failed: ${summary} | ${usefulError}` : `Failed: ${summary}`;
    case "cancelled":
      return `Cancelled: ${summary}`;
    case "interrupted":
      return `Interrupted: ${summary}`;
    default:
      return `${details.provider} task ${truncStr(taskId, 12)}`;
  }
}

class ActivityStore extends EventEmitter {
  private activities: Activity[] = [];
  private nextId = 1;
  private maxEntries = 200;
  private taskActivityIds = new Map<string, string>();

  start(command: string, params: unknown): number {
    const id = this.nextId++;
    const activity: Activity = {
      id,
      command,
      category: getCategory(command),
      intent: describeIntent(command, params),
      params,
      status: "running",
      startedAt: Date.now(),
    };
    this.activities.unshift(activity);
    if (this.activities.length > this.maxEntries) {
      this.activities.length = this.maxEntries;
    }
    this.emit("change");
    return id;
  }

  finish(id: number, ok: boolean, result?: unknown, error?: string): void {
    const activity = this.activities.find((entry) => entry.id === id);
    if (!activity) return;
    activity.status = ok ? "ok" : "error";
    activity.finishedAt = Date.now();
    activity.durationMs = activity.finishedAt - activity.startedAt;
    if (ok) activity.payload = result;
    if (error) activity.error = error;
    this.emit("change");
  }

  upsertTask(
    taskId: string,
    details: AgentTaskActivityDetails
  ): void {
    const id = this.taskActivityIds.get(taskId) ?? `task:${taskId}`;
    this.taskActivityIds.set(taskId, id);
    const existing = this.activities.find((entry) => entry.id === id);
    const mappedStatus =
      details.status === "completed"
        ? "ok"
        : details.status === "failed" || details.status === "cancelled" || details.status === "interrupted"
          ? "error"
          : details.status === "waiting_decision"
            ? "waiting"
            : "running";
    const payload = {
      taskId,
      provider: details.provider,
      status: details.status,
      turn: details.turn,
      latestProgress: details.latestProgress,
      latestOutput: details.latestOutput,
      decisionRequest: details.decisionRequest,
      resultText: details.resultText,
    };

    if (existing) {
      existing.status = mappedStatus;
      existing.startedAt = details.createdAt;
      existing.finishedAt =
        mappedStatus === "running" || mappedStatus === "waiting"
          ? undefined
          : details.updatedAt;
      existing.durationMs = existing.finishedAt ? existing.finishedAt - existing.startedAt : undefined;
      existing.payload = payload;
      existing.error = details.error;
      existing.intent = describeAgentTaskIntent(taskId, details);
      existing.params = { prompt: details.prompt, provider: details.provider };
    } else {
      this.activities.unshift({
        id,
        command: "vscode.agent.task",
        category: "Agent Task",
        intent: describeAgentTaskIntent(taskId, details),
        params: { prompt: details.prompt, provider: details.provider },
        status: mappedStatus,
        startedAt: details.createdAt,
        finishedAt:
          mappedStatus === "running" || mappedStatus === "waiting"
            ? undefined
            : details.updatedAt,
        durationMs:
          mappedStatus === "running" || mappedStatus === "waiting"
            ? undefined
            : details.updatedAt - details.createdAt,
        payload,
        error: details.error,
      });
      if (this.activities.length > this.maxEntries) {
        this.activities.length = this.maxEntries;
      }
    }
    this.emit("change");
  }

  getAll(): Activity[] {
    return this.activities;
  }

  clear(): void {
    this.activities = [];
    this.emit("change");
  }

  getStats(): { total: number; ok: number; errors: number; running: number } {
    const total = this.activities.length;
    const ok = this.activities.filter((entry) => entry.status === "ok").length;
    const errors = this.activities.filter((entry) => entry.status === "error").length;
    const running = this.activities.filter((entry) => entry.status === "running" || entry.status === "waiting").length;
    return { total, ok, errors, running };
  }
}

export const activityStore = new ActivityStore();
