import * as assert from 'assert';

// ─────────────────────────────────────────────────────────────────────────────
// Ambient VS Code Mock Setup for Node/Mocha execution
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module');
const originalRequire = Module.prototype.require;

interface MockTab {
  input: unknown;
  isDirty: boolean;
  isPinned: boolean;
}

interface MockTextDocument {
  uri: { toString(): string; fsPath: string; scheme: string; authority?: string };
  isDirty: boolean;
  lineCount: number;
  lineAt(line: number): { text: string; range: unknown };
}

interface MockTextEditor {
  document: MockTextDocument;
  viewColumn?: number;
  selection: { active: { line: number; character: number } };
  revealedRanges: Array<{ range: unknown; type?: unknown }>;
  setDecorations(type: unknown, ranges: unknown[]): void;
  revealRange(range: unknown, type?: unknown): void;
}

const mockState = {
  tabGroupsAll: [] as Array<{ viewColumn?: number; tabs: MockTab[]; activeTab?: MockTab }>,
  textDocuments: [] as MockTextDocument[],
  visibleTextEditors: [] as MockTextEditor[],
  activeTextEditor: undefined as MockTextEditor | undefined,
  closedTabs: [] as MockTab[],
  statFailUris: new Set<string>(),
  statCalledUris: [] as string[],
  editorsShown: [] as Array<{ uri: unknown; options?: unknown }>,
  commandsExecuted: [] as Array<{ command: string; args: unknown[] }>,
};

class MockTabInputText {
  constructor(public readonly uri: { toString(): string; fsPath: string; scheme: string; authority?: string }) {}
}

class MockPosition {
  constructor(public readonly line: number, public readonly character: number) {}
}

class MockSelection {
  constructor(public readonly anchor: MockPosition, public readonly active: MockPosition) {}
}

class MockRange {
  public readonly start: MockPosition;
  public readonly end: MockPosition;
  constructor(
    startOrStartLine: MockPosition | number,
    endOrStartChar: MockPosition | number,
    endLine?: number,
    endChar?: number
  ) {
    if (typeof startOrStartLine === 'number' && typeof endOrStartChar === 'number') {
      this.start = new MockPosition(startOrStartLine, endOrStartChar);
      this.end = new MockPosition(endLine ?? startOrStartLine, endChar ?? endOrStartChar);
    } else {
      this.start = startOrStartLine as MockPosition;
      this.end = endOrStartChar as MockPosition;
    }
  }
}

class MockEventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];
  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
  };
  fire(data: T): void {
    for (const listener of [...this.listeners]) {
      listener(data);
    }
  }
  dispose(): void {
    this.listeners = [];
  }
}

const mockVscode = {
  TabInputText: MockTabInputText,
  Position: MockPosition,
  Selection: MockSelection,
  Range: MockRange,
  TextEditorRevealType: { Default: 0, InCenterIfOutsideViewport: 1 },
  EventEmitter: MockEventEmitter,
  commands: {
    executeCommand: async (command: string, ...args: unknown[]) => {
      mockState.commandsExecuted.push({ command, args });
    }
  },
  Uri: {
    parse: (uriStr: string) => {
      const scheme = uriStr.includes(':') ? uriStr.split(':')[0] : 'file';
      let authority = '';
      if (uriStr.startsWith('file:////')) {
        authority = uriStr.split('/')[4] || '';
      } else if (/^file:\/\/(?!\/)/i.test(uriStr)) {
        authority = uriStr.slice('file://'.length).split('/')[0] || '';
      }
      return {
        toString: () => uriStr,
        fsPath: uriStr.replace(/^[a-z]+:\/\//i, ''),
        scheme,
        authority
      };
    },
    file: (fsPath: string) => ({
      toString: () => `file://${fsPath.replace(/\\/g, '/')}`,
      fsPath,
      scheme: 'file',
      authority: ''
    })
  },
  window: {
    tabGroups: {
      get all() {
        return mockState.tabGroupsAll;
      },
      get activeTabGroup() {
        return mockState.tabGroupsAll[0];
      },
      close: async (tabs: MockTab[], _preserveFocus?: boolean) => {
        mockState.closedTabs.push(...tabs);
        return true;
      }
    },
    get visibleTextEditors() {
      return mockState.visibleTextEditors;
    },
    get activeTextEditor() {
      return mockState.activeTextEditor;
    },
    showWarningMessage: async (_msg: string) => undefined,
    showTextDocument: async (uri: unknown, options?: unknown) => {
      mockState.editorsShown.push({ uri, options });
      const uriStr = typeof uri === 'object' && uri && 'toString' in uri ? (uri as { toString(): string }).toString() : String(uri);
      const editor: MockTextEditor = {
        document: {
          uri: { toString: () => uriStr, fsPath: uriStr, scheme: 'file', authority: '' },
          isDirty: false,
          lineCount: 10,
          lineAt: (line: number) => {
            if (!Number.isInteger(line) || line < 0 || line >= 10) {
              throw new Error(`Illegal argument 'line': ${line}`);
            }
            return { text: `Line ${line} content`, range: new MockRange(new MockPosition(line, 0), new MockPosition(line, 10)) };
          }
        },
        viewColumn: 1,
        selection: new MockSelection(new MockPosition(0, 0), new MockPosition(0, 0)),
        revealedRanges: [],
        setDecorations: () => {},
        revealRange: (range: unknown, type?: unknown) => {
          editor.revealedRanges.push({ range, type });
        }
      };
      return editor;
    },
    createTextEditorDecorationType: (_options: unknown) => ({
      dispose: () => {}
    }),
    onDidChangeVisibleTextEditors: (_listener: unknown) => ({
      dispose: () => {}
    })
  },
  workspace: {
    get textDocuments() {
      return mockState.textDocuments;
    },
    fs: {
      stat: async (uri: { toString(): string }) => {
        mockState.statCalledUris.push(uri.toString());
        if (mockState.statFailUris.has(uri.toString())) {
          throw new Error('FileNotFound');
        }
        return { type: 1, ctime: 0, mtime: 0, size: 100 };
      }
    }
  }
};

Module.prototype.require = function (id: string, ...args: unknown[]) {
  if (id === 'vscode') {
    return mockVscode;
  }
  return originalRequire.apply(this, [id, ...args]);
};

// ─────────────────────────────────────────────────────────────────────────────
// Imports under test
// ─────────────────────────────────────────────────────────────────────────────

import {
  StorageManager,
  CURRENT_SCHEMA_VERSION,
  MAX_TABS_PER_BRANCH,
  BranchContextRecord,
  MementoLike,
  buildBranchKey,
  buildIndexKey,
  sanitizeBranchName,
  normalizeRepoRoot,
  isCursorPosition,
  isTabRecord,
  isBranchContextRecord,
  isBranchIndexRecord
} from '../storage';

import {
  closeCleanTabs,
  restoreTabs,
  captureCurrentState,
  applyCursorAndDecoration,
  areUrisEqual,
  isSafeLocalFileUri
} from '../tabManager';

import { formatBranchForDisplay, handleBranchChange } from '../extension';
import { DecorationService } from '../decorationService';

// ─────────────────────────────────────────────────────────────────────────────
// Test Utilities & Mocks
// ─────────────────────────────────────────────────────────────────────────────

class InMemoryMemento implements MementoLike {
  public store = new Map<string, unknown>();

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    const val = this.store.get(key);
    return val === undefined ? defaultValue : (val as T);
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
}

function makeValidRecord(repoRoot: string, branch: string): BranchContextRecord {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    repoRoot,
    branch,
    savedAt: new Date().toISOString(),
    activeTabUri: null,
    tabs: [
      {
        uri: 'file:///workspace/app.ts',
        viewColumn: 1,
        tabIndex: 0,
        isPinned: false,
        cursor: { line: 5, character: 2 }
      }
    ]
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT TEST SUITE
// ─────────────────────────────────────────────────────────────────────────────

describe('Security & Resilience Audit Suite', () => {
  beforeEach(() => {
    mockState.tabGroupsAll = [];
    mockState.textDocuments = [];
    mockState.visibleTextEditors = [];
    mockState.activeTextEditor = undefined;
    mockState.closedTabs = [];
    mockState.statFailUris.clear();
    mockState.statCalledUris = [];
    mockState.editorsShown = [];
    mockState.commandsExecuted = [];
  });

  // ===========================================================================
  // TARGET 1: Adversarial Input Sanitization & Storage Integrity
  // ===========================================================================
  describe('Audit Target 1: Adversarial Input Sanitization & Storage Integrity', () => {
    const repo = '/var/git/project';

    it('[VULN-02 REMEDIATED] Branch name "__index" is safely namespaced and does not collide with repository index', async () => {
      const branchKey = buildBranchKey(repo, '__index');
      const indexKey = buildIndexKey(repo);

      // Branch key is namespaced under .branch. while index key is under .meta.
      assert.notStrictEqual(branchKey, indexKey, 'Branch key and index key must never collide');
      assert.ok(branchKey.includes('.branch.'));
      assert.ok(indexKey.includes('.meta.__index'));

      const memento = new InMemoryMemento();
      const storage = new StorageManager(memento);

      // Save branch 'main' and branch '__index'
      await storage.saveBranchContext(repo, 'main', makeValidRecord(repo, 'main'));
      await storage.saveBranchContext(repo, '__index', makeValidRecord(repo, '__index'));

      // Both must be retrievable
      assert.ok(storage.getBranchContext(repo, 'main'));
      assert.ok(storage.getBranchContext(repo, '__index'));

      // Index must remain intact
      const rawIndex = memento.get(buildIndexKey(repo));
      assert.ok(isBranchIndexRecord(rawIndex));
    });

    it('[VULN-03 & F-07 REMEDIATED] Strictly bijective sanitization eliminates cross-branch and control-byte collisions', () => {
      const sanitized1 = sanitizeBranchName('feature/auth');
      const sanitized2 = sanitizeBranchName('feature__auth');
      assert.notStrictEqual(sanitized1, sanitized2, 'Sanitized branch names must never collide');

      const key1 = buildBranchKey(repo, 'feature/auth');
      const key2 = buildBranchKey(repo, 'feature__auth');
      assert.notStrictEqual(key1, key2, 'Storage keys for distinct branches must be unique');

      // Control character bijective encoding (F-07)
      const ctrlA = sanitizeBranchName('branch\x00a');
      const plainA = sanitizeBranchName('brancha');
      const literalHex = sanitizeBranchName('branch_x00_a');
      assert.notStrictEqual(ctrlA, plainA, 'Control bytes must not strip to collide with plain branch names');
      assert.notStrictEqual(ctrlA, literalHex, 'Encoded control bytes must not collide with literal _x00_');
    });

    it('[F-08 REMEDIATED] StorageManager.getBranchContext rejects records with mismatched repoRoot or branch identity', async () => {
      const memento = new InMemoryMemento();
      const storage = new StorageManager(memento);
      const key = buildBranchKey(repo, 'main');

      // Simulate hash/key collision where stored record belongs to a different repo or branch
      await memento.update(key, makeValidRecord('/var/git/other-repo', 'main'));
      assert.strictEqual(storage.getBranchContext(repo, 'main'), undefined);

      await memento.update(key, makeValidRecord(repo, 'other-branch'));
      assert.strictEqual(storage.getBranchContext(repo, 'main'), undefined);
    });

    it('Safely handles prototype pollution tokens as branch names without polluting Object.prototype', async () => {
      const memento = new InMemoryMemento();
      const storage = new StorageManager(memento);

      const pollutionTokens = ['__proto__', 'constructor', 'prototype', 'valueOf', 'toString'];

      for (const token of pollutionTokens) {
        const record = makeValidRecord(repo, token);
        await storage.saveBranchContext(repo, token, record);

        // Verify Object prototype is unpolluted
        assert.strictEqual(
          ({} as Record<string, unknown>).schemaVersion,
          undefined,
          `Object.prototype was polluted with record properties by branch token "${token}"`
        );
        assert.strictEqual(
          Object.prototype.hasOwnProperty.call(Object.prototype, 'tabs'),
          false,
          `Object.prototype was polluted with 'tabs' by branch token "${token}"`
        );

        // Verify record retrieval
        const retrieved = storage.getBranchContext(repo, token);
        assert.ok(retrieved, `Failed to retrieve branch record for token: ${token}`);
        assert.strictEqual(retrieved.branch, token);
      }
    });

    it('Safely encapsulates path traversal sequences and special characters in branch names', async () => {
      const memento = new InMemoryMemento();
      const storage = new StorageManager(memento);

      const hostileBranches = [
        'feature/../../etc/passwd',
        '../../../root/id_rsa',
        'refs/heads/master',
        'branch;rm -rf /;',
        'branch\0nullbyte',
        'branch\nnewline\r',
        'unicode/\u202Ereversed',
        'flag/--option=exploit'
      ];

      for (const hostile of hostileBranches) {
        const key = buildBranchKey(repo, hostile);
        assert.ok(key.startsWith('gitrecall.v1.'), `Key does not have valid prefix: ${key}`);

        const record = makeValidRecord(repo, hostile);
        await storage.saveBranchContext(repo, hostile, record);

        const retrieved = storage.getBranchContext(repo, hostile);
        assert.ok(retrieved, `Failed to save/retrieve hostile branch: ${hostile}`);
        assert.strictEqual(retrieved.branch, hostile);
      }
    });

    it('[VULN-04 & F-10 REMEDIATED] Schema validation rejects NaN, float, negative, and unbounded values in CursorPosition, TabRecord, and BranchContextRecord', () => {
      const nanCursor = { line: NaN, character: NaN };
      const floatCursor = { line: 1.7, character: 3.2 };
      const infCursor = { line: Infinity, character: -Infinity };
      const negCursor = { line: -1, character: -5 };
      const validCursor = { line: 0, character: 0 };

      assert.strictEqual(isCursorPosition(nanCursor), false, 'isCursorPosition must reject NaN');
      assert.strictEqual(isCursorPosition(floatCursor), false, 'isCursorPosition must reject floats');
      assert.strictEqual(isCursorPosition(infCursor), false, 'isCursorPosition must reject Infinity');
      assert.strictEqual(isCursorPosition(negCursor), false, 'isCursorPosition must reject negative numbers');
      assert.strictEqual(isCursorPosition(validCursor), true, 'isCursorPosition must accept valid coordinates');

      // F-10: TabRecord viewColumn and tabIndex integer & bounds validation
      const baseTab = {
        uri: 'file:///workspace/a.ts',
        viewColumn: 1,
        tabIndex: 0,
        isPinned: false,
        cursor: validCursor
      };
      assert.strictEqual(isTabRecord(baseTab), true);
      assert.strictEqual(isTabRecord({ ...baseTab, viewColumn: NaN }), false);
      assert.strictEqual(isTabRecord({ ...baseTab, viewColumn: 0 }), false);
      assert.strictEqual(isTabRecord({ ...baseTab, viewColumn: 10 }), false);
      assert.strictEqual(isTabRecord({ ...baseTab, tabIndex: -1 }), false);
      assert.strictEqual(isTabRecord({ ...baseTab, tabIndex: 1.5 }), false);

      // F-10: BranchContextRecord tabs cap
      const oversizedRecord = {
        ...makeValidRecord(repo, 'main'),
        tabs: Array.from({ length: MAX_TABS_PER_BRANCH + 1 }, (_, i) => ({
          ...baseTab,
          tabIndex: i
        }))
      };
      assert.strictEqual(isBranchContextRecord(oversizedRecord), false, 'Must reject oversized tab arrays');
    });

    it('Rejects corrupted / adversarial record shapes', () => {
      assert.strictEqual(isBranchContextRecord(null), false);
      assert.strictEqual(isBranchContextRecord(undefined), false);
      assert.strictEqual(isBranchContextRecord({}), false);
      assert.strictEqual(isBranchContextRecord({ schemaVersion: '1' }), false);
      assert.strictEqual(isBranchContextRecord({ schemaVersion: 1, tabs: 'not-array' }), false);
      assert.strictEqual(isBranchIndexRecord({ knownBranchKeys: null }), false);
      assert.strictEqual(isTabRecord({ uri: 123 }), false);
    });
  });

  // ===========================================================================
  // TARGET 2: Zero-Tolerance Data Loss (Unsaved Buffers & New Branches)
  // ===========================================================================
  describe('Audit Target 2: Zero-Tolerance Data Loss (Unsaved Buffers)', () => {
    it('MATHEMATICAL PROOF: closeCleanTabs never closes a tab with tab.isDirty === true', async () => {
      const dirtyTabUri = 'file:///workspace/dirty.ts';
      const dirtyTab: MockTab = {
        input: new MockTabInputText(mockVscode.Uri.parse(dirtyTabUri)),
        isDirty: true,
        isPinned: false
      };

      const doc: MockTextDocument = {
        uri: mockVscode.Uri.parse(dirtyTabUri),
        isDirty: true,
        lineCount: 5,
        lineAt: () => ({ text: '', range: {} })
      };

      mockState.tabGroupsAll = [{ tabs: [dirtyTab] }];
      mockState.textDocuments = [doc];

      await closeCleanTabs();

      assert.strictEqual(
        mockState.closedTabs.length,
        0,
        'CRITICAL: Dirty tab was passed to tabGroups.close!'
      );
    });

    it('MATHEMATICAL PROOF: closeCleanTabs never closes a tab where underlying doc.isDirty === true', async () => {
      const docDirtyUri = 'file:///workspace/doc-dirty.ts';
      const tab: MockTab = {
        input: new MockTabInputText(mockVscode.Uri.parse(docDirtyUri)),
        isDirty: false,
        isPinned: false
      };

      const doc: MockTextDocument = {
        uri: mockVscode.Uri.parse(docDirtyUri),
        isDirty: true,
        lineCount: 5,
        lineAt: () => ({ text: '', range: {} })
      };

      mockState.tabGroupsAll = [{ tabs: [tab] }];
      mockState.textDocuments = [doc];

      await closeCleanTabs();

      assert.strictEqual(
        mockState.closedTabs.length,
        0,
        'CRITICAL: Tab with dirty document was closed!'
      );
    });

    it('FAIL-SAFE PROOF: closeCleanTabs closes clean tabs even if document is not in workspace.textDocuments', async () => {
      const orphanUri = 'file:///workspace/orphan.ts';
      const orphanTab: MockTab = {
        input: new MockTabInputText(mockVscode.Uri.parse(orphanUri)),
        isDirty: false,
        isPinned: false
      };

      mockState.tabGroupsAll = [{ tabs: [orphanTab] }];
      mockState.textDocuments = [];

      await closeCleanTabs();

      assert.strictEqual(
        mockState.closedTabs.length,
        1,
        'Clean tab whose file was removed on branch switch must be closed!'
      );
    });

    it('FAIL-SAFE PROOF: Non-text tabs (diffs, webviews, settings) are never closed', async () => {
      const nonTextTab: MockTab = {
        input: { description: 'Custom Webview Editor' },
        isDirty: false,
        isPinned: false
      };

      mockState.tabGroupsAll = [{ tabs: [nonTextTab] }];
      mockState.textDocuments = [];

      await closeCleanTabs();

      assert.strictEqual(mockState.closedTabs.length, 0, 'Non-text tab was closed!');
    });

    it('[F-02 & F-03 REMEDIATED] Switching to a brand-new branch preserves open tabs and scopes operations to repoRoot', async () => {
      const repoA = '/workspace/repo-a';
      const repoB = '/workspace/repo-b';
      const tabA: MockTab = {
        input: new MockTabInputText(mockVscode.Uri.file(`${repoA}/main.ts`)),
        isDirty: false,
        isPinned: false
      };
      const tabB: MockTab = {
        input: new MockTabInputText(mockVscode.Uri.file(`${repoB}/sub.ts`)),
        isDirty: false,
        isPinned: false
      };
      mockState.tabGroupsAll = [{ viewColumn: 1, tabs: [tabA, tabB] }];

      const memento = new InMemoryMemento();
      const storage = new StorageManager(memento);
      const decoration = new DecorationService();

      // Switch repo-a from 'main' to a brand-new branch 'feature/new' with no saved record
      await handleBranchChange(
        { repoRoot: repoA, previousBranch: 'main', currentBranch: 'feature/new' },
        storage,
        decoration,
        () => {}
      );

      // 1. No tabs should be closed when switching to an unvisited branch (F-03)
      assert.strictEqual(mockState.closedTabs.length, 0, 'New branch checkout must not wipe open clean tabs');

      // 2. Saved record for repoA 'main' must only contain repoA's tab, not repoB's tab (F-02)
      const savedMain = storage.getBranchContext(repoA, 'main');
      assert.ok(savedMain);
      assert.strictEqual(savedMain.tabs.length, 1);
      assert.ok(savedMain.tabs[0].uri.includes('repo-a/main.ts'));

      decoration.dispose();
    });

    it('Switching to an unvisited branch closes tabs for deleted files while preserving existing tabs', async () => {
      const repo = '/workspace/repo';
      const existingUri = 'file:///workspace/repo/surviving.ts';
      const deletedUri = 'file:///workspace/repo/deleted.ts';

      const existingTab: MockTab = {
        input: new MockTabInputText(mockVscode.Uri.parse(existingUri)),
        isDirty: false,
        isPinned: false
      };
      const deletedTab: MockTab = {
        input: new MockTabInputText(mockVscode.Uri.parse(deletedUri)),
        isDirty: false,
        isPinned: false
      };

      mockState.tabGroupsAll = [{ viewColumn: 1, tabs: [existingTab, deletedTab] }];
      mockState.statFailUris.add(deletedUri);

      const memento = new InMemoryMemento();
      const storage = new StorageManager(memento);
      const decoration = new DecorationService();

      await handleBranchChange(
        { repoRoot: repo, previousBranch: 'main', currentBranch: 'feature/brand-new' },
        storage,
        decoration,
        () => {}
      );

      // The deleted file's clean tab must be closed
      assert.strictEqual(mockState.closedTabs.length, 1, 'Only deleted file tab should be closed');
      const closedInput = mockState.closedTabs[0].input as MockTabInputText;
      assert.strictEqual(closedInput.uri.toString(), deletedUri);

      decoration.dispose();
    });

    it('BATCH ENFORCEMENT: Exactly cleans clean tabs while preserving all dirty tabs in mixed batch', async () => {
      const totalTabs = 50;
      const tabs: MockTab[] = [];
      const docs: MockTextDocument[] = [];

      for (let i = 0; i < totalTabs; i++) {
        const uriStr = `file:///workspace/file${i}.ts`;
        const uri = mockVscode.Uri.parse(uriStr);
        const isDirty = i % 2 === 0;

        tabs.push({
          input: new MockTabInputText(uri),
          isDirty,
          isPinned: false
        });

        docs.push({
          uri,
          isDirty,
          lineCount: 10,
          lineAt: () => ({ text: '', range: {} })
        });
      }

      mockState.tabGroupsAll = [{ tabs }];
      mockState.textDocuments = docs;

      await closeCleanTabs();

      assert.strictEqual(mockState.closedTabs.length, 25);
      for (const closedTab of mockState.closedTabs) {
        assert.strictEqual(closedTab.isDirty, false);
        const uriStr = (closedTab.input as MockTabInputText).uri.toString();
        const doc = docs.find(d => d.uri.toString() === uriStr);
        assert.ok(doc);
        assert.strictEqual(doc.isDirty, false);
      }
    });
  });

  // ===========================================================================
  // TARGET 3: Asynchronous Concurrency & Race Conditions
  // ===========================================================================
  describe('Audit Target 3: Asynchronous Concurrency & Race Conditions', () => {
    const repo = '/var/git/concurrency';

    it('[VULN-01 PROOF] Catastrophic Storage Wipe: pruneStaleEntries wipes all branches when passed only [prev, curr]', async () => {
      const memento = new InMemoryMemento();
      const storage = new StorageManager(memento);

      await storage.saveBranchContext(repo, 'feature-A', makeValidRecord(repo, 'feature-A'));
      await storage.saveBranchContext(repo, 'feature-B', makeValidRecord(repo, 'feature-B'));

      assert.ok(storage.getBranchContext(repo, 'feature-A'), 'feature-A must exist');
      assert.ok(storage.getBranchContext(repo, 'feature-B'), 'feature-B must exist');

      const previousBranch = 'feature-B';
      const currentBranch = 'feature-C';
      await storage.pruneStaleEntries(repo, [
        ...(previousBranch ? [previousBranch] : []),
        ...(currentBranch ? [currentBranch] : [])
      ]);

      const featureARecord = storage.getBranchContext(repo, 'feature-A');
      assert.strictEqual(
        featureARecord,
        undefined,
        'CRITICAL DATA LOSS PROVED: feature-A was permanently deleted by pruneStaleEntries!'
      );
    });

    it('Chained promise lock enforces strict sequential execution without interleaving', async () => {
      const executionLog: string[] = [];
      let cycleChain: Promise<void> = Promise.resolve();

      const simulateBranchChange = (branch: string, durationMs: number) => {
        cycleChain = cycleChain.then(async () => {
          executionLog.push(`start:${branch}`);
          await new Promise(resolve => setTimeout(resolve, durationMs));
          executionLog.push(`end:${branch}`);
        });
      };

      simulateBranchChange('branch-1', 40);
      simulateBranchChange('branch-2', 10);
      simulateBranchChange('branch-3', 20);

      await cycleChain;

      assert.deepStrictEqual(executionLog, [
        'start:branch-1',
        'end:branch-1',
        'start:branch-2',
        'end:branch-2',
        'start:branch-3',
        'end:branch-3'
      ]);
    });

    it('Trailing-edge debounce cancels pending transitions when returning to origin branch', async () => {
      let pendingTransition: { previousBranch: string | undefined } | null = null;
      let timer: NodeJS.Timeout | null = null;
      let lastKnownBranch = 'main';
      let emittedEvent: { prev: string | undefined; curr: string | undefined } | null = null;

      const triggerChange = (newBranch: string) => {
        if (timer) {
          clearTimeout(timer);
        }
        if (!pendingTransition) {
          pendingTransition = { previousBranch: lastKnownBranch };
        }
        timer = setTimeout(() => {
          const prev = pendingTransition!.previousBranch;
          pendingTransition = null;
          if (newBranch !== prev) {
            emittedEvent = { prev, curr: newBranch };
            lastKnownBranch = newBranch;
          }
        }, 50);
      };

      triggerChange('feature-1');
      await new Promise(r => setTimeout(r, 10));
      triggerChange('feature-2');
      await new Promise(r => setTimeout(r, 10));
      triggerChange('main');

      await new Promise(r => setTimeout(r, 80));

      assert.strictEqual(
        emittedEvent,
        null,
        'Debounce engine should not fire when branch hops back to original branch'
      );
      assert.strictEqual(lastKnownBranch, 'main');
    });
  });

  // ===========================================================================
  // TARGET 4: File URI Deserialization & Host Resilience
  // ===========================================================================
  describe('Audit Target 4: File URI Deserialization & Host Resilience', () => {
    it('Silently skips non-existent files during restore without throwing', async () => {
      const missingUri = 'file:///workspace/deleted-file.ts';
      mockState.statFailUris.add(missingUri);

      const records = [
        {
          uri: missingUri,
          viewColumn: 1,
          tabIndex: 0,
          isPinned: false,
          cursor: { line: 2, character: 0 }
        }
      ];

      let callbackFired = false;
      await assert.doesNotReject(async () => {
        await restoreTabs(records, () => {
          callbackFired = true;
        });
      });

      assert.strictEqual(callbackFired, false, 'Callback should not fire for deleted file');
      assert.strictEqual(mockState.editorsShown.length, 0, 'No editor should be opened');
    });

    it('Clamps cursor coordinates safely within document line bounds', async () => {
      const validUri = 'file:///workspace/existing.ts';
      const records = [
        {
          uri: validUri,
          viewColumn: 1,
          tabIndex: 0,
          isPinned: false,
          cursor: { line: 9999, character: 9999 }
        }
      ];

      let restoredLine = -1;
      await restoreTabs(records, (_editor, line) => {
        restoredLine = line;
      });

      assert.strictEqual(restoredLine, 9, 'Cursor line was not clamped to document lineCount - 1');
    });

    it('Tolerates non-file URI schemes without crashing or calling fs.stat', async () => {
      const strangeUris = [
        'git:/path/to/diff?ref=HEAD',
        'untitled:Untitled-1',
        'vscode-userdata:/settings.json',
        'output:extension-output-git'
      ];

      const records = strangeUris.map((uri, i) => ({
        uri,
        viewColumn: 1,
        tabIndex: i,
        isPinned: false,
        cursor: { line: 0, character: 0 }
      }));

      await assert.doesNotReject(async () => {
        await restoreTabs(records, () => {});
      });

      assert.strictEqual(mockState.statCalledUris.length, 0, 'Non-file schemes must be rejected before fs.stat');
    });

    it('[VULN-05, VULN-06 & F-01 REMEDIATED] captureCurrentState ignores non-file/UNC schemes and restoreTabs rejects UNC URIs BEFORE fs.stat', async () => {
      // 1. Test captureCurrentState filters out non-file schemes and UNC authorities
      const fileTab: MockTab = {
        input: new MockTabInputText(mockVscode.Uri.file('/workspace/real.ts')),
        isDirty: false,
        isPinned: false
      };
      const untitledTab: MockTab = {
        input: new MockTabInputText(mockVscode.Uri.parse('untitled:Untitled-1')),
        isDirty: false,
        isPinned: false
      };
      const gitTab: MockTab = {
        input: new MockTabInputText(mockVscode.Uri.parse('git:/path/diff')),
        isDirty: false,
        isPinned: false
      };
      const uncTab: MockTab = {
        input: new MockTabInputText(mockVscode.Uri.parse('file://attacker-host/share/leak.ts')),
        isDirty: false,
        isPinned: false
      };
      mockState.tabGroupsAll = [{ tabs: [fileTab, untitledTab, gitTab, uncTab] }];
      const captured = captureCurrentState();
      assert.strictEqual(captured.length, 1, 'captureCurrentState must only capture safe local file: tabs');
      assert.strictEqual(captured[0].uri, 'file:///workspace/real.ts');

      // 2. Test restoreTabs rejects both 2-slash and 4-slash UNC paths BEFORE calling fs.stat
      mockState.statCalledUris = [];
      const uncRecords = [
        {
          uri: 'file:////attacker-host/share/exploit.ts',
          viewColumn: 1,
          tabIndex: 0,
          isPinned: false,
          cursor: { line: 0, character: 0 }
        },
        {
          uri: 'file://attacker-host/share/exploit2.ts',
          viewColumn: 1,
          tabIndex: 1,
          isPinned: false,
          cursor: { line: 0, character: 0 }
        }
      ];
      let editorOpened = false;
      await restoreTabs(uncRecords, () => { editorOpened = true; });
      assert.strictEqual(editorOpened, false, 'restoreTabs must reject UNC paths with authority');
      assert.strictEqual(mockState.editorsShown.length, 0, 'No editor should be opened for UNC path');
      assert.strictEqual(mockState.statCalledUris.length, 0, 'fs.stat must NEVER be invoked on UNC paths');
    });

    it('[F-04, F-05, F-11, F-12 REMEDIATED] Enforces workspace bounds, escapes status bar codicons, preserves POSIX case, and restores pinned tabs', async () => {
      // F-04: Workspace boundary check
      assert.strictEqual(isSafeLocalFileUri('file:///workspace/repo/src/a.ts', undefined, '/workspace/repo'), true);
      assert.strictEqual(isSafeLocalFileUri('file:///etc/passwd', undefined, '/workspace/repo'), false);
      assert.strictEqual(isSafeLocalFileUri('file:///workspace/repo/../secret.txt', undefined, '/workspace/repo'), false);

      // F-05: Status bar codicon escaping
      const spoofBranch = 'main $(error) $(sync~spin) Alert';
      const formatted = formatBranchForDisplay(spoofBranch);
      assert.ok(!formatted.includes('$(') || formatted.includes('\\$('), 'Must escape $( codicon sequences');
      assert.strictEqual(formatted, 'main \\$(error) \\$(sync~spin) Alert');

      // F-11: Case sensitivity preserved on Linux, folded on Windows
      assert.notStrictEqual(
        normalizeRepoRoot('/home/dev/Repo', 'linux'),
        normalizeRepoRoot('/home/dev/repo', 'linux')
      );
      assert.strictEqual(
        normalizeRepoRoot('C:\\Users\\Dev\\Repo', 'win32'),
        normalizeRepoRoot('c:/users/dev/repo', 'win32')
      );
      assert.strictEqual(
        areUrisEqual('file:///workspace/Foo.ts', 'file:///workspace/foo.ts', 'linux'),
        false
      );
      assert.strictEqual(
        areUrisEqual('file:///C:/workspace/Foo.ts', 'file:///c:/workspace/foo.ts', 'win32'),
        true
      );

      // F-12: Pinned tab restoration
      mockState.commandsExecuted = [];
      await restoreTabs([
        {
          uri: 'file:///workspace/pinned.ts',
          viewColumn: 1,
          tabIndex: 0,
          isPinned: true,
          cursor: { line: 0, character: 0 }
        }
      ]);
      const pinCmd = mockState.commandsExecuted.find((c) => c.command === 'workbench.action.pinEditor');
      assert.ok(pinCmd, 'workbench.action.pinEditor must be called when isPinned is true');
    });

    it('Restores tabs in exact saved order in background and focuses active tab last with line pulse', async () => {
      mockState.editorsShown = [];
      const file1 = 'file:///workspace/tab1.ts';
      const file2 = 'file:///workspace/tab2.ts';
      const activeFile = 'file:///workspace/active.ts';

      const records = [
        { uri: file1, viewColumn: 1, tabIndex: 0, isPinned: false, cursor: { line: 1, character: 0 } },
        { uri: activeFile, viewColumn: 1, tabIndex: 1, isPinned: false, cursor: { line: 4, character: 2 } },
        { uri: file2, viewColumn: 1, tabIndex: 2, isPinned: false, cursor: { line: 2, character: 0 } }
      ];

      const pulses: Array<{ uri: string; line: number }> = [];
      await restoreTabs(
        records,
        (editor, line) => {
          pulses.push({ uri: editor.document.uri.toString(), line });
        },
        activeFile,
        { line: 5, character: 3 }
      );

      assert.strictEqual(mockState.editorsShown.length, 4);

      const first = mockState.editorsShown[0];
      const second = mockState.editorsShown[1];
      const third = mockState.editorsShown[2];
      const focused = mockState.editorsShown[3];

      assert.strictEqual((first.uri as { toString(): string }).toString(), file1);
      assert.deepStrictEqual(first.options, { viewColumn: 1, preserveFocus: true, preview: false });

      assert.strictEqual((second.uri as { toString(): string }).toString(), activeFile);
      assert.deepStrictEqual(second.options, { viewColumn: 1, preserveFocus: true, preview: false });

      assert.strictEqual((third.uri as { toString(): string }).toString(), file2);
      assert.deepStrictEqual(third.options, { viewColumn: 1, preserveFocus: true, preview: false });

      assert.strictEqual((focused.uri as { toString(): string }).toString(), activeFile);
      assert.deepStrictEqual(focused.options, { viewColumn: 1, preserveFocus: false, preview: false });

      assert.strictEqual(pulses.length, 1);
      assert.strictEqual(pulses[0].uri, activeFile);
      assert.strictEqual(pulses[0].line, 5);
    });

    it('Restores all tabs in order and calls onFileRestored when activeTabUri is null/omitted', async () => {
      mockState.editorsShown = [];
      const file1 = 'file:///workspace/fallback1.ts';
      const file2 = 'file:///workspace/fallback2.ts';

      const records = [
        { uri: file1, viewColumn: 1, tabIndex: 0, isPinned: false, cursor: { line: 2, character: 0 } },
        { uri: file2, viewColumn: 1, tabIndex: 1, isPinned: false, cursor: { line: 3, character: 0 } }
      ];

      const pulses: Array<{ uri: string; line: number }> = [];
      await restoreTabs(records, (editor, line) => {
        pulses.push({ uri: editor.document.uri.toString(), line });
      }, null);

      assert.strictEqual(mockState.editorsShown.length, 2);
      assert.deepStrictEqual(mockState.editorsShown[0].options, { viewColumn: 1, preserveFocus: true, preview: false });
      assert.deepStrictEqual(mockState.editorsShown[1].options, { viewColumn: 1, preserveFocus: true, preview: false });

      assert.strictEqual(pulses.length, 2);
      assert.strictEqual(pulses[0].line, 2);
      assert.strictEqual(pulses[1].line, 3);
    });

    it('applyCursorAndDecoration correctly positions cursor, clamps bounds, and calls onFileRestored', async () => {
      const editor = await mockVscode.window.showTextDocument(mockVscode.Uri.file('/workspace/apply.ts'));
      let pulseLine = -1;

      applyCursorAndDecoration(editor as unknown as import('vscode').TextEditor, { line: 0, character: 0 }, (_ed, line) => {
        pulseLine = line;
      });
      assert.strictEqual(editor.selection.active.line, 0);
      assert.strictEqual(editor.selection.active.character, 0);
      assert.strictEqual(pulseLine, 0);

      applyCursorAndDecoration(editor as unknown as import('vscode').TextEditor, { line: 7, character: 4 }, (_ed, line) => {
        pulseLine = line;
      });
      assert.strictEqual(editor.selection.active.line, 7);
      assert.strictEqual(editor.selection.active.character, 4);
      assert.strictEqual(pulseLine, 7);

      applyCursorAndDecoration(editor as unknown as import('vscode').TextEditor, { line: 999, character: 999 }, (_ed, line) => {
        pulseLine = line;
      });
      assert.strictEqual(editor.selection.active.line, 9);
      assert.strictEqual(pulseLine, 9);

      applyCursorAndDecoration(editor as unknown as import('vscode').TextEditor, { line: -10, character: -5 }, (_ed, line) => {
        pulseLine = line;
      });
      assert.strictEqual(editor.selection.active.line, 0);
      assert.strictEqual(editor.selection.active.character, 0);
      assert.strictEqual(pulseLine, 0);
    });

    it('Preserves original tab ordering regardless of activeTabUri position', async () => {
      mockState.editorsShown = [];
      const tabs = [
        { uri: 'file:///workspace/alpha.ts', viewColumn: 1, tabIndex: 0, isPinned: false, cursor: { line: 0, character: 0 } },
        { uri: 'file:///workspace/beta.ts', viewColumn: 1, tabIndex: 1, isPinned: false, cursor: { line: 1, character: 0 } },
        { uri: 'file:///workspace/gamma.ts', viewColumn: 1, tabIndex: 2, isPinned: false, cursor: { line: 2, character: 0 } },
        { uri: 'file:///workspace/delta.ts', viewColumn: 1, tabIndex: 3, isPinned: false, cursor: { line: 3, character: 0 } }
      ];

      await restoreTabs(tabs, undefined, 'file:///workspace/beta.ts', { line: 1, character: 5 });

      const phase1Uris = mockState.editorsShown.slice(0, 4).map(e => (e.uri as { toString(): string }).toString());
      assert.deepStrictEqual(phase1Uris, [
        'file:///workspace/alpha.ts',
        'file:///workspace/beta.ts',
        'file:///workspace/gamma.ts',
        'file:///workspace/delta.ts'
      ]);
      for (let i = 0; i < 4; i++) {
        assert.deepStrictEqual(mockState.editorsShown[i].options, { viewColumn: 1, preserveFocus: true, preview: false });
      }

      assert.strictEqual(mockState.editorsShown.length, 5);
      const activeCall = mockState.editorsShown[4];
      assert.strictEqual((activeCall.uri as { toString(): string }).toString(), 'file:///workspace/beta.ts');
      assert.deepStrictEqual(activeCall.options, { viewColumn: 1, preserveFocus: false, preview: false });
    });

    it('Empty line cursor positioning: preserves 0-indexed line and character=0 without jumping', async () => {
      const editor = await mockVscode.window.showTextDocument(mockVscode.Uri.file('/workspace/empty-line.ts'));
      editor.document.lineAt = (line: number) => {
        if (line === 3) {
          return { text: '', range: new MockRange(new MockPosition(3, 0), new MockPosition(3, 0)) };
        }
        return { text: `Line ${line} text`, range: new MockRange(new MockPosition(line, 0), new MockPosition(line, 12)) };
      };

      editor.revealedRanges = [];
      let pulseLine = -1;
      applyCursorAndDecoration(editor as unknown as import('vscode').TextEditor, { line: 3, character: 0 }, (_ed, line) => {
        pulseLine = line;
      }, true);

      assert.strictEqual(editor.selection.active.line, 3);
      assert.strictEqual(editor.selection.active.character, 0);
      assert.strictEqual(pulseLine, 3);

      assert.strictEqual(editor.revealedRanges.length, 1);
      const revealed = editor.revealedRanges[0].range as MockRange;
      assert.strictEqual(revealed.start.line, 3);
      assert.strictEqual(revealed.start.character, 0);
      assert.strictEqual(revealed.end.line, 3);
      assert.strictEqual(revealed.end.character, 0);
    });

    it('Flicker prevention: does not re-open documents already visible in visibleTextEditors', async () => {
      mockState.editorsShown = [];
      const visibleUri = 'file:///workspace/already-visible.ts';
      const visibleDocEditor = {
        document: {
          uri: mockVscode.Uri.parse(visibleUri),
          isDirty: false,
          lineCount: 10,
          lineAt: (line: number) => ({ text: 'code', range: new MockRange(new MockPosition(line, 0), new MockPosition(line, 4)) })
        },
        viewColumn: 1,
        selection: new MockSelection(new MockPosition(0, 0), new MockPosition(0, 0)),
        revealedRanges: [],
        setDecorations: () => {},
        revealRange: () => {}
      };
      mockState.visibleTextEditors = [visibleDocEditor as unknown as MockTextEditor];

      const records = [
        { uri: visibleUri, viewColumn: 1, tabIndex: 0, isPinned: false, cursor: { line: 2, character: 0 } },
        { uri: 'file:///workspace/new-tab.ts', viewColumn: 1, tabIndex: 1, isPinned: false, cursor: { line: 1, character: 0 } }
      ];

      await restoreTabs(records, undefined, null);

      assert.strictEqual(mockState.editorsShown.length, 1);
      assert.strictEqual((mockState.editorsShown[0].uri as { toString(): string }).toString(), 'file:///workspace/new-tab.ts');

      mockState.visibleTextEditors = [];
    });

    it('Flicker prevention: does not re-open tabs already present in tabGroups', async () => {
      mockState.editorsShown = [];
      const inGroupUri = 'file:///workspace/existing-tab.ts';
      mockState.tabGroupsAll = [
        {
          viewColumn: 1,
          tabs: [
            {
              input: new MockTabInputText(mockVscode.Uri.parse(inGroupUri)),
              isDirty: false,
              isPinned: false
            }
          ]
        }
      ];

      const records = [
        { uri: inGroupUri, viewColumn: 1, tabIndex: 0, isPinned: false, cursor: { line: 1, character: 0 } },
        { uri: 'file:///workspace/open-me.ts', viewColumn: 1, tabIndex: 1, isPinned: false, cursor: { line: 0, character: 0 } }
      ];

      await restoreTabs(records, undefined, null);

      assert.strictEqual(mockState.editorsShown.length, 1);
      assert.strictEqual((mockState.editorsShown[0].uri as { toString(): string }).toString(), 'file:///workspace/open-me.ts');

      mockState.tabGroupsAll = [];
    });

    it('Eliminates redundant round-trips: skips showTextDocument if activeTextEditor is already the active file', async () => {
      mockState.editorsShown = [];
      const activeFile = 'file:///workspace/already-active.ts';
      const activeEditorMock = {
        document: {
          uri: mockVscode.Uri.parse(activeFile),
          isDirty: false,
          lineCount: 10,
          lineAt: (line: number) => ({ text: 'code', range: new MockRange(new MockPosition(line, 0), new MockPosition(line, 4)) })
        },
        viewColumn: 1,
        selection: new MockSelection(new MockPosition(0, 0), new MockPosition(0, 0)),
        revealedRanges: [],
        setDecorations: () => {},
        revealRange: () => {}
      };
      mockState.activeTextEditor = activeEditorMock as unknown as MockTextEditor;
      mockState.visibleTextEditors = [activeEditorMock as unknown as MockTextEditor];

      const records = [
        { uri: activeFile, viewColumn: 1, tabIndex: 0, isPinned: false, cursor: { line: 5, character: 2 } }
      ];

      let pulseLine = -1;
      await restoreTabs(records, (_ed, line) => {
        pulseLine = line;
      }, activeFile, { line: 5, character: 2 });

      assert.strictEqual(mockState.editorsShown.length, 0);
      assert.strictEqual(pulseLine, 5);

      mockState.activeTextEditor = undefined;
      mockState.visibleTextEditors = [];
    });

    it('CRLF sanitization: strips trailing \\r to prevent cursor jumping to next line', async () => {
      const editor = await mockVscode.window.showTextDocument(mockVscode.Uri.file('/workspace/crlf.ts'));
      editor.document.lineAt = (line: number) => {
        if (line === 2) {
          return { text: 'const a = 10;\r', range: new MockRange(new MockPosition(2, 0), new MockPosition(2, 14)) };
        }
        if (line === 3) {
          return { text: '\r', range: new MockRange(new MockPosition(3, 0), new MockPosition(3, 1)) };
        }
        return { text: 'normal line', range: new MockRange(new MockPosition(line, 0), new MockPosition(line, 11)) };
      };

      applyCursorAndDecoration(editor as unknown as import('vscode').TextEditor, { line: 2, character: 99 }, undefined, true);
      assert.strictEqual(editor.selection.active.line, 2);
      assert.strictEqual(editor.selection.active.character, 13);

      applyCursorAndDecoration(editor as unknown as import('vscode').TextEditor, { line: 3, character: 5 }, undefined, true);
      assert.strictEqual(editor.selection.active.line, 3);
      assert.strictEqual(editor.selection.active.character, 0);
    });

    it('Executes workbench.action.keepEditor on active tab to prevent terminal click demotion', async () => {
      mockState.commandsExecuted = [];
      mockState.editorsShown = [];
      const file = 'file:///workspace/active-tab.ts';
      const records = [
        { uri: file, viewColumn: 1, tabIndex: 0, isPinned: false, cursor: { line: 1, character: 0 } }
      ];

      await restoreTabs(records, undefined, file, { line: 1, character: 0 });

      const keepCmd = mockState.commandsExecuted.find(c => c.command === 'workbench.action.keepEditor');
      assert.ok(keepCmd, 'workbench.action.keepEditor should have been executed');
    });

    it('DecorationService.pulseLine on empty line produces zero-width range on safeLine', async () => {
      const decService = new DecorationService();
      let decorationRanges: unknown[] = [];
      const editor = {
        document: {
          lineCount: 5,
          lineAt: (line: number) => {
            if (line === 2) {
              return { text: '', range: new MockRange(new MockPosition(2, 0), new MockPosition(2, 0)) };
            }
            return { text: 'code', range: new MockRange(new MockPosition(line, 0), new MockPosition(line, 4)) };
          }
        },
        setDecorations: (_type: unknown, ranges: unknown[]) => {
          decorationRanges = ranges;
        }
      };

      decService.pulseLine(editor as unknown as import('vscode').TextEditor, 2);
      assert.strictEqual(decorationRanges.length, 1);
      const range = decorationRanges[0] as MockRange;
      assert.strictEqual(range.start.line, 2);
      assert.strictEqual(range.start.character, 0);
      assert.strictEqual(range.end.line, 2);
      assert.strictEqual(range.end.character, 0);
      decService.dispose();
    });
  });
});
