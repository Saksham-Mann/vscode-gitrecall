import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { closeCleanTabs } from '../../../tabManager';

/**
 * Integration test: dirty files are never closed by Clean Desk.
 */
suite('Dirty File Safety', () => {
  let tmpDir: string;
  let testFile: string;

  suiteSetup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitrecall-dirty-'));
    testFile = path.join(tmpDir, 'dirty.ts');
    fs.writeFileSync(testFile, 'original content\n');
  });

  suiteTeardown(async () => {
    // Revert and close
    await vscode.commands.executeCommand('workbench.action.revertFile');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort
    }
  });

  test('dirty file survives closeCleanTabs and retains unsaved content', async () => {
    // Open the file
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(testFile));
    const editor = await vscode.window.showTextDocument(doc, { preview: false });

    // Make an unsaved edit
    const editApplied = await editor.edit(editBuilder => {
      editBuilder.insert(new vscode.Position(0, 0), 'UNSAVED EDIT: ');
    });
    assert.ok(editApplied, 'Edit should have been applied');
    assert.ok(doc.isDirty, 'Document should be dirty after edit');

    // Run Clean Desk
    await closeCleanTabs();

    // Wait briefly for tab operations to settle
    await new Promise(resolve => setTimeout(resolve, 300));

    // The dirty file should still be open
    const stillOpen = vscode.workspace.textDocuments.find(
      d => d.uri.fsPath === testFile
    );
    assert.ok(stillOpen, 'Dirty file should still be open after closeCleanTabs');
    assert.ok(stillOpen.isDirty, 'Document should still be dirty');
    assert.ok(
      stillOpen.getText().includes('UNSAVED EDIT'),
      'Unsaved content should be intact'
    );
  });
});
