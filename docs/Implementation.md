# Implementation.md — GitRecall Implementation Roadmap

## 1. File Structure

```
gitrecall/
├── src/
│   ├── extension.ts                 # activate()/deactivate() entrypoint
│   ├── core/
│   │   ├── ExtensionController.ts
│   │   ├── GitWatcher.ts
│   │   ├── WorkspaceStorageManager.ts
│   │   ├── TabLifecycleManager.ts
│   │   └── DecorationService.ts
│   ├── schema/
│   │   ├── types.ts                 # BranchContextRecord, TabRecord, CursorPosition, BranchIndexRecord
│   │   ├── keys.ts                  # key construction/sanitization helpers
│   │   └── migrations/
│   │       └── index.ts             # migration registry (empty in v1, scaffolded for v2)
│   ├── ui/
│   │   └── StatusBarController.ts
│   └── util/
│       ├── debounce.ts
│       ├── logger.ts                 # thin wrapper around a shared OutputChannel
│       └── hash.ts                   # sha256-based repoRoot hashing
├── test/
│   ├── unit/
│   │   ├── WorkspaceStorageManager.test.ts
│   │   ├── TabLifecycleManager.test.ts
│   │   ├── GitWatcher.test.ts
│   │   ├── debounce.test.ts
│   │   └── migrations.test.ts
│   └── integration/
│       ├── runTest.ts                # @vscode/test-electron launcher
│       └── suite/
│           ├── index.ts
│           ├── saveRestore.integration.test.ts
│           ├── dirtyFiles.integration.test.ts
│           └── debounce.integration.test.ts
├── .vscode/
│   ├── launch.json
│   └── tasks.json
├── .vscodeignore
├── .eslintrc.json
├── .gitignore
├── package.json                      # extension manifest (activationEvents, contributes, engines)
├── tsconfig.json                     # strict: true
├── CHANGELOG.md
└── README.md
```

## 2. Development Roadmap — 4 Milestones

### Milestone 1: Foundation & Git Detection
**Goal:** Extension activates cleanly and can reliably detect branch changes, with no tab manipulation yet.

- Scaffold project via `yo code` or manual `package.json` + `tsconfig.json` (strict mode on).
- Implement `GitWatcher` (§2.2 of `TechSpec.md`): resolve `vscode.git`, subscribe to repository state, filter to genuine branch-name changes.
- Implement `ExtensionController` skeleton that just logs `BranchChangeEvent`s to the Output Channel.
- Implement `StatusBarController` showing the current branch (no save-state indicator yet, since nothing is saved).
- **Exit criteria:** Checking out branches in a real repo produces accurate, de-duplicated log lines in the Output Channel; no false positives from commits/stages.

### Milestone 2: Persistence & State Capture
**Goal:** Tab/cursor state can be captured and durably saved per branch, without yet touching the editor on restore.

- Implement `schema/types.ts` and `schema/keys.ts` exactly per `Schema.md`.
- Implement `WorkspaceStorageManager` (save/get/delete), including the `__index` maintenance.
- Implement `TabLifecycleManager.captureCurrentState()` only (no close/restore yet).
- Wire `ExtensionController` to call capture + save on every debounced branch change (restore is a no-op stub).
- **Exit criteria:** After switching branches several times and inspecting `workspaceState` (via a temporary debug command), each branch has an accurate, schema-valid `BranchContextRecord`.

### Milestone 3: Tab Lifecycle — Clean Desk & Restore
**Goal:** Full save → clean → restore cycle works end-to-end, including dirty-file safety and missing-file handling.

- Implement `TabLifecycleManager.closeCleanTabs()` with the dirty-file exclusion logic.
- Implement `TabLifecycleManager.restoreState()` with the full decision tree from `AppFlow.md` §4 (existence check, dedup against already-open tabs, `showTextDocument` with correct `viewColumn`, cursor + reveal).
- Wire the full sequential flow into `ExtensionController` (save → clean → restore), including the concurrency lock described in `TechSpec.md` §4.
- Implement the debounce utility (`util/debounce.ts`) and integrate the 300ms trailing-edge window.
- **Exit criteria:** Manual test script (see §3) passes for all core scenarios: clean switch, switch with a dirty file present, switch to a branch with no prior record, switch to a branch whose saved file was since deleted.

### Milestone 4: Decoration, Polish & Packaging
**Goal:** Visual pulse implemented, status bar finalized, error handling hardened, ready for Marketplace packaging.

- Implement `DecorationService` exactly per `Design.md` §3 (shared decoration type, light/dark colors, 1500ms lifecycle, timeout cleanup).
- Wire `TabLifecycleManager.restoreState()`'s `onFileRestored` callback to `DecorationService.pulseLine()`.
- Finalize `StatusBarController` to show save-state per `Design.md` §4 (has record vs. new).
- Implement the single approved user-facing warning path (`Design.md` §5) for persistence failures.
- Full error-handling pass per `TechSpec.md` §6 — wrap all event handler bodies, verify no uncaught rejections in the integration test run.
- Write `README.md`, `CHANGELOG.md`, finalize `package.json` metadata (`displayName`, `description`, `categories`, `keywords`, `icon`).
- Package via `vsce package`; smoke-test the `.vsix` in a clean VS Code profile.
- **Exit criteria:** All integration tests green; manual smoke test in a fresh profile with no other extensions; `.vsix` installs and behaves identically to dev-mode (`F5`) run.

## 3. Testing Strategy

### 3.1 Unit Testing (state transitions, pure logic)
Framework: standard TS test runner (e.g., `mocha` + `ts-node`, consistent with `@vscode/test-electron` tooling) — no VS Code API dependency for this layer, achieved by keeping `WorkspaceStorageManager` constructed against a mock `Memento` and `TabLifecycleManager`'s pure-logic pieces (ordering, filtering, decision-tree branch selection) extracted into functions that accept plain data rather than live `vscode.Tab` objects wherever feasible.

Key unit test targets:
- `WorkspaceStorageManager`: save → get round-trip; schema version mismatch → migration or safe-degradation path; key sanitization for branch names containing `/`.
- `debounce.ts`: timer resets correctly on repeated calls within the window; fires exactly once with the final arguments after the window elapses.
- `migrations`: given a synthetic "old-shape" record, migration produces a valid current-shape record.
- `GitWatcher`'s filtering logic: given a sequence of synthetic `onDidChange` fires with varying `HEAD.name` values, only genuine changes produce `onBranchChanged` events.

### 3.2 Integration Testing (`@vscode/test-electron`)
Runs a real, downloaded VS Code instance with GitRecall loaded against fixture Git repositories checked into `test/integration/fixtures/`.

Key integration scenarios:
- **Clean switch:** open 3 files on branch A, checkout branch B (no prior record), checkout back to A → all 3 files reopen at correct cursor positions within the performance budget.
- **Dirty file safety:** open a file, make an unsaved edit, checkout another branch → dirty file remains open and unsaved-edits intact; is correctly reused (not reloaded) if the same branch is later revisited.
- **Missing file:** save a record referencing a file, delete that file on disk (simulating a rename on another branch), checkout back → no error, file simply not restored, others in the record restore normally.
- **Debounce under rapid checkouts:** script 5 checkouts within under 300ms of each other → only one save/restore cycle executes, using the final branch.
- **Split-pane restoration:** open files across 2 `viewColumn`s, switch and return → pane assignment preserved exactly.

### 3.3 Manual Smoke Test Checklist (pre-release, informal)
- Fresh VS Code profile, only GitRecall installed.
- Real multi-branch repository with a mix of TypeScript, JSON, and binary files.
- Verify: no popups on clean switches, status bar updates correctly, pulse highlight renders and disappears in both light and dark themes, extension activation doesn't noticeably delay VS Code startup.
