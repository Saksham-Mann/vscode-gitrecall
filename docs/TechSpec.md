# TechSpec.md — GitRecall Technical Specification

## 1. Component Architecture Overview

GitRecall is composed of five cooperating components, each with a single responsibility, wired together by a thin activation entrypoint.

```
extension.ts (activate/deactivate)
        │
        ▼
┌─────────────────────┐
│  ExtensionController  │  ← orchestration + lifecycle owner
└──────────┬────────────┘
           │ owns
           ├────────────────────┬────────────────────┬───────────────────────┐
           ▼                    ▼                    ▼                       ▼
┌───────────────────┐ ┌──────────────────────┐ ┌────────────────────┐ ┌──────────────────┐
│   GitWatcher        │ │ WorkspaceStorageManager│ │ TabLifecycleManager │ │ DecorationService  │
└───────────────────┘ └──────────────────────┘ └────────────────────┘ └──────────────────┘
```

## 2. Component Breakdown

### 2.1 `ExtensionController`
**Responsibility:** Top-level orchestrator. Owns the lifecycle of all other components, wires their events together, and holds the single source of truth for `lastKnownBranch`.

**Public surface:**
```typescript
class ExtensionController {
  constructor(context: vscode.ExtensionContext);
  async initialize(): Promise<void>;
  dispose(): void;
}
```

**Responsibilities:**
- Instantiate `GitWatcher`, `WorkspaceStorageManager`, `TabLifecycleManager`, `DecorationService`, and the status bar item.
- Subscribe to `GitWatcher.onBranchChanged` and drive the save → clean → restore sequence described in `AppFlow.md`.
- Own the debounce timer (see §4).
- Register all disposables on `context.subscriptions`.

### 2.2 `GitWatcher`
**Responsibility:** Abstracts away the built-in Git extension so the rest of the codebase never touches `vscode.git` directly.

**Public surface:**
```typescript
interface BranchChangeEvent {
  repoRoot: string;
  previousBranch: string | undefined;
  currentBranch: string | undefined; // undefined = detached HEAD
}

class GitWatcher implements vscode.Disposable {
  constructor();
  async activate(): Promise<boolean>; // false if vscode.git unavailable
  readonly onBranchChanged: vscode.Event<BranchChangeEvent>;
  getCurrentBranch(repoRoot: string): string | undefined;
  dispose(): void;
}
```

**Internals:**
- Resolves `vscode.extensions.getExtension('vscode.git')`, awaits `extension.activate()` if not already active, then calls `.exports.getAPI(1)`.
- For each `repository` in `gitApi.repositories` (and future ones via `gitApi.onDidOpenRepository`), subscribes to `repository.state.onDidChange`.
- On each fire, compares `repository.state.HEAD?.name` against an internally cached per-repo branch name; only fires `onBranchChanged` when the name actually differs (the underlying event fires far more often than branch changes — e.g., on every commit, stage/unstage, fetch).
- Handles detached HEAD state (`HEAD.name === undefined`) by using `HEAD.commit` (short SHA) as a synthetic "branch key" so context is still preserved when a developer checks out a specific commit.

### 2.3 `WorkspaceStorageManager`
**Responsibility:** Sole owner of reads/writes to `context.workspaceState`. No other component touches storage directly.

**Public surface:**
```typescript
class WorkspaceStorageManager {
  constructor(state: vscode.Memento);
  async saveBranchContext(repoRoot: string, branch: string, record: BranchContextRecord): Promise<void>;
  getBranchContext(repoRoot: string, branch: string): BranchContextRecord | undefined;
  async deleteBranchContext(repoRoot: string, branch: string): Promise<void>;
}
```

**Internals:**
- Namespacing key format: `gitrecall.v1.<sha256(repoRoot)>.<branchNameSanitized>` (see `Schema.md` for full key strategy and rationale on hashing the repo root).
- Wraps `Memento.update()` calls in try/catch; on failure, surfaces the single warning described in `Design.md` §5 via a callback/event rather than importing `vscode.window` directly (keeps this component testable in isolation).
- Performs no synchronous disk I/O — `workspaceState` is backed by VS Code's internal SQLite store and all access is via the async `Memento` API.

### 2.4 `TabLifecycleManager`
**Responsibility:** All reading and mutation of the editor tab area — the only component that touches `vscode.window.tabGroups` and `vscode.window.showTextDocument`.

**Public surface:**
```typescript
class TabLifecycleManager {
  captureCurrentState(): BranchContextRecord;
  async closeCleanTabs(record: BranchContextRecord): Promise<void>;
  async restoreState(record: BranchContextRecord, onFileRestored: (editor: vscode.TextEditor, line: number) => void): Promise<void>;
}
```

**Internals:**
- `captureCurrentState()` iterates `vscode.window.tabGroups.all`, and within each group, `group.tabs`, extracting URI (from `tab.input` when it's a `TabInputText`), `group.viewColumn`, tab index, `tab.isPinned`, `tab.isActive`; cross-references open `vscode.window.visibleTextEditors` / `vscode.window.tabGroups.activeTabGroup` to pull cursor `selection.active` per URI.
- `restoreState()` implements the decision tree from `AppFlow.md` §4 using a two-stage restoration pattern:
  1. Background Tabs: Checks existence via `vscode.workspace.fs.stat()` (async, never `fs.existsSync`), dedups against currently open tabs, opens non-active tabs with `{ viewColumn, preserveFocus: true, preview: false }`, and applies their saved cursor positions.
  2. Active Tab: Opens the active tab last with `{ viewColumn, preserveFocus: false, preview: false }`, restores its active cursor, reveals the range, and invokes the pulse line callback on the active document via `applyCursorAndDecoration()`. If no active tab is designated, falls back to opening tabs in order and invoking the pulse callback.

### 2.5 `DecorationService`
**Responsibility:** Owns creation, application, and disposal of the pulse-highlight decoration type described in `Design.md`.

**Public surface:**
```typescript
class DecorationService implements vscode.Disposable {
  constructor();
  pulseLine(editor: vscode.TextEditor, line: number): void;
  dispose(): void;
}
```

**Internals:**
- Creates a single shared `TextEditorDecorationType` at construction (not one per pulse call) for efficiency; light/dark colors supplied via the decoration's `light`/`dark` sub-options.
- `pulseLine()` computes the `Range` for the given line, calls `editor.setDecorations(type, [range])`, and schedules a `setTimeout` to call `editor.setDecorations(type, [])` after 1500ms.
- Tracks active timeout handles in a `Map<vscode.TextEditor, NodeJS.Timeout>`; if `pulseLine` is called again for the same editor before the previous timeout fires (unlikely but possible on fast re-restore), the prior timeout is cleared first.
- `dispose()` clears all pending timeouts and disposes the shared decoration type — called from `ExtensionController.dispose()`.

## 3. API Contract Mappings

| GitRecall Need | VS Code / Git API | Notes |
|---|---|---|
| Detect branch change | `vscode.git` built-in extension → `gitApi.repositories[i].state.onDidChange` + `.state.HEAD.name` | Must activate the `vscode.git` extension explicitly; it is not guaranteed active on startup |
| Enumerate open tabs | `vscode.window.tabGroups.all` → `group.tabs` | `Tab.input` must be narrowed to `TabInputText` to extract a URI safely |
| Close tabs | `vscode.window.tabGroups.close(tabs \| tabGroups, preserveFocus?)` | Batched call preferred over looped single closes |
| Reopen a file | `vscode.window.showTextDocument(uri, options)` | `options.viewColumn` restores pane placement; `preview: false` ensures it opens as a permanent tab, not a preview tab |
| Check file existence | `vscode.workspace.fs.stat(uri)` (throws `FileNotFound` on miss) | Always async; never use Node's `fs` sync APIs |
| Persist state | `context.workspaceState.update(key, value)` / `.get(key)` | `Memento` API; value must be JSON-serializable |
| Cursor position | `TextEditor.selection` / `TextEditor.revealRange(range, revealType)` | Store as `{line, character}`, restore as a zero-width `Selection` |
| Ephemeral highlight | `vscode.window.createTextEditorDecorationType(options)` + `editor.setDecorations(type, ranges)` | One shared decoration type; ranges array toggled between `[range]` and `[]` |

## 4. Concurrency & Debounce Strategy

- The `repository.state.onDidChange` event is **not** branch-switch-specific — it fires on stage/unstage, commit, fetch, and many other repository mutations. `GitWatcher` performs a cheap name-comparison filter before ever notifying `ExtensionController`, so downstream components only see genuine branch transitions.
- Even genuine branch transitions can arrive in rapid bursts (e.g., an interactive rebase stepping through several commits, or a script running several checkouts). `ExtensionController` debounces with a **300ms trailing-edge window**: each new `onBranchChanged` event resets the timer; only when 300ms pass with no further change does the save/restore cycle run, using the branch name present *at that moment* (not the first-detected one).
- Save and restore operations for a given cycle run **sequentially, not concurrently** (save must fully complete — including the awaited `workspaceState.update()` — before Clean Desk begins, which must complete before Restore begins), to guarantee the outgoing branch's context is durably persisted before any tabs are closed.
- If a new branch-change event arrives *while* a save/restore cycle from a previous transition is still in flight, `ExtensionController` awaits completion of the in-flight cycle before starting the debounce timer for the new one (a simple internal `Promise` lock), preventing interleaved/racing tab mutations.

## 5. Performance Budgets

| Operation | Budget | Notes |
|---|---|---|
| Extension activation (`activate()` returns) | < 50ms | Git extension activation itself is awaited but not blocking (fire-and-continue with event subscription established async) |
| Capture current state (≤ 20 tabs) | < 20ms | Pure in-memory enumeration, no I/O |
| Persist to workspaceState | < 30ms | `Memento.update()` is normally fast; not on the critical rendering path |
| Full save → clean → restore cycle (≤ 15 tabs) | < 200ms | Matches PRD success metric; dominated by `showTextDocument` calls, which are the only inherently I/O-bound step |
| Pulse decoration apply | < 5ms | Synchronous `setDecorations` call |

## 6. Error Handling Strategy

- All async calls into VS Code APIs are wrapped in try/catch at the component boundary (not deep inside loops), logging to a dedicated `vscode.OutputChannel` named `"GitRecall"`.
- No uncaught exception should ever propagate out of an event handler — `ExtensionController`'s subscription callbacks wrap the entire save/restore cycle in a top-level try/catch that logs and safely aborts the current cycle, leaving the editor state as-is rather than partially applied.
- See `Design.md` §5 and `Rules.md` for the single approved user-facing error surface (persistence failure warning).
