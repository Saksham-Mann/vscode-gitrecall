# Changelog

All notable changes to the **GitRecall** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.4] - 2026-10-15

### Added

- **Smart New-Branch Transition**: Preserves open tabs when checking out an unvisited branch, while automatically closing clean tabs for files that do not exist on the new branch to avoid crossed-out tabs.
- **Multi-Repository Scoping**: Tab capture, Clean Desk, and restoration are strictly isolated to the repository root where the checkout occurred.
- **Pinned Tab Persistence**: Restores pinned editor tab state when switching back to a branch.
- **Pre-Stat Host Boundary Hardening**: Pre-filters URIs to reject Windows UNC paths (`file://remote/share`), path traversals (`..`), and virtual schemes before querying filesystem stats.
- **Bijective Key Sanitization**: Prefix-free character escaping (`_` $\to$ `_u_`, `/` $\to$ `_s_`, control bytes $\to$ `_xNN_`) and `detached:<sha>` namespace eliminate cross-branch storage collisions.
- **DoS Protection**: Coordinates validated as integers and tab snapshots capped at `MAX_TABS_PER_BRANCH = 200`.
- **Status Bar UI Sanitization**: Escapes `$(...)` codicon sequences to prevent UI spoofing in the status bar.
- **Centralized Diagnostic Logger**: Centralized OutputChannel logging with control-character sanitization.

## [1.0.3] - 2026-09-05

### Changed

- Synchronized release documentation and marketplace badges to v1.0.3.

## [1.0.2] - 2026-09-05

### Changed

- Expanded and optimized keyword discovery matrix in extension metadata.
- Updated extension display name to reflect full tab, layout, and state restoration capabilities.

## [1.0.1] - 2026-09-05

### Changed

- Updated repository routing and marketplace metadata links.

## [1.0.0] - 2025-01-XX

### Added

- **Automatic tab save/restore per Git branch** — open editor tabs, split-pane layout (ViewColumn), tab order, and pinned states are captured when you switch away from a branch and restored when you return.
- **Cursor position memory** — the exact line and character position of each open file is saved per branch and restored on checkout, with a brief blue highlight pulse on the restored line.
- **Dirty-file safety** — files with unsaved changes are never closed during the Clean Desk phase of a branch switch. Your work-in-progress is always protected.
- **300ms trailing-edge debounce** — rapid successive branch changes (e.g., `git checkout` scripts) are collapsed into a single save/restore cycle using the final settled branch.
- **Schema-versioned storage** — all state is persisted to VS Code's `workspaceState` with a versioned key format (`gitrecall.v1.<hash>.<branch>`), enabling safe future migrations.
- **Branch index and stale entry pruning** — a per-repository index tracks all known branches; entries for deleted branches are pruned on each switch.
- **Status bar integration** — a `$(history)` status bar item shows the current branch and links to a dedicated GitRecall OutputChannel for diagnostics.
- **`GitRecall: Show Output` command** — opens the OutputChannel with timestamped lifecycle logs.
- **Zero configuration** — no settings, no keybindings, no commands required. Install the extension and it works immediately.
- **Fully local, no telemetry** — all data stays in VS Code's local workspace storage. No network calls, no analytics, no data leaves the machine.
