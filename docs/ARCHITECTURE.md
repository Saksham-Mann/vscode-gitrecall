# ARCHITECTURE.md — GitRecall System Architecture

## 1. System Overview

GitRecall is architected around strict separation of concerns, single-responsibility modules, and non-blocking asynchronous event handling. The extension acts like an invisible background service that synchronizes editor state with Git branch transitions.

---

## 2. Component Diagram

```
                       ┌──────────────────────────────┐
                       │         extension.ts         │
                       │   (Entrypoint & Orchestrator)│
                       └──────────────┬───────────────┘
                                      │
            ┌─────────────────────────┼─────────────────────────┐
            │                         │                         │
            ▼                         ▼                         ▼
  ┌───────────────────┐     ┌───────────────────┐     ┌───────────────────┐
  │   gitWatcher.ts   │     │    storage.ts     │     │   tabManager.ts   │
  │                   │     │                   │     │                   │
  │ • vscode.git API  │     │ • workspaceState  │     │ • tabGroups       │
  │ • Branch events   │     │ • Schema validation│    │ • Clean Desk      │
  │ • HEAD tracking   │     │ • Namespaced keys │     │ • Tab restore     │
  └───────────────────┘     └───────────────────┘     └─────────┬─────────┘
                                                                │
                                                                ▼
                                                      ┌───────────────────┐
                                                      │decorationService.ts│
                                                      │                   │
                                                      │ • 1.5s line pulse │
                                                      │ • Shared DecType  │
                                                      │ • Timer disposal  │
                                                      └───────────────────┘
```

---

## 3. Module Responsibilities

### 3.1 `storage.ts`
`storage.ts` is responsible for all persistence operations, key construction, schema validation, and safe degradation across schema versions. It handles saving, retrieving, and pruning `BranchContextRecord` and `BranchIndexRecord` instances, as well as converting repository paths into stable SHA-256 hashes and sanitizing branch identifiers. **Crucially, `storage.ts` is the ONLY module allowed to touch `context.workspaceState`.** No other component may directly invoke `Memento` methods.

### 3.2 `gitWatcher.ts`
`gitWatcher.ts` abstracts and encapsulates all interactions with the built-in `vscode.git` extension. It activates the Git extension if dormant, binds to repository lifecycle events (`state.onDidChange`, `onDidOpenRepository`, `onDidCloseRepository`), tracks active HEAD branch names in memory, filters out non-branch mutations (commits, stages, fetches), and emits clean `onBranchChanged` events. **Crucially, `gitWatcher.ts` is the ONLY module allowed to touch the `vscode.git` extension API.** It never shells out to system `git` CLI binaries.

### 3.3 `tabManager.ts`
`tabManager.ts` manages all interactions with the VS Code editor tab area via `vscode.window.tabGroups` and `vscode.window.showTextDocument`. It captures the current snapshot of open tabs (URIs, `viewColumn` pane layout, visual order, pinned status, active tab URI, active cursor, and tab cursor line/character). During branch transitions, it executes the "Clean Desk" policy by batch-closing only non-dirty tabs while preserving any unsaved documents. On restore, it performs a two-stage restoration lifecycle:
1. **Background tabs**: Reuses already-open tabs to protect in-memory edits, reopens non-active files at their designated `viewColumn` with `preserveFocus: true`, and applies cursor positions.
2. **Active tab**: Reopens the active tab last with `preserveFocus: false`, restores its active cursor position, and triggers the ephemeral line pulse highlight via `applyCursorAndDecoration`.

### 3.4 `decorationService.ts`
`decorationService.ts` provides subtle, ephemeral visual feedback indicating restored cursor positions. It creates and manages exactly one shared `TextEditorDecorationType` across the extension lifetime (with distinct styling for light and dark themes). When a file is restored, it applies a whole-line accent highlight to the cursor line and schedules a 1.5-second timeout to remove the decoration. It maintains active timer handles per editor to ensure timers are cleared immediately if an editor tab is closed early, preventing memory leaks or decoration operations on disposed editors.

---

## 4. Full Event-Lifecycle Diagram

The following flowchart details the complete, sequential execution path for a single branch-switch cycle:

```
[ Git repository change detected (repository.state.onDidChange) ]
                               │
                               ▼
            [ Debounce trailing-edge timer: 300ms ]
            (Subsequent events reset timer; only latest branch proceeds)
                               │
                               ▼
        [ Confirm branch name actually changed vs lastKnownBranch ]
           ├── No  ─► [ No-op: Exit cycle ]
           └── Yes ─► Continue
                               │
                               ▼
            [ Capture outgoing tab and cursor state ]
            (URIs, viewColumns, order, pinned, cursor positions)
                               │
                               ▼
             [ Persist outgoing record to storage.ts ]
             (Awaited workspaceState.update under namespaced key)
                               │
                               ▼
                  [ Execute "Clean Desk" ]
                  (Iterate all open tabs; inspect isDirty)
                   ├── isDirty === true  ─► [ Keep open: Preserved ]
                   └── isDirty === false ─► [ Batch close via tabGroups.close ]
                               │
                               ▼
         [ Look up incoming branch's saved record in storage.ts ]
           ├── Record not found ─► [ Leave clean desk survivors as-is: Exit ]
           └── Record found     ─► Process each TabRecord in original order
                               │
                               ▼
            ┌──────────────────────────────────────────────┐
            │  PHASE 1: RESTORE NON-ACTIVE BACKGROUND TABS │
            │  (For each record where uri !== activeTabUri)│
            └──────────────────────┬───────────────────────┘
                                   │
                                   ▼
                [ Check file exists on disk via ]
                [ vscode.workspace.fs.stat(uri)  ]
                  ├── File missing ─► [ Skip & log info; do not throw ]
                  └── File exists  ─► Continue
                                   │
                                   ▼
                [ Is tab already open in editor? ]
                  ├── Yes ─► [ Reuse existing editor instance ]
                  └── No  ─► [ Open via showTextDocument ]
                             (options: viewColumn, preserveFocus: true, preview: false)
                                   │
                                   ▼
                [ Set editor.selection & revealRange ]
                (Cursor positioned silently in background; NO pulse)
                                   │
                                   ▼
            ┌──────────────────────────────────────────────┐
            │  PHASE 2: RESTORE ACTIVE TAB WITH FOCUS      │
            │  (Open saved activeTabUri last)              │
            └──────────────────────┬───────────────────────┘
                                   │
                                   ▼
                [ Check active file exists via fs.stat ]
                  ├── File missing ─► [ Skip & log info; do not throw ]
                  └── File exists  ─► Continue
                                   │
                                   ▼
                [ Open active tab via showTextDocument ]
                (options: viewColumn, preserveFocus: false, preview: false)
                                   │
                                   ▼
                [ Set active selection to activeCursor & revealRange ]
                                   │
                                   ▼
                [ Trigger decorationService.pulseLine ]
                (Pulse accent decoration on active document; disposes in 1.5s)
```

---

## 5. Error Handling Rules

1. **No Uncaught VS Code API Calls:**
   Every call to external VS Code APIs (`vscode.window.*`, `vscode.workspace.*`, `vscode.git`) must be wrapped in `try / catch` blocks at architectural component boundaries. Under no circumstances may an unhandled rejection escape an event handler or crash the extension host.
2. **Dedicated OutputChannel Logging:**
   All caught errors, warnings, and diagnostic events must be logged to a single, shared `vscode.OutputChannel` named `"GitRecall"`. Catch blocks must never be empty. Failures must cleanly abort the active operation and leave the workspace in its current valid state rather than a half-applied state.
3. **Single Approved User-Facing Dialog:**
   To uphold GitRecall's "invisible until useful" UX principle, no informational modals, popups, or confirmation prompts are ever shown during clean branch switches. The **only** approved user-facing UI prompt is a single `vscode.window.showWarningMessage` triggered if and only if `context.workspaceState.update()` encounters an irrecoverable persistence failure (indicating that outgoing context could not be saved to disk).
4. **Strictly Asynchronous Filesystem Access:**
   Synchronous filesystem operations (such as `fs.existsSync`, `fs.readFileSync`, or any sync Node `fs` API) are strictly forbidden across the entire codebase. File existence checks must exclusively use `await vscode.workspace.fs.stat(uri)` wrapped in a `try / catch` that handles `FileNotFound` gracefully.

---

## 6. Resource Disposal & Memory Management

To prevent memory leaks and dangling listeners in long-running VS Code sessions:
- **Subscriptions:** Every `vscode.Disposable` (including `gitApi.repositories[i].state.onDidChange`, `gitApi.onDidOpenRepository`, and commands) must be registered in `context.subscriptions` or tracked within an owning class's `dispose()` method.
- **Repository Cleanup:** Subscriptions to individual repositories must be tracked and disposed when repositories are closed via `gitApi.onDidCloseRepository`.
- **Shared Decoration Type:** `decorationService.ts` must create exactly **one** shared `TextEditorDecorationType` upon initialization and dispose it when the service is disposed. It must never instantiate decoration types dynamically on each pulse.
- **Timer Management:** All `setTimeout` timers (such as the 300ms debounce timer and the 1.5-second decoration pulse timers) must store their handles and be explicitly cleared (`clearTimeout`) upon component disposal or when an editor closes before timer expiration.
- **Lifecycle Teardown:** The top-level `deactivate()` hook in `extension.ts` must trigger full teardown across all sub-modules.
