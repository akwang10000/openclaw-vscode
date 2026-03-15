export type DiagnosisLevel = "ok" | "info" | "warn" | "error";

export interface DiagnosisFinding {
  level: DiagnosisLevel;
  code: string;
  message: string;
  detail?: string;
}

export interface NodeCommandSnapshot {
  nodeId?: string;
  displayName?: string;
  connected?: boolean;
  paired?: boolean;
  commands?: string[];
}

export function explainNodeStateQueryError(error: unknown): DiagnosisFinding {
  const detail = error instanceof Error ? error.message : String(error);
  const normalized = detail.toLowerCase();

  if (normalized.includes("unauthorized role: node")) {
    return {
      level: "info",
      code: "NODE_LIST_RESTRICTED_FOR_NODE_ROLE",
      message: "Live node enumeration is not available from the VS Code node role.",
      detail: "The extension is connected, but Gateway only allows node.list from a higher-privilege client. Verify live node exposure from the OpenClaw app or CLI if needed.",
    };
  }

  return {
    level: "warn",
    code: "NODE_LIST_UNAVAILABLE",
    message: "Could not query Gateway for live node command state.",
    detail,
  };
}

function pushFinding(
  findings: DiagnosisFinding[],
  level: DiagnosisLevel,
  code: string,
  message: string,
  detail?: string
): void {
  findings.push({ level, code, message, detail });
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

export function analyzeGatewayAllowCommands(
  allowCommands: string[] | undefined,
  registeredCommands: string[]
): DiagnosisFinding[] {
  const findings: DiagnosisFinding[] = [];
  const normalized = (allowCommands ?? []).map((value) => value.trim()).filter(Boolean);
  const allowSet = new Set(normalized);
  const exactMatches = registeredCommands.filter((command) => allowSet.has(command));
  const legacyMatches = registeredCommands.filter((command) => allowSet.has(command.replace(/^vscode\./, "")));

  if (normalized.length === 0) {
    pushFinding(
      findings,
      "error",
      "GATEWAY_ALLOWCOMMANDS_EMPTY",
      "Local Gateway config does not allow any VS Code node commands.",
      "Add exact command names such as vscode.workspace.info and vscode.file.read to gateway.nodes.allowCommands."
    );
    return findings;
  }

  if (exactMatches.length === 0 && legacyMatches.length > 0) {
    pushFinding(
      findings,
      "error",
      "GATEWAY_ALLOWCOMMANDS_LEGACY_NAMES",
      "Gateway allowCommands uses old unprefixed names that do not match this extension.",
      `Replace values like ${legacyMatches[0].replace(/^vscode\./, "")} with exact names such as ${legacyMatches[0]}.`
    );
    return findings;
  }

  if (exactMatches.length === 0) {
    pushFinding(
      findings,
      "error",
      "GATEWAY_ALLOWCOMMANDS_NO_MATCH",
      "Gateway allowCommands does not include this extension's exact vscode.* command names.",
      "OpenClaw may show connected=true and paired=true but commands=[] until gateway.nodes.allowCommands contains exact vscode.* entries."
    );
    return findings;
  }

  if (exactMatches.length < registeredCommands.length) {
    pushFinding(
      findings,
      "warn",
      "GATEWAY_ALLOWCOMMANDS_PARTIAL",
      `Gateway allowCommands exposes ${exactMatches.length} of ${registeredCommands.length} registered VS Code commands.`,
      "This is valid if intentional, but some OpenClaw actions may stay unavailable."
    );
    return findings;
  }

  pushFinding(
    findings,
    "ok",
    "GATEWAY_ALLOWCOMMANDS_READY",
    `Gateway allowCommands includes all ${registeredCommands.length} registered VS Code commands.`
  );
  return findings;
}

export function analyzeNodeCommandExposure(
  node: NodeCommandSnapshot | null,
  registeredCommands: string[]
): DiagnosisFinding[] {
  const findings: DiagnosisFinding[] = [];
  if (!node) {
    pushFinding(
      findings,
      "warn",
      "NODE_NOT_FOUND",
      "Gateway did not return this VS Code node in node.list.",
      "Reconnect the extension and refresh the OpenClaw node list."
    );
    return findings;
  }

  if (!node.paired) {
    pushFinding(
      findings,
      "warn",
      "NODE_NOT_PAIRED",
      "The VS Code node is not marked as paired yet.",
      "Approve the device in OpenClaw before invoking commands."
    );
  }

  if (!node.connected) {
    pushFinding(
      findings,
      "warn",
      "NODE_NOT_CONNECTED",
      "The VS Code node is currently disconnected in Gateway."
    );
  }

  const commands = Array.isArray(node.commands) ? node.commands.filter((value) => typeof value === "string") : [];
  if (commands.length === 0) {
    pushFinding(
      findings,
      "error",
      "NODE_COMMANDS_EMPTY",
      "Gateway sees the VS Code node, but it exposes zero commands.",
      "This usually means gateway.nodes.allowCommands does not contain exact vscode.* names."
    );
    return findings;
  }

  const declaredSet = new Set(commands);
  const exactMatches = registeredCommands.filter((command) => declaredSet.has(command));
  if (exactMatches.length === 0) {
    pushFinding(
      findings,
      "error",
      "NODE_COMMANDS_NO_MATCH",
      "Gateway returned commands for this node, but none match the extension's registered vscode.* commands."
    );
    return findings;
  }

  if (exactMatches.length < registeredCommands.length) {
    pushFinding(
      findings,
      "warn",
      "NODE_COMMANDS_PARTIAL",
      `Gateway currently exposes ${exactMatches.length} of ${registeredCommands.length} registered VS Code commands.`
    );
    return findings;
  }

  pushFinding(
    findings,
    "ok",
    "NODE_COMMANDS_READY",
    `Gateway currently exposes all ${registeredCommands.length} registered VS Code commands for this node.`
  );
  return findings;
}
