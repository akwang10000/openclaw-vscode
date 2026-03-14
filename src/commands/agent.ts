import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { spawn } from "child_process";
import { getConfig } from "../config";
import { log, logError, logWarn } from "../logger";
import {
  createSpawnCommand,
  ensureMutationAllowed,
  getValidatedCliPath,
  resolveWorkspaceCwd,
} from "../security";

/** Get PATH with common CLI install locations added */
function getEnhancedPath(): string {
  const home = os.homedir();
  const extra = [
    path.join(home, ".cursor", "bin"),
    path.join(home, ".local", "bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
  ];
  const current = process.env.PATH || "";
  return [...extra, current].join(path.delimiter);
}

export function getEnhancedEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: getEnhancedPath() };
}

interface AgentRunParams {
  prompt: string;
  mode?: "agent" | "plan" | "ask";
  model?: string;
  cwd?: string;
  timeoutMs?: number;
}

interface AgentRunResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
}

export interface AgentCliCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  combinedOutput: string;
  timedOut: boolean;
}

const MAX_OUTPUT = 200_000;

function getConfiguredCliPath(): string {
  const cfg = getConfig();
  return getValidatedCliPath(cfg.agentCliPath || "agent");
}

export async function runAgentCliCommand(
  args: string[],
  options: {
    cwd?: string;
    timeoutMs?: number;
    useWorkspaceRoot?: boolean;
  } = {}
): Promise<AgentCliCommandResult> {
  const spawnCommand = createSpawnCommand(getConfiguredCliPath(), args, getEnhancedEnv());
  const cwd = options.cwd
    ? resolveWorkspaceCwd(options.cwd)
    : options.useWorkspaceRoot
      ? resolveWorkspaceCwd()
      : undefined;
  const timeoutMs = options.timeoutMs ?? 30_000;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const child = spawn(spawnCommand.file, spawnCommand.args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: getEnhancedEnv(),
      shell: false,
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
      resolve({
        exitCode,
        stdout,
        stderr,
        combinedOutput: `${stdout}${stderr}`.slice(0, MAX_OUTPUT),
        timedOut,
      });
    };

    child.on("close", (code) => finalize(code));
    child.on("error", (err) => {
      logError(`agent CLI error: ${err.message}`);
      finalize(null);
    });
  });
}

async function detectAgentCli(): Promise<{ found: boolean; path: string; version?: string }> {
  const cfg = getConfig();
  const rawCliPath = cfg.agentCliPath || "agent";

  try {
    const result = await runAgentCliCommand(["--version"], { timeoutMs: 5_000 });
    if (result.exitCode === 0) {
      return {
        found: true,
        path: getConfiguredCliPath(),
        version: result.combinedOutput.trim(),
      };
    }
  } catch {
    // invalid CLI path or launch failure, return not found below
  }

  return { found: false, path: rawCliPath };
}

export async function openAgentCliTerminal(title: string, args: string[]): Promise<void> {
  const spawnCommand = createSpawnCommand(getConfiguredCliPath(), args, getEnhancedEnv());
  const terminal = vscode.window.createTerminal({
    name: title,
    shellPath: spawnCommand.file,
    shellArgs: spawnCommand.args,
    env: getEnhancedEnv(),
  });
  terminal.show();
}

/** Check agent CLI status - used by setup wizard and status commands */
export async function agentStatus(): Promise<{
  cliFound: boolean;
  cliPath: string;
  cliVersion?: string;
  isCursor: boolean;
}> {
  const isCursor = vscode.env.appName?.toLowerCase().includes("cursor") ?? false;
  const cli = await detectAgentCli();
  return {
    cliFound: cli.found,
    cliPath: cli.path,
    cliVersion: cli.version,
    isCursor,
  };
}

/** Run Cursor Agent CLI with a prompt */
export async function agentRun(params: AgentRunParams): Promise<AgentRunResult> {
  const cfg = getConfig();

  if (!cfg.agentEnabled) {
    throw new Error(
      "Agent integration is disabled. Enable it in OpenClaw Settings -> Agent section."
    );
  }

  const mode = params.mode || cfg.agentDefaultMode || "agent";
  const model = params.model || cfg.agentDefaultModel || undefined;
  if (mode === "agent") {
    await ensureMutationAllowed("run Cursor Agent in write mode", params.prompt.slice(0, 80));
  }

  const args: string[] = ["--trust", "-p", params.prompt];
  if (mode !== "agent") args.push(`--mode=${mode}`);
  if (model) args.push("--model", model);
  args.push("--output-format", "text");

  logWarn(`agent.run: mode=${mode} model=${model || "auto"} prompt="${params.prompt.slice(0, 80)}..."`);

  const timeoutMs = params.timeoutMs ?? cfg.agentTimeoutMs ?? 300_000;
  const result = await runAgentCliCommand(args, {
    cwd: params.cwd,
    timeoutMs,
    useWorkspaceRoot: !params.cwd,
  });

  log(`agent.run done: exit=${result.exitCode} timedOut=${result.timedOut} output=${result.combinedOutput.length} chars`);
  return {
    exitCode: result.exitCode,
    output: result.combinedOutput,
    timedOut: result.timedOut,
  };
}

/** Show setup wizard if agent CLI is not configured */
export async function agentSetup(): Promise<{
  cliFound: boolean;
  isCursor: boolean;
  message: string;
}> {
  const status = await agentStatus();

  if (status.cliFound) {
    return {
      cliFound: true,
      isCursor: status.isCursor,
      message: `Agent CLI found: ${status.cliPath} (${status.cliVersion || "unknown version"})`,
    };
  }

  const installCmd = process.platform === "win32"
    ? "irm 'https://cursor.com/install?win32=true' | iex"
    : "curl https://cursor.com/install -fsSL | bash";

  const choice = await vscode.window.showInformationMessage(
    "Cursor Agent CLI not found. Install it to enable AI coding agent integration.",
    "Install Now",
    "Enter Path",
    "Later"
  );

  if (choice === "Install Now") {
    const term = vscode.window.createTerminal("Install Cursor Agent");
    term.show();
    term.sendText(installCmd);
    return {
      cliFound: false,
      isCursor: status.isCursor,
      message: "Installing... Run the command in the terminal, then re-check with \"OpenClaw: Agent Setup\".",
    };
  }

  if (choice === "Enter Path") {
    const input = await vscode.window.showInputBox({
      prompt: "Path to Cursor Agent CLI binary",
      placeHolder: "/usr/local/bin/agent",
    });
    if (input) {
      getValidatedCliPath(input);
      const cfg = vscode.workspace.getConfiguration("openclaw");
      await cfg.update("agent.cliPath", input, vscode.ConfigurationTarget.Global);
      return {
        cliFound: false,
        isCursor: status.isCursor,
        message: "Path saved. Restart or re-check to verify.",
      };
    }
  }

  return {
    cliFound: false,
    isCursor: status.isCursor,
    message: "Agent CLI setup skipped. You can configure it later in OpenClaw Settings.",
  };
}
