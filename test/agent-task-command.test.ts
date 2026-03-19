const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readSource(relPath) {
  return fs.readFileSync(path.join(__dirname, "..", relPath), "utf8");
}

test("agent task start defaults timeoutMs from config", () => {
  const source = readSource(path.join("src", "commands", "agent-task.ts"));

  assert.match(source, /timeoutMs:\s*timeoutMs \?\? cfg\.agentTimeoutMs \?\? 300_000/);
});
