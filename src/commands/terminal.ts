import {
  createSpawnCommand,
  ensureMutationAllowed,
  isExecutableAllowed,
  parseCommandString,
  resolveWorkspaceCwd,
} from "../security";
import { getConfig } from "../config";
import { log, logError, logWarn } from "../logger";
import { spawn } from "child_process";

interface TerminalRunParams {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

interface TerminalRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const MAX_OUTPUT = 100_000;

export async function terminalRun(params: TerminalRunParams): Promise<TerminalRunResult> {
  const cfg = getConfig();

  if (!cfg.terminalEnabled) {
    throw new Error("Terminal execution is disabled. Enable openclaw.terminal.enabled to use this.");
  }

  const parsed = parseCommandString(params.command);

  if (!isExecutableAllowed(parsed.executable, cfg.terminalAllowlist)) {
    throw new Error(
      `Command not in allowlist. Allowed: ${cfg.terminalAllowlist.join(", ")}`
    );
  }

  await ensureMutationAllowed("run a terminal command", params.command);

  const cwd = resolveWorkspaceCwd(params.cwd);

  const timeoutMs = params.timeoutMs ?? 60_000;
  const spawnCommand = createSpawnCommand(parsed.executable, parsed.args);

  logWarn(`terminal.run: ${params.command}`);

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const child = spawn(spawnCommand.file, spawnCommand.args, {
      shell: false,
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT) {
        stdout += chunk.toString("utf8").slice(0, MAX_OUTPUT - stdout.length);
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT) {
        stderr += chunk.toString("utf8").slice(0, MAX_OUTPUT - stderr.length);
      }
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, timeoutMs);

    const finalize = (exitCode: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      log(`terminal.run done: exit=${exitCode} timedOut=${timedOut}`);
      resolve({ exitCode, stdout, stderr, timedOut });
    };

    child.on("close", (code) => finalize(code));
    child.on("error", (err) => {
      logError(`terminal.run error: ${err.message}`);
      finalize(null);
    });
  });
}
