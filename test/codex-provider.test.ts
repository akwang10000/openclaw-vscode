const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function readProviderSource() {
  return fs.readFileSync(
    path.join(__dirname, "..", "src", "agent-tasks", "codex-provider.ts"),
    "utf8"
  );
}

test("codex provider no longer passes unsupported approval flags", () => {
  const source = readProviderSource();

  assert.match(source, /buildCodexExecArgs/);
  assert.doesNotMatch(source, /args\.push\([^)]*"-a"/);
  assert.doesNotMatch(source, /args\.push\([^)]*"--approval"/);
  assert.doesNotMatch(source, /"--color"/);
});

test("codex provider reports timeout as failed instead of cancelled", () => {
  const source = readProviderSource();

  assert.match(source, /let timedOut = false;/);
  assert.match(source, /timedOut = true;/);
  assert.match(source, /Codex task timed out after \$\{timeoutMs\}ms/);
  assert.doesNotMatch(source, /const timer = setTimeout\(\(\) => \{\s*cancelled = true;/s);
});
