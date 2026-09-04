# PRD.md — GitRecall Product Requirements Document

## 1. Overview

**Product Name:** GitRecall
**Category:** VS Code Extension — Developer Productivity / Workspace Automation
**One-line description:** GitRecall automatically remembers and restores your open tabs, cursor positions, and pane layout every time you switch Git branches — so your editor context follows your code, not the other way around.

## 2. Problem Statement

Modern development workflows involve constant branch switching: reviewing a teammate's PR, jumping to a hotfix, stashing work to context-switch onto an urgent bug, or juggling multiple feature branches in parallel. Every `git checkout` silently discards the developer's *editor context* — the specific set of open tabs, the exact cursor line they were reading or editing, and the split-pane arrangement they had built up over the last 20 minutes of focused work.

Today, developers rebuild this context manually and repeatedly:
- Re-opening the same 4–6 files after every checkout.
- Scrolling back to "where was I" on each file.
- Re-splitting panes to get back to a comfortable layout.
- Losing 30–90 seconds of re-orientation per switch, multiplied by 10–20 switches per day.

This is a pure tax on flow state. It is not solved by existing tools:
- VS Code's native "Restore Editors" only tracks the last global session, not per-branch.
- Git worktrees solve this at the cost of duplicated checkouts and disk usage, and still require manual window management.
- Workspace-per-branch scripting exists but is bespoke, fragile, and not portable across machines or teammates.

## 3. User Personas

### Persona A — "Junior Dev, Single Feature Focus"
- Works on one feature branch for days at a time.
- Occasionally checks out `main` to pull latest or review a small fix.
- Pain point: loses their working set of tabs every time they check out `main` and back, re-discovering which files they were mid-edit on.
- Value from GitRecall: near-zero — GitRecall silently restores exactly what they had open, with zero learning curve.

### Persona B — "Senior Dev, Heavy Context Switcher"
- Juggles 4–8 active branches: a feature, a review branch, a hotfix, an experiment.
- Switches branches 10+ times per day, often mid-thought.
- Pain point: the cognitive overhead of "reloading" context on every switch is the single biggest interruption to deep work.
- Value from GitRecall: high — GitRecall effectively gives each branch its own persistent "workspace memory," letting the senior dev treat branch switches like tab switches in a browser.

## 4. Core Value Proposition

> **Your tabs remember which branch they belong to.**

GitRecall turns Git branches into first-class *workspace contexts*. Checking out a branch doesn't just change your files on disk — it changes your editor back to exactly how you left it.

## 5. Success Metrics

| Metric | Target |
|---|---|
| Data loss incidents (unsaved edits lost due to extension action) | 0 — hard requirement, not a target |
| Context swap latency (checkout event → tabs/cursor restored) | < 200ms for workspaces with ≤ 15 tracked tabs |
| Restore accuracy (tab set + cursor line matches last saved state) | 100% for files unchanged on disk since save |
| Extension activation overhead on VS Code startup | < 50ms |
| User-visible interruptions (popups, prompts) during a clean checkout | 0 |
| Crash / uncaught exception rate | 0 reported per 1,000 checkouts in telemetry-free manual testing |

## 6. In Scope (v1)

- Local, single-machine, per-workspace tab/cursor/layout persistence keyed by branch name.
- Automatic detection of branch checkout via `git checkout`, `git switch`, and VS Code's built-in Git UI.
- Restoration of: open file tabs, tab order, split-pane (`viewColumn`) grouping, active tab, and cursor line/character position per file.
- Ephemeral, non-intrusive visual highlight on the cursor line when a file is restored.
- Safe handling of dirty (unsaved) files — never force-close or discard unsaved changes.
- Safe handling of files that no longer exist on disk (renamed, deleted, or on a branch where the file never existed).
- Debouncing of rapid, consecutive branch switches (e.g., rebase operations, scripted checkouts) to avoid thrashing.
- A status bar item showing the currently tracked branch and whether GitRecall has saved state for it.

## 7. Out of Scope (v1)

- **Cross-machine / cloud sync.** All state lives in `workspaceState`, local to the machine and workspace. No account system, no network calls.
- **Multi-root workspace support** beyond the primary repository root (may be considered in v2).
- **Git worktree awareness** (treating worktrees as distinct contexts) — deferred.
- **Merge/rebase-in-progress special handling** beyond basic debounce safety — no custom UX for conflict states in v1.
- **Terminal state, debug session state, or extension-specific panel state** — only editor tabs, cursor position, and pane layout are tracked.
- **Settings sync / team-shared configuration** — GitRecall is zero-config by design; no settings UI in v1.

## 8. Functional Requirements

1. **FR-1:** The extension MUST detect a branch change originating from any source (terminal `git` commands, VS Code Source Control UI, other extensions invoking Git) via the built-in `vscode.git` extension's API and event model.
2. **FR-2:** On detecting a branch change, the extension MUST capture the *previous* branch's open tab set (URI, `viewColumn`, tab order, active/pinned state) and each open editor's cursor position (line, character) before any tabs are closed.
3. **FR-3:** The extension MUST persist this captured state to `context.workspaceState` under a key namespaced by repository root and branch name.
4. **FR-4:** The extension MUST NOT close any editor tab containing unsaved changes without explicit, safe handling (see Rules.md) — dirty tabs are preserved, not silently discarded.
5. **FR-5:** Before reopening a previously-tracked file, the extension MUST verify the file still exists on disk at the recorded URI; missing files are skipped and logged, not treated as errors.
6. **FR-6:** On restoring a file, the extension MUST place the cursor at the last recorded line/character and reveal that line in the viewport.
7. **FR-7:** On restoring a file, the extension MUST render a brief (1.5s), non-intrusive accent highlight across the restored line, then dispose the decoration automatically.
8. **FR-8:** The extension MUST debounce rapid consecutive checkout events (e.g., within a 300ms window) so that only the final resolved branch state triggers a save/restore cycle.
9. **FR-9:** The extension MUST expose the currently tracked branch and save state via a status bar item, updated on every branch change.
10. **FR-10:** All persistence operations MUST be asynchronous and MUST NOT block the UI thread.

## 9. User Experience Flow (Summary)

1. Developer opens a workspace with GitRecall installed — no setup screen, no onboarding modal.
2. Developer works normally, opening/arranging tabs as usual.
3. Developer checks out a different branch (any method).
4. GitRecall silently saves the outgoing branch's context, closes clean tabs, restores the incoming branch's last-known context, and briefly pulses the cursor line on each restored file.
5. Developer continues working with zero manual re-navigation.

See `AppFlow.md` for the detailed sequential/decision-tree breakdown of this flow.
