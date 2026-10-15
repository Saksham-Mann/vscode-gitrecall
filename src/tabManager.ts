import * as vscode from 'vscode';
import { TabRecord, CursorPosition, normalizeRepoRoot } from './storage';
import { log, logWarn } from './logger';

/**
 * Validates that a URI represents a safe local `file:` resource with no remote UNC authority,
 * no Windows UNC backslash prefix, no path traversal segments, and (if repoRoot is provided)
 * resides within `repoRoot`.
 */
export function isSafeLocalFileUri(
  uriStr: string,
  parsedUri?: vscode.Uri,
  repoRoot?: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (typeof uriStr !== 'string' || uriStr.length === 0) {
    return false;
  }

  // Reject standard file://authority/path (two slashes followed by non-slash) or file:////host/share
  if (/^file:\/\/(?!\/)/i.test(uriStr) || /^file:\/\/\/\/+/i.test(uriStr)) {
    return false;
  }

  let uri: vscode.Uri;
  try {
    uri = parsedUri ?? vscode.Uri.parse(uriStr);
  } catch (err) {
    logWarn(`Failed to parse URI "${uriStr}"`, err);
    return false;
  }

  if (uri.scheme !== 'file') {
    return false;
  }

  if (uri.authority && uri.authority !== '') {
    return false;
  }

  const rawFsPath = uri.fsPath || (uri as { path?: string }).path || '';
  if (!rawFsPath) {
    return false;
  }

  // Reject Windows UNC paths encoded in fsPath (e.g. \\server\share or //server/share)
  if (/^(\\\\|\/\/)/.test(rawFsPath)) {
    return false;
  }

  const normalizedFile = normalizeRepoRoot(rawFsPath.replace(/^file:\/\//i, ''), platform);
  const segments = normalizedFile.split('/');
  if (segments.includes('..')) {
    return false;
  }

  if (repoRoot && repoRoot.trim().length > 0) {
    const normalizedRoot = normalizeRepoRoot(repoRoot, platform);
    if (
      normalizedFile !== normalizedRoot &&
      !normalizedFile.startsWith(`${normalizedRoot}/`)
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Captures the current open editor tabs, split pane columns, tab indices,
 * pinned states, and active cursor coordinates across all tab groups.
 * When `repoRoot` is provided, only captures tabs belonging to that repository root.
 */
export function captureCurrentState(
  activeCursorCache?: { uri: string; line: number; character: number } | null,
  repoRoot?: string
): TabRecord[] {
  const records: TabRecord[] = [];

  try {
    for (const group of vscode.window.tabGroups.all) {
      let groupTabIndex = 0;
      group.tabs.forEach((tab) => {
        try {
          if (tab.input instanceof vscode.TabInputText) {
            const uri = tab.input.uri.toString();
            if (!isSafeLocalFileUri(uri, tab.input.uri, repoRoot)) {
              return;
            }
            const viewColumn = typeof group.viewColumn === 'number' ? group.viewColumn : 1;
            const tabIndex = groupTabIndex++;
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
          logWarn('Error capturing individual tab state', tabError);
        }
      });
    }
  } catch (groupError) {
    logWarn('Error enumerating tab groups during capture', groupError);
  }

  return records;
}

/**
 * Closes editor tabs that do not contain unsaved changes.
 * Dirty files are strictly preserved to protect against data loss.
 * If preserveUris is provided, tabs matching those URIs are also preserved
 * to eliminate screen flicker and avoid closing tabs needed by the incoming branch.
 * If repoRoot is provided, only closes tabs belonging to that repository root.
 */
export async function closeCleanTabs(
  tabs?: readonly vscode.Tab[],
  preserveUris?: readonly string[],
  repoRoot?: string
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

        // When scoped to a repository root, never close tabs outside that repository
        if (repoRoot && !isSafeLocalFileUri(uriStr, tab.input.uri, repoRoot)) {
          continue;
        }

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
        logWarn('Error checking tab dirty state', tabError);
        // Fail safe: do not close tab on evaluation failure
      }
    }

    if (cleanTabs.length > 0) {
      await vscode.window.tabGroups.close(cleanTabs, true);
    }
  } catch (error) {
    logWarn('Failed to batch-close clean tabs', error);
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
    } catch (lineErr) {
      logWarn(`Failed to read line ${targetLine} length during cursor restoration`, lineErr);
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
        logWarn('Error in onFileRestored callback', cbError);
      }
    }
  } catch (error) {
    logWarn('Error in applyCursorAndDecoration', error);
  }
}

/**
 * Normalizes and compares two URI strings for equality.
 * Preserves case on case-sensitive POSIX platforms while folding case on Windows.
 */
export function areUrisEqual(
  uriA: string | undefined | null,
  uriB: string | undefined | null,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (!uriA || !uriB) {
    return uriA === uriB;
  }
  if (uriA === uriB) {
    return true;
  }
  try {
    const parsedA = vscode.Uri.parse(uriA);
    const parsedB = vscode.Uri.parse(uriB);
    if (parsedA.scheme.toLowerCase() !== parsedB.scheme.toLowerCase()) {
      return false;
    }
    const rawPathA = (parsedA.fsPath || (parsedA as { path?: string }).path || '').replace(/\\/g, '/');
    const rawPathB = (parsedB.fsPath || (parsedB as { path?: string }).path || '').replace(/\\/g, '/');
    if (rawPathA && rawPathB) {
      return normalizeRepoRoot(rawPathA, platform) === normalizeRepoRoot(rawPathB, platform);
    }
    return platform === 'win32'
      ? parsedA.toString().toLowerCase() === parsedB.toString().toLowerCase()
      : parsedA.toString() === parsedB.toString();
  } catch (err) {
    logWarn('Error comparing URIs in areUrisEqual', err);
    return platform === 'win32' ? uriA.toLowerCase() === uriB.toLowerCase() : uriA === uriB;
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
  } catch (err) {
    logWarn('Failed to enumerate tabGroups in isTabInGroup', err);
  }
  return false;
}

/**
 * Restores saved tabs in two phases:
 *
 * Pre-filter:
 *   Sorts records by (viewColumn, tabIndex) and validates all URIs (scheme === 'file',
 *   empty authority, no UNC paths, and optional repoRoot containment) BEFORE invoking
 *   `vscode.workspace.fs.stat()` so unsafe URIs never trigger filesystem or SMB requests.
 *
 * Phase 1 – Background tabs
 *   Opens valid tabs in saved order with `{ preview: false, preserveFocus: true }`.
 *
 * Phase 2 – Active tab
 *   Focuses the saved active tab, restores pinned status if needed, adjusts its tab bar
 *   position relative to existing tabs in the group, and applies cursor + line pulse.
 */
export async function restoreTabs(
  records: TabRecord[],
  onFileRestored?: (editor: vscode.TextEditor, line: number) => void,
  activeTabUri?: string | null,
  activeCursor?: CursorPosition | null,
  repoRoot?: string
): Promise<void> {
  const hasActiveTab = typeof activeTabUri === 'string' && activeTabUri.length > 0;

  // Sort records by viewColumn and tabIndex so restoration strictly follows original order
  const orderedRecords = [...records].sort(
    (a, b) => (a.viewColumn ?? 1) - (b.viewColumn ?? 1) || (a.tabIndex ?? 0) - (b.tabIndex ?? 0)
  );

  // ── Pre-filter: validate scheme, authority, and workspace bounds BEFORE fs.stat ──
  const preValidated = orderedRecords.map((r) => {
    try {
      const parsed = vscode.Uri.parse(r.uri);
      const safe = isSafeLocalFileUri(r.uri, parsed, repoRoot);
      return { record: r, parsed: safe ? parsed : null };
    } catch (err) {
      logWarn(`Skipping malformed URI during restore pre-filter: "${r.uri}"`, err);
      return { record: r, parsed: null };
    }
  });

  const statResults = await Promise.allSettled(
    preValidated.map((item) =>
      item.parsed
        ? vscode.workspace.fs.stat(item.parsed)
        : Promise.reject(new Error('UnsafeOrInvalidUri'))
    )
  );

  const validRecords = orderedRecords.filter((_, i) => statResults[i].status === 'fulfilled');

  // ── Phase 1: Open all valid tabs in exact saved order ──
  for (const record of validRecords) {
    try {
      const uri = vscode.Uri.parse(record.uri);
      if (!isSafeLocalFileUri(record.uri, uri, repoRoot)) {
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

      if (record.isPinned) {
        try {
          await vscode.commands.executeCommand('workbench.action.pinEditor');
        } catch (pinErr) {
          logWarn(`Best-effort pinEditor failed for "${record.uri}"`, pinErr);
        }
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
      logWarn(`Error restoring record for "${record.uri}"`, recordError);
    }
  }

  // ── Phase 2: Focus the saved active tab and correct its bar position ──
  if (!hasActiveTab) {
    return;
  }

  try {
    const activeUri = vscode.Uri.parse(activeTabUri!);
    if (!isSafeLocalFileUri(activeTabUri!, activeUri, repoRoot)) {
      return;
    }

    // Use the pre-computed stat result for the active file
    const activeRecordIdx = orderedRecords.findIndex((r) => areUrisEqual(r.uri, activeTabUri!));
    if (activeRecordIdx < 0 || statResults[activeRecordIdx].status !== 'fulfilled') {
      log(`Active file no longer exists on disk, skipping: ${activeTabUri}`);
      return;
    }

    const activeRecord = orderedRecords[activeRecordIdx];
    const targetViewColumn = activeRecord?.viewColumn;
    const targetCursor = activeCursor ?? activeRecord?.cursor ?? null;

    // Compute target tab index among valid existing tabs in the same viewColumn
    const validGroupRecords = validRecords.filter(
      (r) => (r.viewColumn ?? 1) === (targetViewColumn ?? 1)
    );
    const validGroupIndex = validGroupRecords.findIndex((r) =>
      areUrisEqual(r.uri, activeTabUri!)
    );
    const savedTabIndex = validGroupIndex >= 0 ? validGroupIndex : (activeRecord?.tabIndex ?? 0);

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
    } catch (keepErr) {
      logWarn('Best-effort keepEditor command failed', keepErr);
    }

    if (activeRecord?.isPinned) {
      try {
        await vscode.commands.executeCommand('workbench.action.pinEditor');
      } catch (pinErr) {
        logWarn('Best-effort pinEditor command failed on active tab', pinErr);
      }
    }

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
    } catch (moveErr) {
      logWarn('Best-effort moveActiveEditor repositioning failed', moveErr);
    }

    // ── Cursor restoration ──
    applyCursorAndDecoration(activeEditor, targetCursor, onFileRestored, true);

  } catch (activeError) {
    logWarn(`Error restoring active tab for "${activeTabUri}"`, activeError);
  }
}

/**
 * TabManager class wrapping tab capture, clean desk, and restoration.
 */
export class TabManager {
  captureCurrentState(
    activeCursorCache?: { uri: string; line: number; character: number } | null,
    repoRoot?: string
  ): TabRecord[] {
    return captureCurrentState(activeCursorCache, repoRoot);
  }

  async closeCleanTabs(
    tabs?: readonly vscode.Tab[],
    preserveUris?: readonly string[],
    repoRoot?: string
  ): Promise<void> {
    return closeCleanTabs(tabs, preserveUris, repoRoot);
  }

  async restoreTabs(
    records: TabRecord[],
    onFileRestored?: (editor: vscode.TextEditor, line: number) => void,
    activeTabUri?: string | null,
    activeCursor?: CursorPosition | null,
    repoRoot?: string
  ): Promise<void> {
    return restoreTabs(records, onFileRestored, activeTabUri, activeCursor, repoRoot);
  }
}
