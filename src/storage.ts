import * as crypto from 'crypto';

/**
 * Current schema version for BranchContextRecord and storage key namespacing.
 */
export const CURRENT_SCHEMA_VERSION = 1;

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
  /** Canonical URI string of the document (vscode.Uri.toString()). */
  uri: string;
  /**
   * The editor group / split pane where this tab belongs.
   * Corresponds to vscode.ViewColumn numeric values (1 = First, 2 = Second, etc.).
   */
  viewColumn: number;
  /** Zero-based index of this tab within its editor group at save time. */
  tabIndex: number;
  /** Indicates whether the tab was pinned in the editor group. */
  isPinned: boolean;
  /** The cursor position at the time state was captured. */
  cursor: CursorPosition;
}

/**
 * The complete snapshot of open editor context for a specific branch.
 */
export interface BranchContextRecord {
  /** Schema version used to write this record. */
  schemaVersion: number;
  /** Absolute, normalized filesystem path of the repository root. */
  repoRoot: string;
  /** The Git branch name or synthetic detached-HEAD key. */
  branch: string;
  /** ISO-8601 UTC timestamp of when this record was captured and saved. */
  savedAt: string;
  /** Canonical URI string of the active tab, or null if no editor was focused. */
  activeTabUri: string | null;
  /**
   * The cursor position in the active tab at save time, or null/undefined if no editor was active or cursor not captured.
   */
  activeCursor?: CursorPosition | null;
  /** Ordered list of open tabs across all editor groups at save time. */
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

/**
 * Error thrown when an update operation on Memento fails.
 */
export class StoragePersistError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'StoragePersistError';
    Object.setPrototypeOf(this, StoragePersistError.prototype);
  }
}

/**
 * Minimal structural interface matching vscode.Memento.
 * Enables unit-testing against mock in-memory stores without requiring
 * the live 'vscode' runtime module.
 */
export interface MementoLike {
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
  keys?(): readonly string[];
}

// Type guard helpers (free of `any` types)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isCursorPosition(value: unknown): value is CursorPosition {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.line === 'number' &&
    Number.isInteger(value.line) &&
    value.line >= 0 &&
    typeof value.character === 'number' &&
    Number.isInteger(value.character) &&
    value.character >= 0
  );
}

export function isTabRecord(value: unknown): value is TabRecord {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.uri === 'string' &&
    typeof value.viewColumn === 'number' &&
    typeof value.tabIndex === 'number' &&
    typeof value.isPinned === 'boolean' &&
    isCursorPosition(value.cursor)
  );
}

export function isBranchContextRecord(value: unknown): value is BranchContextRecord {
  if (!isRecord(value)) {
    return false;
  }
  const hasValidActiveCursor =
    value.activeCursor === undefined ||
    value.activeCursor === null ||
    isCursorPosition(value.activeCursor);

  return (
    typeof value.schemaVersion === 'number' &&
    typeof value.repoRoot === 'string' &&
    typeof value.branch === 'string' &&
    typeof value.savedAt === 'string' &&
    (value.activeTabUri === null || typeof value.activeTabUri === 'string') &&
    hasValidActiveCursor &&
    Array.isArray(value.tabs) &&
    value.tabs.every(isTabRecord)
  );
}

export function isBranchIndexRecord(value: unknown): value is BranchIndexRecord {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.schemaVersion === 'number' &&
    typeof value.repoRoot === 'string' &&
    Array.isArray(value.knownBranchKeys) &&
    value.knownBranchKeys.every(k => typeof k === 'string')
  );
}

// Key construction & sanitization helpers

/**
 * Normalizes repository root path across platforms (forward slashes, no trailing slash, lowercased).
 */
export function normalizeRepoRoot(repoRoot: string): string {
  return repoRoot.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Computes an 8-character hex SHA-256 hash prefix from the normalized repo root path.
 */
export function hashRepoRoot(repoRoot: string): string {
  const normalized = normalizeRepoRoot(repoRoot);
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 8);
}

/**
 * Sanitizes Git branch names safely by stripping null/control characters and encoding slashes.
 * Uses an unambiguous escape scheme to prevent cross-branch collisions.
 */
export function sanitizeBranchName(branch: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = branch.replace(/[\x00-\x1F\x7F]/g, '');
  // Escape underscores first, then encode slashes to prevent collision
  // e.g. "a/b" -> "a_s_b", "a__b" -> "a_u__u_b"
  return clean.replace(/_/g, '_u_').replace(/\//g, '_s_');
}

/**
 * Builds the storage key for a specific branch context record.
 */
export function buildBranchKey(
  repoRoot: string,
  branch: string,
  version: number = CURRENT_SCHEMA_VERSION
): string {
  const hash = hashRepoRoot(repoRoot);
  const sanitizedBranch = sanitizeBranchName(branch);
  return `gitrecall.v${version}.${hash}.branch.${sanitizedBranch}`;
}

/**
 * Builds the storage key from an already sanitized branch key.
 */
export function buildBranchKeyFromSanitized(
  repoRoot: string,
  sanitizedBranch: string,
  version: number = CURRENT_SCHEMA_VERSION
): string {
  const hash = hashRepoRoot(repoRoot);
  return `gitrecall.v${version}.${hash}.branch.${sanitizedBranch}`;
}

/**
 * Builds the storage key for the repository's branch index.
 */
export function buildIndexKey(
  repoRoot: string,
  version: number = CURRENT_SCHEMA_VERSION
): string {
  const hash = hashRepoRoot(repoRoot);
  return `gitrecall.v${version}.${hash}.meta.__index`;
}

/**
 * Manages branch context persistence and indexing in workspace storage.
 */
export class StorageManager {
  constructor(private readonly memento: MementoLike) {}

  /**
   * Retrieves the saved BranchContextRecord for a given branch, or undefined if not found or invalid.
   */
  getBranchContext(repoRoot: string, branch: string): BranchContextRecord | undefined {
    const key = buildBranchKey(repoRoot, branch);
    let raw: unknown;

    try {
      raw = this.memento.get<unknown>(key);
    } catch (error) {
      console.warn(`[GitRecall] Error reading branch context for "${branch}" from storage:`, error);
      return undefined;
    }

    if (raw === undefined || raw === null) {
      return undefined;
    }

    if (isRecord(raw) && typeof raw.schemaVersion === 'number') {
      if (raw.schemaVersion !== CURRENT_SCHEMA_VERSION) {
        console.warn(
          `[GitRecall] Schema version mismatch for branch "${branch}". Expected ${CURRENT_SCHEMA_VERSION}, got ${raw.schemaVersion}. Treating as absent.`
        );
        return undefined;
      }
    }

    if (!isBranchContextRecord(raw)) {
      console.warn(`[GitRecall] Invalid record shape retrieved for branch "${branch}". Treating as absent.`);
      return undefined;
    }

    return raw;
  }

  /**
   * Persists a BranchContextRecord and updates the repository's branch index.
   */
  async saveBranchContext(
    repoRoot: string,
    branch: string,
    record: BranchContextRecord
  ): Promise<void> {
    if (!isBranchContextRecord(record)) {
      throw new StoragePersistError(`Cannot save invalid BranchContextRecord for branch "${branch}"`);
    }

    const key = buildBranchKey(repoRoot, branch);

    try {
      await this.memento.update(key, record);
    } catch (error) {
      console.warn(`[GitRecall] Failed to persist branch context for "${branch}":`, error);
      throw new StoragePersistError(`Failed to persist branch context for "${branch}"`, error);
    }

    // Maintain index for prune operations
    try {
      const sanitizedBranch = sanitizeBranchName(branch);
      const indexKey = buildIndexKey(repoRoot);
      const currentIndex = this.getIndexRecord(repoRoot);

      if (!currentIndex.knownBranchKeys.includes(sanitizedBranch)) {
        const updatedIndex: BranchIndexRecord = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          repoRoot,
          knownBranchKeys: [...currentIndex.knownBranchKeys, sanitizedBranch]
        };
        await this.memento.update(indexKey, updatedIndex);
      }
    } catch (error) {
      console.warn(`[GitRecall] Failed to update branch index for repo "${repoRoot}":`, error);
      throw new StoragePersistError(`Failed to update branch index for repo "${repoRoot}"`, error);
    }
  }

  /**
   * Deletes a BranchContextRecord and removes its key from the repository index.
   */
  async deleteBranchContext(repoRoot: string, branch: string): Promise<void> {
    const key = buildBranchKey(repoRoot, branch);

    try {
      await this.memento.update(key, undefined);
    } catch (error) {
      console.warn(`[GitRecall] Failed to delete branch context for "${branch}":`, error);
      throw new StoragePersistError(`Failed to delete branch context for "${branch}"`, error);
    }

    try {
      const sanitizedBranch = sanitizeBranchName(branch);
      const indexKey = buildIndexKey(repoRoot);
      const currentIndex = this.getIndexRecord(repoRoot);

      if (currentIndex.knownBranchKeys.includes(sanitizedBranch)) {
        const updatedIndex: BranchIndexRecord = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          repoRoot,
          knownBranchKeys: currentIndex.knownBranchKeys.filter(k => k !== sanitizedBranch)
        };
        await this.memento.update(indexKey, updatedIndex);
      }
    } catch (error) {
      console.warn(`[GitRecall] Failed to update branch index during deletion for repo "${repoRoot}":`, error);
      throw new StoragePersistError(`Failed to update branch index during deletion`, error);
    }
  }

  /**
   * Prunes saved records for any branches that no longer exist in the repository.
   */
  async pruneStaleEntries(repoRoot: string, currentValidBranches: string[]): Promise<void> {
    const currentIndex = this.getIndexRecord(repoRoot);
    const validSanitizedKeys = new Set(currentValidBranches.map(b => sanitizeBranchName(b)));

    const staleKeys = currentIndex.knownBranchKeys.filter(k => !validSanitizedKeys.has(k));
    if (staleKeys.length === 0) {
      return;
    }

    for (const staleKey of staleKeys) {
      const key = buildBranchKeyFromSanitized(repoRoot, staleKey);
      try {
        await this.memento.update(key, undefined);
      } catch (error) {
        console.warn(`[GitRecall] Failed to prune stale branch record "${staleKey}":`, error);
        throw new StoragePersistError(`Failed to prune stale branch record "${staleKey}"`, error);
      }
    }

    const remainingKeys = currentIndex.knownBranchKeys.filter(k => validSanitizedKeys.has(k));
    const updatedIndex: BranchIndexRecord = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      repoRoot,
      knownBranchKeys: remainingKeys
    };

    try {
      await this.memento.update(buildIndexKey(repoRoot), updatedIndex);
    } catch (error) {
      console.warn(`[GitRecall] Failed to update branch index after pruning for repo "${repoRoot}":`, error);
      throw new StoragePersistError(`Failed to update branch index after pruning`, error);
    }
  }

  /**
   * Helper to retrieve or initialize the BranchIndexRecord for a repository.
   */
  private getIndexRecord(repoRoot: string): BranchIndexRecord {
    const indexKey = buildIndexKey(repoRoot);
    try {
      const raw = this.memento.get<unknown>(indexKey);
      if (isBranchIndexRecord(raw) && raw.schemaVersion === CURRENT_SCHEMA_VERSION) {
        return raw;
      }
    } catch (error) {
      console.warn(`[GitRecall] Failed to read branch index for repo "${repoRoot}":`, error);
    }

    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      repoRoot,
      knownBranchKeys: []
    };
  }
}
