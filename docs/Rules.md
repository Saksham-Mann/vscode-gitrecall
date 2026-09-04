# Rules.md — GitRecall Architectural Rules & Hard Constraints

These rules are binding for all code generated for GitRecall. They are not suggestions — code that violates a rule marked **NEVER** must be rejected and rewritten, even if it "works" in the common case.

## 1. Data Safety — Absolute Rules

- **NEVER** close a tab that has unsaved changes (`isDirty === true`) as part of the automated "Clean Desk" step. Dirty tabs are always excluded from any batch close operation, with no exceptions and no user-configurable override in v1.
- **NEVER** reload/re-open a file from disk if a tab for that URI is already open and dirty. If the URI is already open, reuse the existing editor instance — never call `showTextDocument` in a way that could discard in-memory unsaved state.
- **NEVER** write, insert, or modify any content in a user's source file. GitRecall's only permitted touch of a document is setting the cursor `selection` and applying a purely visual, non-content `TextEditorDecorationType`. No comments, no markers, no auto-formatting.
- **NEVER** delete or overwrite a previously saved `BranchContextRecord` for a branch as a side effect of failed migration or a partial write — a failed save must leave the previously persisted record for that branch untouched. Writes are only committed after the new record is fully constructed in memory.
- **NEVER** treat a persistence failure (`workspaceState.update()` rejecting) as a silent no-op. It must be logged and, per `Design.md` §5, surfaced via the single approved warning path — silent data-loss-adjacent failures are worse than one interruption.

## 2. Filesystem & I/O Rules

- **NEVER** query the filesystem synchronously (no `fs.existsSync`, `fs.readFileSync`, or any sync Node `fs` call anywhere in the extension). All existence checks use `vscode.workspace.fs.stat()` and are awaited.
- **NEVER** assume a URI from a saved record still resolves to a valid file. Every restoration path must run the existence check from `AppFlow.md` §4 before attempting to open it.
- **NEVER** block VS Code's UI/extension host thread with a long-running synchronous loop. Batch operations (e.g., closing many tabs) use the batched API (`tabGroups.close(tabs[])`) rather than sequential awaited loops where a batched form exists.

## 3. Git Integration Rules

- **NEVER** shell out to `git` directly (no `child_process.exec('git ...')`) for branch detection. All Git interaction goes through the built-in `vscode.git` extension's exported API, so GitRecall stays consistent with whatever Git state VS Code itself considers authoritative and avoids maintaining a second source of truth.
- **NEVER** assume the `vscode.git` extension is active or even installed. `GitWatcher.activate()` must handle the "not found" / "not yet activated" cases gracefully (see `TechSpec.md` §2.2) and the extension must not crash or spam errors in a non-Git or Git-extension-disabled workspace — it should simply remain dormant.
- **NEVER** trigger a save/restore cycle from a `repository.state.onDidChange` event without first confirming the branch name actually changed. This event fires on many non-branch-switch mutations (staging, committing, fetching); acting on all of them would cause constant, disruptive tab churn.

## 4. UX / Interruption Rules

- **NEVER** show a modal dialog, confirmation prompt, or blocking `showInformationMessage` during a normal (non-error) save/restore cycle. See `Design.md` §1 and §5 for the single carve-out.
- **NEVER** steal focus while restoring background tabs. Always use `preserveFocus: true` when restoring non-active tabs in Phase 1 so background tab creation does not disrupt editor focus. In Phase 2, open the active tab last with `preserveFocus: false` to restore focused editor context, apply the cursor position, and trigger the ephemeral line pulse highlight.
- **NEVER** reorder tabs relative to their saved order, and **NEVER** reassign a tab to a different `viewColumn` than was recorded, except when the missing-file or dedup rules in `AppFlow.md` §4 make the original slot inapplicable.

## 5. Debounce & Concurrency Rules

- **NEVER** start a new save/restore cycle while a previous one is still in flight. Use the internal lock/await pattern described in `TechSpec.md` §4 — cycles are strictly sequential, never concurrent or interleaved.
- **NEVER** act on an intermediate branch state during a rapid sequence of checkouts. Only the branch resolved after the debounce window elapses is used for the cycle.
- **NEVER** persist state keyed to an intermediate/transient branch name that was superseded before the debounce window closed.

## 6. Memory Management Rules

- **NEVER** leave an event subscription (`vscode.Disposable`) unregistered from `context.subscriptions` or the owning component's internal disposal list. Every `onDid*` subscription, every `createTextEditorDecorationType()` result, and every `setTimeout` handle must have a clear owner responsible for disposing/clearing it.
- **NEVER** create a new `TextEditorDecorationType` per pulse call. `DecorationService` must create exactly one shared instance and reuse it for the lifetime of the extension, toggling applied ranges rather than creating/disposing types repeatedly.
- **NEVER** let a pending pulse `setTimeout` outlive its target editor. If an editor is closed before its 1500ms pulse timer fires, the timer must be cleared (not merely left to fire harmlessly) — `DecorationService` tracks handles per-editor specifically to enforce this.
- **NEVER** allow `GitWatcher`'s per-repository subscriptions to leak when a repository is closed/removed from the workspace (`gitApi.onDidCloseRepository`). Each repository's `state.onDidChange` subscription must be disposed when its repository closes.
- **ALWAYS** implement `dispose()` on every stateful component (`GitWatcher`, `DecorationService`, `StatusBarController`) and call it from `ExtensionController.dispose()`, which itself is called from the extension's `deactivate()`.

## 7. Schema & Storage Rules

- **NEVER** write a `BranchContextRecord` without a `schemaVersion` field, and **NEVER** read one without checking it (see `Schema.md` §5).
- **NEVER** store non-JSON-serializable values in `workspaceState` (e.g., no `vscode.Uri` objects directly — always `.toString()` them first; no class instances, no `Map`/`Set`).
- **NEVER** silently drop the previous version's data on a breaking schema change. Old-versioned keys remain untouched; new-versioned keys are written alongside per the versioning strategy.

## 8. Code Quality Rules

- **ALWAYS** compile under `"strict": true` in `tsconfig.json` with no `any` used to bypass a type error introduced by VS Code API narrowing (e.g., narrowing `Tab.input` to `TabInputText` must use a proper `instanceof` check, not an `as any` cast).
- **NEVER** catch an error and discard it without at minimum a log line to the `"GitRecall"` Output Channel (see `TechSpec.md` §6). Empty catch blocks are forbidden.
- **ALWAYS** route all Git API access through `GitWatcher` and all storage access through `WorkspaceStorageManager` — no other component may import or touch `vscode.git` exports or `context.workspaceState` directly. This is what keeps `TabLifecycleManager` and `DecorationService` unit-testable without a live VS Code Git repository.
