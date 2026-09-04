<div align="center">

  <img src="assets/icon.png" width="128" height="128" alt="GitRecall Logo" style="border-radius: 24px;" />

  # GitRecall

  **Your tabs remember which branch they belong to.**

  <p align="center">
    <a href="https://marketplace.visualstudio.com/items?itemName=Saksham-Mann.gitrecall">
      <img src="https://img.shields.io/badge/Marketplace-v1.0.1-2563eb?style=for-the-badge&logo=visualstudiocode&logoColor=white&labelColor=161b22" alt="Marketplace Version" />
    </a>
    <a href="https://github.com/Saksham-Mann/vscode-gitrecall">
      <img src="https://img.shields.io/badge/GitHub-Repository-181717?style=for-the-badge&logo=github&logoColor=white&labelColor=161b22" alt="GitHub Repository" />
    </a>
    <a href="https://github.com/Saksham-Mann/vscode-gitrecall/issues">
      <img src="https://img.shields.io/badge/Issues-Tracker-161b22?style=for-the-badge&logo=github&logoColor=white&labelColor=161b22" alt="Issue Tracker" />
    </a>
    <a href="src/test">
      <img src="https://img.shields.io/badge/Tests-57%20Passed-238636?style=for-the-badge&logo=mocha&logoColor=white&labelColor=161b22" alt="Test Suite" />
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
    <a href="https://marketplace.visualstudio.com/items?itemName=Saksham-Mann.gitrecall">Marketplace</a>
  </p>

  <p align="center">
    Automatic, ephemeral workspace state and cursor restoration across Git branch switches. Zero dependencies. Zero cloud sync.
  </p>

</div>

---

![GitRecall Demo](assets/gitRecall.gif)

## Features

| Feature | Description |
|---|---|
| **Automatic Tab Restore** | Tabs reopen in their original editor groups when returning to a branch. |
| **Cursor Position Memory** | Line and column positions are saved per file and per branch. Restores exact position with a brief highlight pulse. |
| **Split-Pane Layout** | Preserves editor columns (ViewColumn). Files reopen in the pane where they were left. |
| **Zero Configuration** | Works out of the box with no settings, keybindings, or setup commands required. |
| **Dirty-File Safety** | Files with unsaved edits are never closed on branch switch. |
| **Fully Local** | All state is stored in VS Code's local workspace storage. Zero network requests, zero telemetry. |

## How It Works

1. **Branch Switch**: GitRecall listens to HEAD changes from VS Code's built-in Git extension, using a 300ms trailing-edge debounce to handle rapid checkouts.
2. **Save**: Captures open tabs, active editor groups, pinned states, and cursor positions for the outgoing branch into local workspace storage.
3. **Clean Desk**: Closes clean tabs to prepare the editor for the target branch. Dirty buffers with unsaved changes are always kept open.
4. **Restore**: Reopens the target branch's tabs in their original layout, places cursors, and applies a brief line highlight.

## Installation

Install through VS Code:
1. Open the **Extensions** view (`Ctrl+Shift+X` / `Cmd+Shift+X`).
2. Search for **GitRecall**.
3. Click **Install**.

Or via command line:

```bash
code --install-extension Saksham-Mann.gitrecall
```

## Requirements

- VS Code `^1.85.0`
- Built-in Git extension enabled in a workspace with an initialized Git repository

## Privacy

GitRecall stores state strictly in VS Code's local workspace storage (`context.workspaceState`). It makes no network requests and collects no telemetry.

## Known Limitations

| Limitation | Details |
|---|---|
| **Single-root workspaces** | Tracks the active repository in single-root workspaces. Multi-root support is planned for a future release. |
| **Local storage only** | State is saved in local workspace storage and does not sync across machines via Settings Sync. |
| **Text editors only** | Non-text tabs (diff viewers, webviews, settings UI) are skipped during capture and restore. |

## Feedback and Support

To report bugs, request features, or view the source code, visit the [GitHub repository](https://github.com/Saksham-Mann/vscode-gitrecall).

If GitRecall improves your workflow, please consider leaving a review on the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=Saksham-Mann.gitrecall) and starring the project on [GitHub](https://github.com/Saksham-Mann/vscode-gitrecall). Ongoing feedback helps guide future improvements.

## License

[MIT](LICENSE)
