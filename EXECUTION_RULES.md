# Execution Rules

## Purpose
This file records our working plan and repository rules so future tasks follow the same execution standard.

## Current Plan
1. Prioritize security fixes and high-impact functional issues first.
2. Keep code, tests, and documentation aligned in the same task whenever practical.
3. Before stopping after a completed task, sync the project state to the remote repository.

## Working Rules
1. Make the smallest safe change that fully resolves the task.
2. Verify important changes with relevant tests, lint, or build commands before stopping.
3. Update docs or changelog when behavior, security semantics, or workflow changes.
4. If a task introduces new rules, record them in this file immediately.

## Remote Sync Rule
When a task is complete and work is about to stop, push the project to the remote repository.

Default sequence:
1. Review `git status` and confirm the intended changes.
2. Run the relevant verification commands.
3. Commit the finished work with a clear message.
4. Push to `origin` on the current branch.

If push is blocked by permissions, authentication, or network issues, report the blocker clearly before stopping.
