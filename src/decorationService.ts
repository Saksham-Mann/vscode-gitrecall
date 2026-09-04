import * as vscode from 'vscode';
import { clamp } from './tabManager';

/**
 * Service managing ephemeral pulse decorations on restored cursor lines.
 * Reuses a single shared TextEditorDecorationType to prevent UI flicker and resource leaks.
 */
export class DecorationService implements vscode.Disposable {
  private readonly decorationType: vscode.TextEditorDecorationType;
  private readonly activeTimers = new Map<vscode.TextEditor, NodeJS.Timeout>();
  private readonly disposables: vscode.Disposable[] = [];
  private isDisposed = false;

  constructor() {
    // Exactly one shared decoration type across the extension lifetime
    this.decorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      light: {
        backgroundColor: 'rgba(56, 139, 253, 0.15)'
      },
      dark: {
        backgroundColor: 'rgba(56, 139, 253, 0.20)'
      }
    });

    // Clean up active timers for any editor that is closed before its 1500ms pulse finishes
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors((visibleEditors) => {
        const visibleSet = new Set(visibleEditors);
        for (const [editor, timer] of this.activeTimers.entries()) {
          if (!visibleSet.has(editor)) {
            clearTimeout(timer);
            this.activeTimers.delete(editor);
          }
        }
      })
    );
  }

  /**
   * Applies an ephemeral whole-line highlight to the given line, automatically removing it after 1500ms.
   * If a pulse is already active on this editor, the existing timer is cleared and restarted seamlessly.
   */
  pulseLine(editor: vscode.TextEditor, line: number): void {
    if (this.isDisposed) {
      return;
    }

    try {
      const lineCount = editor.document.lineCount;
      if (lineCount === 0) {
        return;
      }

      const rawLine = Number.isFinite(line) ? Math.floor(line) : 0;
      const safeLine = clamp(rawLine, 0, Math.max(0, lineCount - 1));
      const lineText = editor.document.lineAt(safeLine).text.replace(/\r$/, '');
      const lineRange = lineText.length === 0
        ? new vscode.Range(safeLine, 0, safeLine, 0)
        : editor.document.lineAt(safeLine).range;

      // Clear existing timeout for this editor to avoid overlapping timers or flicker
      const existingTimer = this.activeTimers.get(editor);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      // Single synchronous decoration call
      editor.setDecorations(this.decorationType, [lineRange]);

      // Schedule removal after 1500ms
      const timer = setTimeout(() => {
        try {
          this.activeTimers.delete(editor);
          editor.setDecorations(this.decorationType, []);
        } catch (err) {
          // Editor might have been disposed before callback ran
          console.warn('[GitRecall] Error removing line pulse decoration:', err);
        }
      }, 1500);

      this.activeTimers.set(editor, timer);
    } catch (error) {
      console.warn('[GitRecall] Failed to apply line pulse decoration:', error);
    }
  }

  /**
   * Clears all pending timers, disposes listeners, and disposes the shared decoration type.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;

    // Clear all pending pulse timers
    for (const timer of this.activeTimers.values()) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();

    // Dispose listeners
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;

    // Dispose the single shared decoration type
    this.decorationType.dispose();
  }
}
