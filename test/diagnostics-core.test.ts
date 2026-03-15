const test = require("node:test");
const assert = require("node:assert/strict");

const {
  analyzeGatewayAllowCommands,
  analyzeNodeCommandExposure,
  explainNodeStateQueryError,
  isLoopbackHost,
} = require("../src/diagnostics-core.ts");

const registeredCommands = [
  "vscode.workspace.info",
  "vscode.file.read",
  "vscode.git.status",
];

test("isLoopbackHost recognizes local gateway hosts", () => {
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("::1"), true);
  assert.equal(isLoopbackHost("192.168.1.10"), false);
});

test("analyzeGatewayAllowCommands flags legacy unprefixed command names", () => {
  const findings = analyzeGatewayAllowCommands(["workspace.info", "file.read"], registeredCommands);
  assert.equal(findings[0].code, "GATEWAY_ALLOWCOMMANDS_LEGACY_NAMES");
  assert.equal(findings[0].level, "error");
});

test("analyzeGatewayAllowCommands accepts full vscode command names", () => {
  const findings = analyzeGatewayAllowCommands(
    ["vscode.workspace.info", "vscode.file.read", "vscode.git.status"],
    registeredCommands
  );
  assert.equal(findings[0].code, "GATEWAY_ALLOWCOMMANDS_READY");
  assert.equal(findings[0].level, "ok");
});

test("analyzeNodeCommandExposure reports empty command lists", () => {
  const findings = analyzeNodeCommandExposure(
    { displayName: "VS Code", connected: true, paired: true, commands: [] },
    registeredCommands
  );
  assert.equal(findings[0].code, "NODE_COMMANDS_EMPTY");
  assert.equal(findings[0].level, "error");
});

test("analyzeNodeCommandExposure accepts complete command exposure", () => {
  const findings = analyzeNodeCommandExposure(
    { displayName: "VS Code", connected: true, paired: true, commands: registeredCommands },
    registeredCommands
  );
  assert.equal(findings.at(-1).code, "NODE_COMMANDS_READY");
  assert.equal(findings.at(-1).level, "ok");
});

test("explainNodeStateQueryError downgrades node-role node.list rejections to info", () => {
  const finding = explainNodeStateQueryError(new Error("unauthorized role: node"));
  assert.equal(finding.code, "NODE_LIST_RESTRICTED_FOR_NODE_ROLE");
  assert.equal(finding.level, "info");
  assert.match(finding.detail, /higher-privilege client/i);
});
