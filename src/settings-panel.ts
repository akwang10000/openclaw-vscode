import * as vscode from "vscode";
import { log } from "./logger";
import { runAgentCliCommand, openAgentCliTerminal } from "./commands/agent";
import { applySettings } from "./settings-apply";
import { coerceMessageType, parseSettingsInput } from "./settings-validation";
import { buildWebviewHtml, createNonce } from "./webview-security";

let panel: vscode.WebviewPanel | null = null;

export function showSettingsPanel(context: vscode.ExtensionContext): void {
  if (panel) {
    panel.reveal();
    return;
  }

  panel = vscode.window.createWebviewPanel(
    "openclawSettings",
    "OpenClaw Settings",
    vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [] }
  );

  const cfg = vscode.workspace.getConfiguration("openclaw");
  const nonce = createNonce();
  panel.webview.html = getHtml(
    {
      gatewayHost: cfg.get<string>("gatewayHost", "127.0.0.1"),
      gatewayPort: cfg.get<number>("gatewayPort", 18789),
      gatewayToken: cfg.get<string>("gatewayToken", ""),
      gatewayTls: cfg.get<boolean>("gatewayTls", false),
      autoConnect: cfg.get<boolean>("autoConnect", false),
      displayName: cfg.get<string>("displayName", "VS Code"),
      readOnly: cfg.get<boolean>("readOnly", false),
      confirmWrites: cfg.get<boolean>("confirmWrites", false),
      terminalEnabled: cfg.get<boolean>("terminal.enabled", false),
      terminalAllowlist: cfg.get<string[]>("terminal.allowlist", ["git", "npm", "pnpm", "npx", "node", "tsc"]).join(", "),
      agentEnabled: cfg.get<boolean>("agent.enabled", false),
      agentCliPath: cfg.get<string>("agent.cliPath", "agent"),
      agentDefaultMode: cfg.get<string>("agent.defaultMode", "agent"),
      agentDefaultModel: cfg.get<string>("agent.defaultModel", ""),
      agentTimeoutMs: cfg.get<number>("agent.timeoutMs", 300000),
    },
    panel.webview.cspSource,
    nonce
  );

  panel.webview.onDidReceiveMessage(async (msg) => {
    const type = coerceMessageType(msg);
    try {
      if (type === "save" || type === "saveAndConnect") {
        const settings = parseSettingsInput((msg as { data?: unknown }).data);
        await applySettings(settings);
        log("Settings saved");
        vscode.window.showInformationMessage("OpenClaw settings saved.");
        if (type === "saveAndConnect") {
          await vscode.commands.executeCommand("openclaw.connect");
        }
        return;
      }

      if (type === "connect") {
        await vscode.commands.executeCommand("openclaw.connect");
        return;
      }

      if (type === "diagnose") {
        await vscode.commands.executeCommand("openclaw.diagnoseConnection");
        return;
      }

      if (type === "installCli") {
        const cmd = process.platform === "win32"
          ? "irm 'https://cursor.com/install?win32=true' | iex"
          : "curl https://cursor.com/install -fsSL | bash";
        const term = vscode.window.createTerminal("Install Cursor Agent");
        term.show();
        term.sendText(cmd);
        return;
      }

      if (type === "agentLogin") {
        await openAgentCliTerminal("Cursor Agent Login", ["login"]);
        return;
      }

      if (type === "loadModels") {
        const result = await runAgentCliCommand(["--list-models", "--trust"], { timeoutMs: 10_000 });
        const out = result.combinedOutput.trim();
        if (result.exitCode !== 0 || !out) {
          panel?.webview.postMessage({ type: "modelsError", error: "Failed to load models. Make sure the CLI is installed and authenticated." });
          return;
        }

        const models = out
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("Available") && !line.startsWith("---"))
          .map((model) => {
            const dash = model.indexOf(" - ");
            return dash > 0
              ? { id: model.slice(0, dash).trim(), label: model.trim() }
              : { id: model, label: model };
          });
        panel?.webview.postMessage({ type: "modelsLoaded", models });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(message);
      panel?.webview.postMessage({ type: "settingsError", error: message });
    }
  });

  panel.onDidDispose(() => {
    panel = null;
  });
}

interface SettingsData {
  gatewayHost: string;
  gatewayPort: number;
  gatewayToken: string;
  gatewayTls: boolean;
  autoConnect: boolean;
  displayName: string;
  readOnly: boolean;
  confirmWrites: boolean;
  terminalEnabled: boolean;
  terminalAllowlist: string;
  agentEnabled: boolean;
  agentCliPath: string;
  agentDefaultMode: string;
  agentDefaultModel: string;
  agentTimeoutMs: number;
}

function getHtml(data: SettingsData, cspSource: string, nonce: string): string {
  return buildWebviewHtml({
    title: "OpenClaw Settings",
    cspSource,
    nonce,
    styles: `
  body {
    font-family: var(--vscode-font-family, system-ui);
    padding: 20px;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    max-width: 640px;
  }
  h1 { font-size: 1.5em; margin-bottom: 4px; }
  .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 24px; font-size: 0.9em; }
  .section { margin-bottom: 24px; }
  .section-title {
    font-size: 1.1em;
    font-weight: 600;
    margin-bottom: 12px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--vscode-widget-border, #444);
  }
  .field { margin-bottom: 14px; }
  label {
    display: block;
    margin-bottom: 4px;
    font-weight: 500;
    font-size: 0.9em;
  }
  .hint {
    color: var(--vscode-descriptionForeground);
    font-size: 0.8em;
    margin-top: 2px;
  }
  input[type="text"], input[type="number"], input[type="password"], select {
    width: 100%;
    padding: 6px 8px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, #444);
    border-radius: 4px;
    font-size: 0.9em;
    box-sizing: border-box;
  }
  .checkbox-row, .row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .checkbox-row input[type="checkbox"], .row input[type="checkbox"] {
    width: 16px;
    height: 16px;
  }
  .checkbox-row label, .row label {
    margin: 0;
    font-weight: normal;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 20px;
  }
  button {
    padding: 8px 20px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9em;
    font-weight: 500;
  }
  .btn-primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .btn-secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .error {
    display: none;
    margin-bottom: 16px;
    padding: 10px 12px;
    border: 1px solid var(--vscode-errorForeground, #f14c4c);
    border-radius: 4px;
    color: var(--vscode-errorForeground, #f14c4c);
  }
  .notice {
    margin-top: 10px;
    padding: 10px 12px;
    border: 1px solid var(--vscode-widget-border, #444);
    border-radius: 4px;
    background: color-mix(in srgb, var(--vscode-editor-background) 85%, var(--vscode-button-background) 15%);
    font-size: 0.85em;
    line-height: 1.5;
  }
`,
    body: `
<h1>OpenClaw Node</h1>
<div class="subtitle">Connect your IDE to OpenClaw Gateway</div>
<div id="error" class="error"></div>

<div class="section">
  <div class="section-title">Gateway Connection</div>
  <div class="field">
    <label>Host</label>
    <input type="text" id="gatewayHost" value="${escHtml(data.gatewayHost)}" placeholder="localhost">
    <div class="hint">Required. Use 127.0.0.1 for a local Gateway, or a LAN / tailnet address for remote access.</div>
  </div>
  <div class="field">
    <label>Port</label>
    <input type="number" id="gatewayPort" value="${data.gatewayPort}" placeholder="18789">
  </div>
  <div class="field">
    <label>Token</label>
    <input type="password" id="gatewayToken" value="${escHtml(data.gatewayToken)}" placeholder="Gateway token">
    <div class="hint">For a local Gateway, copy gateway.auth.token from ~/.openclaw/openclaw.json.</div>
  </div>
  <div class="checkbox-row">
    <input type="checkbox" id="gatewayTls" ${data.gatewayTls ? "checked" : ""}>
    <label for="gatewayTls">Use TLS (wss://)</label>
  </div>
  <div class="hint">Most local Gateways use plain ws://127.0.0.1:18789. Turn TLS on only if your Gateway is really serving wss://.</div>
  <div class="notice">
    If OpenClaw shows <code>connected: true</code> and <code>paired: true</code> but <code>commands: []</code>,
    check <code>gateway.nodes.allowCommands</code> in OpenClaw and make sure it contains exact names such as
    <code>vscode.workspace.info</code> and <code>vscode.file.read</code>.
  </div>
</div>

<div class="section">
  <div class="section-title">Node Settings</div>
  <div class="field">
    <label>Display Name</label>
    <input type="text" id="displayName" value="${escHtml(data.displayName)}" placeholder="My VS Code">
    <div class="hint">Required. This is how the node appears in Gateway.</div>
  </div>
  <div class="checkbox-row">
    <input type="checkbox" id="autoConnect" ${data.autoConnect ? "checked" : ""}>
    <label for="autoConnect">Auto-connect on startup</label>
  </div>
</div>

<div class="section">
  <div class="section-title">Security</div>
  <div class="checkbox-row">
    <input type="checkbox" id="readOnly" ${data.readOnly ? "checked" : ""}>
    <label for="readOnly">Read-only mode (blocks all mutating commands)</label>
  </div>
  <div class="checkbox-row">
    <input type="checkbox" id="confirmWrites" ${data.confirmWrites ? "checked" : ""}>
    <label for="confirmWrites">Confirm before mutating commands</label>
  </div>
</div>

<div class="section">
  <div class="section-title">Terminal</div>
  <div class="checkbox-row">
    <input type="checkbox" id="terminalEnabled" ${data.terminalEnabled ? "checked" : ""}>
    <label for="terminalEnabled">Enable terminal commands</label>
  </div>
  <div class="field">
    <label>Allowlist</label>
    <input type="text" id="terminalAllowlist" value="${escHtml(data.terminalAllowlist)}" placeholder="git, npm, pnpm">
    <div class="hint">Comma-separated executable names only. Wildcards such as <code>*</code> are not supported.</div>
  </div>
</div>

<div class="section">
  <div class="section-title">Agent (Cursor CLI)</div>
  <div class="hint" style="margin-bottom:8px">
    Integrate with <a href="https://cursor.com/docs/cli/overview">Cursor Agent CLI</a> to delegate coding tasks.
  </div>
  <div style="display:flex;gap:6px;margin-bottom:10px">
    <button class="btn-secondary" style="padding:4px 10px;font-size:11px" id="installCliBtn">Install CLI</button>
    <button class="btn-secondary" style="padding:4px 10px;font-size:11px" id="agentLoginBtn">Login</button>
  </div>
  <div class="row">
    <input type="checkbox" id="agentEnabled" ${data.agentEnabled ? "checked" : ""}>
    <label for="agentEnabled">Enable Agent integration</label>
  </div>
  <div id="agentFields" style="display:${data.agentEnabled ? "block" : "none"}">
    <div class="field">
      <label>CLI Path</label>
      <input type="text" id="agentCliPath" value="${escHtml(data.agentCliPath)}" placeholder="agent">
      <div class="hint">Use a bare executable name or an absolute path.</div>
    </div>
    <div class="field">
      <label>Default Mode</label>
      <select id="agentDefaultMode">
        <option value="agent" ${data.agentDefaultMode === "agent" ? "selected" : ""}>Agent - Full access</option>
        <option value="plan" ${data.agentDefaultMode === "plan" ? "selected" : ""}>Plan - Design first</option>
        <option value="ask" ${data.agentDefaultMode === "ask" ? "selected" : ""}>Ask - Read-only</option>
      </select>
    </div>
    <div class="field">
      <label>Default Model</label>
      <div style="display:flex;gap:6px;align-items:center">
        <select id="agentDefaultModel" style="flex:1">
          <option value="">auto (Cursor decides)</option>
          ${data.agentDefaultModel ? `<option value="${escHtml(data.agentDefaultModel)}" selected>${escHtml(data.agentDefaultModel)}</option>` : ""}
        </select>
        <button class="btn-secondary" style="padding:4px 10px;font-size:11px;white-space:nowrap" id="loadModelsBtn">Load</button>
      </div>
      <div class="hint">Load models after the CLI is installed and authenticated.</div>
    </div>
    <div class="field">
      <label>Timeout (ms)</label>
      <input type="number" id="agentTimeoutMs" value="${data.agentTimeoutMs}" placeholder="300000">
    </div>
  </div>
</div>

<div class="buttons">
  <button class="btn-primary" id="saveBtn">Save Settings</button>
  <button class="btn-secondary" id="saveConnectBtn">Save and Connect</button>
  <button class="btn-secondary" id="diagnoseBtn">Run Diagnosis</button>
</div>
`,
    script: `
  const vscode = acquireVsCodeApi();

  function showError(message) {
    const box = document.getElementById('error');
    box.textContent = message || '';
    box.style.display = message ? 'block' : 'none';
  }

  function getData() {
    return {
      gatewayHost: document.getElementById('gatewayHost').value,
      gatewayPort: document.getElementById('gatewayPort').value,
      gatewayToken: document.getElementById('gatewayToken').value,
      gatewayTls: document.getElementById('gatewayTls').checked,
      autoConnect: document.getElementById('autoConnect').checked,
      displayName: document.getElementById('displayName').value,
      readOnly: document.getElementById('readOnly').checked,
      confirmWrites: document.getElementById('confirmWrites').checked,
      terminalEnabled: document.getElementById('terminalEnabled').checked,
      terminalAllowlist: document.getElementById('terminalAllowlist').value,
      agentEnabled: document.getElementById('agentEnabled').checked,
      agentCliPath: document.getElementById('agentCliPath').value,
      agentDefaultMode: document.getElementById('agentDefaultMode').value,
      agentDefaultModel: document.getElementById('agentDefaultModel').value,
      agentTimeoutMs: document.getElementById('agentTimeoutMs').value,
    };
  }

  document.getElementById('agentEnabled').addEventListener('change', (event) => {
    document.getElementById('agentFields').style.display = event.target.checked ? 'block' : 'none';
  });
  document.getElementById('saveBtn').addEventListener('click', () => {
    showError('');
    vscode.postMessage({ type: 'save', data: getData() });
  });
  document.getElementById('saveConnectBtn').addEventListener('click', () => {
    showError('');
    vscode.postMessage({ type: 'saveAndConnect', data: getData() });
  });
  document.getElementById('diagnoseBtn').addEventListener('click', () => vscode.postMessage({ type: 'diagnose' }));
  document.getElementById('installCliBtn').addEventListener('click', () => vscode.postMessage({ type: 'installCli' }));
  document.getElementById('agentLoginBtn').addEventListener('click', () => vscode.postMessage({ type: 'agentLogin' }));
  document.getElementById('loadModelsBtn').addEventListener('click', () => {
    showError('');
    vscode.postMessage({ type: 'loadModels' });
  });

  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type === 'modelsLoaded') {
      const sel = document.getElementById('agentDefaultModel');
      const current = sel.value;
      sel.innerHTML = '<option value="">auto (Cursor decides)</option>';
      msg.models.forEach((model) => {
        const opt = document.createElement('option');
        opt.value = model.id;
        opt.textContent = model.label;
        if (model.id === current) opt.selected = true;
        sel.appendChild(opt);
      });
    }
    if (msg.type === 'modelsError' || msg.type === 'settingsError') {
      showError(msg.error || 'Unknown error');
    }
  });
`,
  });
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
