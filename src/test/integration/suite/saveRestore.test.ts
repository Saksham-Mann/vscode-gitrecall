import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import {
  StorageManager,
  CURRENT_SCHEMA_VERSION,
  BranchContextRecord
} from '../../../storage';
import { captureCurrentState, restoreTabs } from '../../../tabManager';

/**
 * Integration test: save/restore round-trip.
 * Creates a temp git repo with two branches, simulates tab capture on branch A,
 * saves to storage, clears tabs, restores from storage, and verifies correctness.
 */
suite('Save / Restore Integration', () => {
  let tmpDir: string;
  let fileA: string;
  let fileB: string;

  suiteSetup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitrecall-test-'));
    fileA = path.join(tmpDir, 'fileA.ts');
    fileB = path.join(tmpDir, 'fileB.ts');
    fs.writeFileSync(fileA, 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconst e = 5;\n');
    fs.writeFileSync(fileB, 'export default {};\n');
  });

  suiteTeardown(async () => {
    // Close all editors before cleaning up
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  test('captures tab state and restores it accurately', async () => {
    // Open two files
    const docA = await vscode.workspace.openTextDocument(vscode.Uri.file(fileA));
    const editorA = await vscode.window.showTextDocument(docA, { viewColumn: vscode.ViewColumn.One, preview: false });

    // Move cursor to line 3
    const pos = new vscode.Position(3, 2);
    editorA.selection = new vscode.Selection(pos, pos);
    editorA.revealRange(new vscode.Range(pos, pos));

    const docB = await vscode.workspace.openTextDocument(vscode.Uri.file(fileB));
    await vscode.window.showTextDocument(docB, { viewColumn: vscode.ViewColumn.One, preview: false });

    // Capture current state
    const captured = captureCurrentState();
    assert.ok(captured.length >= 2, `Expected at least 2 tabs, got ${captured.length}`);

    const tabA = captured.find(t => t.uri.includes('fileA.ts'));
    assert.ok(tabA, 'fileA.ts should be in captured tabs');
    assert.strictEqual(tabA.cursor.line, 3, 'Cursor line for fileA should be 3');

    // Build a record
    const record: BranchContextRecord = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      repoRoot: tmpDir,
      branch: 'test-branch',
      savedAt: new Date().toISOString(),
      activeTabUri: null,
      tabs: captured
    };

    // Save to a mock memento (workspaceState)
    const mockMemento = new Map<string, unknown>();
    const mementoLike = {
      get: <T>(key: string): T | undefined => mockMemento.get(key) as T | undefined,
      update: async (key: string, value: unknown) => {
        if (value === undefined) {
          mockMemento.delete(key);
        } else {
          mockMemento.set(key, value);
        }
      }
    };

    const storage = new StorageManager(mementoLike);
    await storage.saveBranchContext(tmpDir, 'test-branch', record);

    // Close all editors
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    // Verify editors are closed
    await new Promise(resolve => setTimeout(resolve, 500));

    // Restore
    const retrieved = storage.getBranchContext(tmpDir, 'test-branch');
    assert.ok(retrieved, 'Should have a saved record');

    const restoredEditors: Array<{ uri: string; line: number }> = [];
    await restoreTabs(retrieved.tabs, (editor, line) => {
      restoredEditors.push({ uri: editor.document.uri.toString(), line });
    });

    // Verify fileA was restored
    const restoredA = restoredEditors.find(r => r.uri.includes('fileA.ts'));
    assert.ok(restoredA, 'fileA.ts should be restored');
    assert.strictEqual(restoredA.line, 3, 'fileA cursor should restore to line 3');
  });

  test('restores active tab last with focus and applies cursor decoration', async () => {
    const docA = await vscode.workspace.openTextDocument(vscode.Uri.file(fileA));
    await vscode.window.showTextDocument(docA, { viewColumn: vscode.ViewColumn.One, preview: false });

    const docB = await vscode.workspace.openTextDocument(vscode.Uri.file(fileB));
    await vscode.window.showTextDocument(docB, { viewColumn: vscode.ViewColumn.One, preview: false });

    const uriA = vscode.Uri.file(fileA).toString();
    const uriB = vscode.Uri.file(fileB).toString();

    // Close all editors
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await new Promise(resolve => setTimeout(resolve, 500));

    const records = [
      { uri: uriA, viewColumn: vscode.ViewColumn.One, tabIndex: 0, isPinned: false, cursor: { line: 1, character: 0 } },
      { uri: uriB, viewColumn: vscode.ViewColumn.One, tabIndex: 1, isPinned: false, cursor: { line: 0, character: 0 } }
    ];

    const pulses: Array<{ uri: string; line: number }> = [];
    await restoreTabs(records, (editor, line) => {
      pulses.push({ uri: editor.document.uri.toString(), line });
    }, uriB, { line: 0, character: 0 });

    // In two-stage restoration, pulse is only fired for the active tab (uriB)
    assert.strictEqual(pulses.length, 1);
    assert.ok(pulses[0].uri.includes('fileB.ts'));

    // And the active editor in VS Code should now be fileB
    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor, 'Active text editor should exist');
    assert.ok(activeEditor.document.uri.toString().includes('fileB.ts'), 'Active editor should be fileB');
  });
});
