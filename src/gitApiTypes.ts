import * as vscode from 'vscode';

/**
 * Minimal ambient types for the vscode.git built-in extension.
 * Captures only the subset of the API surface required by GitRecall.
 */

export interface BranchHead {
  readonly name?: string;
  readonly commit?: string;
}

export interface RepositoryState {
  readonly HEAD: BranchHead | undefined;
  readonly onDidChange: vscode.Event<void>;
}

export interface Repository {
  readonly rootUri: vscode.Uri;
  readonly state: RepositoryState;
}

export interface GitAPI {
  readonly repositories: ReadonlyArray<Repository>;
  readonly onDidOpenRepository: vscode.Event<Repository>;
  readonly onDidCloseRepository: vscode.Event<Repository>;
}

export interface GitExtension {
  readonly enabled?: boolean;
  getAPI(version: 1): GitAPI;
}
