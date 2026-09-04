import * as vscode from 'vscode';
import { GitExtension, Repository } from './gitApiTypes';

/**
 * Event fired when an active Git repository transitions to a different branch or commit.
 */
export interface BranchChangeEvent {
  /** The filesystem path of the repository root where the change occurred. */
  repoRoot: string;
  /** The branch name before the transition, or undefined if previously detached/uninitialized. */
  previousBranch: string | undefined;
  /** The newly checked-out branch name, or a synthetic detached HEAD key (`detached__<sha>`). */
  currentBranch: string | undefined;
}

/**
 * Normalizes repository filesystem path for consistent internal map lookups.
 */
export function normalizeRepoPath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Watches Git branch state transitions using the built-in vscode.git extension.
 * Encapsulates repository discovery, HEAD change diffing, and trailing-edge debounce.
 */
export class GitWatcher implements vscode.Disposable {
  private readonly _onBranchChanged = new vscode.EventEmitter<BranchChangeEvent>();
  public readonly onBranchChanged: vscode.Event<BranchChangeEvent> = this._onBranchChanged.event;

  private isActivated = false;
  private isDisposed = false;

  private readonly disposables: vscode.Disposable[] = [];
  private readonly repositorySubscriptions = new Map<string, vscode.Disposable>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly lastKnownBranches = new Map<string, string | undefined>();
  private readonly lastObservedBranches = new Map<string, string | undefined>();
  private readonly pendingTransitions = new Map<string, { previousBranch: string | undefined }>();

  /**
   * Safely acquires the vscode.git extension and initializes repository event listeners.
   * Resolves false if vscode.git is not available or activation fails.
   */
  async activate(): Promise<boolean> {
    if (this.isActivated) {
      return true;
    }

    try {
      const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
      if (!gitExtension) {
        console.warn('[GitRecall] Built-in Git extension (vscode.git) not found or disabled.');
        return false;
      }

      if (!gitExtension.isActive) {
        await gitExtension.activate();
      }

      const gitApi = gitExtension.exports?.getAPI(1);
      if (!gitApi) {
        console.warn('[GitRecall] Failed to obtain Git API (version 1) from vscode.git.');
        return false;
      }

      // Listen for newly opened repositories
      this.disposables.push(
        gitApi.onDidOpenRepository((repository: Repository) => {
          try {
            this.setupRepository(repository);
          } catch (error) {
            console.warn('[GitRecall] Error handling opened repository:', error);
          }
        })
      );

      // Listen for closed repositories to prevent memory leaks
      this.disposables.push(
        gitApi.onDidCloseRepository((repository: Repository) => {
          try {
            this.teardownRepository(repository);
          } catch (error) {
            console.warn('[GitRecall] Error handling closed repository:', error);
          }
        })
      );

      // Subscribe to all currently detected repositories
      for (const repository of gitApi.repositories) {
        try {
          this.setupRepository(repository);
        } catch (error) {
          console.warn('[GitRecall] Error setting up initial repository:', error);
        }
      }

      this.isActivated = true;
      return true;
    } catch (error) {
      console.warn('[GitRecall] Exception occurred during GitWatcher activation:', error);
      return false;
    }
  }

  /**
   * Synchronously returns the last known branch for a given repository root.
   */
  getCurrentBranch(repoRoot: string): string | undefined {
    const normalizedKey = normalizeRepoPath(repoRoot);
    return this.lastKnownBranches.get(normalizedKey);
  }

  /**
   * Disposes all listeners, cancels pending debounce timers, and cleans up resources.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;

    // Clear all pending debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Dispose all per-repository subscriptions
    for (const sub of this.repositorySubscriptions.values()) {
      sub.dispose();
    }
    this.repositorySubscriptions.clear();

    // Dispose top-level API subscriptions
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;

    // Clear memory tracking structures
    this.pendingTransitions.clear();
    this.lastKnownBranches.clear();
    this.lastObservedBranches.clear();

    // Dispose event emitter
    this._onBranchChanged.dispose();
  }

  /**
   * Resolves the current branch name or synthetic detached-HEAD key for a repository.
   */
  private resolveBranch(repository: Repository): string | undefined {
    const head = repository.state?.HEAD;
    if (!head) {
      return undefined;
    }

    if (head.name) {
      return head.name;
    }

    if (head.commit) {
      return `detached__${head.commit.slice(0, 7)}`;
    }

    return undefined;
  }

  /**
   * Registers state listeners for a specific repository.
   */
  private setupRepository(repository: Repository): void {
    const repoRoot = repository.rootUri.fsPath;
    const normalizedKey = normalizeRepoPath(repoRoot);

    if (this.repositorySubscriptions.has(normalizedKey)) {
      this.teardownRepository(repository);
    }

    const initialBranch = this.resolveBranch(repository);
    this.lastKnownBranches.set(normalizedKey, initialBranch);
    this.lastObservedBranches.set(normalizedKey, initialBranch);

    const subscription = repository.state.onDidChange(() => {
      try {
        this.handleRepositoryStateChange(repository);
      } catch (error) {
        console.warn(`[GitRecall] Error in state.onDidChange for "${repoRoot}":`, error);
      }
    });

    this.repositorySubscriptions.set(normalizedKey, subscription);
  }

  /**
   * Unregisters listeners and clears tracking data for a closed repository.
   */
  private teardownRepository(repository: Repository): void {
    const repoRoot = repository.rootUri.fsPath;
    const normalizedKey = normalizeRepoPath(repoRoot);

    const subscription = this.repositorySubscriptions.get(normalizedKey);
    if (subscription) {
      subscription.dispose();
      this.repositorySubscriptions.delete(normalizedKey);
    }

    const timer = this.debounceTimers.get(normalizedKey);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(normalizedKey);
    }

    this.pendingTransitions.delete(normalizedKey);
    this.lastKnownBranches.delete(normalizedKey);
    this.lastObservedBranches.delete(normalizedKey);
  }

  /**
   * Handles repository state mutations, filtering out non-branch changes and debouncing rapid checkouts.
   */
  private handleRepositoryStateChange(repository: Repository): void {
    const repoRoot = repository.rootUri.fsPath;
    const normalizedKey = normalizeRepoPath(repoRoot);
    const currentBranch = this.resolveBranch(repository);
    const lastObserved = this.lastObservedBranches.get(normalizedKey);

    // Filter out mutations that did not change the branch (e.g. stage, commit, fetch)
    if (currentBranch === lastObserved) {
      return;
    }

    // Branch changed: update observed branch
    this.lastObservedBranches.set(normalizedKey, currentBranch);

    // Reset trailing-edge timer
    const existingTimer = this.debounceTimers.get(normalizedKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Preserve the original previousBranch before the start of this debounce cycle
    if (!this.pendingTransitions.has(normalizedKey)) {
      this.pendingTransitions.set(normalizedKey, {
        previousBranch: this.lastKnownBranches.get(normalizedKey)
      });
    }

    const timer = setTimeout(() => {
      this.handleDebounceElapsed(repository);
    }, 300);

    this.debounceTimers.set(normalizedKey, timer);
  }

  /**
   * Invoked when the 300ms trailing-edge debounce window elapses for a repository.
   */
  private handleDebounceElapsed(repository: Repository): void {
    try {
      const repoRoot = repository.rootUri.fsPath;
      const normalizedKey = normalizeRepoPath(repoRoot);

      this.debounceTimers.delete(normalizedKey);

      const pending = this.pendingTransitions.get(normalizedKey);
      this.pendingTransitions.delete(normalizedKey);

      const previousBranch = pending ? pending.previousBranch : this.lastKnownBranches.get(normalizedKey);
      const finalBranch = this.resolveBranch(repository);

      // Update settled states
      this.lastKnownBranches.set(normalizedKey, finalBranch);
      this.lastObservedBranches.set(normalizedKey, finalBranch);

      // Only emit if the settled branch actually differs from the previous branch
      if (finalBranch !== previousBranch) {
        this._onBranchChanged.fire({
          repoRoot,
          previousBranch,
          currentBranch: finalBranch
        });
      }
    } catch (error) {
      console.warn('[GitRecall] Error processing debounced branch change:', error);
    }
  }
}
