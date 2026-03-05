# Input Shortcuts

Primary source of truth: `src/hooks/keyboard/shortcutRegistry.ts`.

| Shortcut | Action | Scope |
| --- | --- | --- |
| `Cmd/Ctrl + Z` | Undo | Global |
| `Cmd/Ctrl + Shift + Z` or `Cmd/Ctrl + Y` | Redo | Global |
| `Cmd/Ctrl + S` | Save project | Global |
| `Cmd/Ctrl + O` | Open project | Global |
| `Cmd/Ctrl + C` | Copy selection | Global |
| `Cmd/Ctrl + X` | Cut selection | Global |
| `Cmd/Ctrl + A` | Select all on active layer | Canvas/global shortcut scope |
| `X` | Swap foreground/background palette colors | Canvas/global shortcut scope |
| `Shift + X` | Copy foreground color to background | Canvas/global shortcut scope |
| `B` | Switch to Brush | Canvas/global shortcut scope |
| `E` (hold/tap) | Temporary or persistent Eraser | Canvas/global shortcut scope |
| `F` | Switch to Fill | Canvas/global shortcut scope |
| `W` | Switch to Magic Wand | Canvas/global shortcut scope |
| `M` | Switch to Selection | Canvas/global shortcut scope |
| `U` | Switch to Color Adjust (hue/saturation/lightness/contrast) | Canvas/global shortcut scope |
| `C` | Switch to Custom brush tool | Canvas/global shortcut scope |
| `P` (hold) | Temporary Color Picker | Canvas/global shortcut scope |
| `[` / `]` | Brush size down/up | Canvas/global shortcut scope (also allowed in focused numeric inputs) |
| `Space` (hold) | Pan mode | Canvas/global shortcut scope |
| `Delete` / `Backspace` | Delete active selection or clear floating paste | Canvas/global shortcut scope |
| `Enter` / `Numpad Enter` | Commit context action (e.g. floating paste) | Canvas/global shortcut scope |
| `Escape` | Cancel context action | Canvas/global shortcut scope |
| `Enter` (polygon modes) | Complete polygon/contour shape | Polygon/contour drawing mode |
| `Escape` (polygon modes) | Cancel polygon/contour shape | Polygon/contour drawing mode |

Notes:
- Recolor panel-local shortcuts were removed; recolor now relies on shared/global shortcuts and explicit UI controls.
- Browser/OS reserved combos (e.g. `Cmd/Ctrl + L`, `Cmd/Ctrl + R`, `Cmd/Ctrl + W`) are not guaranteed overridable.
