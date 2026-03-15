import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { getConfig } from "../config";
import { createSpawnCommand, validateCliPath } from "../security";
import { logError, logWarn } from "../logger";
import { getEnhancedEnv } from "../commands/agent";
import type {
  AgentDecisionRequest,
  AgentTaskProvider,
  AgentTaskProviderTurnInput,
  AgentTaskProviderTurnResult,
  AgentTaskRuntimeHandle,
} from "./types";

function writeUtf8NoBom(filePath: string, content: string): void {
  const encoding = new TextEncoder();
  fs.writeFileSync(filePath, encoding.encode(content));
}

function buildDecisionSchema(): string {
  return JSON.stringify({
    type: "object",
    properties: {
      question: { type: "string" },
      options: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            label: { type: "string" },
          },
          required: ["id", "label"],
          additionalProperties: false,
        },
      },
      recommendedOption: { type: "string" },
      contextSummary: { type: "string" },
    },
    required: ["question", "options", "recommendedOption", "contextSummary"],
    additionalProperties: false,
  }, null, 2);
}

function parseDecisionRequest(raw: string): AgentDecisionRequest {
  const parsed = JSON.parse(raw) as AgentDecisionRequest;
  if (
    !parsed ||
    typeof parsed.question !== "string" ||
    !Array.isArray(parsed.options) ||
    typeof parsed.recommendedOption !== "string" ||
    typeof parsed.contextSummary !== "string"
  ) {
    throw new Error("Codex plan output did not match the decision schema");
  }
  if (!parsed.options.length) {
    throw new Error("Codex plan output did not include any decision options");
  }
  return parsed;
}

function buildTurnPrompt(input: AgentTaskProviderTurnInput): string {
  if (input.mode !== "plan" || input.decisionChoice) {
    return input.prompt;
  }

  return [
    input.prompt,
    "",
    "Do not execute changes.",
    "Return only a structured decision request with 2-4 meaningful implementation options, one recommended option, and a short context summary.",
  ].join("\n");
}

function buildResumePrompt(input: AgentTaskProviderTurnInput): string {
  return [
    input.prompt,
    "",
    `The user selected option "${input.decisionChoice}".`,
    input.decisionNotes ? `User notes: ${input.decisionNotes}` : "",
    input.mode === "plan"
      ? "Continue in planning mode, refine the chosen option, and return the final plan in plain text."
      : "Continue the task accordingly and return the final result in plain text.",
  ].filter(Boolean).join("\n");
}

export class CodexTaskProvider implements AgentTaskProvider {
  readonly providerId = "codex" as const;
  private readonly schemaPath: string;
  private readonly handles = new Map<string, { cancel: () => void; sessionId?: string }>();

  constructor(storagePath: string) {
    this.schemaPath = path.join(storagePath, "codex-plan-schema.json");
    fs.mkdirSync(storagePath, { recursive: true });
    writeUtf8NoBom(this.schemaPath, buildDecisionSchema());
  }

  startTask(input: AgentTaskProviderTurnInput): AgentTaskRuntimeHandle {
    return this.runTurn(input, false);
  }

  resumeTask(input: AgentTaskProviderTurnInput): AgentTaskRuntimeHandle {
    return this.runTurn(input, true);
  }

  cancelTask(taskId: string): void {
    this.handles.get(taskId)?.cancel();
  }

  getSnapshot(taskId: string): { sessionId?: string } | null {
    const handle = this.handles.get(taskId);
    return handle ? { sessionId: handle.sessionId } : null;
  }

  private runTurn(input: AgentTaskProviderTurnInput, resume: boolean): AgentTaskRuntimeHandle {
    const cfg = getConfig();
    if (!cfg.agentCodexEnabled) {
      throw new Error("Codex provider is disabled. Enable openclaw.agent.codex.enabled first.");
    }

    const cliPath = validateCliPath(cfg.agentCodexCliPath || "codex").normalized;
    const prompt = resume ? buildResumePrompt(input) : buildTurnPrompt(input);
    const args = this.buildArgs(input, prompt, resume);
    const spawnCommand = createSpawnCommand(cliPath, args, getEnhancedEnv());

    let latestText = "";
    let sessionId = input.sessionId;
    let cancelled = false;
    let settled = false;
    let stderrOutput = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";

    if (resume) {
      input.onEvent({
        type: "agent.task.resumed",
        taskId: input.taskId,
        provider: "codex",
        status: "running",
        ts: Date.now(),
        turn: input.turn,
        sessionId,
      });
    } else {
      input.onEvent({
        type: "agent.task.started",
        taskId: input.taskId,
        provider: "codex",
        status: "running",
        ts: Date.now(),
        turn: input.turn,
        prompt: input.prompt,
      });
    }

    const child = spawn(spawnCommand.file, spawnCommand.args, {
      cwd: input.cwd,
      env: getEnhancedEnv(),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeoutMs = input.timeoutMs ?? 300_000;
    const timer = setTimeout(() => {
      cancelled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, timeoutMs);

    const runtimeHandle: AgentTaskRuntimeHandle = {
      cancel: () => {
        cancelled = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      },
      done: new Promise<AgentTaskProviderTurnResult>((resolve) => {
        const finish = (result: AgentTaskProviderTurnResult) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          this.handles.delete(input.taskId);
          resolve(result);
        };

        const handleStdoutLine = (line: string) => {
          const trimmed = line.trim();
          if (!trimmed) {
            return;
          }
          try {
            const parsed = JSON.parse(trimmed) as Record<string, unknown>;
            const type = typeof parsed.type === "string" ? parsed.type : "";
            if (type === "thread.started" && typeof parsed.thread_id === "string") {
              sessionId = parsed.thread_id;
              this.handles.set(input.taskId, { cancel: runtimeHandle.cancel, sessionId });
              return;
            }
            if (type === "item.completed") {
              const item = parsed.item as Record<string, unknown> | undefined;
              if (item && item.type === "agent_message" && typeof item.text === "string") {
                latestText = item.text;
                input.onEvent({
                  type: "agent.task.output",
                  taskId: input.taskId,
                  provider: "codex",
                  status: "running",
                  ts: Date.now(),
                  turn: input.turn,
                  text: latestText,
                });
                return;
              }
            }
            input.onEvent({
              type: "agent.task.progress",
              taskId: input.taskId,
              provider: "codex",
              status: "running",
              ts: Date.now(),
              turn: input.turn,
              message: type || "codex.event",
            });
          } catch {
            latestText = trimmed;
            input.onEvent({
              type: "agent.task.output",
              taskId: input.taskId,
              provider: "codex",
              status: "running",
              ts: Date.now(),
              turn: input.turn,
              text: trimmed,
            });
          }
        };

        const handleStderrLine = (line: string) => {
          const trimmed = line.trim();
          if (!trimmed) {
            return;
          }
          stderrOutput = `${stderrOutput}${trimmed}\n`.slice(-20_000);
          input.onEvent({
            type: "agent.task.progress",
            taskId: input.taskId,
            provider: "codex",
            status: "running",
            ts: Date.now(),
            turn: input.turn,
            message: trimmed,
          });
        };

        const flushLines = (chunk: string, carry: string, onLine: (line: string) => void): string => {
          const combined = `${carry}${chunk}`;
          const parts = combined.split(/\r?\n/);
          const nextCarry = parts.pop() ?? "";
          for (const part of parts) {
            onLine(part);
          }
          return nextCarry;
        };

        child.stdout?.on("data", (chunk: Buffer) => {
          stdoutBuffer = flushLines(chunk.toString("utf8"), stdoutBuffer, handleStdoutLine);
        });

        child.stderr?.on("data", (chunk: Buffer) => {
          stderrBuffer = flushLines(chunk.toString("utf8"), stderrBuffer, handleStderrLine);
        });

        child.on("error", (err) => {
          logError(`codex provider failed to start: ${err.message}`);
          finish({ error: err.message, sessionId });
        });

        child.on("close", (code) => {
          if (stdoutBuffer.trim()) {
            handleStdoutLine(stdoutBuffer);
          }
          if (stderrBuffer.trim()) {
            handleStderrLine(stderrBuffer);
          }

          if (cancelled) {
            finish({ cancelled: true, sessionId, finalText: latestText || undefined });
            return;
          }
          if (code !== 0) {
            finish({
              error: stderrOutput.trim() || `Codex exited with code ${code}`,
              sessionId,
              finalText: latestText || undefined,
            });
            return;
          }

          if (input.mode === "plan" && !input.decisionChoice) {
            try {
              finish({
                sessionId,
                decisionRequest: parseDecisionRequest(latestText),
                finalText: latestText,
              });
            } catch (err) {
              finish({
                error: err instanceof Error ? err.message : String(err),
                sessionId,
                finalText: latestText,
              });
            }
            return;
          }

          finish({
            sessionId,
            finalText: latestText || "",
          });
        });
      }),
    };

    this.handles.set(input.taskId, { cancel: runtimeHandle.cancel, sessionId });
    return runtimeHandle;
  }

  private buildArgs(input: AgentTaskProviderTurnInput, prompt: string, resume: boolean): string[] {
    const args = resume && input.sessionId
      ? ["exec", "resume", input.sessionId, prompt]
      : ["exec", prompt];

    args.push("--json", "--color", "never", "--skip-git-repo-check", "-C", input.cwd);

    // The local Codex CLI version used by this project supports sandbox selection
    // but not the older "-a/--approval" flag shape. Keep the args compatible with
    // current exec help output so task launches work on real machines.
    if (input.mode === "agent") {
      args.push("-s", "workspace-write");
    } else {
      args.push("-s", "read-only");
    }

    if (input.mode === "plan" && !input.decisionChoice) {
      args.push("--output-schema", this.schemaPath);
    }

    return args;
  }
}
