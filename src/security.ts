import * as path from "path";
import * as vscode from "vscode";
import { getConfig } from "./config";
import {
  buildWindowsBatchInvocation,
  evaluateMutationPolicy,
  needsWindowsBatchBridge,
  parseCommandString,
  resolveExecutablePath,
  validateCliPath,
} from "./security-core";
export { computeEffectiveTimeout, evaluateMutationPolicy, parseCommandString, validateCliPath } from "./security-core";

export interface SpawnCommand {
  file: string;
  args: string[];
}

/**
 * Resolve a relative path to an absolute path within the workspace.
 * Throws if the path escapes the workspace sandbox.
 */
export function resolveWorkspacePath(relativePath: string): vscode.Uri {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error("No workspace folder open");
  }

  const rootUri = workspaceFolders[0].uri;
  const rootPath = rootUri.fsPath;

  // Reject absolute paths
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Absolute paths not allowed: ${relativePath}`);
  }

  // Resolve and check containment
  const resolved = path.resolve(rootPath, relativePath);
  const normalizedRoot = path.resolve(rootPath) + path.sep;
  const normalizedResolved = path.resolve(resolved);

  // Allow exact root match or must be inside root
  if (normalizedResolved !== path.resolve(rootPath) &&
      !normalizedResolved.startsWith(normalizedRoot)) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }

  return vscode.Uri.file(resolved);
}

export function resolveWorkspaceCwd(relativePath?: string): string {
  if (!relativePath) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error("No workspace folder open");
    }
    return workspaceFolders[0].uri.fsPath;
  }

  return resolveWorkspacePath(relativePath).fsPath;
}

/**
 * Check if a terminal command is in the allowlist.
 */
export function isCommandAllowed(command: string, allowlist: string[]): boolean {
  const parsed = parseCommandString(command);
  return isExecutableAllowed(parsed.executable, allowlist);
}

export function isExecutableAllowed(executable: string, allowlist: string[]): boolean {
  const baseCmd = executable.trim();
  if (!baseCmd) {
    return false;
  }
  const baseName = path.basename(baseCmd);
  return allowlist.some(
    (allowed) =>
      allowed === "*" ||
      baseName === allowed ||
      baseName === `${allowed}.exe` ||
      baseName === `${allowed}.cmd` ||
      baseName === `${allowed}.bat`
  );
}

export async function ensureMutationAllowed(
  actionLabel: string,
  targetLabel?: string
): Promise<void> {
  const cfg = getConfig();
  const policy = evaluateMutationPolicy(cfg.readOnly, cfg.confirmWrites);
  if (policy.blocked) {
    throw new Error("Read-only mode is enabled");
  }
  if (!policy.needsConfirmation) {
    return;
  }

  const label = targetLabel ? `${actionLabel}: ${targetLabel}` : actionLabel;
  const choice = await vscode.window.showWarningMessage(
    `OpenClaw wants to ${label}`,
    "Allow",
    "Deny"
  );
  if (choice !== "Allow") {
    throw new Error("Operation denied by user");
  }
}

export function getValidatedCliPath(input: string): string {
  return validateCliPath(input).normalized;
}

export function createSpawnCommand(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): SpawnCommand {
  const resolvedExecutable = path.isAbsolute(executable)
    ? executable
    : resolveExecutablePath(executable, env);

  if (needsWindowsBatchBridge(resolvedExecutable)) {
    const comspec = process.env.ComSpec || "cmd.exe";
    return {
      file: comspec,
      args: ["/d", "/s", "/c", buildWindowsBatchInvocation(resolvedExecutable, args)],
    };
  }

  return {
    file: resolvedExecutable,
    args,
  };
}
