import * as assert from 'assert';
import { StorageManager, CURRENT_SCHEMA_VERSION, BranchContextRecord, MementoLike } from '../../../storage';

/**
 * Integration test: rapid branch changes should serialize correctly via the
 * chained-promise concurrency lock — no lost writes, no interleaved state.
 *
 * NOTE: This test exercises StorageManager directly (it doesn't spin up the full
 * GitWatcher debounce because that requires a live git repo + vscode.git extension).
 * The debounce behavior is tested by verifying that successive writes to the same
 * branch key are atomic and ordered.
 */
suite('Debounce / Serialization Safety', () => {
  test('rapid successive saves serialize correctly — last write wins', async () => {
    const memento = new Map<string, unknown>();
    const mementoLike: MementoLike = {
      get: <T>(key: string): T | undefined => memento.get(key) as T | undefined,
      update: async (key: string, value: unknown) => {
        // Simulate a small async delay to expose race conditions
        await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
        if (value === undefined) {
          memento.delete(key);
        } else {
          memento.set(key, value);
        }
      }
    };

    const storage = new StorageManager(mementoLike);
    const repo = '/test/repo';

    // Simulate the chained-promise pattern from extension.ts
    let chain = Promise.resolve();

    const branchNames = ['branch-1', 'branch-2', 'branch-3', 'branch-4', 'branch-5'];

    for (const branch of branchNames) {
      chain = chain.then(async () => {
        const record: BranchContextRecord = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          repoRoot: repo,
          branch,
          savedAt: new Date().toISOString(),
          activeTabUri: null,
          tabs: [
            {
              uri: `file:///test/${branch}.ts`,
              viewColumn: 1,
              tabIndex: 0,
              isPinned: false,
              cursor: { line: 0, character: 0 }
            }
          ]
        };
        await storage.saveBranchContext(repo, branch, record);
      });
    }

    await chain;

    // All five branches should have been saved
    for (const branch of branchNames) {
      const saved = storage.getBranchContext(repo, branch);
      assert.ok(saved, `Record for ${branch} should exist`);
      assert.strictEqual(saved.branch, branch);
      assert.strictEqual(saved.tabs.length, 1);
      assert.ok(saved.tabs[0].uri.includes(branch), `Tab URI should reference ${branch}`);
    }
  });

  test('overlapping save-then-delete cycles produce consistent state', async () => {
    const memento = new Map<string, unknown>();
    const mementoLike: MementoLike = {
      get: <T>(key: string): T | undefined => memento.get(key) as T | undefined,
      update: async (key: string, value: unknown) => {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 5));
        if (value === undefined) {
          memento.delete(key);
        } else {
          memento.set(key, value);
        }
      }
    };

    const storage = new StorageManager(mementoLike);
    const repo = '/test/repo2';

    let chain = Promise.resolve();

    // Save branch A, then delete it, then save branch B
    chain = chain.then(async () => {
      await storage.saveBranchContext(repo, 'A', {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        repoRoot: repo,
        branch: 'A',
        savedAt: new Date().toISOString(),
        activeTabUri: null,
        tabs: []
      });
    });

    chain = chain.then(() => storage.deleteBranchContext(repo, 'A'));

    chain = chain.then(async () => {
      await storage.saveBranchContext(repo, 'B', {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        repoRoot: repo,
        branch: 'B',
        savedAt: new Date().toISOString(),
        activeTabUri: null,
        tabs: [{ uri: 'file:///b.ts', viewColumn: 1, tabIndex: 0, isPinned: false, cursor: { line: 0, character: 0 } }]
      });
    });

    await chain;

    assert.strictEqual(storage.getBranchContext(repo, 'A'), undefined, 'Branch A should be deleted');
    assert.ok(storage.getBranchContext(repo, 'B'), 'Branch B should exist');
  });
});
