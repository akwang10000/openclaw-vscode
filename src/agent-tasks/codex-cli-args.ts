export type CodexTaskMode = "agent" | "plan" | "ask";

export interface BuildCodexExecArgsInput {
  cwd: string;
  prompt: string;
  mode: CodexTaskMode;
  sessionId?: string;
  outputSchemaPath?: string;
}

function getSandboxMode(mode: CodexTaskMode): string {
  return mode === "agent" ? "workspace-write" : "read-only";
}

function buildExecOptions(input: BuildCodexExecArgsInput): string[] {
  const args = [
    "--json",
    "--skip-git-repo-check",
    "-C", input.cwd,
    "-s", getSandboxMode(input.mode),
  ];
  if (input.outputSchemaPath) {
    args.push("--output-schema", input.outputSchemaPath);
  }
  return args;
}

export function buildCodexExecArgs(input: BuildCodexExecArgsInput): string[] {
  const execOptions = buildExecOptions(input);

  // --color is intentionally omitted here. Recent Codex CLIs reject it on
  // exec resume, while --json still keeps stdout machine-readable.
  // Resume is a nested exec subcommand in newer Codex CLIs, so the shared
  // exec options must appear before "resume" to be parsed by exec itself.
  if (input.sessionId) {
    return ["exec", ...execOptions, "resume", input.sessionId, input.prompt];
  }
  return ["exec", ...execOptions, input.prompt];
}
