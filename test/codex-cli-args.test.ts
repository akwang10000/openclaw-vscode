const test = require("node:test");
const assert = require("node:assert/strict");

const { buildCodexExecArgs } = require("../src/agent-tasks/codex-cli-args.ts");

test("buildCodexExecArgs omits --color and places exec options before resume", () => {
  const args = buildCodexExecArgs({
    cwd: "H:\\workspace\\openclaw-vscode",
    prompt: "continue this task",
    mode: "agent",
    sessionId: "session-123",
  });

  assert.deepEqual(args, [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "-C", "H:\\workspace\\openclaw-vscode",
    "-s", "workspace-write",
    "resume",
    "session-123",
    "continue this task",
  ]);
  assert.equal(args.includes("--color"), false);
});

test("buildCodexExecArgs adds output schema for plan starts", () => {
  const args = buildCodexExecArgs({
    cwd: ".",
    prompt: "plan this",
    mode: "plan",
    outputSchemaPath: "schema.json",
  });

  assert.deepEqual(args, [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "-C", ".",
    "-s", "read-only",
    "--output-schema", "schema.json",
    "plan this",
  ]);
});
