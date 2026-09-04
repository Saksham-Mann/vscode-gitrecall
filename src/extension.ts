import * as vscode from 'vscode';
import { StorageManager, StoragePersistError, BranchContextRecord, CursorPosition, CURRENT_SCHEMA_VERSION } from './storage';
import { GitWatcher, BranchChangeEvent } from './gitWatcher';
import { captureCurrentState, closeCleanTabs, restoreTabs, areUrisEqual } from './tabManager';
import { DecorationService } from './decorationService';

/** Shared OutputChannel for all GitRecall diagnostics. */
let outputChannel: vscode.OutputChannel | undefined;

/** Top-level references for explicit teardown in deactivate(). */
let gitWatcher: GitWatcher | undefined;
let decorationService: DecorationService | undefined;

/**
 * Cached active editor cursor tracking to prevent loss of cursor coordinates
 * when user switches branches from the terminal or sidebar where activeTextEditor is undefined.
 */
export interface ActiveCursorCache {
  uri: string;
  line: number;
  character: number;
}

export let lastKnownActiveCursor: ActiveCursorCache | null = null;

/**
 * Logs a message to the GitRecall OutputChannel and to the dev console.
 */
function log(message: string): void {
  const timestamped = `[${new Date().toISOString()}] ${message}`;
  outputChannel?.appendLine(timestamped);
  console.log(`[GitRecall] ${message}`);
}

/**
 * Logs a warning to the GitRecall OutputChannel and to the dev console.
 */
function logWarn(message: string): void {
  const timestamped = `[${new Date().toISOString()}] WARN: ${message}`;
  outputChannel?.appendLine(timestamped);
  console.warn(`[GitRecall] ${message}`);
}

/**
 * Extension activation entrypoint.
 * Wires GitWatcher, StorageManager, TabManager, DecorationService, and the status bar item
 * into the full branch-switch lifecycle described in docs/ARCHITECTURE.md.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  try {
    // --- OutputChannel ---
    outputChannel = vscode.window.createOutputChannel('GitRecall');
    context.subscriptions.push(outputChannel);
    log('Activating GitRecall...');

    // --- DecorationService ---
    decorationService = new DecorationService();
    context.subscriptions.push(decorationService);

    // --- GitWatcher ---
    gitWatcher = new GitWatcher();
    context.subscriptions.push(gitWatcher);

    const gitAvailable = await gitWatcher.activate();
    if (!gitAvailable) {
      log('Built-in Git extension not available. GitRecall will remain dormant.');
      return;
    }

    // --- StorageManager ---
    const storage = new StorageManager(context.workspaceState);

    // --- Status Bar Item ---
    const statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      // Priority just right of the built-in Git branch indicator (which is ~100)
      99
    );
    context.subscriptions.push(statusBarItem);

    // Register a command for the status bar click → opens OutputChannel
    const showOutputCommand = 'gitrecall.showOutput';
    context.subscriptions.push(
      vscode.commands.registerCommand(showOutputCommand, () => {
        outputChannel?.show(true);
      })
    );
    statusBarItem.command = showOutputCommand;

    /**
     * Updates the status bar text and tooltip for the current branch.
     */
    const updateStatusBar = (branch: string | undefined, hasSavedRecord: boolean): void => {
      if (!branch) {
        statusBarItem.text = '$(history) GitRecall';
        statusBarItem.tooltip = 'GitRecall is active but no branch is checked out';
      } else if (hasSavedRecord) {
        statusBarItem.text = `$(history) GitRecall: ${branch}`;
        statusBarItem.tooltip = `GitRecall is tracking tabs & cursor position for '${branch}'`;
      } else {
        statusBarItem.text = `$(history) GitRecall: new`;
        statusBarItem.tooltip = `GitRecall is active on '${branch}' (no saved state yet)`;
      }
      statusBarItem.show();
    };

    // Initialize the status bar with whatever branch is currently checked out.
    // We pick the first repository's branch if there is one — multi-repo is out-of-scope for v1.
    {
      const allGroups = vscode.window.tabGroups.all;
      // Use the first repo root we can find from the watcher
      let initialBranch: string | undefined;
      let initialRepoRoot: string | undefined;

      // Walk workspace folders to find the first git repo the watcher knows about
      if (vscode.workspace.workspaceFolders) {
        for (const folder of vscode.workspace.workspaceFolders) {
          const branch = gitWatcher.getCurrentBranch(folder.uri.fsPath);
          if (branch !== undefined) {
            initialBranch = branch;
            initialRepoRoot = folder.uri.fsPath;
            break;
          }
        }
      }

      if (initialBranch && initialRepoRoot) {
        const existing = storage.getBranchContext(initialRepoRoot, initialBranch);
        updateStatusBar(initialBranch, existing !== undefined);
      } else {
        updateStatusBar(undefined, false);
      }

      // Suppress unused-variable lint for allGroups — referenced to ensure tabGroups API is available
      void allGroups;
    }

    // --- Selection Cache Handler ---
    // Maintain real-time selection cache so terminal focus or blur does not lose active cursor
    const selectionSubscription = vscode.window.onDidChangeTextEditorSelection((e) => {
      try {
        if (!e.textEditor || e.textEditor.document.uri.scheme !== 'file') {
          return;
        }
        // Only record user-initiated selections (keyboard, mouse, command).
        // Ignore programmatic updates or external file reloads from Git (e.kind === undefined).
        if (e.kind === undefined) {
          return;
        }
        const selection = e.selections[0];
        if (selection) {
          lastKnownActiveCursor = {
            uri: e.textEditor.document.uri.toString(),
            line: selection.active.line,
            character: selection.active.character
          };
        }
      } catch {
        // Ignore selection tracking errors
      }
    });
    context.subscriptions.push(selectionSubscription);

    const activeEditorSubscription = vscode.window.onDidChangeActiveTextEditor((editor) => {
      try {
        if (!editor || editor.document.uri.scheme !== 'file') {
          return;
        }
        const selection = editor.selection;
        if (selection) {
          lastKnownActiveCursor = {
            uri: editor.document.uri.toString(),
            line: selection.active.line,
            character: selection.active.character
          };
        }
      } catch {
        // Ignore active editor change tracking errors
      }
    });
    context.subscriptions.push(activeEditorSubscription);

    // --- Concurrency Lock ---
    // A simple chained-promise lock ensuring save/restore cycles run strictly sequentially.
    let cycleChain: Promise<void> = Promise.resolve();

    // --- Branch Change Handler ---
    const branchChangeSubscription = gitWatcher.onBranchChanged((event: BranchChangeEvent) => {
      // Chain onto the existing cycle so overlapping events serialize
      cycleChain = cycleChain
        .then(() => handleBranchChange(event, storage, decorationService!, updateStatusBar))
        .catch((err) => logWarn(`Critical error in branch change chain: ${String(err)}`));
    });
    context.subscriptions.push(branchChangeSubscription);

    log('GitRecall activated successfully.');
  } catch (error) {
    logWarn(`Unexpected error during activation: ${String(error)}`);
  }
}

/**
 * Executes the full branch-switch cycle: save → clean desk → restore → pulse.
 * Runs inside the concurrency lock so cycles never overlap.
 */
async function handleBranchChange(
  event: BranchChangeEvent,
  storage: StorageManager,
  decoration: DecorationService,
  updateStatusBar: (branch: string | undefined, hasSavedRecord: boolean) => void
): Promise<void> {
  try {
    const { repoRoot, previousBranch, currentBranch } = event;
    log(`Branch change detected: "${previousBranch ?? '(none)'}" → "${currentBranch ?? '(none)'}" in ${repoRoot}`);

    // On startup or initial folder open, previousBranch is undefined.
    // VS Code natively restores the user's workspace session. Skip Clean Desk and
    // restoration to eliminate startup lag and avoid disrupting the native tab order.
    if (!previousBranch) {
      log(`Initial branch detected: "${currentBranch ?? '(none)'}". Skipping startup restoration.`);
      if (currentBranch) {
        const hasSaved = storage.getBranchContext(repoRoot, currentBranch) !== undefined;
        updateStatusBar(currentBranch, hasSaved);
      } else {
        updateStatusBar(undefined, false);
      }
      return;
    }

    // ── Step A: Capture outgoing branch's tab state ──
    const capturedTabs = captureCurrentState(lastKnownActiveCursor);
    log(`Captured ${capturedTabs.length} tab(s) for outgoing branch "${previousBranch}".`);

      // Determine active tab URI and cursor coordinates
      let activeTabUri: string | null = null;
      try {
        const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
        if (activeTab?.input instanceof vscode.TabInputText) {
          activeTabUri = activeTab.input.uri.toString();
        } else if (!activeTabUri && lastKnownActiveCursor) {
          activeTabUri = lastKnownActiveCursor.uri;
        }
      } catch (err) {
        logWarn(`Could not determine active tab URI: ${String(err)}`);
      }

      let activeCursor: CursorPosition | null = null;
      try {
        // Prioritize lastKnownActiveCursor if it matches activeTabUri (via areUrisEqual).
        // When a branch change event fires, Git has already modified files on disk and VS Code
        // may have reloaded editors with shifted lines. lastKnownActiveCursor captures the user's
        // authentic cursor before the checkout.
        if (
          lastKnownActiveCursor &&
          (!activeTabUri || areUrisEqual(lastKnownActiveCursor.uri, activeTabUri))
        ) {
          activeCursor = {
            line: lastKnownActiveCursor.line,
            character: lastKnownActiveCursor.character
          };
          if (!activeTabUri) {
            activeTabUri = lastKnownActiveCursor.uri;
          }
        } else {
          const activeEditor = vscode.window.activeTextEditor;
          if (activeEditor && activeTabUri && areUrisEqual(activeEditor.document.uri.toString(), activeTabUri)) {
            activeCursor = {
              line: activeEditor.selection.active.line,
              character: activeEditor.selection.active.character
            };
          } else if (activeTabUri) {
            const matchingTab = capturedTabs.find((t) => areUrisEqual(t.uri, activeTabUri));
            if (matchingTab) {
              activeCursor = {
                line: matchingTab.cursor.line,
                character: matchingTab.cursor.character
              };
            }
          }
        }
      } catch (err) {
        logWarn(`Could not determine active cursor coordinates: ${String(err)}`);
      }

      const record: BranchContextRecord = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        repoRoot,
        branch: previousBranch,
        savedAt: new Date().toISOString(),
        activeTabUri,
        activeCursor,
        tabs: capturedTabs
      };

      // ── Step B: Persist ──
      try {
        await storage.saveBranchContext(repoRoot, previousBranch, record);
        log(`Saved context for branch "${previousBranch}".`);
      } catch (error) {
        if (error instanceof StoragePersistError) {
          logWarn(`Persistence failure for branch "${previousBranch}": ${error.message}`);
          // Single approved user-facing warning per docs/ARCHITECTURE.md §5
          vscode.window.showWarningMessage(
            `GitRecall: Failed to save editor context for branch "${previousBranch}". Your tabs and cursor positions for that branch may not be restored next time.`
          );
        } else {
          logWarn(`Unexpected save error for branch "${previousBranch}": ${String(error)}`);
        }
        // Continue — restoration of the incoming branch should still proceed
      }

    // ── Step C: Look up incoming branch's saved record ──
    if (!currentBranch) {
      log('No incoming branch (undefined). Skipping restoration.');
      await closeCleanTabs();
      updateStatusBar(currentBranch, false);
      return;
    }

    const incomingRecord = storage.getBranchContext(repoRoot, currentBranch);

    if (!incomingRecord) {
      log(`No saved record for incoming branch "${currentBranch}". Skipping restoration.`);
      await closeCleanTabs();
      updateStatusBar(currentBranch, false);
      return;
    }

    // ── Step D: Clean Desk with diff-based preservation ──
    // Preserve tabs that belong to the incoming branch.
    // Only close clean tabs that are NOT needed on the incoming branch.
    // This completely eliminates blank-screen flashing, redraw churn, and UI glitches.
    const incomingUris = incomingRecord.tabs.map((t) => t.uri);
    await closeCleanTabs(undefined, incomingUris);
    log('Clean Desk complete.');

    // ── Step E: Restore tabs + pulse ──
    log(`Restoring ${incomingRecord.tabs.length} tab(s) for branch "${currentBranch}".`);
    await restoreTabs(
      incomingRecord.tabs,
      (editor, line) => {
        decoration.pulseLine(editor, line);
      },
      incomingRecord.activeTabUri,
      incomingRecord.activeCursor
    );
    log(`Restoration complete for branch "${currentBranch}".`);

    // ── Step F: Update status bar ──
    updateStatusBar(currentBranch, true);
  } catch (error) {
    logWarn(`Unhandled error in branch-change cycle: ${String(error)}`);
    // Do not rethrow — the promise chain must never reject unhandled
  }
}

/**
 * Extension deactivation hook.
 * context.subscriptions handles disposal automatically, but we explicitly
 * dispose top-level references as a defense-in-depth measure.
 */
export function deactivate(): void {
  try {
    gitWatcher?.dispose();
    gitWatcher = undefined;
  } catch (error) {
    console.warn('[GitRecall] Error disposing GitWatcher during deactivation:', error);
  }

  try {
    decorationService?.dispose();
    decorationService = undefined;
  } catch (error) {
    console.warn('[GitRecall] Error disposing DecorationService during deactivation:', error);
  }

  try {
    outputChannel?.dispose();
    outputChannel = undefined;
  } catch (error) {
    console.warn('[GitRecall] Error disposing OutputChannel during deactivation:', error);
  }

  lastKnownActiveCursor = null;
}
