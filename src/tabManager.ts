import * as vscode from 'vscode';
import { TabRecord, CursorPosition } from './storage';

/**
 * Captures the current open editor tabs, split pane columns, tab indices,
 * pinned states, and active cursor coordinates across all tab groups.
 */
export function captureCurrentState(
  activeCursorCache?: { uri: string; line: number; character: number } | null
): TabRecord[] {
  const records: TabRecord[] = [];

  try {
    for (const group of vscode.window.tabGroups.all) {
      group.tabs.forEach((tab, index) => {
        try {
          if (tab.input instanceof vscode.TabInputText) {
            if (tab.input.uri.scheme !== 'file') {
              return;
            }
            const uri = tab.input.uri.toString();
            const viewColumn = typeof group.viewColumn === 'number' ? group.viewColumn : 1;
            const tabIndex = index;
            const isPinned = tab.isPinned;

            let cursor: CursorPosition = { line: 0, character: 0 };
            if (activeCursorCache && areUrisEqual(activeCursorCache.uri, uri)) {
              cursor = {
                line: activeCursorCache.line,
                character: activeCursorCache.character
              };
            } else {
              // Cross-reference visible editors to find active cursor coordinates
              const matchingEditor =
                vscode.window.visibleTextEditors.find(
                  (e) => areUrisEqual(e.document.uri.toString(), uri) && e.viewColumn === group.viewColumn
                ) ??
                vscode.window.visibleTextEditors.find(
                  (e) => areUrisEqual(e.document.uri.toString(), uri)
                );

              if (matchingEditor) {
                cursor = {
                  line: matchingEditor.selection.active.line,
                  character: matchingEditor.selection.active.character
                };
              }
            }

            records.push({
              uri,
              viewColumn,
              tabIndex,
              isPinned,
              cursor
            });
          }
        } catch (tabError) {
          console.warn('[GitRecall] Error capturing individual tab state:', tabError);
        }
      });
    }
  } catch (groupError) {
    console.warn('[GitRecall] Error enumerating tab groups during capture:', groupError);
  }

  return records;
}

/**
 * Closes editor tabs that do not contain unsaved changes.
 * Dirty files are strictly preserved to protect against data loss.
 * If preserveUris is provided, tabs matching those URIs are also preserved
 * to eliminate screen flicker and avoid closing tabs needed by the incoming branch.
 */
export async function closeCleanTabs(
  tabs?: readonly vscode.Tab[],
  preserveUris?: readonly string[]
): Promise<void> {
  try {
    const targetTabs: readonly vscode.Tab[] =
      tabs ?? vscode.window.tabGroups.all.flatMap((g) => g.tabs);

    const cleanTabs: vscode.Tab[] = [];

    for (const tab of targetTabs) {
      try {
        if (!(tab.input instanceof vscode.TabInputText)) {
          // Fail safe: skip non-text editors (webviews, settings, diffs)
          continue;
        }

        if (tab.isDirty) {
          // Tab has unsaved changes
          continue;
        }

        const uriStr = tab.input.uri.toString();

        // Preserve tabs that belong to the incoming branch to eliminate blank screen flicker
        if (preserveUris && preserveUris.some((pUri) => areUrisEqual(pUri, uriStr))) {
          continue;
        }

        const doc = vscode.workspace.textDocuments.find((d) => areUrisEqual(d.uri.toString(), uriStr));

        if (doc && doc.isDirty) {
          // Document has unsaved edits
          continue;
        }

        cleanTabs.push(tab);
      } catch (tabError) {
        console.warn('[GitRecall] Error checking tab dirty state:', tabError);
        // Fail safe: do not close tab on evaluation failure
      }
    }

    if (cleanTabs.length > 0) {
      await vscode.window.tabGroups.close(cleanTabs, true);
    }
  } catch (error) {
    console.warn('[GitRecall] Failed to batch-close clean tabs:', error);
  }
}

/**
 * Clamps a numeric value safely between lower and upper bounds.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(min, value), max);
}

/**
 * Restores cursor position on the editor with safe bounds clamping,
 * reveals the cursor in the viewport, and optionally invokes the line pulse decoration callback.
 */
export function applyCursorAndDecoration(
  editor: vscode.TextEditor,
  cursor?: CursorPosition | null,
  onFileRestored?: (editor: vscode.TextEditor, line: number) => void,
  reveal: boolean = true
): void {
  try {
    const lineCount = editor.document.lineCount;
    if (lineCount <= 0) {
      return;
    }
    const rawLine = cursor && typeof cursor.line === 'number' && Number.isFinite(cursor.line) ? Math.floor(cursor.line) : 0;
    const targetLine = clamp(rawLine, 0, Math.max(0, lineCount - 1));

    let lineLength = 0;
    try {
      lineLength = editor.document.lineAt(targetLine).text.replace(/\r$/, '').length;
    } catch {
      lineLength = 0;
    }

    const targetChar = typeof cursor?.character === 'number' && Number.isFinite(cursor.character)
      ? clamp(Math.floor(cursor.character), 0, lineLength)
      : 0;

    const pos = new vscode.Position(targetLine, targetChar);
    editor.selection = new vscode.Selection(pos, pos);

    if (reveal) {
      const revealType =
        typeof vscode.TextEditorRevealType.Default === 'number'
          ? vscode.TextEditorRevealType.Default
          : vscode.TextEditorRevealType.InCenterIfOutsideViewport;

      editor.revealRange(
        new vscode.Range(pos, pos),
        revealType
      );
    }

    if (onFileRestored) {
      try {
        onFileRestored(editor, targetLine);
      } catch (cbError) {
        console.warn('[GitRecall] Error in onFileRestored callback:', cbError);
      }
    }
  } catch (error) {
    console.warn('[GitRecall] Error in applyCursorAndDecoration:', error);
  }
}

/**
 * Normalizes and compares two URI strings for equality.
 */
export function areUrisEqual(uriA: string | undefined | null, uriB: string | undefined | null): boolean {
  if (!uriA || !uriB) {
    return uriA === uriB;
  }
  if (uriA === uriB) {
    return true;
  }
  try {
    const parsedA = vscode.Uri.parse(uriA);
    const parsedB = vscode.Uri.parse(uriB);
    if (parsedA.scheme !== parsedB.scheme) {
      return false;
    }
    const pathA = (parsedA.fsPath || parsedA.path || '').replace(/\\/g, '/').toLowerCase();
    const pathB = (parsedB.fsPath || parsedB.path || '').replace(/\\/g, '/').toLowerCase();
    if (pathA && pathB) {
      return pathA === pathB;
    }
    return parsedA.toString().toLowerCase() === parsedB.toString().toLowerCase();
  } catch {
    return uriA.toLowerCase() === uriB.toLowerCase();
  }
}

/**
 * Checks whether a tab with the specified URI is already present in an open tab group.
 */
function isTabInGroup(uriStr: string, viewColumn?: number): boolean {
  try {
    for (const group of vscode.window.tabGroups.all) {
      if (viewColumn !== undefined && typeof group.viewColumn === 'number' && group.viewColumn !== viewColumn) {
        continue;
      }
      for (const tab of group.tabs) {
        if (
          tab.input instanceof vscode.TabInputText ||
          (typeof tab.input === 'object' && tab.input !== null && 'uri' in tab.input)
        ) {
          const tabUri = (tab.input as { uri: vscode.Uri }).uri;
          if (tabUri && areUrisEqual(tabUri.toString(), uriStr)) {
            return true;
          }
        }
      }
    }
  } catch {
    // Fail open if tabGroups enumeration fails
  }
  return false;
}

/**
 * Restores saved tabs in two phases:
 *
 * Phase 1 – Background tabs
 *   All file-existence checks are parallelised upfront (one Promise.allSettled batch) to
 *   eliminate N sequential async round-trips and reduce startup lag.
 *   Each valid tab is opened with { preview: false, preserveFocus: false } so VS Code
 *   advances its insertion cursor left-to-right, producing the correct tab bar order.
 *   (preserveFocus: true inserts every new tab next to the still-focused first tab,
 *   reversing the order after position 0.)
 *
 * Phase 2 – Active tab
 *   After Phase 1 the tab bar contains all tabs in their correct saved positions.
 *   We locate the active tab's ACTUAL current bar index by scanning tabGroups and use
 *   workbench.action.openEditorAtIndex to navigate to it.  That command calls
 *   focusEditorAtIndex internally which only changes focus — it does NOT reinsert the tab
 *   and therefore cannot cause it to drift to the end of the bar on terminal clicks.
 *   showTextDocument is only used as a fallback when the tab is not yet in the group.
 *   The cursor is applied immediately (reduces perceived lag) and again after 50 ms
 *   (overwrites VS Code's own async view-state restoration which runs on a real setTimeout).
 */
export async function restoreTabs(
  records: TabRecord[],
  onFileRestored?: (editor: vscode.TextEditor, line: number) => void,
  activeTabUri?: string | null,
  activeCursor?: CursorPosition | null
): Promise<void> {
  const hasActiveTab = typeof activeTabUri === 'string' && activeTabUri.length > 0;

  // ── Pre-filter: parallel existence check ──
  // All stat calls run concurrently so N tabs cost one round-trip, not N.
  const uris = records.map((r) => vscode.Uri.parse(r.uri));
  const statResults = await Promise.allSettled(uris.map((u) => vscode.workspace.fs.stat(u)));
  const validRecords = records.filter((_, i) => statResults[i].status === 'fulfilled');

  // ── Phase 1: Open all valid tabs in exact saved order ──
  for (const record of validRecords) {
    try {
      const uri = vscode.Uri.parse(record.uri);
      if (uri.scheme !== 'file' || (uri.authority && uri.authority !== '')) {
        continue;
      }

      // Reuse an already-visible editor without a redundant showTextDocument call
      const visibleEditor =
        vscode.window.visibleTextEditors.find(
          (e) =>
            areUrisEqual(e.document.uri.toString(), record.uri) &&
            (record.viewColumn === undefined || e.viewColumn === record.viewColumn)
        ) ??
        vscode.window.visibleTextEditors.find(
          (e) => areUrisEqual(e.document.uri.toString(), record.uri)
        );

      let targetEditor: vscode.TextEditor | undefined;

      if (visibleEditor) {
        targetEditor = visibleEditor;
      } else if (isTabInGroup(record.uri, record.viewColumn)) {
        // Already in the group (e.g. preserved dirty tab) — skip; Phase 2 will focus it
        continue;
      } else {
        // Open background tabs with preserveFocus: true to avoid stealing focus
        targetEditor = await vscode.window.showTextDocument(uri, {
          viewColumn: record.viewColumn,
          preserveFocus: true,
          preview: false
        });
      }

      if (targetEditor) {
        applyCursorAndDecoration(
          targetEditor,
          record.cursor,
          hasActiveTab ? undefined : onFileRestored,
          false // no reveal for background tabs — suppresses flicker
        );
      }
    } catch (recordError) {
      console.warn(`[GitRecall] Error restoring record for "${record.uri}":`, recordError);
    }
  }

  // ── Phase 2: Focus the saved active tab and correct its bar position ──
  if (!hasActiveTab) {
    return;
  }

  try {
    const activeUri = vscode.Uri.parse(activeTabUri!);
    if (activeUri.scheme !== 'file' || (activeUri.authority && activeUri.authority !== '')) {
      return;
    }

    // Use the pre-computed stat result for the active file
    const activeRecordIdx = records.findIndex((r) => areUrisEqual(r.uri, activeTabUri!));
    if (activeRecordIdx < 0 || statResults[activeRecordIdx].status !== 'fulfilled') {
      console.info(`[GitRecall] Active file no longer exists on disk, skipping: ${activeTabUri}`);
      return;
    }

    const activeRecord = records[activeRecordIdx];
    const targetViewColumn = activeRecord?.viewColumn;
    const targetCursor = activeCursor ?? activeRecord?.cursor ?? null;
    const savedTabIndex = activeRecord?.tabIndex ?? 0;

    // ── Focus ──
    let activeEditor: vscode.TextEditor | undefined;
    const currentActive = vscode.window.activeTextEditor;
    if (
      currentActive &&
      areUrisEqual(currentActive.document.uri.toString(), activeTabUri!) &&
      (targetViewColumn === undefined || currentActive.viewColumn === targetViewColumn)
    ) {
      activeEditor = currentActive;
    } else {
      activeEditor = await vscode.window.showTextDocument(activeUri, {
        viewColumn: targetViewColumn,
        preview: false,
        preserveFocus: false
      });
    }

    // Promote from any residual preview state so terminal clicks cannot demote the tab
    try {
      await vscode.commands.executeCommand('workbench.action.keepEditor');
    } catch { /* best effort in test environments */ }

    // ── Position correction ──
    // Use the native VS Code command 'moveActiveEditor' to slide the active tab back to its
    // saved bar index if it drifted during focus or open.
    try {
      const targetGroup =
        vscode.window.tabGroups.all.find(
          (g) => targetViewColumn === undefined || g.viewColumn === targetViewColumn
        ) ?? vscode.window.tabGroups.activeTabGroup;

      if (targetGroup) {
        const currentIndex = targetGroup.tabs.findIndex(
          (t) =>
            t.input instanceof vscode.TabInputText &&
            areUrisEqual((t.input as vscode.TabInputText).uri.toString(), activeTabUri!)
        );

        if (currentIndex >= 0 && currentIndex !== savedTabIndex) {
          await vscode.commands.executeCommand('moveActiveEditor', {
            to: savedTabIndex === 0 ? 'first' : 'position',
            by: 'tab',
            value: savedTabIndex + 1
          });
        }
      }
    } catch {
      // Repositioning is best-effort
    }

    // ── Cursor restoration ──
    applyCursorAndDecoration(activeEditor, targetCursor, onFileRestored, true);

  } catch (activeError) {
    console.warn(`[GitRecall] Error restoring active tab for "${activeTabUri}":`, activeError);
  }
}


/**
 * TabManager class wrapping tab capture, clean desk, and restoration.
 */
export class TabManager {
  captureCurrentState(
    activeCursorCache?: { uri: string; line: number; character: number } | null
  ): TabRecord[] {
    return captureCurrentState(activeCursorCache);
  }

  async closeCleanTabs(
    tabs?: readonly vscode.Tab[],
    preserveUris?: readonly string[]
  ): Promise<void> {
    return closeCleanTabs(tabs, preserveUris);
  }

  async restoreTabs(
    records: TabRecord[],
    onFileRestored?: (editor: vscode.TextEditor, line: number) => void,
    activeTabUri?: string | null,
    activeCursor?: CursorPosition | null
  ): Promise<void> {
    return restoreTabs(records, onFileRestored, activeTabUri, activeCursor);
  }
}
