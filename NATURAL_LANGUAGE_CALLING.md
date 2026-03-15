# Natural-Language Calling Guide

This document defines the recommended v1 contract for using OpenClaw with this VS Code node through natural language instead of raw `vscode.*` commands.

It is written for end users first, not protocol authors.

## Goal

Make OpenClaw feel like an IDE assistant:
- users talk in normal language
- the system maps intent to `vscode.*` or `vscode.agent.task.*`
- low-level details such as `taskId`, `status`, and `respond` stay hidden unless needed for debugging

Default behavior:
- conversation-first
- read-first safety
- plan before write
- hide task protocol details by default

## User Intent Model

The natural-language layer should classify requests into these intent groups.

### 1. Read And Query

Examples:
- "Read the README and tell me how to install this project."
- "Check the current git status."
- "Show me the files under `src/agent-tasks`."

Recommended internal route:
- direct read-only `vscode.*` commands

Typical mappings:
- `vscode.file.read`
- `vscode.dir.list`
- `vscode.git.status`
- `vscode.lang.definition`
- `vscode.workspace.info`

### 2. Analyze And Summarize

Examples:
- "Summarize the current architecture."
- "Explain how Gateway timeout handling works."
- "Compare the old agent path and the Codex task path."

Recommended internal route:
- start with read-only command composition
- if the task is broad or multi-step, upgrade to `vscode.agent.task.start` with `mode = "ask"`

### 3. Plan And Decide

Examples:
- "Give me two implementation options."
- "Analyze the next step, but do not modify anything."
- "I want to choose the direction myself."

Recommended internal route:
- always use `vscode.agent.task.start` with `mode = "plan"`
- translate `decisionRequest` into natural language
- do not show raw JSON unless the user explicitly asks

### 4. Execute And Modify

Examples:
- "Fix this bug."
- "Apply the recommended plan."
- "Update the docs and commit the changes."

Recommended internal route:
- do not immediately write
- first restate the intended change in one short sentence
- require explicit user confirmation before entering write mode
- after confirmation, prefer `vscode.agent.task.start` with `mode = "agent"`

### 5. Resume Or Debug

Examples:
- "Continue the last task."
- "Use the recommended option and keep going."
- "Why is the VS Code node connected but not callable?"

Recommended internal route:
- if there is an active or waiting task, attach to that task internally
- if the user is debugging setup, prefer diagnostics and read-only inspection
- do not ask the user for `taskId` unless there is real ambiguity

## Routing Rules

Use these rules in order.

1. If the user says "read", "look at", "check", "summarize", or "analyze", default to read-only behavior.
2. If the user says "give me options", "plan first", "do not change anything", or "I will choose", force `plan` mode.
3. If the user says "fix", "implement", "apply", "commit", or "change", do not write immediately. First confirm the intended execution.
4. If the user says "continue", "keep going", or "use the recommended option", try to resolve the most recent `waiting_decision` or active task internally.
5. If the user asks for "status", "progress", or "where are we now", summarize task progress in natural language instead of returning raw task JSON.
6. Only reveal command names, `taskId`, `waiting_decision`, or protocol details when:
   - the user asks for debugging detail
   - a failure needs explanation
   - multiple candidate tasks make automatic resume unsafe

## Prompt Contract For OpenClaw

The assistant-side system prompt should follow these rules.

### Role Framing

Treat the user as talking to an IDE assistant, not a command runner.

Prefer:
- understanding intent
- choosing the right internal route
- hiding protocol mechanics

Avoid:
- asking users to name raw commands
- requiring users to supply `taskId`
- exposing JSON unless needed

### Agent Split

Treat these as different systems:
- `vscode.agent.status` checks the legacy Cursor Agent CLI path
- natural-language long-form tasks should prefer `vscode.agent.task.*`

Do not use `vscode.agent.status` as a prerequisite for Codex task handling.

### Safety Contract

For any request that could modify code, run terminal commands, or create git history:
- analyze first
- plan first when the request is broad
- require explicit user confirmation before write execution

### Task Hiding Contract

Internally the system may use:
- `start`
- `status`
- `respond`
- `result`

Externally it should say things like:
- "I am analyzing the repository."
- "I organized two directions for you to choose from."
- "I am continuing with the recommended option."

## User-Facing Reply Style

Default reply style:
- short
- action-oriented
- natural
- no command names

Preferred examples:
- "I will first inspect the workspace and read the README."
- "I found two reasonable directions. You can pick one."
- "I am continuing with the recommended approach."

Avoid by default:
- "I called `vscode.agent.task.start`"
- "Task `780ff015...` is now `waiting_decision`"

Allowed when debugging:
- "Internally this is the Codex task flow, not the legacy Cursor Agent status check."

## Ready-To-Use Templates

### Read Template

User:

```text
Read the current project README and summarize installation steps and known limits.
```

Recommended route:
- read-only `vscode.*`

### Analyze Template

User:

```text
Explain how the current Gateway timeout and task orchestration logic works.
```

Recommended route:
- read-only commands first
- promote to `mode = "ask"` if the repository scan is broad

### Plan Template

User:

```text
Analyze the next most valuable change for this repository. Give me two options and do not modify anything yet.
```

Recommended route:
- `vscode.agent.task.start(mode = "plan")`

### Execute Template

User:

```text
Apply the recommended approach, make the code changes, and summarize what changed.
```

Recommended route:
- confirm intent
- then `vscode.agent.task.start(mode = "agent")`

### Resume Template

User:

```text
Continue the last plan task and use the recommended option.
```

Recommended route:
- resolve latest `waiting_decision`
- internally continue with `status/respond/result`

### Debug Template

User:

```text
Check why the VS Code node is connected but still cannot be called.
```

Recommended route:
- diagnostics and read-only inspection
- avoid task mode unless the user is asking for a coding workflow

## Example Translation

User:

```text
Look through this repository and tell me the next two things worth doing.
```

Assistant should interpret this as:
- not a raw command request
- not a write request
- probably `plan` if the user wants options

User:

```text
Fix the bug in the Codex CLI startup path.
```

Assistant should interpret this as:
- a write-capable request
- first confirm the intended scope
- then enter `agent` execution if confirmed

## Acceptance Checklist

This guide is working as intended when:
- users can describe goals in plain language
- the system chooses read, ask, plan, or agent mode without asking for raw commands
- users do not need `taskId` for normal flows
- progress updates are phrased naturally
- protocol details appear only in debugging or failure explanations

## Scope Notes

This v1 guide is documentation and prompt-contract only.

It does not require:
- protocol changes in OpenClaw
- code changes in this extension
- UI buttons or product-side workflow automation

Those can be added later on top of this contract.
