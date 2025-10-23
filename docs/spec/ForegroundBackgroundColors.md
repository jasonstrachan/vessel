# Foreground/Background Palette Spec

## Goal
Introduce globally available foreground and background colors so artists can quickly flip between two swatches from the color picker panel. The UI will expose overlapping foreground/background swatch controls to the left of the existing RGB sliders, and tools/brushes can read or mutate either color as needed.

## Current State
- `ColorPickerPanel` (`src/components/panels/ColorPickerPanel.tsx`) owns a single color value pulled from `tools.brushSettings` or `tools.eraserSettings`.
- The picker UI only exposes a single swatch (via `ColorPicker`) plus recent project colors (`ColorSwatches`).
- No shared store concept exists for a dual-color palette; `BrushSettings.color` is the de-facto foreground color and there is no background counterpart.
- Brushes that need multiple colors handle them ad-hoc (e.g., gradients) rather than via a consistent palette contract.

## Requirements
- **Dual swatches**: Display overlapping foreground/background squares, positioned immediately left of the RGB sliders. Clicking a swatch selects it (foreground or background) and gives it a distinct outline.
- **Toggle active color**: Clicking a swatch switches the active editing target; the ColorPicker and RGB sliders update whichever color is active.
- **Storage**: Foreground/background colors must live in `useAppStore`, scoped outside per-tool settings so all tools can access them.
- **Global access**: Brushes and tools can read both colors and optional metadata (e.g., which is active). Store actions expose setters and swapper helpers.
- **Tool integration**: Default behavior mirrors current single-color tools (foreground = active brush color). Background color defaults to white but can be changed. Some tools (fills, gradients, eraser) can opt-in to use background color.
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

`BrushSettings.color` remains for now but should mirror the palette foreground. When the active slot is `foreground`, color edits update both `palette.foregroundColor` and the active tool settings. When `background` is selected, updates only touch `palette.backgroundColor` unless the active tool explicitly opts-in.

## UI & Interaction
- **Layout**: Insert a `PaletteSwatches` sub-component above the RGB slider block, aligned flush left. It renders two 32×32 squares with slight overlap (foreground on top-right). Provide tailwind classes so they coexist with existing panel padding.
- **Active styling**: Selected swatch uses a 2px light outline and elevated box-shadow. Non-active swatch uses subdued outline. Optional diagonal divider to clarify stacking order.
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
  - Update `ColorSwatches` buttons to apply to whichever slot is active.

## Tool & Brush Integration
- **Default brush/eraser**: Continue to read from `tools.brushSettings.color`, but keep it in sync with palette foreground whenever the active slot is foreground. When background is edited, no immediate brush color update occurs unless tool opts-in.
- **Fill tools (shape fill, project background fill)**: Update to respect `palette.backgroundColor` as the secondary color option. Spec separate follow-up to let fill tools optionally use background by default.
- **Gradient/duotone brushes**: Provide helper `getPaletteColors()` returning `{ foreground, background, activeSlot }` so plugins can adopt background usage gracefully.
- **History/undo**: Palette changes must be part of the undo stack. Integrate into existing history actions (`setBrushSettings`, `setEraserSettings`) by using `immer` patterns or manual patch objects that include palette diffs.

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
   - Ensure brush/eraser settings remain in sync with palette.foreground when that slot is active.
   - Audit tools that read `brushSettings.color` and confirm they still behave correctly.
4. **Persistence & history**
   - Update project import/export, autosave, and undo history snapshots to include palette.
   - Add regression tests for store actions and serialization.
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
  - Swap active swatch and confirm ColorPicker reflects the selected color.
  - Use `X` shortcut to swap colors and verify both swatch visuals and store state.
  - Change brush, switch tools, and ensure foreground color remains consistent.
