import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { getRegisteredCommands } from "./commands/registry";
import { getConfig } from "./config";
import type { DiagnosisFinding, NodeCommandSnapshot } from "./diagnostics-core";
import { analyzeGatewayAllowCommands, analyzeNodeCommandExposure, isLoopbackHost } from "./diagnostics-core";
import { loadOrCreateDeviceIdentity } from "./device-identity";
import type { GatewayClient } from "./gateway-client";
import { getOutputChannel } from "./logger";

interface LocalGatewayConfigSnapshot {
  path: string;
  token?: string;
  allowCommands?: string[];
}

interface GatewayNodeListResponse {
  nodes?: NodeCommandSnapshot[];
}

async function probeTcpPort(host: string, port: number, timeoutMs = 2_500): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish());
    socket.once("timeout", () => finish(new Error(`Timed out after ${timeoutMs}ms`)));
    socket.once("error", (err) => finish(err instanceof Error ? err : new Error(String(err))));
    socket.connect(port, host);
  });
}

function tryLoadLocalGatewayConfig(): LocalGatewayConfigSnapshot | null {
  const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  if (!fs.existsSync(configPath)) {
    return null;
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as {
    gateway?: {
      auth?: { token?: unknown };
      nodes?: { allowCommands?: unknown };
    };
  };

  const token = typeof parsed.gateway?.auth?.token === "string" ? parsed.gateway.auth.token : undefined;
  const allowCommands = Array.isArray(parsed.gateway?.nodes?.allowCommands)
    ? parsed.gateway?.nodes?.allowCommands.filter((value): value is string => typeof value === "string")
    : undefined;

  return { path: configPath, token, allowCommands };
}

function formatFindingLevel(level: DiagnosisFinding["level"]): string {
  if (level === "ok") return "OK";
  if (level === "info") return "INFO";
  if (level === "warn") return "WARN";
  return "ERROR";
}

function summarize(findings: DiagnosisFinding[]): { errors: number; warnings: number } {
  return {
    errors: findings.filter((finding) => finding.level === "error").length,
    warnings: findings.filter((finding) => finding.level === "warn").length,
  };
}

export async function runConnectionDiagnosis(client: GatewayClient | null): Promise<void> {
  const cfg = getConfig();
  const registeredCommands = getRegisteredCommands();
  const findings: DiagnosisFinding[] = [
    {
      level: "info",
      code: "CONFIG_GATEWAY",
      message: `Configured gateway: ${cfg.gatewayTls ? "wss" : "ws"}://${cfg.gatewayHost}:${cfg.gatewayPort}`,
    },
    {
      level: cfg.gatewayToken.trim() ? "ok" : "error",
      code: "CONFIG_TOKEN",
      message: cfg.gatewayToken.trim()
        ? "Gateway token is configured in VS Code settings."
        : "Gateway token is missing in VS Code settings.",
      detail: cfg.gatewayToken.trim()
        ? undefined
        : "Set openclaw.gatewayToken or run OpenClaw: Setup Wizard.",
    },
  ];

  if (cfg.gatewayTls && isLoopbackHost(cfg.gatewayHost)) {
    findings.push({
      level: "warn",
      code: "CONFIG_LOCAL_TLS",
      message: "TLS is enabled for a loopback Gateway host.",
      detail: "Most local OpenClaw gateways use ws://127.0.0.1:18789, not wss://. If you see WRONG_VERSION_NUMBER, turn TLS off.",
    });
  }

  if (cfg.terminalEnabled && cfg.terminalAllowlist.some((entry) => entry.trim() === "*")) {
    findings.push({
      level: "warn",
      code: "TERMINAL_ALLOWLIST_WILDCARD",
      message: "Terminal allowlist contains '*'.",
      detail: "This extension is designed around explicit executable names such as git, npm, pnpm, node, or tsc.",
    });
  }

  try {
    await probeTcpPort(cfg.gatewayHost, cfg.gatewayPort);
    findings.push({
      level: "ok",
      code: "TCP_REACHABLE",
      message: "Gateway TCP port is reachable from this machine.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    findings.push({
      level: "error",
      code: "TCP_UNREACHABLE",
      message: `Cannot reach ${cfg.gatewayHost}:${cfg.gatewayPort}.`,
      detail: message,
    });
  }

  if (isLoopbackHost(cfg.gatewayHost)) {
    try {
      const localGateway = tryLoadLocalGatewayConfig();
      if (!localGateway) {
        findings.push({
          level: "warn",
          code: "LOCAL_CONFIG_MISSING",
          message: "Local OpenClaw config was not found at ~/.openclaw/openclaw.json.",
        });
      } else {
        findings.push({
          level: "info",
          code: "LOCAL_CONFIG_FOUND",
          message: `Loaded local OpenClaw config from ${localGateway.path}.`,
        });
        if (localGateway.token && cfg.gatewayToken.trim() && localGateway.token !== cfg.gatewayToken.trim()) {
          findings.push({
            level: "error",
            code: "TOKEN_MISMATCH",
            message: "VS Code Gateway token does not match the local OpenClaw Gateway token.",
            detail: "Copy gateway.auth.token from ~/.openclaw/openclaw.json into openclaw.gatewayToken.",
          });
        }
        findings.push(...analyzeGatewayAllowCommands(localGateway.allowCommands, registeredCommands));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      findings.push({
        level: "warn",
        code: "LOCAL_CONFIG_READ_FAILED",
        message: "Could not read the local OpenClaw config for diagnosis.",
        detail: message,
      });
    }
  } else {
    findings.push({
      level: "info",
      code: "REMOTE_GATEWAY",
      message: "Remote Gateway host detected; local ~/.openclaw/openclaw.json checks were skipped.",
    });
  }

  if (!client || client.state !== "connected") {
    findings.push({
      level: "warn",
      code: "CLIENT_NOT_CONNECTED",
      message: "The VS Code extension is not currently connected to Gateway.",
      detail: "Run OpenClaw: Connect before expecting commands to appear in OpenClaw.",
    });
  } else {
    findings.push({
      level: "ok",
      code: "CLIENT_CONNECTED",
      message: "The VS Code extension is currently connected to Gateway.",
    });
    try {
      const identity = loadOrCreateDeviceIdentity();
      const nodeList = await client.request<GatewayNodeListResponse>("node.list", {});
      const matchingNode = Array.isArray(nodeList.nodes)
        ? nodeList.nodes.find((node) => node.nodeId === identity.deviceId)
          ?? nodeList.nodes.find((node) => node.displayName === cfg.displayName)
          ?? null
        : null;
      findings.push(...analyzeNodeCommandExposure(matchingNode, registeredCommands));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      findings.push({
        level: "warn",
        code: "NODE_LIST_UNAVAILABLE",
        message: "Could not query Gateway for live node command state.",
        detail: message,
      });
    }
  }

  const channel = getOutputChannel();
  channel.show(true);
  channel.appendLine("");
  channel.appendLine("=== OpenClaw Connection Diagnosis ===");
  for (const finding of findings) {
    channel.appendLine(`${formatFindingLevel(finding.level)}  ${finding.message}`);
    if (finding.detail) {
      channel.appendLine(`      ${finding.detail}`);
    }
  }

  const summary = summarize(findings);
  const summaryText = `Diagnosis complete: ${summary.errors} error(s), ${summary.warnings} warning(s).`;

  if (summary.errors > 0) {
    const choice = await vscode.window.showWarningMessage(
      summaryText,
      "Open Log",
      "Open Settings",
      "Setup Wizard"
    );
    if (choice === "Open Log") {
      channel.show(true);
    } else if (choice === "Open Settings") {
      await vscode.commands.executeCommand("openclaw.settings");
    } else if (choice === "Setup Wizard") {
      await vscode.commands.executeCommand("openclaw.setup");
    }
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    summaryText,
    "Open Log",
    "Open Settings"
  );
  if (choice === "Open Log") {
    channel.show(true);
  } else if (choice === "Open Settings") {
    await vscode.commands.executeCommand("openclaw.settings");
  }
}
