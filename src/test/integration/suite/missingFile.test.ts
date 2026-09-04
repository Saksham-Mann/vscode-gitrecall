import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { CURRENT_SCHEMA_VERSION, BranchContextRecord } from '../../../storage';
import { restoreTabs } from '../../../tabManager';

/**
 * Integration test: missing/deleted files during restore must not throw.
 * Valid files in the same record should still restore correctly.
 */
suite('Missing File Resilience', () => {
  let tmpDir: string;
  let existingFile: string;
  let deletedFile: string;

  suiteSetup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitrecall-missing-'));
    existingFile = path.join(tmpDir, 'existing.ts');
    deletedFile = path.join(tmpDir, 'deleted.ts');

    fs.writeFileSync(existingFile, 'I exist.\n');
    fs.writeFileSync(deletedFile, 'I will be deleted.\n');
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort
    }
  });

  test('restores valid files and silently skips deleted ones', async () => {
    // Delete the file on disk before restore
    fs.unlinkSync(deletedFile);

    const record: BranchContextRecord = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      repoRoot: tmpDir,
      branch: 'test',
      savedAt: new Date().toISOString(),
      activeTabUri: null,
      tabs: [
        {
          uri: vscode.Uri.file(deletedFile).toString(),
          viewColumn: 1,
          tabIndex: 0,
          isPinned: false,
          cursor: { line: 0, character: 0 }
        },
        {
          uri: vscode.Uri.file(existingFile).toString(),
          viewColumn: 1,
          tabIndex: 1,
          isPinned: false,
          cursor: { line: 0, character: 0 }
        }
      ]
    };

    // restoreTabs should not throw
    const restoredEditors: string[] = [];
    await assert.doesNotReject(async () => {
      await restoreTabs(record.tabs, (editor) => {
        restoredEditors.push(editor.document.uri.fsPath);
      });
    });

    // The existing file should be restored
    const openDocs = vscode.workspace.textDocuments.map(d => d.uri.fsPath);
    const existingIsOpen = openDocs.some(p => path.normalize(p) === path.normalize(existingFile));
    assert.ok(existingIsOpen, 'existing.ts should be opened');

    // Verify the callback was called for the existing file
    const existingRestored = restoredEditors.some(
      p => path.normalize(p) === path.normalize(existingFile)
    );
    assert.ok(existingRestored, 'onFileRestored callback should have fired for existing.ts');
  });
});
