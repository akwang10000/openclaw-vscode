export type AgentTaskStatus =
  | "queued"
  | "running"
  | "waiting_decision"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type AgentTaskMode = "agent" | "plan" | "ask";
export type AgentTaskProviderId = "codex";

export interface AgentDecisionOption {
  id: string;
  label: string;
}

export interface AgentDecisionRequest {
  question: string;
  options: AgentDecisionOption[];
  recommendedOption: string;
  contextSummary: string;
}

export interface AgentTaskTurnRecord {
  turn: number;
  kind: "start" | "respond";
  prompt: string;
  startedAt: number;
  completedAt?: number;
  sessionId?: string;
  finalText?: string;
  decisionRequest?: AgentDecisionRequest;
  decisionChoice?: string;
  decisionNotes?: string;
  error?: string;
}

export interface AgentTaskSnapshot {
  taskId: string;
  provider: AgentTaskProviderId;
  mode: AgentTaskMode;
  status: AgentTaskStatus;
  prompt: string;
  cwd?: string;
  timeoutMs?: number;
  metadata?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  turn: number;
  sessionId?: string;
  latestOutput?: string;
  latestProgress?: string;
  lastError?: string;
  decisionRequest?: AgentDecisionRequest;
  resultText?: string;
  history: AgentTaskTurnRecord[];
}

export interface AgentTaskListFilter {
  status?: AgentTaskStatus;
  limit?: number;
}

export interface AgentTaskEventBase {
  taskId: string;
  provider: AgentTaskProviderId;
  status: AgentTaskStatus;
  ts: number;
}

export type AgentTaskEvent =
  | (AgentTaskEventBase & { type: "agent.task.started"; turn: number; prompt: string })
  | (AgentTaskEventBase & { type: "agent.task.resumed"; turn: number; sessionId?: string })
  | (AgentTaskEventBase & { type: "agent.task.progress"; turn: number; message: string })
  | (AgentTaskEventBase & { type: "agent.task.output"; turn: number; text: string })
  | (AgentTaskEventBase & { type: "agent.task.decision_required"; turn: number; question: string; options: AgentDecisionOption[]; recommendedOption: string; contextSummary: string })
  | (AgentTaskEventBase & { type: "agent.task.completed"; turn: number; resultText: string; sessionId?: string })
  | (AgentTaskEventBase & { type: "agent.task.failed"; turn: number; error: string; sessionId?: string })
  | (AgentTaskEventBase & { type: "agent.task.cancelled"; turn: number; sessionId?: string });

export interface AgentTaskStartInput {
  provider: AgentTaskProviderId;
  prompt: string;
  mode?: AgentTaskMode;
  cwd?: string;
  timeoutMs?: number;
  metadata?: Record<string, string>;
}

export interface AgentTaskRespondInput {
  taskId: string;
  choice: string;
  notes?: string;
}

export interface AgentTaskCancelInput {
  taskId: string;
}

export interface AgentTaskRuntimeHandle {
  cancel: () => void;
  done: Promise<AgentTaskProviderTurnResult>;
}

export interface AgentTaskProviderTurnInput {
  taskId: string;
  turn: number;
  mode: AgentTaskMode;
  prompt: string;
  cwd: string;
  timeoutMs?: number;
  metadata?: Record<string, string>;
  sessionId?: string;
  decisionChoice?: string;
  decisionNotes?: string;
  onEvent: (event: AgentTaskEvent) => void;
}

export interface AgentTaskProviderTurnResult {
  sessionId?: string;
  finalText?: string;
  decisionRequest?: AgentDecisionRequest;
  error?: string;
  cancelled?: boolean;
}

export interface AgentTaskProvider {
  providerId: AgentTaskProviderId;
  startTask(input: AgentTaskProviderTurnInput): AgentTaskRuntimeHandle;
  resumeTask(input: AgentTaskProviderTurnInput): AgentTaskRuntimeHandle;
  cancelTask(taskId: string): void;
  getSnapshot(taskId: string): { sessionId?: string } | null;
}

