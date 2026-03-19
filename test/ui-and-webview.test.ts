const test = require("node:test");
const assert = require("node:assert/strict");

const { describeIntent, describeAgentTaskIntent } = require("../src/activity-store.ts");
const { buildWebviewHtml, getWebviewCsp } = require("../src/webview-security.ts");

test("describeIntent uses the current command parameter names", () => {
  assert.equal(describeIntent("vscode.git.stage", { paths: ["src/a.ts", "src/b.ts"] }), "Stage src/a.ts, src/b.ts");
  assert.equal(describeIntent("vscode.git.log", { limit: 5 }), "Git log (5)");
  assert.equal(describeIntent("vscode.test.run", { path: "test/unit.ts" }), "Run tests in test/unit.ts");
  assert.equal(describeIntent("vscode.debug.launch", { name: "Extension" }), "Launch debug Extension");
});

test("buildWebviewHtml injects CSP and script nonce", () => {
  const html = buildWebviewHtml({
    title: "Test",
    cspSource: "vscode-webview://test",
    nonce: "abc123",
    styles: "body { color: red; }",
    body: "<div>Hello</div>",
    script: "console.log('hi');",
  });

  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'nonce-abc123'/);
  assert.match(html, /<script nonce="abc123">/);
  assert.match(getWebviewCsp("vscode-webview://test", "abc123"), /default-src 'none'/);
});

test("describeAgentTaskIntent formats agent task lifecycle text deterministically", () => {
  const base = {
    provider: "codex",
    prompt: "Improve natural-language task reporting in this project. Do not modify files.",
    turn: 1,
    updatedAt: Date.now(),
    createdAt: Date.now(),
  };

  assert.equal(
    describeAgentTaskIntent("task-1", {
      ...base,
      status: "queued",
    }),
    "Preparing task: Improve natural-language task reporting in this project"
  );

  assert.equal(
    describeAgentTaskIntent("task-1", {
      ...base,
      status: "running",
      latestProgress: "Analyzing activity-store.ts and activity-panel.ts",
    }),
    "Working on: Improve natural-language task reporting in this project | Analyzing activity-store.ts and activity-panel.ts"
  );

  assert.equal(
    describeAgentTaskIntent("task-1", {
      ...base,
      status: "waiting_decision",
      decisionRequest: {
        question: "Which implementation path should we take to improve task reporting?",
      },
    }),
    "Waiting for decision: Which implementation path should we take to improve task reporting?"
  );

  assert.equal(
    describeAgentTaskIntent("task-1", {
      ...base,
      status: "completed",
      resultText: "Done",
    }),
    "Completed: Improve natural-language task reporting in this project"
  );

  assert.equal(
    describeAgentTaskIntent("task-1", {
      ...base,
      status: "failed",
      error: "Codex task timed out after 300000ms",
    }),
    "Failed: Improve natural-language task reporting in this project | Codex task timed out after 300000ms"
  );
});

test("describeAgentTaskIntent filters noisy progress lines", () => {
  const intent = describeAgentTaskIntent("task-1", {
    provider: "codex",
    status: "running",
    prompt: "Investigate the resume path.",
    turn: 1,
    latestProgress: "2026-03-19 22:08:25.321 [warning] thread-stream-state-changed",
    updatedAt: Date.now(),
    createdAt: Date.now(),
  });

  assert.equal(intent, "Working on: Investigate the resume path");
});
