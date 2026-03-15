import * as vscode from "vscode";
import { log } from "./logger";
import { agentStatus, openAgentCliTerminal, runAgentCliCommand } from "./commands/agent";
import { applySettings } from "./settings-apply";
import { coerceMessageType, parseSettingsInput } from "./settings-validation";
import { buildWebviewHtml, createNonce } from "./webview-security";

let panel: vscode.WebviewPanel | null = null;

export async function showSetupWizard(context: vscode.ExtensionContext): Promise<void> {
  if (panel) {
    panel.reveal();
    return;
  }

  const isCursor = vscode.env.appName?.toLowerCase().includes("cursor") ?? false;
  const cli = await agentStatus();

  panel = vscode.window.createWebviewPanel("openclawSetup", "OpenClaw Setup", vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [],
  });

  const cfg = vscode.workspace.getConfiguration("openclaw");
  const nonce = createNonce();
  panel.webview.html = getWizardHtml(
    {
      isCursor,
      cliFound: cli.cliFound,
      cliVersion: cli.cliVersion || "",
      gatewayHost: cfg.get("gatewayHost", "127.0.0.1"),
      gatewayPort: cfg.get("gatewayPort", 18789),
      gatewayToken: cfg.get("gatewayToken", ""),
      gatewayTls: cfg.get("gatewayTls", false),
      autoConnect: cfg.get("autoConnect", false),
      displayName: cfg.get("displayName", "VS Code"),
      readOnly: cfg.get("readOnly", false),
      confirmWrites: cfg.get("confirmWrites", false),
      terminalEnabled: cfg.get("terminal.enabled", false),
      terminalAllowlist: cfg.get<string[]>("terminal.allowlist", ["git", "npm", "pnpm", "npx", "node", "tsc"]).join(", "),
      agentEnabled: cfg.get("agent.enabled", false),
      agentCliPath: cfg.get("agent.cliPath", "agent"),
      agentDefaultMode: cfg.get("agent.defaultMode", "agent"),
      agentDefaultModel: cfg.get("agent.defaultModel", ""),
      agentTimeoutMs: cfg.get("agent.timeoutMs", 300000),
    },
    panel.webview.cspSource,
    nonce
  );

  panel.webview.onDidReceiveMessage(async (msg) => {
    const type = coerceMessageType(msg);
    try {
      if (type === "save") {
        const settings = parseSettingsInput((msg as { data?: unknown }).data);
        await applySettings(settings);
        log("Setup wizard: settings saved");
        vscode.window.showInformationMessage("OpenClaw configured. Connecting...");
        await vscode.commands.executeCommand("openclaw.connect");
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

      if (type === "detectCli") {
        const status = await agentStatus();
        panel?.webview.postMessage({ type: "cliStatus", found: status.cliFound, version: status.cliVersion || "", path: status.cliPath });
        return;
      }

      if (type === "agentLogin") {
        await openAgentCliTerminal("Cursor Agent Login", ["login"]);
        return;
      }

      if (type === "checkAuth") {
        const result = await runAgentCliCommand(["--list-models", "--trust"], { timeoutMs: 20_000 });
        const clean = result.combinedOutput.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
        const ok = clean.includes("Available models") && !clean.includes("Authentication required");
        panel?.webview.postMessage({ type: "authStatus", ok, detail: ok ? "Authenticated" : (clean || "Not authenticated") });
        return;
      }

      if (type === "listModels") {
        const result = await runAgentCliCommand(["--list-models", "--trust"], { timeoutMs: 20_000 });
        const models = result.combinedOutput
          .split("\n")
          .map((line) => line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim())
          .filter((line) => line.includes(" - ") && !line.startsWith("Loading") && !line.startsWith("Available") && !line.startsWith("Tip:"))
          .map((line) => {
            const [id, ...rest] = line.split(" - ");
            return { id: id.trim(), name: rest.join(" - ").replace(/\s*\(current.*?\)/, "").trim() };
          })
          .filter((model) => model.id && model.id !== "auto");
        panel?.webview.postMessage({ type: "modelList", models, error: null });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(message);
      panel?.webview.postMessage({ type: "wizardError", error: message });
    }
  });

  panel.onDidDispose(() => {
    panel = null;
  });
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface WizardData {
  isCursor: boolean;
  cliFound: boolean;
  cliVersion: string;
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

function getWizardHtml(data: WizardData, cspSource: string, nonce: string): string {
  const installCmd = process.platform === "win32"
    ? "irm 'https://cursor.com/install?win32=true' | iex"
    : "curl https://cursor.com/install -fsSL | bash";

  return buildWebviewHtml({
    title: "OpenClaw Setup",
    cspSource,
    nonce,
    styles: `
:root {
  --bg: var(--vscode-editor-background);
  --fg: var(--vscode-editor-foreground);
  --border: var(--vscode-widget-border, #444);
  --card: var(--vscode-sideBar-background, #252526);
  --accent: var(--vscode-button-background, #0e639c);
  --accent-fg: var(--vscode-button-foreground, #fff);
  --muted: var(--vscode-descriptionForeground, #888);
  --ok: #4ec9b0;
  --err: #f14c4c;
  --warn: #dcdcaa;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family); color: var(--fg); background: var(--bg); }
.wiz { max-width: 680px; margin: 0 auto; padding: 20px; }
h1 { font-size: 20px; margin-bottom: 4px; }
.sub { color: var(--muted); font-size: 13px; margin-bottom: 20px; }
.progress { display: flex; gap: 4px; margin-bottom: 24px; }
.dot { flex: 1; height: 4px; border-radius: 2px; background: var(--border); transition: background .3s; }
.dot.active { background: var(--accent); }
.dot.done { background: var(--ok); }
.step { display: none; }
.step.visible { display: block; }
.st { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
.sd { color: var(--muted); font-size: 12px; margin-bottom: 16px; line-height: 1.5; }
.field { margin-bottom: 12px; }
.field label { display: block; font-size: 12px; font-weight: 500; margin-bottom: 4px; }
.field input[type="text"], .field input[type="number"], .field input[type="password"], .field select {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--card);
  color: var(--fg);
  font-size: 13px;
}
.hint { font-size: 11px; color: var(--muted); margin-top: 2px; }
.row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.row input[type="checkbox"] { width: 16px; height: 16px; }
.row label { font-size: 13px; cursor: pointer; }
.preset-btns { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
.preset {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  font-size: 11px;
}
.preset.active, .preset:hover { background: var(--accent); color: var(--accent-fg); border-color: transparent; }
.sta { padding: 10px 14px; border-radius: 6px; margin-bottom: 8px; border: 1px solid var(--border); font-size: 12px; }
.sta.ok { border-color: var(--ok); background: rgba(78, 201, 176, .08); }
.sta.warn { border-color: var(--warn); background: rgba(220, 220, 170, .08); }
.sta.err { border-color: var(--err); background: rgba(241, 76, 76, .08); }
.sta.neu { border-color: var(--muted); }
code { background: var(--card); padding: 2px 6px; border-radius: 3px; font-size: 11px; }
.buttons { display: flex; gap: 8px; margin-top: 20px; }
.btn { padding: 8px 20px; border-radius: 4px; border: none; cursor: pointer; font-size: 13px; font-weight: 500; }
.btn-p { background: var(--accent); color: var(--accent-fg); }
.btn-s { background: transparent; border: 1px solid var(--border); color: var(--fg); }
.btn-skip { background: transparent; color: var(--muted); border: none; font-size: 12px; }
.btn-sm { padding: 4px 12px; font-size: 11px; }
.spacer { flex: 1; }
.card { margin-bottom: 16px; padding: 12px; border: 1px solid var(--border); border-radius: 6px; }
.card-title { font-weight: 600; font-size: 13px; margin-bottom: 8px; }
.btn-row { display: flex; gap: 6px; margin-bottom: 4px; }
.error {
  display: none;
  margin-bottom: 16px;
  padding: 10px 12px;
  border: 1px solid var(--err);
  border-radius: 6px;
  color: var(--err);
}
`,
    body: `
<div class="wiz">
  <h1>OpenClaw Setup</h1>
  <div class="sub">Connect your IDE to OpenClaw Gateway${data.isCursor ? " (Cursor detected)" : ""}</div>
  <div id="error" class="error"></div>
  <div class="progress"><div class="dot" id="d0"></div><div class="dot" id="d1"></div><div class="dot" id="d2"></div><div class="dot" id="d3"></div></div>

  <div class="step" id="s0">
    <div class="st">Step 1: Gateway Connection</div>
    <div class="sd">Connect this editor to your OpenClaw Gateway.</div>
    <div class="field"><label>Host</label><input type="text" id="gatewayHost" value="${esc(data.gatewayHost)}" placeholder="127.0.0.1"><div class="hint">Required.</div></div>
    <div class="field"><label>Port</label><input type="number" id="gatewayPort" value="${data.gatewayPort}"></div>
    <div class="field"><label>Token</label><input type="password" id="gatewayToken" value="${esc(data.gatewayToken)}" placeholder="gateway.auth.token from config"></div>
    <div class="row"><input type="checkbox" id="gatewayTls" ${data.gatewayTls ? "checked" : ""}><label for="gatewayTls">Use TLS (wss://)</label></div>
    <div class="field"><label>Display Name</label><input type="text" id="displayName" value="${esc(data.displayName)}" placeholder="My VS Code"><div class="hint">Required.</div></div>
    <div class="row"><input type="checkbox" id="autoConnect" ${data.autoConnect ? "checked" : ""}><label for="autoConnect">Auto-connect on startup</label></div>
  </div>

  <div class="step" id="s1">
    <div class="st">Step 2: Security and Permissions</div>
    <div class="sd">Choose how much write access OpenClaw should have.</div>
    <div class="sd" style="font-weight:500;color:var(--fg)">Quick presets:</div>
    <div class="preset-btns">
      <button class="preset" data-preset="strict">Strict (read-only)</button>
      <button class="preset" data-preset="standard">Standard (confirm writes)</button>
      <button class="preset" data-preset="trusted">Trusted (full access)</button>
    </div>
    <div class="row"><input type="checkbox" id="readOnly" ${data.readOnly ? "checked" : ""}><label for="readOnly">Read-only mode (blocks all mutating commands)</label></div>
    <div class="row"><input type="checkbox" id="confirmWrites" ${data.confirmWrites ? "checked" : ""}><label for="confirmWrites">Confirm before mutating commands</label></div>
    <div style="margin-top:16px"><div class="sd" style="font-weight:500;color:var(--fg)">Terminal access</div></div>
    <div class="row"><input type="checkbox" id="terminalEnabled" ${data.terminalEnabled ? "checked" : ""}><label for="terminalEnabled">Enable terminal commands</label></div>
    <div class="field"><label>Allowlist</label><input type="text" id="terminalAllowlist" value="${esc(data.terminalAllowlist)}" placeholder="git, npm, pnpm"><div class="hint">Comma-separated executable names only. Empty is allowed only when terminal access is disabled.</div></div>
  </div>

  <div class="step" id="s2">
    <div class="st">Step 3: Cursor Agent CLI (Optional)</div>
    <div class="sd">Skip this step if you do not need delegated coding tasks.</div>
    <div class="card">
      <div class="card-title">Install CLI</div>
      <div class="sta ${data.cliFound ? "ok" : "warn"}" id="cliSta">${data.cliFound ? "Installed - " + esc(data.cliVersion) : "Not installed"}</div>
      <div class="btn-row"><button class="btn btn-s btn-sm" id="installCliBtn">Install</button><button class="btn btn-s btn-sm" id="detectCliBtn">Re-detect</button></div>
      <div class="hint"><code>${esc(installCmd)}</code></div>
    </div>
    <div class="card">
      <div class="card-title">Login to Cursor</div>
      <div class="sta neu" id="authSta">Click "Login" to authenticate.</div>
      <div class="btn-row"><button class="btn btn-s btn-sm" id="agentLoginBtn">Login</button><button class="btn btn-s btn-sm" id="checkAuthBtn">Check</button></div>
      <div class="hint">You can also provide CURSOR_API_KEY in your environment.</div>
    </div>
    <div class="card">
      <div class="card-title">Configure</div>
      <div class="row"><input type="checkbox" id="agentEnabled" ${data.agentEnabled ? "checked" : ""}><label for="agentEnabled">Enable Agent integration</label></div>
      <div id="agentFields" style="display:${data.agentEnabled ? "block" : "none"}">
        <div class="field"><label>CLI Path</label><input type="text" id="agentCliPath" value="${esc(data.agentCliPath)}" placeholder="agent"><div class="hint">Bare executable name or absolute path.</div></div>
        <div class="field"><label>Default Mode</label>
          <select id="agentDefaultMode">
            <option value="agent" ${data.agentDefaultMode === "agent" ? "selected" : ""}>Agent - Full access</option>
            <option value="plan" ${data.agentDefaultMode === "plan" ? "selected" : ""}>Plan - Design first</option>
            <option value="ask" ${data.agentDefaultMode === "ask" ? "selected" : ""}>Ask - Read-only</option>
          </select>
        </div>
        <div class="field"><label>Default Model</label>
          <select id="agentDefaultModel"><option value="">auto (recommended)</option></select>
          <div class="btn-row" style="margin-top:4px"><button class="btn btn-s btn-sm" id="loadModelsBtn">Load Models</button></div>
          <div class="hint" id="modelHint">Load models after login.</div>
        </div>
        <div class="field"><label>Timeout (ms)</label><input type="number" id="agentTimeoutMs" value="${data.agentTimeoutMs}"></div>
      </div>
    </div>
  </div>

  <div class="step" id="s3">
    <div class="st">Step 4: Review and Connect</div>
    <div class="sd">Review the configuration and save it.</div>
    <div id="summary" style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:12px;font-size:12px;line-height:1.8"></div>
  </div>

  <div class="buttons">
    <button class="btn btn-s" id="btnBack" style="display:none">Back</button>
    <span class="spacer"></span>
    <button class="btn btn-skip" id="btnSkip" style="display:none">Skip</button>
    <button class="btn btn-p" id="btnNext">Next</button>
  </div>
</div>
`,
    script: `
const vscode = acquireVsCodeApi();
let step = 0;
const total = 4;
let savedModel = ${JSON.stringify(data.agentDefaultModel)};

function showError(message) {
  const box = document.getElementById('error');
  box.textContent = message || '';
  box.style.display = message ? 'block' : 'none';
}

function show(stepIndex) {
  step = stepIndex;
  for (let i = 0; i < total; i += 1) {
    document.getElementById('s' + i).classList.toggle('visible', i === stepIndex);
    const dot = document.getElementById('d' + i);
    dot.classList.toggle('active', i === stepIndex);
    dot.classList.toggle('done', i < stepIndex);
  }
  document.getElementById('btnBack').style.display = stepIndex > 0 ? '' : 'none';
  document.getElementById('btnSkip').style.display = stepIndex === 2 ? '' : 'none';
  document.getElementById('btnNext').textContent = stepIndex === total - 1 ? 'Save and Connect' : 'Next';
  if (stepIndex === total - 1) {
    renderSummary();
  }
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

function renderSummary() {
  const d = getData();
  const lines = [
    '<b>Gateway:</b> ' + esc(d.gatewayHost) + ':' + d.gatewayPort + (d.gatewayTls ? ' (TLS)' : ''),
    '<b>Name:</b> ' + esc(d.displayName),
    '<b>Token:</b> ' + (d.gatewayToken ? '***' : 'none'),
    '<b>Auto-connect:</b> ' + (d.autoConnect ? 'Yes' : 'No'),
    '',
    '<b>Security:</b> ' + (d.readOnly ? 'Read-only' : d.confirmWrites ? 'Confirm writes' : 'Full access'),
    '<b>Terminal:</b> ' + (d.terminalEnabled ? 'Enabled (' + esc(d.terminalAllowlist || 'none') + ')' : 'Disabled'),
    '',
    '<b>Agent:</b> ' + (d.agentEnabled ? 'Enabled (mode: ' + d.agentDefaultMode + (d.agentDefaultModel ? ', model: ' + esc(d.agentDefaultModel) : '') + ')' : 'Disabled'),
  ];
  document.getElementById('summary').innerHTML = lines.join('<br>');
}

function esc(value) {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

function applyPreset(preset) {
  const readOnly = document.getElementById('readOnly');
  const confirmWrites = document.getElementById('confirmWrites');
  const terminalEnabled = document.getElementById('terminalEnabled');
  const terminalAllowlist = document.getElementById('terminalAllowlist');
  document.querySelectorAll('.preset').forEach((btn) => btn.classList.remove('active'));
  document.querySelector('[data-preset="' + preset + '"]').classList.add('active');
  if (preset === 'strict') {
    readOnly.checked = true;
    confirmWrites.checked = false;
    terminalEnabled.checked = false;
    terminalAllowlist.value = '';
  }
  if (preset === 'standard') {
    readOnly.checked = false;
    confirmWrites.checked = true;
    terminalEnabled.checked = true;
    terminalAllowlist.value = 'git, npm, pnpm, npx, node, tsc';
  }
  if (preset === 'trusted') {
    readOnly.checked = false;
    confirmWrites.checked = false;
    terminalEnabled.checked = true;
    terminalAllowlist.value = '*';
  }
}

document.querySelectorAll('.preset').forEach((btn) => btn.addEventListener('click', () => applyPreset(btn.dataset.preset)));
document.getElementById('agentEnabled').addEventListener('change', (event) => {
  document.getElementById('agentFields').style.display = event.target.checked ? 'block' : 'none';
});
document.getElementById('btnBack').addEventListener('click', () => { if (step > 0) show(step - 1); });
document.getElementById('btnSkip').addEventListener('click', () => show(step + 1));
document.getElementById('btnNext').addEventListener('click', () => {
  showError('');
  if (step === 0 && !document.getElementById('gatewayToken').value.trim()) {
    if (!confirm('No token is set. Continue?')) return;
  }
  if (step === total - 1) {
    vscode.postMessage({ type: 'save', data: getData() });
    return;
  }
  show(step + 1);
});
document.getElementById('installCliBtn').addEventListener('click', () => vscode.postMessage({ type: 'installCli' }));
document.getElementById('detectCliBtn').addEventListener('click', () => vscode.postMessage({ type: 'detectCli' }));
document.getElementById('agentLoginBtn').addEventListener('click', () => vscode.postMessage({ type: 'agentLogin' }));
document.getElementById('checkAuthBtn').addEventListener('click', () => vscode.postMessage({ type: 'checkAuth' }));
document.getElementById('loadModelsBtn').addEventListener('click', () => {
  document.getElementById('modelHint').textContent = 'Loading...';
  vscode.postMessage({ type: 'listModels' });
});

window.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'cliStatus') {
    const el = document.getElementById('cliSta');
    if (msg.found) {
      el.className = 'sta ok';
      el.textContent = 'Installed - ' + msg.version;
    } else {
      el.className = 'sta warn';
      el.textContent = 'Not installed';
    }
  }
  if (msg.type === 'authStatus') {
    const el = document.getElementById('authSta');
    if (msg.ok) {
      el.className = 'sta ok';
      el.textContent = 'Authenticated';
    } else {
      el.className = 'sta warn';
      el.textContent = msg.detail || 'Not authenticated';
    }
  }
  if (msg.type === 'modelList') {
    const sel = document.getElementById('agentDefaultModel');
    const hint = document.getElementById('modelHint');
    sel.innerHTML = '<option value="">auto (recommended)</option>';
    if (msg.error) {
      hint.textContent = msg.error;
      return;
    }
    if (!msg.models.length) {
      hint.textContent = 'No models found. Login first?';
      return;
    }
    msg.models.forEach((model) => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.name ? model.name + ' (' + model.id + ')' : model.id;
      if (model.id === savedModel) option.selected = true;
      sel.appendChild(option);
    });
    hint.textContent = msg.models.length + ' models loaded';
  }
  if (msg.type === 'wizardError') {
    showError(msg.error || 'Unknown error');
  }
});

show(0);
`,
  });
}
