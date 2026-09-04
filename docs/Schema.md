# SCHEMA.md — GitRecall Persistence Schema

## 1. Overview & Purpose

This document defines the complete and exact data structures persisted to `context.workspaceState` by GitRecall. GitRecall is a zero-config VS Code extension that automatically saves and restores editor tabs, split-pane layouts, active tab focus, and cursor positions per Git branch.

All persistence is local to the current workspace machine and scoped per repository root and Git branch.

---

## 2. TypeScript Type Definitions

The following TypeScript interfaces represent the authoritative contract for all data saved to and retrieved from `context.workspaceState`.

```typescript
/**
 * Zero-based line and character cursor position, matching vscode.Position semantics.
 * Represents a collapsed single point (the active cursor caret), not a selection range.
 */
export interface CursorPosition {
  /** Zero-based line number in the text document. */
  line: number;
  /** Zero-based character offset on the line. */
  character: number;
}

/**
 * Persisted state of an individual open editor tab.
 */
export interface TabRecord {
  /**
   * Canonical URI string of the document (vscode.Uri.toString()).
   * Identifies the file across workspace sessions.
   */
  uri: string;

  /**
   * The editor group / split pane where this tab belongs.
   * Corresponds to vscode.ViewColumn numeric values (1 = First, 2 = Second, etc.).
   */
  viewColumn: number;

  /**
   * Zero-based index of this tab within its editor group at save time.
   * Used to restore tabs in their original relative visual order.
   */
  tabIndex: number;

  /**
   * Indicates whether the tab was pinned in the editor group.
   */
  isPinned: boolean;

  /**
   * The cursor position at the time state was captured.
   * If the tab was not actively rendered in a visible editor, defaults to line 0, character 0.
   */
  cursor: CursorPosition;
}

/**
 * The complete snapshot of open editor context for a specific branch.
 * Stored under the key convention: gitrecall.v{schemaVersion}.{repoRootHash}.{branchKeySanitized}
 */
export interface BranchContextRecord {
  /**
   * Schema version used to write this record. Always checked on read.
   */
  schemaVersion: number;

  /**
   * Absolute, normalized filesystem path of the repository root.
   */
  repoRoot: string;

  /**
   * The Git branch name (e.g., "main", "feature/auth") or synthetic detached-HEAD key ("detached__a1b2c3d").
   */
  branch: string;

  /**
   * ISO-8601 UTC timestamp of when this record was captured and saved.
   */
  savedAt: string;

  /**
   * Canonical URI string of the tab that was active/focused when state was saved,
   * or null if no editor was focused.
   */
  activeTabUri: string | null;

  /**
   * Zero-based line and character cursor position in the active tab at save time,
   * or null/undefined if no editor was focused or cursor was unavailable.
   */
  activeCursor?: CursorPosition | null;

  /**
   * Ordered list of open tabs across all editor groups at save time.
   */
  tabs: TabRecord[];
}

/**
 * Top-level in-memory representation mapping sanitized branch keys to their
 * corresponding BranchContextRecord, scoped per repository root.
 */
export interface BranchWorkspaceMap {
  [branchKeySanitized: string]: BranchContextRecord;
}

/**
 * Index record tracking all known sanitized branch keys for a repository.
 * Stored under the key: gitrecall.v{schemaVersion}.{repoRootHash}.__index
 */
export interface BranchIndexRecord {
  schemaVersion: number;
  repoRoot: string;
  knownBranchKeys: string[];
}
```

---

## 3. Storage Key Strategy & Sanitization Rationale

VS Code's `context.workspaceState` is a flat key-value store (`vscode.Memento`). To avoid monolithic blobs, prevent cross-branch write conflicts, and enable clean individual lookups, GitRecall partitions records using deterministic structured keys:

```
gitrecall.v{schemaVersion}.{repoRootHash}.{branchKeySanitized}
```

### Why Branch Names Are Sanitized (`branchKeySanitized`)
- Git branch names frequently contain forward slashes `/` (e.g., `feature/login`, `bugfix/issue-42`, `releases/v1.0.0`).
- Key-value stores and internal persistence layers may treat `/` as a hierarchy delimiter or illegal character.
- GitRecall sanitizes branch names by replacing every `/` with `__`:
  - `feature/auth` &rarr; `feature__auth`
  - `bugfix/hotfix/patch-1` &rarr; `bugfix__hotfix__patch-1`
- Detached HEAD states have no branch name. For these, GitRecall generates a synthetic key prefixed with `detached__` followed by the 7-character commit SHA (e.g., `detached__9f3b2e1`).

### Why Repository Roots Are Hashed (`repoRootHash`)
- Absolute paths vary significantly across platforms (e.g., `C:\Users\dev\repo` on Windows with backslashes and drive letters vs. `/home/dev/repo` on Linux/macOS with forward slashes).
- Paths can contain spaces, punctuation, colons, unicode characters, and can easily exceed safe key-length boundaries.
- To produce predictable, safe, collision-resistant, and short key segments, GitRecall computes a SHA-256 hash of the normalized absolute path and takes the **first 8 hexadecimal characters**:
  - Normalized path: `c:/users/dev/projects/gitrecall`
  - SHA-256 prefix (8 chars): `e3b0c442`
  - Resulting key segment: `e3b0c442`

---

## 4. Schema Versioning & Safe Degradation

1. **Explicit Version Field:** Every `BranchContextRecord` and `BranchIndexRecord` carries `schemaVersion: number` (currently `1`). The key also redundantly embeds `v{schemaVersion}`.
2. **Never Throw on Read:** When reading from `workspaceState`, if a record has a missing, invalid, or mismatched `schemaVersion`:
   - It **MUST NOT** throw an exception.
   - It **MUST NOT** crash the extension or disrupt the user's branch checkout.
   - It **DEGRADES SAFELY**: The record is treated as absent (`undefined`). GitRecall simply leaves the current editor layout as-is (clean desk survivors intact) and logs an informational notice to the `"GitRecall"` OutputChannel.
3. **Additive Changes:** New optional properties may be added to `TabRecord` or `BranchContextRecord` without incrementing `schemaVersion`. Optional fields are typed as `field?: Type` and handled with sensible defaults at read time.
4. **Breaking Changes:** Any breaking change (renamed fields, altered semantics, changed key construction) increments `schemaVersion` to `2`. Old keys (`gitrecall.v1.*`) remain untouched on disk, preventing data loss if a user switches between extension versions.

---

## 5. Worked JSON Example

Below is a fully populated, valid JSON example of a `BranchContextRecord` stored in `context.workspaceState`:

```json
{
  "schemaVersion": 1,
  "repoRoot": "/home/developer/projects/gitrecall",
  "branch": "feature/auth-service",
  "savedAt": "2026-09-03T14:40:00.000Z",
  "activeTabUri": "file:///home/developer/projects/gitrecall/src/auth/service.ts",
  "activeCursor": {
    "line": 142,
    "character": 18
  },
  "tabs": [
    {
      "uri": "file:///home/developer/projects/gitrecall/src/auth/service.ts",
      "viewColumn": 1,
      "tabIndex": 0,
      "isPinned": true,
      "cursor": {
        "line": 142,
        "character": 18
      }
    },
    {
      "uri": "file:///home/developer/projects/gitrecall/src/auth/types.ts",
      "viewColumn": 1,
      "tabIndex": 1,
      "isPinned": false,
      "cursor": {
        "line": 35,
        "character": 4
      }
    },
    {
      "uri": "file:///home/developer/projects/gitrecall/test/auth/service.test.ts",
      "viewColumn": 2,
      "tabIndex": 0,
      "isPinned": false,
      "cursor": {
        "line": 88,
        "character": 12
      }
    }
  ]
}
```
