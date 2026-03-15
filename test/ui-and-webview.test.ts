const test = require("node:test");
const assert = require("node:assert/strict");

const { describeIntent } = require("../src/activity-store.ts");
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
