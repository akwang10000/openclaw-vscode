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

  assert.match(source, /workspace-write/);
  assert.match(source, /read-only/);
  assert.doesNotMatch(source, /args\.push\([^)]*"-a"/);
  assert.doesNotMatch(source, /args\.push\([^)]*"--approval"/);
});
