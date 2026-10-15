<div align="center">

  <img src="assets/icon.png" width="128" height="128" alt="GitRecall Logo" style="border-radius: 24px;" />

  # GitRecall

  **Your tabs remember which branch they belong to.**

  <p align="center">
    <a href="https://marketplace.visualstudio.com/items?itemName=Saksham-Mann.gitrecall">
      <img src="https://img.shields.io/badge/Marketplace-v1.0.4-2563eb?style=for-the-badge&logo=visualstudiocode&logoColor=white&labelColor=161b22" alt="Marketplace Version" />
    </a>
    <a href="https://open-vsx.org/extension/Saksham-Mann/gitrecall">
      <img src="https://img.shields.io/badge/Open%20VSX-v1.0.4-be185d?style=for-the-badge&logo=eclipseide&logoColor=white&labelColor=161b22" alt="Open VSX Version" />
    </a>
    <a href="https://github.com/Saksham-Mann/vscode-gitrecall">
      <img src="https://img.shields.io/badge/GitHub-Repository-181717?style=for-the-badge&logo=github&logoColor=white&labelColor=161b22" alt="GitHub Repository" />
    </a>
    <a href="src/test">
      <img src="https://img.shields.io/badge/Tests-61%20Passed-238636?style=for-the-badge&logo=mocha&logoColor=white&labelColor=161b22" alt="Test Suite" />
    </a>
    <a href="LICENSE">
      <img src="https://img.shields.io/badge/License-MIT-d29922?style=for-the-badge&logo=opensourceinitiative&logoColor=white&labelColor=161b22" alt="License" />
    </a>
  </p>

  <p align="center">
    <a href="https://github.com/Saksham-Mann/vscode-gitrecall">Repository</a>
    &middot;
    <a href="https://github.com/Saksham-Mann/vscode-gitrecall/issues">Issue Tracker</a>
    &middot;
    <a href="https://marketplace.visualstudio.com/items?itemName=Saksham-Mann.gitrecall">VS Code Marketplace</a>
    &middot;
    <a href="https://open-vsx.org/extension/Saksham-Mann/gitrecall">Open VSX</a>
  </p>

  <p align="center">
    Stop losing editor context when reviewing PRs or switching tasks. GitRecall restores exact files, multi-column panes, and cursor lines whenever switching Git branches.
  </p>

</div>

---

![GitRecall Demo](assets/gitRecall.gif)

## Why GitRecall?

Switching branches should not erase context. Switching to main to hotfix a bug or review a pull request often leaves the editor cluttered with files from a previous feature branch or forces a manual search for previous work.

GitRecall isolates state per branch. Checking out a branch immediately restores workspace state to its previous configuration.

### Cross-IDE Compatibility
Compatible across VS Code and all Code-OSS derivative environments, web editors, and developer platforms supporting standard extension protocols (via Open VSX or VSIX).

---

## What's New in v1.0.4

- **Smart New-Branch Transitions**: Switching to a branch with no saved snapshot preserves open tabs, while automatically detecting and closing clean tabs for files that do not exist on the target branch (eliminating crossed-out dead tabs).
- **Multi-Repository Scoping**: Tab capture, Clean Desk, and restoration cycles are strictly scoped to the repository root where the checkout occurred, preventing cross-repo tab closure in multi-repository workspaces.
- **Pinned Tab Restoration**: Pinned editor tabs are persisted and restored with their pinned status intact across branch checkouts.
- **Pre-Stat Host Boundary Hardening**: All URIs are strictly validated before `workspace.fs.stat()` is called, blocking Windows UNC remote paths (`file://remote/share`), path traversals (`..`), and virtual schemes to ensure security.
- **Collision-Proof Storage & Detached HEAD**: Strictly bijective, prefix-free key sanitization (`_u_`, `_s_`, `_xNN_`) and `detached:<sha>` namespaces prevent cross-branch context collision.
- **Codicon & Status Bar Sanitization**: Status bar displays escape `$(...)` codicon tokens and strip control characters to prevent UI spoofing.

---

## Features

| Feature | Description |
|---|---|
| Automatic Branch Memory | Open tabs, pinned files, and layout groups are tracked and restored per branch. |
| Cursor and Line Precision | Restores exact cursor position and active line with a subtle highlight pulse. |
| Split-Pane Layouts | Retains multi-column layout (ViewColumn) precisely as arranged. |
| Pinned Tab Persistence | Preserves pinned state across branch switches. |
| Smart Clean Desk | Closes clean tabs that don't belong to the target branch while protecting unsaved files. |
| Dead Tab Cleanup | Automatically closes tabs for files deleted or absent in newly checked-out branches. |
| Multi-Repo Scoping | Safely handles multiple Git repositories in a workspace without cross-repo interference. |
| Zero Configuration | Operates immediately with no custom configuration or keybindings required. |
| Local-First and Private | State is isolated inside local workspace storage. No network requests, zero telemetry. |

---

## How It Works

```text
git checkout feature-login
         │
         ▼
[ Git HEAD Event ] ──► [ Debounce (300ms) ]
                               │
                               ▼
        ┌──────────────────────────────────────────────┐
        │  1. Save current tabs & cursors to branch A  │
        │  2. Close clean tabs (dirty tabs stay safe)  │
        │  3. Reopen & place layout for branch B       │
        └──────────────────────────────────────────────┘
```

1. **Detection:** Intercepts HEAD change events via the built-in Git extension using a 300ms debounce to ignore rapid rebase and checkout operations.
2. **Snapshot:** Caches open tab paths, active split groups, pinned tabs, and cursor offsets scoped to the active repository root in local workspace storage.
3. **Clean Slate:** Closes clean buffers not needed on the incoming branch while leaving unsaved files intact.
4. **Context Recovery:** Reconstructs the target branch layout, moves cursors to saved coordinates, and highlights the active line.

---

## Installation

### Via Extensions View
1. Open the Extensions sidebar (`Ctrl+Shift+X` / `Cmd+Shift+X`) in your IDE.
2. Search for `GitRecall`.
3. Select **Install**.

### Via Command Line
```bash
# Visual Studio Code / Compatible Editors
code --install-extension Saksham-Mann.gitrecall
```

### Via VSIX Package
Download the latest `gitrecall-1.0.4.vsix` release and install it with:
```bash
code --install-extension gitrecall-1.0.4.vsix
```

---

## Requirements

- VS Code or compatible editor (`^1.85.0`)
- Built-in Git extension active with an initialized Git workspace

---

## Privacy and Storage

GitRecall operates under local-first execution:
- State is stored directly within workspace storage (`context.workspaceState`).
- No external cloud dependencies or background sync processes.
- No analytics, telemetry, or remote logging.

---

## Known Scope and Behavior

| Context | Handling |
|---|---|
| Repository scoping | Tab capture, Clean Desk, and restoration are strictly isolated to the repository where the branch switch occurred. |
| Local storage scope | Branch state remains local to the active machine and is not synchronized via Settings Sync. |
| Text editors | Operates on standard text documents. System webviews (diffs, markdown previews, settings) are omitted from capture. |

---

## Feedback and Contributions

- Report issues or request features via the [GitHub Issue Tracker](https://github.com/Saksham-Mann/vscode-gitrecall/issues).
- Feedback and stars on the [GitHub Repository](https://github.com/Saksham-Mann/vscode-gitrecall) or reviews on the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=Saksham-Mann.gitrecall) assist project maintenance.

---

## License

[MIT](LICENSE) (c) Saksham Mann
