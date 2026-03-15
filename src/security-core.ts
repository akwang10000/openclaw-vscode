import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

export interface ParsedCommand {
  executable: string;
  args: string[];
}

export interface EffectiveTimeout {
  timeoutMs: number;
  source: "local" | "remote";
}

export interface ContainedPathResolution {
  rootPath: string;
  canonicalRootPath: string;
  resolvedPath: string;
  canonicalPath: string;
  exists: boolean;
}

const COMMAND_CONTROL_CHARS = new Set(["|", "&", ";", "<", ">", "`"]);
const CLI_PATH_CONTROL_RE = /[`|<>&;$\r\n"]/;
const WINDOWS_BATCH_RE = /\.(cmd|bat)$/i;

function normalizeForComparison(value: string): string {
  const normalized = path.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isPathInsideRoot(rootPath: string, candidatePath: string): boolean {
  const normalizedRoot = normalizeForComparison(rootPath);
  const normalizedCandidate = normalizeForComparison(candidatePath);
  if (normalizedRoot === normalizedCandidate) {
    return true;
  }
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function findNearestExistingPath(targetPath: string): { existingPath: string; exists: boolean } {
  let current = path.resolve(targetPath);
  const { root } = path.parse(current);

  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current || current === root) {
      break;
    }
    current = parent;
  }

  return { existingPath: current, exists: fs.existsSync(targetPath) };
}

export function resolveContainedPath(rootPath: string, relativePath: string): ContainedPathResolution {
  const trimmed = relativePath.trim();
  if (path.isAbsolute(trimmed)) {
    throw new Error(`Absolute paths not allowed: ${relativePath}`);
  }

  const resolvedRootPath = path.resolve(rootPath);
  const canonicalRootPath = fs.realpathSync.native(resolvedRootPath);
  const resolvedPath = path.resolve(resolvedRootPath, trimmed || ".");
  const { existingPath, exists } = findNearestExistingPath(resolvedPath);
  const canonicalExistingPath = fs.realpathSync.native(existingPath);

  if (!isPathInsideRoot(canonicalRootPath, canonicalExistingPath)) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }

  const relativeFromExisting = path.relative(existingPath, resolvedPath);
  const canonicalPath = path.resolve(canonicalExistingPath, relativeFromExisting);
  if (!isPathInsideRoot(canonicalRootPath, canonicalPath)) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }

  return {
    rootPath: resolvedRootPath,
    canonicalRootPath,
    resolvedPath,
    canonicalPath,
    exists,
  };
}

export function parseCommandString(command: string): ParsedCommand {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("Command cannot be empty");
  }

  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    const next = trimmed[i + 1] ?? "";

    if (ch === "\r" || ch === "\n") {
      throw new Error("Command cannot contain newlines");
    }

    if (quote === null) {
      if (COMMAND_CONTROL_CHARS.has(ch) || ch === "^" || ch === "%" || ch === "!") {
        throw new Error(`Command contains unsupported shell control character: ${ch}`);
      }
      if (ch === "$" && next === "(") {
        throw new Error("Command substitution is not allowed");
      }
      if (ch === "'" || ch === "\"") {
        quote = ch;
        continue;
      }
      if (/\s/.test(ch)) {
        if (current) {
          tokens.push(current);
          current = "";
        }
        continue;
      }
      if (ch === "\\") {
        const escaped = trimmed[i + 1];
        if (escaped) {
          current += escaped;
          i += 1;
          continue;
        }
      }
      current += ch;
      continue;
    }

    if (ch === quote) {
      quote = null;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      throw new Error("Quoted arguments cannot contain newlines");
    }
    if (ch === "\\") {
      const escaped = trimmed[i + 1];
      if (escaped) {
        current += escaped;
        i += 1;
        continue;
      }
    }
    current += ch;
  }

  if (quote !== null) {
    throw new Error("Command contains an unterminated quoted string");
  }
  if (current) {
    tokens.push(current);
  }
  if (!tokens.length) {
    throw new Error("Command cannot be empty");
  }

  return {
    executable: tokens[0],
    args: tokens.slice(1),
  };
}

export function validateCliPath(input: string): { normalized: string; kind: "absolute" | "bare" } {
  const value = input.trim();
  if (!value) {
    throw new Error("Agent CLI path cannot be empty");
  }
  if (CLI_PATH_CONTROL_RE.test(value)) {
    throw new Error("Agent CLI path contains unsupported shell control characters");
  }

  if (path.isAbsolute(value)) {
    return { normalized: value, kind: "absolute" };
  }

  if (value.includes("/") || value.includes("\\")) {
    throw new Error("Agent CLI path must be a bare executable name or an absolute path");
  }
  if (/\s/.test(value)) {
    throw new Error("Bare executable names cannot contain spaces");
  }

  return { normalized: value, kind: "bare" };
}

export function computeEffectiveTimeout(localTimeoutSeconds: number, remoteTimeoutMs?: number | null): EffectiveTimeout {
  const localTimeoutMs = Math.max(1_000, Math.floor(localTimeoutSeconds * 1_000));
  const remote = typeof remoteTimeoutMs === "number" && Number.isFinite(remoteTimeoutMs)
    ? Math.max(1_000, Math.floor(remoteTimeoutMs))
    : null;

  if (remote !== null && remote < localTimeoutMs) {
    return { timeoutMs: remote, source: "remote" };
  }
  return { timeoutMs: localTimeoutMs, source: "local" };
}

export function evaluateMutationPolicy(readOnly: boolean, confirmWrites: boolean): {
  blocked: boolean;
  needsConfirmation: boolean;
} {
  return {
    blocked: readOnly,
    needsConfirmation: !readOnly && confirmWrites,
  };
}

export function resolveExecutablePath(executable: string, env: NodeJS.ProcessEnv = process.env): string {
  if (path.isAbsolute(executable)) {
    return executable;
  }

  const lookupTool = process.platform === "win32" ? "where" : "which";
  try {
    const out = execFileSync(lookupTool, [executable], {
      env,
      encoding: "utf8",
      timeout: 3_000,
    });
    const candidates = out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const preferred = process.platform === "win32"
      ? candidates.find((candidate) => fs.existsSync(candidate) && /\.(exe|com)$/i.test(candidate))
      : candidates.find((candidate) => fs.existsSync(candidate));
    const batchCandidate = candidates.find((candidate) => fs.existsSync(candidate) && WINDOWS_BATCH_RE.test(candidate));
    const existing = candidates.find((candidate) => fs.existsSync(candidate));
    return preferred ?? batchCandidate ?? existing ?? executable;
  } catch {
    return executable;
  }
}

export function needsWindowsBatchBridge(filePath: string): boolean {
  return process.platform === "win32" && WINDOWS_BATCH_RE.test(filePath);
}

function quoteForWindowsBatch(token: string): string {
  if (!token) {
    return "\"\"";
  }
  if (/[`|<>&;%!^\r\n"]/.test(token)) {
    throw new Error(`Unsupported character in Windows command argument: ${token}`);
  }
  if (/\s/.test(token) || /[()]/.test(token)) {
    return `"${token}"`;
  }
  return token;
}

export function buildWindowsBatchInvocation(filePath: string, args: string[]): string {
  return [quoteForWindowsBatch(filePath), ...args.map((arg) => quoteForWindowsBatch(arg))].join(" ");
}
