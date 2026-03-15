import { validateCliPath } from "./security-core";

export interface PersistedSettingsInput {
  gatewayHost: string;
  gatewayPort: number;
  gatewayToken: string;
  gatewayTls: boolean;
  autoConnect: boolean;
  displayName: string;
  readOnly: boolean;
  confirmWrites: boolean;
  terminalEnabled: boolean;
  terminalAllowlist: string[];
  agentEnabled: boolean;
  agentCliPath: string;
  agentDefaultMode: "agent" | "plan" | "ask";
  agentDefaultModel: string;
  agentTimeoutMs: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid settings payload");
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value.trim();
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be true or false`);
  }
  return value;
}

function readInteger(value: unknown, label: string, min: number, max: number): number {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
    throw new Error(`${label} must be an integer`);
  }
  if (raw < min || raw > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  return raw;
}

export function parseTerminalAllowlist(value: unknown): string[] {
  const allowlist = readString(value, "Terminal allowlist")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return allowlist;
}

export function parseSettingsInput(value: unknown): PersistedSettingsInput {
  const input = asRecord(value);
  const gatewayHost = readString(input.gatewayHost, "Gateway host");
  if (!gatewayHost) {
    throw new Error("Gateway host cannot be empty");
  }

  const displayName = readString(input.displayName, "Display name");
  if (!displayName) {
    throw new Error("Display name cannot be empty");
  }

  const terminalEnabled = readBoolean(input.terminalEnabled, "Terminal enabled");
  const terminalAllowlist = parseTerminalAllowlist(input.terminalAllowlist ?? "");
  if (terminalEnabled && terminalAllowlist.length === 0) {
    throw new Error("Terminal allowlist cannot be empty when terminal access is enabled");
  }

  const mode = readString(input.agentDefaultMode, "Agent mode") || "agent";
  if (mode !== "agent" && mode !== "plan" && mode !== "ask") {
    throw new Error("Agent mode must be one of: agent, plan, ask");
  }

  const cliPath = readString(input.agentCliPath ?? "agent", "Agent CLI path") || "agent";

  return {
    gatewayHost,
    gatewayPort: readInteger(input.gatewayPort, "Gateway port", 1, 65_535),
    gatewayToken: typeof input.gatewayToken === "string" ? input.gatewayToken : "",
    gatewayTls: readBoolean(input.gatewayTls, "Gateway TLS"),
    autoConnect: readBoolean(input.autoConnect, "Auto-connect"),
    displayName,
    readOnly: readBoolean(input.readOnly, "Read-only"),
    confirmWrites: readBoolean(input.confirmWrites, "Confirm writes"),
    terminalEnabled,
    terminalAllowlist,
    agentEnabled: readBoolean(input.agentEnabled, "Agent enabled"),
    agentCliPath: validateCliPath(cliPath).normalized,
    agentDefaultMode: mode,
    agentDefaultModel: typeof input.agentDefaultModel === "string" ? input.agentDefaultModel.trim() : "",
    agentTimeoutMs: readInteger(input.agentTimeoutMs, "Agent timeout", 1_000, 86_400_000),
  };
}

export function coerceMessageType(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }
  const type = (value as Record<string, unknown>).type;
  return typeof type === "string" ? type : "";
}
