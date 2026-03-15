import { getConfig } from "../config";
import { ensureMutationAllowed, resolveWorkspaceCwd } from "../security";
import { getAgentOrchestrator } from "../agent-tasks/service";
import type {
  AgentTaskCancelInput,
  AgentTaskListFilter,
  AgentTaskRespondInput,
  AgentTaskStartInput,
} from "../agent-tasks/types";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error("Parameters must be an object");
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function readOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value.trim() || undefined;
}

function readOptionalInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function readMetadata(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("metadata must be an object of string values");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const metadata: Record<string, string> = {};
  for (const [key, rawValue] of entries) {
    if (typeof rawValue !== "string") {
      throw new Error(`metadata.${key} must be a string`);
    }
    metadata[key] = rawValue;
  }
  return metadata;
}

function readMode(value: unknown): "agent" | "plan" | "ask" {
  if (value === undefined || value === null || value === "") {
    return "agent";
  }
  if (value === "agent" || value === "plan" || value === "ask") {
    return value;
  }
  throw new Error("mode must be one of: agent, plan, ask");
}

export async function agentTaskStart(params: unknown): Promise<unknown> {
  const input = asRecord(params);
  const provider = readString(input.provider, "provider");
  if (provider !== "codex") {
    throw new Error("Only provider='codex' is supported in v1");
  }

  const prompt = readString(input.prompt, "prompt");
  const mode = readMode(input.mode);
  const cwd = readOptionalString(input.cwd, "cwd");
  const timeoutMs = readOptionalInteger(input.timeoutMs, "timeoutMs");
  const metadata = readMetadata(input.metadata);
  const cfg = getConfig();
  if (!cfg.agentCodexEnabled) {
    throw new Error("Codex provider is disabled. Set openclaw.agent.codex.enabled=true.");
  }
  if (mode === "agent") {
    await ensureMutationAllowed("run Codex in write mode", prompt.slice(0, 80));
  }

  const orchestrator = getAgentOrchestrator();
  const snapshot = await orchestrator.startTask({
    provider: "codex",
    prompt,
    mode,
    cwd: cwd ? resolveWorkspaceCwd(cwd) : resolveWorkspaceCwd(),
    timeoutMs,
    metadata,
  } satisfies AgentTaskStartInput);

  return {
    taskId: snapshot.taskId,
    provider: snapshot.provider,
    status: snapshot.status,
    mode: snapshot.mode,
    createdAt: snapshot.createdAt,
  };
}

export async function agentTaskStatus(params: unknown): Promise<unknown> {
  const input = asRecord(params);
  const orchestrator = getAgentOrchestrator();
  return orchestrator.getTaskStatus(readString(input.taskId, "taskId"));
}

export async function agentTaskList(params: unknown): Promise<unknown> {
  const input = !params ? {} : asRecord(params);
  const status = readOptionalString(input.status, "status");
  const limit = readOptionalInteger(input.limit, "limit");
  const orchestrator = getAgentOrchestrator();
  return orchestrator.listTasks({
    status: status as AgentTaskListFilter["status"],
    limit,
  });
}

export async function agentTaskRespond(params: unknown): Promise<unknown> {
  const input = asRecord(params);
  const orchestrator = getAgentOrchestrator();
  return orchestrator.respondToTask({
    taskId: readString(input.taskId, "taskId"),
    choice: readString(input.choice, "choice"),
    notes: readOptionalString(input.notes, "notes"),
  } satisfies AgentTaskRespondInput);
}

export async function agentTaskCancel(params: unknown): Promise<unknown> {
  const input = asRecord(params);
  const orchestrator = getAgentOrchestrator();
  return orchestrator.cancelTask({
    taskId: readString(input.taskId, "taskId"),
  } satisfies AgentTaskCancelInput);
}

export async function agentTaskResult(params: unknown): Promise<unknown> {
  const input = asRecord(params);
  const orchestrator = getAgentOrchestrator();
  return orchestrator.getTaskResult(readString(input.taskId, "taskId"));
}

