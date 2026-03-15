# OpenClaw Node for VS Code / Cursor

<p align="center">
  <img src="assets/icon.png" alt="OpenClaw VS Code" width="128" />
</p>

<p align="center">
  <strong>Connect VS Code or Cursor to OpenClaw Gateway as a remote IDE node.</strong><br>
  OpenClaw can read code, inspect symbols, run safe IDE actions, and delegate resumable Codex tasks through the VS Code API sandbox.
</p>

<p align="center">
  <a href="README.zh-CN.md">简体中文</a>
</p>

---

## What This Extension Does

This extension registers a VS Code node with OpenClaw Gateway and exposes IDE capabilities through `vscode.*` commands.

OpenClaw can then:
- read, write, and edit files inside the workspace
- inspect definitions, references, hovers, symbols, and diagnostics
- run git, test, and debug actions through VS Code APIs
- execute allowlisted terminal commands
- launch Cursor Agent CLI tasks
- launch resumable Codex CLI tasks with status, decision, cancel, and result APIs

The extension is intentionally sandboxed:
- file and `cwd` inputs stay inside the workspace
- terminal execution is disabled by default
- mutating actions respect `openclaw.readOnly` and `openclaw.confirmWrites`

For conversation-first usage, see:
- [Natural-Language Calling Guide](NATURAL_LANGUAGE_CALLING.md)

## Current Status

Implemented command families:
- `vscode.file.*`
- `vscode.dir.list`
- `vscode.editor.*`
- `vscode.diagnostics.get`
- `vscode.workspace.info`
- `vscode.lang.*`
- `vscode.code.format`
- `vscode.git.*`
- `vscode.test.*`
- `vscode.debug.*`
- `vscode.terminal.run`
- `vscode.agent.*`
- `vscode.agent.task.*`

Not implemented yet:
- `vscode.search.text`
- `vscode.search.files`

## Installation

### From VSIX

Download the latest `.vsix` from:
- <https://github.com/akwang10000/openclaw-vscode/releases>

Then install it:

```bash
# VS Code
code --install-extension openclaw-node-vscode-x.y.z.vsix

# Cursor
cursor --install-extension openclaw-node-vscode-x.y.z.vsix
```

### Development Install

```bash
npm install
npm run build
npx vsce package --no-dependencies
code --install-extension openclaw-node-vscode-0.2.0.vsix --force
```

## Quick Start

1. Install the extension.
2. Open `OpenClaw: Setup Wizard` in VS Code.
3. Enter your Gateway host, port, and token.
4. Approve the device on the Gateway the first time it connects.
5. Confirm the node is connected and exposes `vscode.*` commands.

Recommended first-run settings:
- `openclaw.confirmWrites = true`
- `openclaw.terminal.enabled = false`
- `openclaw.agent.codex.enabled = true` only after `codex` is available locally

### First Connection Check

From OpenClaw, invoke:

```text
vscode.workspace.info
```

Expected payload shape:

```json
{
  "name": "openclaw-vscode",
  "rootPath": "H:\\workspace\\openclaw-vscode",
  "folders": ["H:\\workspace\\openclaw-vscode"]
}
```

### If You Prefer Natural Language

You can talk to OpenClaw like an IDE assistant instead of naming raw commands.

Examples:
- "Read the README and tell me how to install this project."
- "Analyze the next most valuable change, but do not modify anything yet."
- "Continue the last task and use the recommended option."

Recommended behavior:
- read/query requests stay read-only
- planning requests use the Codex task flow
- write requests should be confirmed before execution

### Common First-Run Fixes

- Local Gateway usually means `openclaw.gatewayHost = 127.0.0.1`, `openclaw.gatewayPort = 18789`, and `openclaw.gatewayTls = false`.
- Copy the token from `gateway.auth.token` in `~/.openclaw/openclaw.json`.
- If the node shows `connected: true` and `paired: true` but `commands: []`, make sure `gateway.nodes.allowCommands` contains exact command names such as `vscode.workspace.info` and `vscode.file.read`.
- Run `OpenClaw: Diagnose Connection` inside VS Code for guided local checks.

## Command Families

Use full command names when invoking through OpenClaw.

### Files and Workspace

| Command | Parameters | Description |
|---------|------------|-------------|
| `vscode.file.read` | `path`, `offset?`, `limit?` | Read file text by line range |
| `vscode.file.write` | `path`, `content` | Write or create a file |
| `vscode.file.edit` | `path`, `edits[]` | Apply targeted text edits |
| `vscode.file.delete` | `path` | Delete a file |
| `vscode.dir.list` | `path?`, `recursive?`, `pattern?` | List files or folders |
| `vscode.workspace.info` | none | Return workspace name and folders |

### Editor and Language

| Command | Parameters | Description |
|---------|------------|-------------|
| `vscode.editor.active` | none | Active editor path, language, and selections |
| `vscode.editor.openFiles` | none | Open editor tabs |
| `vscode.editor.selections` | none | Current selections across editors |
| `vscode.lang.definition` | `path`, `line`, `character` | Go to definition |
| `vscode.lang.references` | `path`, `line`, `character` | Find references |
| `vscode.lang.hover` | `path`, `line`, `character` | Hover info |
| `vscode.lang.symbols` | `path?`, `query?` | Document or workspace symbols |
| `vscode.lang.rename` | `path`, `line`, `character`, `newName` | Rename symbol |
| `vscode.lang.codeActions` | `path`, `startLine`, `endLine` | List code actions |
| `vscode.lang.applyCodeAction` | `path`, `startLine`, `endLine`, `title` | Apply a code action |
| `vscode.code.format` | `path` | Format document |
| `vscode.diagnostics.get` | `path?`, `severity?` | Diagnostics summary |

### Git, Test, and Debug

| Command | Parameters | Description |
|---------|------------|-------------|
| `vscode.git.status` | none | Working tree status |
| `vscode.git.diff` | `path?`, `staged?` | Git diff |
| `vscode.git.log` | `count?`, `path?` | Commit log |
| `vscode.git.blame` | `path` | Git blame |
| `vscode.git.stage` | `paths[]` | Stage files |
| `vscode.git.unstage` | `paths[]` | Unstage files |
| `vscode.git.commit` | `message` | Commit staged changes |
| `vscode.git.stash` | `action`, `message?` | Stash operations |
| `vscode.test.list` | none | Discover tests |
| `vscode.test.run` | `testIds?`, `grep?` | Run tests |
| `vscode.test.results` | none | Latest test results |
| `vscode.debug.launch` | `config?` | Start debugging |
| `vscode.debug.stop` | none | Stop debugging |
| `vscode.debug.breakpoint` | `path`, `line`, `action?` | Toggle breakpoint |
| `vscode.debug.evaluate` | `expression`, `frameId?` | Evaluate expression |
| `vscode.debug.stackTrace` | none | Stack trace |
| `vscode.debug.variables` | `frameId?` | Variables |
| `vscode.debug.status` | none | Debug status |

### Terminal and Legacy Agent CLI

| Command | Parameters | Description |
|---------|------------|-------------|
| `vscode.terminal.run` | `command`, `cwd?`, `timeoutMs?` | Run an allowlisted executable with safe parsing |
| `vscode.agent.status` | none | Check Cursor Agent CLI availability |
| `vscode.agent.run` | `prompt`, `mode?`, `model?`, `cwd?`, `timeoutMs?` | Run Cursor Agent CLI |
| `vscode.agent.setup` | none | Open setup wizard |

## Codex Task Workflow

The new task interface is for resumable Codex CLI runs.

### Available Commands

| Command | Parameters | Description |
|---------|------------|-------------|
| `vscode.agent.task.start` | `provider`, `prompt`, `mode?`, `cwd?`, `timeoutMs?`, `metadata?` | Start a Codex task |
| `vscode.agent.task.status` | `taskId` | Return the current task snapshot |
| `vscode.agent.task.list` | `status?`, `limit?` | List recent tasks |
| `vscode.agent.task.respond` | `taskId`, `choice`, `notes?` | Continue a waiting plan task |
| `vscode.agent.task.cancel` | `taskId` | Cancel a queued or running task |
| `vscode.agent.task.result` | `taskId` | Return final output, error, or pending decision |

### Ask Mode Example

Start:

```json
{
  "provider": "codex",
  "prompt": "Reply with exactly the words OPENCLAW TEST.",
  "mode": "ask",
  "cwd": "."
}
```

Then poll:
- `vscode.agent.task.status`
- `vscode.agent.task.result`

### Plan Mode Example

1. Start the task:

```json
{
  "provider": "codex",
  "prompt": "Analyze this repository and give me two implementation options.",
  "mode": "plan",
  "cwd": "."
}
```

2. Poll `vscode.agent.task.status` until:

```json
{
  "status": "waiting_decision",
  "decisionRequest": {
    "question": "What should the next implementation focus be for this repository?",
    "options": [
      { "id": "unify-agent-providers", "label": "..." },
      { "id": "add-search-commands", "label": "..." }
    ],
    "recommendedOption": "unify-agent-providers",
    "contextSummary": "..."
  }
}
```

3. Continue with:

```json
{
  "taskId": "your-task-id",
  "choice": "unify-agent-providers",
  "notes": "Use the recommended option and continue."
}
```

4. Poll `status` again, then call `vscode.agent.task.result`.

Notes:
- only `provider = "codex"` is supported in v1
- `mode = "agent"` is treated as mutating and respects `readOnly` / `confirmWrites`
- `cwd` must remain inside the active workspace

## Configuration

All extension settings live under `openclaw.*`.

### Connection

| Setting | Default | Description |
|---------|---------|-------------|
| `openclaw.gatewayHost` | `"127.0.0.1"` | Gateway host |
| `openclaw.gatewayPort` | `18789` | Gateway port |
| `openclaw.gatewayToken` | `""` | Gateway auth token |
| `openclaw.gatewayTls` | `false` | Use `wss://` instead of `ws://` |
| `openclaw.autoConnect` | `false` | Auto-connect on startup |
| `openclaw.displayName` | `"VS Code"` | Node display name |

### Security

| Setting | Default | Description |
|---------|---------|-------------|
| `openclaw.readOnly` | `false` | Block mutating commands |
| `openclaw.confirmWrites` | `false` | Confirm mutating commands |
| `openclaw.terminal.enabled` | `false` | Allow terminal runs |
| `openclaw.terminal.allowlist` | `["git","npm","pnpm","npx","node","tsc"]` | Allowed executable basenames |
| `openclaw.commandTimeout` | `90` | Default command timeout in seconds |

### Cursor Agent CLI

| Setting | Default | Description |
|---------|---------|-------------|
| `openclaw.agent.enabled` | `false` | Enable Cursor Agent CLI integration |
| `openclaw.agent.cliPath` | `"agent"` | Cursor Agent CLI path |
| `openclaw.agent.defaultMode` | `"agent"` | Default mode |
| `openclaw.agent.defaultModel` | `""` | Default model |
| `openclaw.agent.timeoutMs` | `300000` | Timeout in milliseconds |

### Codex Tasks

| Setting | Default | Description |
|---------|---------|-------------|
| `openclaw.agent.codex.enabled` | `false` | Enable Codex task orchestration |
| `openclaw.agent.codex.cliPath` | `"codex"` | Codex CLI path |
| `openclaw.agent.taskHistoryLimit` | `50` | Completed task snapshots to keep |

## Security Notes

### Workspace Containment

All workspace-relative `path` and `cwd` inputs go through canonical containment checks:
- absolute paths are rejected
- `..` traversal outside the workspace is rejected
- symlink and junction escapes are rejected

### Mutation Policy

`openclaw.readOnly` and `openclaw.confirmWrites` now cover:
- file writes, edits, and deletes
- rename, format, and apply-code-action flows
- git mutations
- terminal execution
- write-capable agent runs

### Terminal Hardening

`vscode.terminal.run` now:
- parses commands before execution
- rejects shell chaining, pipes, redirection, and substitution
- runs with `shell: false`
- allowlists executables by basename

### Device Identity

Each extension instance creates an Ed25519 identity at:

```text
~/.openclaw-vscode/device.json
```

The Gateway must approve that device before it can execute commands.

## Troubleshooting

### Connected But No Commands

Check `gateway.nodes.allowCommands` in `~/.openclaw/openclaw.json`.
Use exact command names such as:
- `vscode.workspace.info`
- `vscode.file.read`
- `vscode.agent.task.start`

### Local Gateway TLS Error

If you see `WRONG_VERSION_NUMBER`, you likely enabled TLS against a local non-TLS Gateway.
Set:

```json
{
  "openclaw.gatewayHost": "127.0.0.1",
  "openclaw.gatewayPort": 18789,
  "openclaw.gatewayTls": false
}
```

### Codex Tasks Do Not Start

Check:
- `openclaw.agent.codex.enabled = true`
- `openclaw.agent.codex.cliPath` points to a working `codex` binary
- `cwd` stays inside the workspace

## Development

```bash
git clone https://github.com/akwang10000/openclaw-vscode.git
cd openclaw-vscode
npm install
npm run test
npm run lint
npm run build
npx vsce package --no-dependencies
```

## References

- [OpenClaw](https://github.com/openclaw/openclaw)
- [OpenClaw Docs](https://docs.openclaw.ai)
- [Design Notes](DESIGN.md)
- [License](LICENSE)
