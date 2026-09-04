# AppFlow.md — GitRecall End-to-End Flow

## 1. Purpose

This document describes the complete, sequential runtime flow of GitRecall from extension activation through a full branch-switch cycle, including every decision branch for edge cases. It is the reference for `TechSpec.md`'s component design.

## 2. High-Level Journey (Narrative)

A developer opens VS Code on a repository with GitRecall installed. GitRecall activates, locates the built-in Git extension, and starts listening for repository state changes. The developer works normally. At some point — via terminal, VS Code's Source Control panel, or any other means — the active branch changes. GitRecall detects this transition, silently saves the outgoing branch's editor context, cleans the desk of tabs that are safe to close, restores the incoming branch's previously saved context (if any), and gives a brief visual cue on each restored file's cursor position. The developer never sees a popup, prompt, or confirmation dialog during a clean switch.

## 3. Sequential Flow (Flowchart-Style)

```
┌─────────────────────────┐
│  1. INITIALIZATION       │
│  Extension activates     │
└────────────┬─────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│  Locate built-in vscode.git          │
│  extension via                       │
│  extensions.getExtension('vscode.git')│
└────────────┬──────────────────────────┘
             │
      ┌──────┴──────┐
      │ Found?       │
      └──────┬───────┘
       Yes   │   No
   ┌─────────┘   └─────────┐
   ▼                        ▼
┌───────────────────┐   ┌─────────────────────────┐
│ Await git.exports  │   │ Log + deactivate         │
│ .getAPI(1)         │   │ gracefully (no UI error) │
└─────────┬───────────┘   └───────────────────────┘
          │
          ▼
┌───────────────────────────────────────┐
│  2. BRANCH LISTENER                    │
│  Subscribe to repository.state.        │
│  onDidChange for each open repository  │
│  Track current HEAD branch name in     │
│  memory (lastKnownBranch)              │
└────────────┬────────────────────────────┘
             │
             ▼  (fires on ANY repo state change,
             │   not just branch switches)
┌───────────────────────────────────────┐
│  Compare repository.state.HEAD.name    │
│  to lastKnownBranch                    │
└────────────┬────────────────────────────┘
             │
      ┌──────┴───────┐
      │ Changed?      │
      └──────┬────────┘
        No   │   Yes
   ┌─────────┘   └──────────────┐
   ▼                             ▼
┌────────────┐        ┌───────────────────────────┐
│ No-op,     │        │  Debounce window starts     │
│ return     │        │  (300ms). Additional        │
└────────────┘        │  changes within window      │
                       │  reset the timer.            │
                       └────────────┬─────────────────┘
                                    │ timer elapses
                                    ▼
                       ┌───────────────────────────┐
                       │  Resolve FINAL branch name  │
                       │  (may differ from the first  │
                       │  detected change if multiple │
                       │  checkouts fired rapidly)     │
                       └────────────┬─────────────────┘
                                    │
                                    ▼
             ┌───────────────────────────────────────┐
             │  3. SAVE CONTEXT (outgoing branch)      │
             │  = lastKnownBranch                      │
             └────────────┬──────────────────────────────┘
                          │
                          ▼
             ┌───────────────────────────────────────┐
             │  For each open tab in tabGroups:        │
             │   - Record URI                          │
             │   - Record viewColumn (group index)     │
             │   - Record tab order/index               │
             │   - Record isPinned / isActive           │
             │   - If tab has a visible text editor,    │
             │     record cursor line/character         │
             └────────────┬──────────────────────────────┘
                          │
                          ▼
             ┌───────────────────────────────────────┐
             │  Persist TabRecord[] to workspaceState  │
             │  under key: branchKey(repoRoot,          │
             │  lastKnownBranch)  (see Schema.md)       │
             └────────────┬──────────────────────────────┘
                          │
                          ▼
             ┌───────────────────────────────────────┐
             │  4. CLEAN DESK                          │
             └────────────┬──────────────────────────────┘
                          │
                          ▼
                 ┌─────────────────────┐
                 │ For each open tab:   │
                 │ Is it dirty          │
                 │ (unsaved changes)?   │
                 └─────────┬────────────┘
                    Yes    │    No
              ┌────────────┘    └─────────────┐
              ▼                                ▼
   ┌────────────────────────┐     ┌────────────────────────┐
   │ SKIP closing this tab.   │     │ Close tab via            │
   │ Leave it open and         │     │ tabGroups.close(tab)     │
   │ visible so the user        │     │                          │
   │ retains full control       │     │                          │
   │ (see Rules.md — never      │     │                          │
   │ force-discard edits)       │     │                          │
   └────────────────────────┘     └────────────────────────┘
                          │
                          ▼
             ┌───────────────────────────────────────┐
             │  5. RESTORE CONTEXT (incoming branch)   │
             │  = newly resolved branch name           │
             └────────────┬──────────────────────────────┘
                          │
                          ▼
             ┌───────────────────────────────────────┐
             │  Read TabRecord[] from workspaceState   │
             │  for branchKey(repoRoot, newBranch)     │
             └────────────┬──────────────────────────────┘
                          │
                   ┌──────┴───────┐
                   │ Record exists?│
                   └──────┬────────┘
                No record │  Has record
        ┌──────────────────┘  └───────────────────┐
        ▼                                          ▼
┌─────────────────────┐              ┌───────────────────────────┐
│ No-op. Leave editor   │              │ For each TabRecord,         │
│ area as-is (whatever   │              │ sorted by original order:   │
│ survived Clean Desk)   │              │  → DECISION TREE below      │
└─────────────────────┘              └───────────────────────────┘
```

## 4. Decision Tree — Per-File Restoration

For each `TabRecord` being restored, in original order:

```
                    ┌───────────────────────┐
                    │ Does file exist on      │
                    │ disk at recorded URI?   │
                    └───────────┬─────────────┘
                No              │              Yes
     ┌───────────────────────────┘   └───────────────────────────┐
     ▼                                                            ▼
┌───────────────────────────┐                    ┌───────────────────────────────┐
│ SKIP this record.           │                    │ Is a tab for this URI already  │
│ Log "file no longer exists   │                    │ open (e.g., survived Clean     │
│ on this branch," do not       │                    │ Desk because it was dirty)?    │
│ error, do not prompt.         │                    └───────────────┬─────────────────┘
└───────────────────────────┘                       Yes              │              No
                                          ┌────────────────────────────┘   └────────────────────┐
                                          ▼                                                       ▼
                              ┌───────────────────────────┐                       ┌───────────────────────────┐
                              │ Reuse existing tab.          │                       │ Open file via               │
                              │ Do NOT reload from disk       │                       │ vscode.window.showTextDocument│
                              │ (would discard unsaved        │                       │ at recorded viewColumn        │
                              │ edits). Just re-apply cursor   │                       └───────────────┬─────────────────┘
                              │ position + reveal + pulse.     │                                       │
                              └───────────────────────────┘                                       ▼
                                                                                     ┌───────────────────────────┐
                                                                                     │ Set cursor selection to      │
                                                                                     │ recorded line/character      │
                                                                                     └───────────────┬─────────────────┘
                                                                                                       │
                                                                                                       ▼
                                                                                     ┌───────────────────────────┐
                                                                                     │ editor.revealRange()         │
                                                                                     │ to bring line into view       │
                                                                                     └───────────────┬─────────────────┘
                                                                                                       │
                                                                                                       ▼
                                                                                     ┌───────────────────────────┐
                                                                                     │ 6. PULSE HIGHLIGHT            │
                                                                                     │ Apply decoration to line,     │
                                                                                     │ setTimeout(1500ms) → dispose  │
                                                                                     └───────────────────────────┘
```

## 5. Additional Edge Cases Covered

- **Untracked / new files at save time:** Included in the tab record like any other open file (URI-based, not Git-status-based) — GitRecall tracks *editor state*, not Git tracking status. An untracked file that's later deleted or `.gitignore`d falls under the "file no longer exists" branch if removed from disk.
- **Same file open on both branches:** If a URI is open on both the outgoing and incoming branch's saved state, and it survived Clean Desk as a dirty tab, it is reused in place (see decision tree above) rather than closed and reopened.
- **Rapid consecutive checkouts (e.g., interactive rebase):** Covered by the debounce window in step 2 — only the final settled branch triggers save/restore. Intermediate states are never persisted or restored.
- **First-ever checkout on a branch (no prior record):** Falls into the "No record" path in step 5 — GitRecall does nothing destructive; the editor area simply reflects whatever tabs survived Clean Desk.
- **Extension activated mid-session (branch already checked out before VS Code opened GitRecall):** `lastKnownBranch` is initialized from `repository.state.HEAD.name` at activation time with no save/restore triggered — GitRecall only acts on *transitions*, never on initial state.
