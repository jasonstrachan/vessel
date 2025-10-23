# Foreground/Background Palette Spec

## Goal
Introduce globally available foreground and background colors so artists can quickly flip between two swatches from the color picker panel. The UI now presents a compact stacked pair of swatches beside the RGB sliders, and tools/brushes can read or mutate either color as needed.

## Current State
- `ColorPickerPanel` (`src/components/panels/ColorPickerPanel.tsx`) owns a single color value pulled from `tools.brushSettings` or `tools.eraserSettings`.
- The picker UI only exposes a single swatch (via `ColorPicker`) plus recent project colors (`ColorSwatches`).
- No shared store concept exists for a dual-color palette; `BrushSettings.color` is the de-facto foreground color and there is no background counterpart.
- Brushes that need multiple colors handle them ad-hoc (e.g., gradients) rather than via a consistent palette contract.

## Requirements
- **Dual swatches**: Display a stacked column of foreground (top) and background (bottom) squares positioned immediately left of the RGB sliders. Clicking a swatch selects it (foreground or background) and gives it a distinct outline.
- **Toggle active color**: Clicking a swatch switches the active editing target; the ColorPicker and RGB sliders update whichever color is active.
- **Storage**: Foreground/background colors must live in `useAppStore`, scoped outside per-tool settings so all tools can access them.
- **Global access**: Brushes and tools can read both colors and optional metadata (e.g., which is active). Store actions expose setters and swapper helpers.
- **Tool integration**: Palette edits no longer push changes directly into the active brush/eraser. Background defaults to white and can be changed at any time. Foreground color is applied to the active tool when a stroke begins, keeping slider drags responsive while still syncing paint output. Tools that need the background color (fills, gradients, etc.) can read it directly from the palette slice.
- **Persistence**: Palette colors persist with the project and autosave history.
- **Accessibility**: Swatch controls must be focusable, announce active state, and work with keyboard (Enter/Space to activate).

## Data Model Changes
Extend `useAppStore` (`src/stores/useAppStore.ts`) with a `palette` slice:
```ts
interface PaletteState {
  foregroundColor: string;     // hex w/ # prefix
  backgroundColor: string;     // hex or 'transparent'
  activeSlot: 'foreground' | 'background';
}
```

New actions:
- `setPaletteColor(slot: 'foreground' | 'background', color: string)`
- `swapPaletteColors()`
- `setActivePaletteSlot(slot: 'foreground' | 'background')`
- `syncPaletteFromTool(color: string, slot?: 'foreground' | 'background')` – helper used when tools change the working color.

Initialization:
- Foreground defaults to the existing brush color default.
- Background defaults to `#FFFFFF` (or the project background if non-transparent).
- Persist `palette` inside project serialization (`utils/projectIO`, history snapshots) so foreground/background survive reloads.

`BrushSettings.color` remains for now but is only refreshed when a new stroke begins and the foreground slot is active. Slider drags and swatch toggles mutate the palette slice exclusively; tools pull the latest palette value on demand (e.g., when `useDrawingHandlers` starts a stroke).

## UI & Interaction
- **Layout**: Insert a `PaletteSwatches` sub-component on the left edge of the RGB slider block. It renders a stacked pair of compact (8×8) buttons that align with the top slider track inside the same flex row.
- **Active styling**: Selected swatch draws a high-contrast outline (color chosen based on swatch brightness). Inactive swatches keep the neutral border.
- **Click behavior**:
  - Click foreground → `setActivePaletteSlot('foreground')`.
  - Click background → `setActivePaletteSlot('background')`.
  - Double-click background (future fast fill) is out of scope; reserve event but no-op for now.
- **Keyboard**:
  - Tab enters the swatch group; pressing `Space` or `Enter` on a swatch selects it.
  - `X` shortcut swaps colors (handled via `useComprehensiveKeyboard` integration).
  - `Shift+X` copies foreground to background (and vice versa once two-way copying is added).
- **ColorPicker wiring**:
  - `ColorPicker` and RGB sliders read/write the active slot.
  - When switching slots, controls rehydrate from the selected color.
  - Palette edits do not update brush/eraser state immediately; adoption happens when the user starts painting with that tool.
  - `ColorSwatches` buttons apply to whichever slot is active.

## Tool & Brush Integration
- **Default brush/eraser**: Continue to read from `tools.brushSettings.color`, but adopt `palette.foregroundColor` at the start of a stroke when the foreground swatch is active. Background edits never mutate tool colors unless a tool explicitly opts-in.
- **Fill tools (shape fill, project background fill)**: Update to respect `palette.backgroundColor` as the secondary color option. Spec separate follow-up to let fill tools optionally use background by default.
- **Gradient/duotone brushes**: Provide helper `getPaletteColors()` returning `{ foreground, background, activeSlot }` so plugins can adopt background usage gracefully.
- **History/undo**: Palette changes are intentionally excluded from the undo stack to keep the history signal focused on canvas edits.

## Migration & Compatibility
- Backward compatibility: Projects saved prior to this change default missing palette fields to existing defaults. Ensure `normalizeProject` assigns fallback values.
- Existing brush presets only store color strings; no migration required beyond ensuring palette foreground mirrors the preset when loading.
- Autosave and crash recovery include the palette slice automatically once wired into project serialization.

## Implementation Plan
1. **Store groundwork**
   - Add `palette` slice, actions, defaults, and project serialization support.
   - Update selectors/helpers so `ColorPickerPanel` can access `palette` without broad store subscriptions.
2. **Panel integration**
   - Introduce `PaletteSwatches` component (likely in `src/components/ui/`).
   - Refactor `ColorPickerPanel` to bind `ColorPicker`, RGB sliders, and `ColorSwatches` to the active palette slot.
   - Add keyboard handlers (`X`, `Shift+X`) via `useComprehensiveKeyboard`.
3. **Tool sync**
   - Update stroke start logic (`useDrawingHandlers`) so the active brush/eraser pulls from `palette.foregroundColor` on demand instead of every slider change.
   - Audit tools that read `brushSettings.color` and confirm they still behave correctly with deferred updates.
4. **Persistence & history**
   - Update project import/export and autosave flows to persist the palette slice.
   - Exclude palette-only edits from undo/redo to keep history lean.
5. **QA & docs**
   - Unit tests for palette reducer/helpers.
   - Manual pass to confirm UI behavior, keyboard shortcuts, and basePath-safe asset usage.
   - Update user-facing docs (right column controls guide) once implementation lands.

## Out of Scope / Follow-Ups
- Brush presets storing background color.
- Swatch history per slot.
- UI affordances for opacity-linked palettes or pattern fills.
- Applying palette colors to canvas background automatically.

## Validation
- Automated: `npm run type-check`, `npm run lint`, `npm test`.
- Manual:
  - Swap active swatch and confirm the ColorPicker reflects the selected color while the non-active tool color remains untouched.
  - Use `X` shortcut to swap colors and verify both swatch visuals and store state.
  - Start a stroke with the foreground swatch active and confirm the brush/eraser adopts the palette color at stroke onset.
