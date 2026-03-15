# OpenClaw VS Code Extension Design

## Goal

This extension turns VS Code or Cursor into an OpenClaw node that exposes IDE capabilities through the VS Code extension API instead of direct shell or unrestricted filesystem access.

The current design goal is:
- allow remote assistants to inspect and modify code through the editor/runtime APIs
- keep operations constrained to the active workspace
- make mutating behavior visible and governable through `readOnly`, `confirmWrites`, and terminal allowlisting

## Current Architecture

```
OpenClaw Gateway
  -> WebSocket node protocol
VS Code / Cursor extension host
  -> GatewayClient
  -> Command registry
  -> Security helpers
  -> Activity store + webviews
  -> Cursor Agent CLI bridge
  -> AgentOrchestrator + Codex task provider
VS Code APIs / workspace
```

Core components:
- `src/extension.ts`: activation, command registration, setup/settings entrypoints, auto-connect
- `src/gateway-client.ts`: WebSocket transport, connect handshake, invoke handling, request lifecycle
- `src/commands/registry.ts`: command dispatch, activity tracking, per-command timeout enforcement
- `src/security-core.ts` and `src/security.ts`: command parsing, mutation policy, CLI path validation, workspace containment
- `src/commands/*`: file, language, git, test, debug, terminal, agent, and agent task handlers
- `src/agent-tasks/*`: Codex provider, orchestrator, task persistence, and task service wiring
- `src/activity-store.ts`: human-readable operation summaries and recent activity state
- `src/activity-panel.ts`, `src/settings-panel.ts`, `src/setup-wizard.ts`: webview surfaces

## Supported Commands

The extension currently exposes these command groups:
- `vscode.file.*`: read, write, edit, delete
- `vscode.dir.list`
- `vscode.editor.*`: active, openFiles, selections
- `vscode.diagnostics.get`
- `vscode.workspace.info`
- `vscode.lang.*`: definition, references, hover, symbols, rename, codeActions, applyCodeAction
- `vscode.code.format`
- `vscode.git.*`: status, diff, log, blame, stage, unstage, commit, stash
- `vscode.test.*`: list, run, results
- `vscode.debug.*`: launch, stop, breakpoint, evaluate, stackTrace, variables, status
- `vscode.terminal.run`
- `vscode.agent.*`: status, run, setup
- `vscode.agent.task.*`: start, status, list, respond, cancel, result

Not implemented:
- `vscode.search.text`
- `vscode.search.files`

## Security Model

### Workspace containment

All workspace-relative `path` and `cwd` values are validated through a shared containment path:
- absolute paths are rejected
- lexical traversal such as `..` is rejected when it escapes the workspace
- existing symlinks / junctions are resolved canonically
- paths that land outside the canonical workspace root after `realpath` resolution are rejected

This rule now applies to both file access and terminal / agent working directories.

### Mutation controls

Mutating commands are governed by shared policy checks:
- `openclaw.readOnly`: blocks mutating commands entirely
- `openclaw.confirmWrites`: prompts before mutating commands

This currently covers:
- file write, edit, delete
- rename, apply code action, format
- git stage, unstage, commit, stash mutations
- terminal execution
- agent write mode

### Terminal model

`vscode.terminal.run` accepts a command string but executes it under a stricter model:
- command strings are parsed before execution
- shell chaining, pipes, redirection, command substitution, and similar shell operators are rejected
- allowlisting is based on executable basename, not full shell snippets
- commands run with `shell: false`

### Agent CLI model

Cursor Agent CLI integration is constrained by:
- `agent.cliPath` validation: bare executable name or absolute path only
- no shell-based command concatenation for detect/list/auth/run flows
- workspace-contained `cwd`

Codex task orchestration is constrained by:
- `agent.codex.cliPath` validation under the same shell-safe path rules
- task `mode=agent` still flowing through the shared mutation guard
- task `cwd` continuing to use workspace containment
- Codex execution running under explicit `-s/-a` flags rather than interactive local approvals

### Webview security

The activity panel, settings panel, and setup wizard now use:
- `default-src 'none'` CSP
- per-render nonces for inline scripts
- minimal `localResourceRoots`
- basic message-type validation before handling postMessage payloads

## Runtime and Timeout Behavior

There are two timeout layers:
- command dispatch timeout in `src/commands/registry.ts`, combining local config and remote requested timeout
- Gateway request timeout in `src/gateway-client.ts`, covering extension-originated protocol requests such as `connect` and `node.invoke.result`

If a command times out, the command returns a structured error instead of waiting indefinitely.
If a Gateway request times out, the pending request entry is removed and the promise rejects.

## Current UX Surfaces

### Activity panel

The activity panel shows:
- command category
- human-readable intent
- status, duration, timestamp
- params and result/error details
- background Codex task state, including waiting-for-decision snapshots

Intent strings are generated from the actual command parameter schema, not guessed field names.

### Settings panel

The settings panel is the direct configuration editor for:
- Gateway connection
- node identity behavior
- security toggles
- terminal allowlist
- agent integration defaults

Validation is now shared with the setup wizard, so invalid host/port/allowlist/CLI path/timeout input fails with explicit feedback.

### Setup wizard

The setup wizard is the guided first-run flow:
1. Gateway connection
2. Security preset and terminal policy
3. Optional Cursor Agent CLI setup
4. Review and connect

## Current Status

Completed:
- Gateway node connection and invoke flow
- file, editor, language, git, test, debug, terminal, and agent command sets
- Codex task orchestration with resumable task snapshots, remote decisions, and Gateway `node.event` emission
- activity panel
- settings panel
- setup wizard
- mutation controls for all exposed mutating commands
- terminal hardening and agent CLI hardening
- canonical workspace containment with symlink / junction escape checks
- webview CSP / nonce hardening
- lightweight automated tests for security helpers, pending request cleanup, activity intents, and webview HTML security helpers

Still out of scope for the current phase:
- multi-root workspace policy
- search commands
- marketplace / publisher migration
- full VS Code integration test harness

## Verification Strategy

The current repository verification flow is:
- `npm run test`
- `npm run lint`
- `npm run build`

The automated tests currently cover:
- safe command parsing
- CLI path validation
- timeout policy selection
- mutation policy matrix
- canonical workspace containment including symlink escape rejection
- pending Gateway request timeout cleanup
- agent task orchestrator state transitions, cancellation, and restart recovery
- activity intent summaries
- webview HTML CSP / nonce generation

## Next Design Focus

After the Codex orchestration pass, the next likely design targets are:
- broader command-level regression tests
- migrating Cursor Agent onto the same provider/task framework
- clearer publish/distribution metadata and marketplace preparation
- multi-root workspace behavior definition
- deeper Gateway protocol compatibility validation
