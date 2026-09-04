import * as assert from 'assert';
import {
  StorageManager,
  StoragePersistError,
  CURRENT_SCHEMA_VERSION,
  BranchContextRecord,
  BranchIndexRecord,
  MementoLike,
  buildBranchKey,
  buildIndexKey,
  sanitizeBranchName,
  hashRepoRoot,
  normalizeRepoRoot,
  isBranchContextRecord,
  isBranchIndexRecord
} from '../../storage';

/**
 * A simple in-memory mock of vscode.Memento for pure unit testing.
 */
class MockMemento implements MementoLike {
  private store = new Map<string, unknown>();

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    const val = this.store.get(key);
    if (val === undefined) {
      return defaultValue;
    }
    return val as T;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.store.delete(key);
    } else {
      this.store.set(key, value);
    }
  }

  keys(): readonly string[] {
    return [...this.store.keys()];
  }

  /** Test helper: inspect raw value */
  _getRaw(key: string): unknown {
    return this.store.get(key);
  }

  /** Test helper: inject raw value */
  _setRaw(key: string, value: unknown): void {
    this.store.set(key, value);
  }
}

/**
 * Creates a valid BranchContextRecord for testing.
 */
function makeRecord(
  repoRoot: string,
  branch: string,
  tabCount = 1
): BranchContextRecord {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    repoRoot,
    branch,
    savedAt: new Date().toISOString(),
    activeTabUri: null,
    tabs: Array.from({ length: tabCount }, (_, i) => ({
      uri: `file:///test/file${i}.ts`,
      viewColumn: 1,
      tabIndex: i,
      isPinned: false,
      cursor: { line: i * 10, character: 0 }
    }))
  };
}

// ──────────────────────────────────────────────
// Key Sanitization Tests
// ──────────────────────────────────────────────

describe('Key sanitization', () => {
  it('sanitizes branch names containing forward slashes and underscores', () => {
    assert.strictEqual(sanitizeBranchName('feature/auth'), 'feature_s_auth');
    assert.strictEqual(sanitizeBranchName('bugfix/hotfix/patch-1'), 'bugfix_s_hotfix_s_patch-1');
    assert.strictEqual(sanitizeBranchName('feature_auth'), 'feature_u_auth');
    assert.strictEqual(sanitizeBranchName('main'), 'main');
  });

  it('normalizes repo roots across platforms', () => {
    const win = normalizeRepoRoot('C:\\Users\\dev\\project\\');
    const unix = normalizeRepoRoot('/home/dev/project/');
    assert.strictEqual(win, 'c:/users/dev/project');
    assert.strictEqual(unix, '/home/dev/project');
  });

  it('produces consistent hashes for equivalent paths', () => {
    const h1 = hashRepoRoot('C:\\Users\\dev\\project');
    const h2 = hashRepoRoot('c:/Users/dev/project/');
    assert.strictEqual(h1, h2);
    assert.strictEqual(h1.length, 8);
  });

  it('builds storage keys in the documented format', () => {
    const key = buildBranchKey('/repo', 'feature/login');
    assert.ok(key.startsWith('gitrecall.v1.'));
    assert.ok(key.endsWith('.branch.feature_s_login'));
  });

  it('builds index keys with meta.__index suffix', () => {
    const key = buildIndexKey('/repo');
    assert.ok(key.endsWith('.meta.__index'));
  });
});

// ──────────────────────────────────────────────
// StorageManager CRUD Tests
// ──────────────────────────────────────────────

describe('StorageManager', () => {
  let memento: MockMemento;
  let storage: StorageManager;
  const repo = '/home/dev/project';

  beforeEach(() => {
    memento = new MockMemento();
    storage = new StorageManager(memento);
  });

  describe('save and get round-trip', () => {
    it('persists and retrieves a valid record', async () => {
      const record = makeRecord(repo, 'main', 2);
      await storage.saveBranchContext(repo, 'main', record);

      const retrieved = storage.getBranchContext(repo, 'main');
      assert.ok(retrieved);
      assert.strictEqual(retrieved.branch, 'main');
      assert.strictEqual(retrieved.tabs.length, 2);
      assert.strictEqual(retrieved.schemaVersion, CURRENT_SCHEMA_VERSION);
    });

    it('returns undefined for a branch with no saved record', () => {
      const result = storage.getBranchContext(repo, 'nonexistent');
      assert.strictEqual(result, undefined);
    });

    it('handles branch names with slashes correctly', async () => {
      const record = makeRecord(repo, 'feature/auth/oauth2', 1);
      await storage.saveBranchContext(repo, 'feature/auth/oauth2', record);

      const retrieved = storage.getBranchContext(repo, 'feature/auth/oauth2');
      assert.ok(retrieved);
      assert.strictEqual(retrieved.branch, 'feature/auth/oauth2');
    });
  });

  describe('schema version mismatch', () => {
    it('returns undefined for a record with a future schema version', () => {
      const key = buildBranchKey(repo, 'main');
      memento._setRaw(key, {
        schemaVersion: 999,
        repoRoot: repo,
        branch: 'main',
        savedAt: new Date().toISOString(),
        activeTabUri: null,
        tabs: []
      });

      const result = storage.getBranchContext(repo, 'main');
      assert.strictEqual(result, undefined);
    });

    it('returns undefined for a record with schema version 0', () => {
      const key = buildBranchKey(repo, 'main');
      memento._setRaw(key, {
        schemaVersion: 0,
        repoRoot: repo,
        branch: 'main',
        savedAt: new Date().toISOString(),
        activeTabUri: null,
        tabs: []
      });

      const result = storage.getBranchContext(repo, 'main');
      assert.strictEqual(result, undefined);
    });
  });

  describe('invalid record shape', () => {
    it('returns undefined for a record missing required fields', () => {
      const key = buildBranchKey(repo, 'main');
      memento._setRaw(key, { schemaVersion: 1, repoRoot: repo });

      const result = storage.getBranchContext(repo, 'main');
      assert.strictEqual(result, undefined);
    });

    it('returns undefined for a non-object value', () => {
      const key = buildBranchKey(repo, 'main');
      memento._setRaw(key, 'not an object');

      const result = storage.getBranchContext(repo, 'main');
      assert.strictEqual(result, undefined);
    });

    it('returns undefined for null stored value', () => {
      const key = buildBranchKey(repo, 'main');
      memento._setRaw(key, null);

      const result = storage.getBranchContext(repo, 'main');
      assert.strictEqual(result, undefined);
    });
  });

  describe('deleteBranchContext', () => {
    it('removes a previously saved record', async () => {
      const record = makeRecord(repo, 'main');
      await storage.saveBranchContext(repo, 'main', record);
      assert.ok(storage.getBranchContext(repo, 'main'));

      await storage.deleteBranchContext(repo, 'main');
      assert.strictEqual(storage.getBranchContext(repo, 'main'), undefined);
    });

    it('removes the branch from the index', async () => {
      const record = makeRecord(repo, 'main');
      await storage.saveBranchContext(repo, 'main', record);

      await storage.deleteBranchContext(repo, 'main');

      const indexKey = buildIndexKey(repo);
      const index = memento._getRaw(indexKey) as BranchIndexRecord | undefined;
      if (index) {
        assert.ok(!index.knownBranchKeys.includes('main'));
      }
    });
  });

  describe('pruneStaleEntries', () => {
    it('removes records for branches not in the valid set', async () => {
      await storage.saveBranchContext(repo, 'main', makeRecord(repo, 'main'));
      await storage.saveBranchContext(repo, 'feature/a', makeRecord(repo, 'feature/a'));
      await storage.saveBranchContext(repo, 'feature/b', makeRecord(repo, 'feature/b'));

      // Prune: only 'main' is still valid
      await storage.pruneStaleEntries(repo, ['main']);

      assert.ok(storage.getBranchContext(repo, 'main'));
      assert.strictEqual(storage.getBranchContext(repo, 'feature/a'), undefined);
      assert.strictEqual(storage.getBranchContext(repo, 'feature/b'), undefined);
    });

    it('updates the index after pruning', async () => {
      await storage.saveBranchContext(repo, 'main', makeRecord(repo, 'main'));
      await storage.saveBranchContext(repo, 'dev', makeRecord(repo, 'dev'));

      await storage.pruneStaleEntries(repo, ['main']);

      const indexKey = buildIndexKey(repo);
      const index = memento._getRaw(indexKey) as BranchIndexRecord;
      assert.ok(index);
      assert.deepStrictEqual(index.knownBranchKeys, ['main']);
    });

    it('is a no-op when all branches are valid', async () => {
      await storage.saveBranchContext(repo, 'main', makeRecord(repo, 'main'));
      await storage.saveBranchContext(repo, 'dev', makeRecord(repo, 'dev'));

      await storage.pruneStaleEntries(repo, ['main', 'dev']);

      assert.ok(storage.getBranchContext(repo, 'main'));
      assert.ok(storage.getBranchContext(repo, 'dev'));
    });

    it('is a no-op when there are no saved entries', async () => {
      // Should not throw
      await storage.pruneStaleEntries(repo, ['main']);
    });
  });

  describe('index maintenance', () => {
    it('tracks saved branches in the index', async () => {
      await storage.saveBranchContext(repo, 'main', makeRecord(repo, 'main'));
      await storage.saveBranchContext(repo, 'feature/x', makeRecord(repo, 'feature/x'));

      const indexKey = buildIndexKey(repo);
      const index = memento._getRaw(indexKey) as BranchIndexRecord;
      assert.ok(isBranchIndexRecord(index));
      assert.ok(index.knownBranchKeys.includes('main'));
      assert.ok(index.knownBranchKeys.includes('feature_s_x'));
    });

    it('does not duplicate branch keys on repeated saves', async () => {
      await storage.saveBranchContext(repo, 'main', makeRecord(repo, 'main'));
      await storage.saveBranchContext(repo, 'main', makeRecord(repo, 'main'));
      await storage.saveBranchContext(repo, 'main', makeRecord(repo, 'main'));

      const indexKey = buildIndexKey(repo);
      const index = memento._getRaw(indexKey) as BranchIndexRecord;
      const mainCount = index.knownBranchKeys.filter(k => k === 'main').length;
      assert.strictEqual(mainCount, 1);
    });
  });

  describe('StoragePersistError on Memento failure', () => {
    it('throws StoragePersistError when Memento.update rejects', async () => {
      const failMemento: MementoLike = {
        get: () => undefined,
        update: () => Promise.reject(new Error('disk full')),
      };
      const failStorage = new StorageManager(failMemento);

      await assert.rejects(
        () => failStorage.saveBranchContext(repo, 'main', makeRecord(repo, 'main')),
        (err: unknown) => {
          assert.ok(err instanceof StoragePersistError);
          return true;
        }
      );
    });
  });
});

// ──────────────────────────────────────────────
// Type Guard Tests
// ──────────────────────────────────────────────

describe('Type guards', () => {
  it('isBranchContextRecord accepts a valid record', () => {
    const record = makeRecord('/repo', 'main', 1);
    assert.ok(isBranchContextRecord(record));
  });

  it('isBranchContextRecord validates activeCursor properly', () => {
    const record = makeRecord('/repo', 'main', 1);

    // Valid activeCursor
    assert.ok(isBranchContextRecord({ ...record, activeCursor: { line: 5, character: 10 } }));
    assert.ok(isBranchContextRecord({ ...record, activeCursor: null }));
    assert.ok(isBranchContextRecord({ ...record, activeCursor: undefined }));

    // Invalid activeCursor
    assert.ok(!isBranchContextRecord({ ...record, activeCursor: { line: -1, character: 0 } }));
    assert.ok(!isBranchContextRecord({ ...record, activeCursor: { line: 1.5, character: 0 } }));
    assert.ok(!isBranchContextRecord({ ...record, activeCursor: { line: '0', character: 0 } }));
    assert.ok(!isBranchContextRecord({ ...record, activeCursor: 'invalid' }));
  });

  it('isBranchContextRecord rejects a record with missing tabs', () => {
    assert.ok(!isBranchContextRecord({ schemaVersion: 1, repoRoot: '/r', branch: 'b', savedAt: 's', activeTabUri: null }));
  });

  it('isBranchContextRecord rejects non-objects', () => {
    assert.ok(!isBranchContextRecord(null));
    assert.ok(!isBranchContextRecord(undefined));
    assert.ok(!isBranchContextRecord(42));
    assert.ok(!isBranchContextRecord('string'));
  });

  it('isBranchIndexRecord accepts a valid index', () => {
    assert.ok(isBranchIndexRecord({ schemaVersion: 1, repoRoot: '/r', knownBranchKeys: ['main'] }));
  });

  it('isBranchIndexRecord rejects invalid shapes', () => {
    assert.ok(!isBranchIndexRecord({ schemaVersion: 1, repoRoot: '/r' }));
    assert.ok(!isBranchIndexRecord(null));
  });
});
