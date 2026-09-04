# Design.md — GitRecall Design Specification

## 1. UX Philosophy

GitRecall's design philosophy is **"invisible until useful."** The extension should behave like a background system service, not an application. Every design decision follows from one rule:

> **If the developer notices GitRecall is running, something has gone wrong.**

This means:
- No onboarding wizard, no welcome tab, no "GitRecall is now active!" toast.
- No confirmation dialogs during normal operation, ever.
- No modal interruptions to ask "restore these 5 tabs?" — restoration is automatic and trusted.
- The *only* acceptable UI surfaces are: (1) a passive status bar item, and (2) an ephemeral, low-opacity line highlight.
- Errors are logged to the extension's Output Channel, never surfaced as error toasts, unless data-loss risk is involved (see §5).

## 2. Developer Ergonomics Principles

1. **Zero configuration required.** GitRecall must be useful the moment it's installed, with no `settings.json` entries needed for baseline behavior.
2. **Reversible, non-destructive by default.** Every automated action (closing a tab, restoring a tab) must be an action the developer could trivially redo manually — nothing GitRecall does should be surprising or hard to undo.
3. **Respect manual state.** If a developer manually closed a tab that GitRecall would have restored, GitRecall does not fight them — restoration only happens on branch transition, not continuously.
4. **Predictable, not clever.** Restoration order, cursor placement, and pane assignment should map as literally as possible to what was saved — no heuristic reordering or "smart" reinterpretation.

## 3. Visual Specification — The Pulse Highlight

The only intentional, user-visible visual effect GitRecall produces is the **cursor-line pulse** applied when a file is restored.

### 3.1 Purpose
Give the developer a single, brief, glanceable cue: *"this is the line you were on before."* It replaces the mental effort of scanning a freshly opened file for context.

### 3.2 Visual Parameters

| Property | Value | Rationale |
|---|---|---|
| Decoration type | `vscode.window.createTextEditorDecorationType` (whole-line background) | Non-invasive; does not alter document content |
| Background color (light theme) | `rgba(56, 139, 253, 0.15)` | Soft accent blue at low alpha — visible without alarm |
| Background color (dark theme) | `rgba(56, 139, 253, 0.20)` | Slightly higher alpha to compensate for lower ambient contrast on dark backgrounds |
| `isWholeLine` | `true` | Highlights full line regardless of cursor column |
| Border | none | Avoids a "boxed" or error-like appearance |
| Duration | 1500ms | Long enough to register peripherally, short enough to never feel "stuck" |
| Fade behavior | Hard dispose at 1500ms via `setTimeout`, no CSS transition (VS Code decorations do not support animated opacity) | Simpler, deterministic; avoids flicker across editor redraws |
| Overlap with selection highlight | Decoration renders beneath selection/find-match layers | Never obscures active selection color |
| Theme color token | Uses a defined `ThemeColor` fallback (`editor.rangeHighlightBackground`) if the extension's custom color is overridden by a color-blind-friendly theme setting (future) | Respects user's accessibility overrides |

### 3.3 Implementation Notes
- Decoration is applied per-editor (`editor.setDecorations(decorationType, [range])`), not globally, so multiple restored editors in different split panes each pulse independently and simultaneously.
- The `setTimeout` handle is tracked and cleared if the editor is closed before 1500ms elapses (see `Rules.md` §Memory Management) to avoid calling `setDecorations` on a disposed editor.
- No decoration is applied to files reused via the "already open / dirty" path in `AppFlow.md` §4, unless explicitly desired for consistency (open design question — default: still pulse, since the goal is "here's where you were," regardless of tab origin).

## 4. Status Bar Item Specification

| Property | Value |
|---|---|
| Position | Left side, priority just right of the built-in Git branch indicator |
| Icon | `$(history)` (codicon) — evokes "context memory" |
| Text (has saved state) | `$(history) GitRecall: <branch-name>` |
| Text (no saved state yet for this branch) | `$(history) GitRecall: new` |
| Tooltip | `"GitRecall is tracking tabs & cursor position for '<branch-name>'"` |
| Click behavior | Opens the Output Channel (for transparency/debugging) — no destructive actions bound to click in v1 |
| Update trigger | Re-rendered on every resolved branch change (post-debounce), and once at activation |
| Visibility | Always visible when a Git repository is open in the workspace; hidden entirely in non-Git workspaces |

## 5. Exception to "No Popups" Rule

The zero-intrusion philosophy has exactly one carve-out: **irrecoverable persistence failures.** If `workspaceState.update()` throws (e.g., storage quota exceeded, corrupted state) such that GitRecall cannot guarantee it saved the outgoing branch's context, it MUST surface a single, non-blocking `vscode.window.showWarningMessage` informing the developer that context for that branch may not have been saved — because silent data-loss-adjacent failures violate the PRD's zero-data-loss success metric more than a single warning violates the "invisible" philosophy. This is the only situation where GitRecall is permitted to interrupt.

## 6. Non-Goals for Visual Design

- No custom tree view / sidebar panel in v1 — nothing to browse or manage. Presence should be feel-invisible, so no dedicated Activity Bar icon.
- No animated transitions for tab open/close beyond VS Code's native behavior.
- No custom notification sounds or non-visual cues.
- No theming/customization settings for the pulse color in v1 (may be reconsidered post-v1 based on accessibility feedback).
