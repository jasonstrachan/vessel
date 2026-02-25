# Hue/Sat Tool Spec

## Goal
Introduce a destructive-but-undoable Hue/Sat tool that lets artists tweak hue, saturation, lightness, and contrast on the active layer or the current selection directly from the existing brush controls column.

## Scope
- **In scope**
  - New toolbar entry (`color-adjust`, labeled “Hue/Sat”) and control panel UI.
  - Store slice for managing adjustment sessions, params, and history hooks.
  - Pixel processing pipeline using existing image processing helpers.
  - Live previews on layer or selection, with undo/redo integration.
  - Keyboard affordances (Enter to apply, Escape to cancel/reset to original).
  - Unit coverage for adjustment helper logic.
- **Out of scope**
  - Non-destructive adjustment layers.
  - Batch operations across multiple layers.
  - Mobile/touch-specific UI redesign.

## User Workflow
1. Select a layer (and optionally marquee a selection).
2. Activate the Hue/Sat tool from the left toolbar — right column swaps to Hue/Sat controls.
3. Adjust sliders; preview updates immediately by reapplying filters to a pristine snapshot.
4. `Apply` commits changes and records history for undo; `Reset` zeros sliders; `Cancel/Esc` restores original pixels and exits.

## UX Requirements
- Controls live where brush settings typically render (right-hand controls panel).
- Sliders with ranges:
  - Hue: −180° … +180°
  - Saturation: −100 … +100 (% delta applied via factor)
  - Lightness: −100 … +100 (relative offset)
  - Contrast: −100 … +100 (standard contrast curve)
  - Red: −100 … +100 (% channel delta)
  - Green: −100 … +100 (% channel delta)
  - Blue: −100 … +100 (% channel delta)
- Buttons: `Apply`, `Reset`, `Cancel`. Enter triggers `Apply`; Escape triggers `Cancel`.
- Disable sliders when there is no active layer or when selection bounds are empty.
- Show value readouts near each slider for precision (inline numeric label).

## Store & Data Model
- Extend `Tool` union with `'color-adjust'`.
- Add `colorAdjust` slice in `useAppStore`:
  ```ts
  interface ColorAdjustState {
    params: {
      hue: number;
      saturation: number;
      lightness: number;
      contrast: number;
      red: number;
      green: number;
      blue: number;
    };
    originalImageData: ImageData | null;
    selectionBounds: { x: number; y: number; width: number; height: number } | null;
    targetLayerId: string | null;
    active: boolean; // true after tool activation and snapshot taken
  }
  ```
- Actions:
  - `startColorAdjustSession()` — validate active layer, capture snapshot, mark `active`.
  - `updateColorAdjustParams(partial)` — merge and trigger preview render.
  - `applyColorAdjust()` — commit result, push history entry, clear snapshot, switch back to previous tool if desired.
  - `cancelColorAdjust()` — restore original pixels, clear snapshot, revert tool.
  - `resetColorAdjust()` — zero params and re-render from original.

## Rendering Pipeline
1. On session start, clone:
   - `layer.imageData` for full-layer adjustment **or**
   - selection sub-rect (copy + mask) if selection is active.
2. Each param change:
   - Recreate a working copy from `originalImageData`.
   - Run `adjustHueLightnessSaturation` with `hue`, `lightness`, `saturation`.
   - Run `adjustContrast` on the result.
   - Run `adjustRgbChannelOffsets` with `red/green/blue` deltas for channel-specific tweaks.
   - If selection-scoped, composite processed rect back into `layer.imageData` while preserving untouched pixels.
   - Dispatch `updateLayerImageData`/`commitLayerHistory` preview updates so canvas rerender triggers.
3. `apply` uses `commitLayerHistory` (or equivalent) before final draw to ensure undo.
4. `cancel` simply restores `originalImageData`.

## Keyboard & Tool Switching
- Hook into `useComprehensiveKeyboard`:
  - `Enter` → `applyColorAdjust`
  - `Escape` → `cancelColorAdjust`
- When tool changes away from `color-adjust`, auto-cancel if session active without apply.

## Testing & Validation
- New helper test (e.g., `src/utils/__tests__/colorAdjust.test.ts`) verifying combined HSL + contrast calculations respect alpha and avoid cumulative drift.
- Integration-ish test ensuring selection-only adjustments leave other pixels untouched.
- Commands: `npm run type-check`, `npm run lint`, `npm test`.

## Risks & Mitigations
- **Cumulative adjustments**: Always reapply filters from `originalImageData` snapshot to avoid compounding.
- **Large layers performance**: Processing may be heavy; consider throttling slider updates if needed.
- **Memory usage**: Snapshot heap copy could be large — ensure snapshot cleared after apply/cancel.

## Definition of Done
- Toolbar button (Hue/Sat) toggles tool and displays control panel.
- Adjustments preview correctly on active layer/selection with responsive sliders.
- Undo/redo restore previous state reliably.
- Keyboard shortcuts and cancel flows behave as specified.
- Tests updated/passing; lint/type-check clean.
