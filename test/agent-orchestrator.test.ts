const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AgentOrchestrator } = require("../src/agent-tasks/orchestrator.ts");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate();
    if (value) {
      return value;
    }
    await delay(20);
  }
  throw new Error("Timed out waiting for condition");
}

class FakeProvider {
  constructor() {
    this.providerId = "codex";
    this.started = [];
    this.resumed = [];
    this.cancellations = [];
    this.pending = new Map();
  }

  startTask(input) {
    this.started.push(input);
    return this.#createHandle(input, false);
  }

  resumeTask(input) {
    this.resumed.push(input);
    return this.#createHandle(input, true);
  }

  cancelTask(taskId) {
    this.cancellations.push(taskId);
    const pending = this.pending.get(taskId);
    if (pending) {
      pending.cancelled = true;
      pending.resolve({ cancelled: true, sessionId: pending.sessionId });
    }
  }

  getSnapshot() {
    return null;
  }

  #createHandle(input, resumed) {
    let resolveDone;
    const done = new Promise((resolve) => {
      resolveDone = resolve;
    });
    const sessionId = resumed ? input.sessionId : `session-${input.taskId}`;

    input.onEvent({
      type: resumed ? "agent.task.resumed" : "agent.task.started",
      taskId: input.taskId,
      provider: "codex",
      status: "running",
      ts: Date.now(),
      turn: input.turn,
      ...(resumed ? { sessionId } : { prompt: input.prompt }),
    });

    if (input.mode === "plan" && !input.decisionChoice) {
      setTimeout(() => {
        input.onEvent({
          type: "agent.task.progress",
          taskId: input.taskId,
          provider: "codex",
          status: "running",
          ts: Date.now(),
          turn: input.turn,
          message: "thinking",
        });
        resolveDone({
          sessionId,
          finalText: "{\"question\":\"Which path?\",\"options\":[{\"id\":\"a\",\"label\":\"A\"},{\"id\":\"b\",\"label\":\"B\"}],\"recommendedOption\":\"a\",\"contextSummary\":\"summary\"}",
          decisionRequest: {
            question: "Which path?",
            options: [
              { id: "a", label: "A" },
              { id: "b", label: "B" },
            ],
            recommendedOption: "a",
            contextSummary: "summary",
          },
        });
      }, 25);
    } else {
      const pending = {
        resolve: resolveDone,
        cancelled: false,
        sessionId,
      };
      this.pending.set(input.taskId, pending);
      setTimeout(() => {
        if (!pending.cancelled) {
          input.onEvent({
            type: "agent.task.output",
            taskId: input.taskId,
            provider: "codex",
            status: "running",
            ts: Date.now(),
            turn: input.turn,
            text: resumed ? "final plan" : "done",
          });
          resolveDone({
            sessionId,
            finalText: resumed ? "final plan" : "done",
          });
        }
      }, 30);
    }

    return {
      cancel: () => this.cancelTask(input.taskId),
      done,
    };
  }
}

async function createOrchestrator() {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-test-"));
  const provider = new FakeProvider();
  const emitted = [];
  const orchestrator = new AgentOrchestrator({
    storagePath,
    taskHistoryLimit: 20,
    providers: { codex: provider },
    emitGatewayEvent: async (event) => {
      emitted.push(event);
    },
  });
  await orchestrator.initialize();
  return { orchestrator, provider, emitted, storagePath };
}

test("startTask creates a snapshot, emits events, and completes", async () => {
  const { orchestrator, emitted } = await createOrchestrator();
  const started = await orchestrator.startTask({
    provider: "codex",
    prompt: "Say hi",
    mode: "ask",
    cwd: ".",
  });

  const completed = await waitFor(async () => {
    const snapshot = await orchestrator.getTaskStatus(started.taskId);
    return snapshot.status === "completed" ? snapshot : null;
  });

  assert.equal(completed.resultText, "done");
  assert.ok(emitted.some((event) => event.type === "agent.task.started"));
  assert.ok(emitted.some((event) => event.type === "agent.task.completed"));
});

test("plan task waits for a decision and resume completes it", async () => {
  const { orchestrator, provider, emitted } = await createOrchestrator();
  const started = await orchestrator.startTask({
    provider: "codex",
    prompt: "Plan this",
    mode: "plan",
    cwd: ".",
  });

  const waiting = await waitFor(async () => {
    const snapshot = await orchestrator.getTaskStatus(started.taskId);
    return snapshot.status === "waiting_decision" ? snapshot : null;
  });

  assert.equal(waiting.decisionRequest.question, "Which path?");
  await orchestrator.respondToTask({
    taskId: started.taskId,
    choice: "a",
    notes: "Prefer path A",
  });

  const completed = await waitFor(async () => {
    const snapshot = await orchestrator.getTaskStatus(started.taskId);
    return snapshot.status === "completed" ? snapshot : null;
  });

  assert.equal(completed.resultText, "final plan");
  assert.equal(provider.resumed.length, 1);
  assert.ok(emitted.some((event) => event.type === "agent.task.decision_required"));
});

test("cancelTask stops a running task and persists cancelled state", async () => {
  const { orchestrator, emitted } = await createOrchestrator();
  const started = await orchestrator.startTask({
    provider: "codex",
    prompt: "Do work",
    mode: "agent",
    cwd: ".",
  });

  await orchestrator.cancelTask({ taskId: started.taskId });
  const cancelled = await waitFor(async () => {
    const snapshot = await orchestrator.getTaskStatus(started.taskId);
    return snapshot.status === "cancelled" ? snapshot : null;
  });

  assert.equal(cancelled.status, "cancelled");
  assert.ok(emitted.some((event) => event.type === "agent.task.cancelled"));
});

test("initialize converts persisted running tasks into interrupted tasks", async () => {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-restore-"));
  const tasksPath = path.join(storagePath, "tasks");
  const taskId = "task-1";
  fs.mkdirSync(path.join(tasksPath, taskId), { recursive: true });
  const snapshot = {
    taskId,
    provider: "codex",
    mode: "agent",
    status: "running",
    prompt: "resume me",
    createdAt: Date.now() - 1000,
    updatedAt: Date.now() - 500,
    turn: 1,
    history: [],
  };
  fs.writeFileSync(path.join(tasksPath, taskId, "task.json"), JSON.stringify(snapshot), "utf8");
  fs.writeFileSync(path.join(tasksPath, "index.json"), JSON.stringify([{ taskId, provider: "codex", status: "running", updatedAt: snapshot.updatedAt }]), "utf8");

  const orchestrator = new AgentOrchestrator({
    storagePath,
    taskHistoryLimit: 20,
    providers: { codex: new FakeProvider() },
    emitGatewayEvent: async () => {},
  });
  await orchestrator.initialize();

  const restored = await orchestrator.getTaskStatus(taskId);
  assert.equal(restored.status, "interrupted");
  assert.match(restored.lastError, /interrupted/i);
});

