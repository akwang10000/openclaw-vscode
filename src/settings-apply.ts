import * as vscode from "vscode";
import type { PersistedSettingsInput } from "./settings-validation";

export async function applySettings(settings: PersistedSettingsInput): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("openclaw");
  await cfg.update("gatewayHost", settings.gatewayHost, vscode.ConfigurationTarget.Global);
  await cfg.update("gatewayPort", settings.gatewayPort, vscode.ConfigurationTarget.Global);
  await cfg.update("gatewayToken", settings.gatewayToken, vscode.ConfigurationTarget.Global);
  await cfg.update("gatewayTls", settings.gatewayTls, vscode.ConfigurationTarget.Global);
  await cfg.update("autoConnect", settings.autoConnect, vscode.ConfigurationTarget.Global);
  await cfg.update("displayName", settings.displayName, vscode.ConfigurationTarget.Global);
  await cfg.update("readOnly", settings.readOnly, vscode.ConfigurationTarget.Global);
  await cfg.update("confirmWrites", settings.confirmWrites, vscode.ConfigurationTarget.Global);
  await cfg.update("terminal.enabled", settings.terminalEnabled, vscode.ConfigurationTarget.Global);
  await cfg.update("terminal.allowlist", settings.terminalAllowlist, vscode.ConfigurationTarget.Global);
  await cfg.update("agent.enabled", settings.agentEnabled, vscode.ConfigurationTarget.Global);
  await cfg.update("agent.cliPath", settings.agentCliPath, vscode.ConfigurationTarget.Global);
  await cfg.update("agent.defaultMode", settings.agentDefaultMode, vscode.ConfigurationTarget.Global);
  await cfg.update("agent.defaultModel", settings.agentDefaultModel, vscode.ConfigurationTarget.Global);
  await cfg.update("agent.timeoutMs", settings.agentTimeoutMs, vscode.ConfigurationTarget.Global);
}
