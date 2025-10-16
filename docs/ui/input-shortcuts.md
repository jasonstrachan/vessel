# Input Shortcuts & Undo Integration

| Shortcut | Action | Notes |
| --- | --- | --- |
| `Cmd ⌘ + Z` / `Ctrl + Z` | Undo | Routes through the centralized history manager. Brush, eraser, fill, and crop actions now use `commitLayerHistory`, so each stroke or crop restores cleanly without falling back to legacy snapshots. |
| `Cmd ⌘ + Shift + Z` / `Ctrl + Shift + Z` | Redo | Replays the latest history entry; large bitmap entries are capped by the new history guardrails to prevent multi-megabyte replays from freezing the UI. |

> **Tip:** For custom tooling, call `commitLayerHistory` (or begin a scoped transaction) rather than cloning canvases. This ensures keyboard shortcuts stay in sync with the new diff-based undo system.
