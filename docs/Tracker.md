# Tracker.md — GitRecall Implementation Tracker

> Status legend: `[ ]` not started · `[~]` in progress · `[x]` complete
> Update this file as work progresses. Grouped to mirror the 4 milestones in `Implementation.md`.

## Setup

- [ ] Scaffold extension project (`package.json`, `tsconfig.json` with `strict: true`, `.eslintrc.json`)
- [ ] Set `engines.vscode` to `^1.85.0` in `package.json`
- [ ] Configure `.vscode/launch.json` and `tasks.json` for F5 debug run
- [ ] Set up `.vscodeignore` and `.gitignore`
- [ ] Create base file structure per `Implementation.md` §1
- [ ] Set up test runner for unit tests (mocha/ts-node)
- [ ] Set up `@vscode/test-electron` scaffolding (`test/integration/runTest.ts`)
- [ ] Create fixture Git repositories for integration tests

## Core Logic — Milestone 1 (Foundation & Git Detection)

- [ ] Implement `GitWatcher`: resolve and activate `vscode.git` extension
- [ ] Implement `GitWatcher`: subscribe to `repository.state.onDidChange` per repo
- [ ] Implement branch-name-change filtering (ignore non-branch-switch mutations)
- [ ] Implement detached HEAD handling (synthetic `detached__<sha>` key)
- [ ] Implement `ExtensionController` skeleton wired to `GitWatcher.onBranchChanged`
- [ ] Implement basic `StatusBarController` (current branch display only)
- [ ] Handle `vscode.git` not found / not active gracefully (no crash, dormant mode)
- [ ] Manual verification: branch switches logged accurately, no false positives

## Core Logic — Milestone 2 (Persistence & State Capture)

- [ ] Define `BranchContextRecord`, `TabRecord`, `CursorPosition`, `BranchIndexRecord` in `schema/types.ts`
- [ ] Implement key construction + sanitization in `schema/keys.ts` (repo root hashing, branch name sanitization)
- [ ] Implement `WorkspaceStorageManager.saveBranchContext()`
- [ ] Implement `WorkspaceStorageManager.getBranchContext()`
- [ ] Implement `WorkspaceStorageManager.deleteBranchContext()`
- [ ] Implement `__index` maintenance (known branch keys per repo)
- [ ] Implement `TabLifecycleManager.captureCurrentState()` (tabs, viewColumn, order, pinned, cursor)
- [ ] Wire capture + save into `ExtensionController` on debounced branch change
- [ ] Manual verification: inspect persisted records for schema validity across several branch switches

## UI/Decorations

- [ ] Implement `DecorationService`: create shared `TextEditorDecorationType` (light/dark colors per `Design.md`)
- [ ] Implement `DecorationService.pulseLine()` with 1500ms `setTimeout` dispose
- [ ] Implement per-editor timeout tracking + clearing on early editor close
- [ ] Wire `pulseLine()` into `TabLifecycleManager.restoreState()`'s `onFileRestored` callback
- [ ] Finalize `StatusBarController`: saved-state indicator (`GitRecall: <branch>` vs `GitRecall: new`)
- [ ] Implement status bar click → open Output Channel
- [ ] Verify pulse visual correctness in both light and dark themes

## Error Handling

- [ ] Wrap all VS Code API calls at component boundaries in try/catch
- [ ] Implement `"GitRecall"` Output Channel logger utility
- [ ] Implement single approved user-facing warning for persistence failure (`Design.md` §5)
- [ ] Ensure no uncaught exceptions can propagate from event handler callbacks
- [ ] Implement missing-file handling in `restoreState()` (existence check via `workspace.fs.stat`)
- [ ] Implement dirty-file exclusion in `closeCleanTabs()`
- [ ] Implement already-open-tab reuse/dedup logic in `restoreState()`
- [ ] Implement schema version check + migration/safe-degradation path on read

## Concurrency & Debounce

- [ ] Implement `util/debounce.ts` (300ms trailing-edge)
- [ ] Integrate debounce into `ExtensionController`'s branch-change handling
- [ ] Implement in-flight cycle lock (no overlapping save/restore cycles)
- [ ] Verify rapid consecutive checkouts only trigger one resolved cycle

## Memory Management

- [ ] Ensure all `Disposable`s registered on `context.subscriptions` or component-owned disposal lists
- [ ] Implement `dispose()` on `GitWatcher`, `DecorationService`, `StatusBarController`, `ExtensionController`
- [ ] Wire `deactivate()` in `extension.ts` to `ExtensionController.dispose()`
- [ ] Verify per-repository subscription cleanup on repository close (`onDidCloseRepository`)
- [ ] Audit for single shared decoration type (no per-pulse instance creation)

## Testing

- [ ] Unit: `WorkspaceStorageManager` save/get round-trip
- [ ] Unit: schema version mismatch → migration / safe-degradation
- [ ] Unit: key sanitization for branch names with `/`
- [ ] Unit: `debounce.ts` timer reset + single trailing fire
- [ ] Unit: `GitWatcher` change-filtering logic (synthetic event sequences)
- [ ] Integration: clean switch, no prior record
- [ ] Integration: clean switch, existing record (full restore incl. cursor + viewColumn)
- [ ] Integration: dirty file preserved and reused correctly
- [ ] Integration: missing file on disk skipped without error
- [ ] Integration: rapid consecutive checkouts → single resolved cycle
- [ ] Integration: split-pane (multi-viewColumn) restoration accuracy
- [ ] Manual smoke test in fresh VS Code profile (checklist in `Implementation.md` §3.3)
- [ ] Performance check: full cycle under 200ms for ≤15 tabs

## Marketplace Packaging

- [x] Write `README.md` (feature overview, GIF/screenshot of pulse highlight, no-config messaging)
- [x] Write `CHANGELOG.md` (v1.0.0 initial entry)
- [x] Finalize `package.json` metadata: `displayName`, `description`, `categories`, `keywords`, `icon`, `publisher`
- [x] Add `LICENSE`
- [ ] Run `vsce package` and produce `.vsix`
- [ ] Smoke test `.vsix` install in a clean profile
- [ ] Publish to Marketplace (or internal distribution, per current plan)
