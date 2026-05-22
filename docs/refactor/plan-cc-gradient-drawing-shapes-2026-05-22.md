# CC Gradient Drawing Shapes Plan

## Goal

Add a drawing-shape selector to the Color Cycle Gradient brush so artists can choose the gesture/shape used to create the CC gradient mark.

The selector should live directly below the `Speed` slider in the CC Gradient brush controls and include:

- `Freehand` - current default freehand/stroke drawing behavior.
- `Rectangle`
- `Triangle`
- `Polygon`
- `Ellipse`
- `Line`

The feature should reuse the existing CC Gradient preview/finalize pipeline so finalized marks remain canonical color-cycle paint, preserve per-stroke speed, animate correctly, and survive undo/redo/save/export.

## Product Contract

`Drawing Shape` controls the geometry users draw. It should not replace the existing gradient source controls or the existing gradient fill/render controls.

- `Freehand`: drag a path; existing stroke/freehand behavior remains the default.
- `Rectangle`: drag from anchor to opposite corner; optional `Shift` creates square.
- `Ellipse`: drag from bounding box; optional `Shift` creates circle.
- `Line`: drag start to end; renders as a rectangular/swept CC mark using brush size as width.
- `Triangle`: drag bounding box or center/radius to create a triangle; optional rotation follows drag direction.
- `Polygon`: click/add vertices and finalize using the existing polygon completion affordance.

Gradient semantics stay separate:

- Manual / foreground / sampled source remains controlled by `CcGradientSourceModeControl`.
- Linear / stroke / concentric fill behavior remains a render/fill decision.
- Shape geometry should feed the same preview and `runColorCycleShapeFill(...)` finalization path wherever possible.

## UX Plan

### 1. Add Drawing Shape Button Group

In `src/components/toolbar/BrushControls.tsx`, add a compact `ButtonGroup` below the `Speed` slider when `currentBrushPresetId === 'color-cycle-gradient'`.

Suggested labels:

- `Free`
- `Rect`
- `Oval`
- `Line`
- `Tri`
- `Poly`

Use tooltips or accessible labels for full names if the existing `ButtonGroup` supports them. Keep the visible row compact enough for the brush settings panel.

### 2. Keep Existing Fill Mode Controls

Do not delete the existing `Grad / Stroke / Concentric` group until the implementation proves whether it should be renamed or moved.

Preferred hierarchy:

1. `Speed`
2. `Drawing Shape` group
3. Gradient source mode
4. Fill/render mode (`Grad / Stroke / Concentric`)
5. Existing dither, color, band, edge, source controls

If the UI feels crowded after implementation, move fill/render mode under an `Advanced`/secondary section as a follow-up, not in the first slice.

## State and Types

### 1. Add a Geometry Setting

Add a new brush setting in `src/types/index.ts`:

```ts
ccGradientDrawingShape?: 'freehand' | 'rectangle' | 'ellipse' | 'line' | 'triangle' | 'polygon';
```

Default:

```ts
ccGradientDrawingShape: 'freehand'
```

Add the default to `DEFAULT_BRUSH_SETTINGS` and the `color-cycle-gradient` preferred settings in `src/presets/brushPresets.ts`.

### 2. Persist Only for CC Gradient

Update `src/stores/slices/toolsSlice.ts` so `ccGradientDrawingShape` is saved/restored only for `color-cycle-gradient`, following the existing `colorCycleFillMode` pattern.

Guardrail:

- Switching away from CC Gradient must not leak `ccGradientDrawingShape` into unrelated brushes.
- Switching back to CC Gradient should restore the user's last selected drawing shape.
- Fresh sessions default to `freehand`.

## Geometry Architecture

Create focused geometry helpers under `src/hooks/canvas/handlers/shapes/` rather than adding inline geometry to orchestration files.

Suggested module:

- `src/hooks/canvas/handlers/shapes/ccGradientDrawingGeometry.ts`

Responsibilities:

- Convert each drawing shape to a polygon or swept polygon compatible with the existing CC shape preview/finalize path.
- Return a stable geometry payload:

```ts
interface CcGradientDrawingGeometry {
  shapePoints: Array<{ x: number; y: number }>;
  sampleSourcePoints?: Array<{ x: number; y: number }>;
  direction?: { x: number; y: number };
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}
```

Contract notes:

- `shapePoints` is the polygon passed to preview and finalize.
- `sampleSourcePoints` is the artist-intent sampling path for sampled gradients. It must stay separate from generated outline points.
- `direction` uses the existing normalized vector shape consumed by CC linear/stroke finalize paths, not endpoint coordinates.
- `bounds` should use the existing min/max convention from `ccStrokeShapeGeometry.ts` unless a downstream caller explicitly needs a derived rectangle.

Shape conversions:

- `freehand`: reuse existing stroke/freehand geometry, including raw pressure samples.
- `rectangle`: four corners from drag bounds.
- `ellipse`: approximate with a deterministic polygon, initially 48 points or fewer based on size.
- `line`: reuse swept-stroke geometry with two endpoints and the active brush size as width.
- `triangle`: generate 3 vertices from drag bounds/direction.
- `polygon`: use existing polygon vertices.

Line width:

- Use the active CC Gradient brush `Size` slider as the base line width.
- Implement `line` as a two-sample swept stroke and reuse `buildCcStrokeShapeGeometry(...)` so square caps, minimum width, and pressure behavior match freehand/stroke mode.
- When pressure is disabled, width is exactly the active brush size, clamped by the existing swept-stroke minimum.
- When pressure is enabled, resolve width from the existing pressure curve/range using the line samples' pressure. If the browser/device provides no meaningful pressure for a simple line drag, use the same fallback pressure as current stroke geometry rather than inventing a new line-specific width control.
- Do not add a separate line-width slider in V1. If users need independent line width later, add it as a follow-up only after the base shape selector is proven.

Sampling rule:

- For sampled gradients, prefer the artist's gesture source (`freehand` centerline, `line` axis, rectangle diagonal/axis, polygon vertices) over dense generated outline points when that better matches intent.
- Preview and finalize must consume the same geometry payload. Do not rebuild sampled source points from `shapePointsRef` in one path and from generated outline points in another path.

## Input Routing

Implement routing as a small CC Gradient drawing-shape layer, not as many new brush presets.

### Freehand

Use the existing CC Gradient stroke/freehand path. If current code names this mode `stroke`, treat `freehand` as the user-facing drawing shape that maps to the existing implementation.

### Rectangle / Ellipse / Line / Triangle

Use pointer-down, pointer-move preview, pointer-up finalize.

- Pointer down records anchor/start.
- Pointer move rebuilds preview geometry from the current drag.
- Pointer up finalizes if geometry is valid.
- `Escape`/cancel clears preview state without committing.

### Polygon

Reuse existing polygon point state only if it can be proven not to collide with the current polygon-gradient / contour-polygon workflows.

- Clicks add vertices.
- Existing double-click/Enter/close affordance should finalize.
- Cancel clears vertices and preview.

Ownership rule:

- Preferred: add a small CC Gradient polygon draft state or ref-owned draft payload namespaced to this drawing-shape feature.
- Acceptable: reuse `polygonGradientState` only behind an explicit mode discriminator and tests proving add-point, finalize, cancel, Escape, tool switch, and layer switch do not leak into existing polygon-gradient or contour modes.
- Do not overload `polygonGradientState.points` implicitly just because it is nearby.

Keep `pointerHandlersRuntime.ts`, `ShapeToolHandlerRuntime.ts`, and `shapeDrawing.ts` as routing/composition shells. Move new computation into helpers and add tests next to helpers.

## Preview and Finalize

Preview must use the existing CC shape preview/dither runtime:

- `src/hooks/canvas/handlers/shapes/ccShapePreviewDitherRuntime.ts`
- existing reduced/capped preview behavior
- existing pressure-linked fill resolution behavior where applicable

Finalize must use the existing CC shape fill path:

- `src/hooks/canvas/handlers/colorCycle/colorCycleShapeFill.ts`
- `runColorCycleShapeFill(...)`
- existing gradient-def/slot binding
- existing committed runtime/store sync

Do not introduce a smooth placeholder preview for dithered shapes.

Do not introduce a non-CC raster path for final output.

## Implementation Slices

Use these slices as the working implementation plan. Keep the checklist current if implementation starts from this document.

### Slice 1 - Types, Defaults, Toolbar

- [x] Add `ccGradientDrawingShape` to `BrushSettings` in `src/types/index.ts`.
- [x] Add `ccGradientDrawingShape: 'freehand'` to `DEFAULT_BRUSH_SETTINGS`.
- [x] Add `ccGradientDrawingShape: 'freehand'` to `colorCycleGradientBrushPreset.preferredSettings`.
- [x] Update `src/stores/slices/toolsSlice.ts` so `ccGradientDrawingShape` is saved/restored only for `color-cycle-gradient`, following the existing `colorCycleFillMode` persistence boundary.
- [x] Wire every tools persistence seam: `getSerializableBrushSettings`, `setBrushSettings` brush-specific save whitelist, `setBrushPreset` load/scrub behavior, `_saveCurrentBrushSettings`, and `loadBrushSettings`.
- [x] Scrub `ccGradientDrawingShape` from non-`color-cycle-gradient` brush settings in the same places `colorCycleFillMode` is scrubbed.
- [x] Add the `Drawing Shape` `ButtonGroup` below `Speed` in `src/components/toolbar/BrushControls.tsx`.
- [x] Keep the control hidden for non-CC-gradient brushes.
- [x] Add focused store/UI tests for defaulting, selection, and CC-only persistence.

Definition of done:

- UI shows the selector only for CC Gradient.
- Selecting each option persists for CC Gradient only.
- Existing `Speed`, source, and fill controls keep working.

### Slice 2 - Rectangle, Ellipse, Line, Triangle Geometry

- [x] Add `src/hooks/canvas/handlers/shapes/ccGradientDrawingGeometry.ts`.
- [x] Implement geometry builders for `rectangle`, `ellipse`, `line`, and `triangle`.
- [x] Keep geometry functions pure and deterministic.
- [x] Add bounds normalization so reverse drags produce the same shape orientation rules as forward drags where appropriate.
- [x] Add `Shift` constraints for square/circle where input routing already has access to modifier keys.
- [x] Add deterministic unit tests for each generated shape.
- [x] Reuse existing swept-stroke geometry for `line` width rather than duplicating width/pressure rules.
- [x] Return sample-source points separately from generated outline points for sampled gradients.

Definition of done:

- Geometry helpers pass unit tests without mounting canvas/UI.
- Generated shapes have stable point ordering, valid bounds, and no duplicate closing point unless a downstream API requires it.
- Existing freehand behavior is unchanged.

### Slice 3 - Drag Preview and Finalize Routing

- [x] Add a small CC Gradient drawing-shape routing helper under `src/hooks/canvas/handlers/shapes/`.
- [x] Route `rectangle`, `ellipse`, `line`, and `triangle` through pointer-down, pointer-move preview, pointer-up finalize.
- [x] Keep `pointerHandlersRuntime.ts`, `ShapeToolHandlerRuntime.ts`, and `shapeDrawing.ts` as routing/composition shells.
- [x] Feed preview geometry into `ccShapePreviewDitherRuntime.ts`.
- [x] Feed final geometry into `runColorCycleShapeFill(...)`.
- [x] Share one geometry snapshot between preview and finalize. The snapshot must carry `shapePoints`, `sampleSourcePoints`, and `direction`.
- [x] Add tests proving preview and finalize consume the same geometry snapshot for at least rectangle, line, and sampled mode.
- [x] Clear preview state on pointer cancel, Escape, layer/tool switch, and invalid geometry.

Definition of done:

- Each drag-defined shape previews through CC dither preview.
- Finalized output matches preview geometry.
- No shape uses a non-CC raster fallback.

### Slice 4 - Polygon Drawing Shape

- [x] Reuse or adapt existing polygon point state.
- [x] Decide and document the finalization gestures in code/tests: double-click, Enter, or close-to-start.
- [x] Ensure polygon preview/finalize uses the same CC geometry payload.
- [x] Add tests for polygon add-point, preview, finalize, and cancel routing.
- [x] Ensure polygon state does not conflict with rectangle, polygon-gradient, contour-polygon, or shape-fill brush state.
- [x] If `polygonGradientState` is reused, add an explicit mode discriminator and regression tests for existing polygon-gradient / contour-polygon workflows.

Definition of done:

- Polygon can be built vertex-by-vertex and committed as CC gradient paint.
- Cancel/reset paths leave no stale preview geometry.

### Slice 5 - Sampling and Pressure Parity

- [x] Confirm sampled gradients use intended gesture/sample points per shape.
- [x] Confirm pressure-linked fill resolution still works.
- [x] Confirm freehand pressure width behavior remains intact.
- [x] Confirm line width uses the same brush-size/pressure semantics as freehand where applicable.
- [x] Confirm per-stroke speed is captured from the current speed slider for all new shape marks.
- [x] Confirm saved/reloaded marks preserve speed, gradient def, and shape fill data.

Definition of done:

- Sampled source behaves predictably for all drawing shapes.
- No regressions to existing stroke/freehand CC Gradient pressure behavior.

### Slice 6 - Cleanup and Documentation

- [x] Remove any temporary diagnostics or debug flags added during implementation.
- [x] Update this checklist with completed items and any deliberate scope changes.
- [x] Add a short note to `docs/project.md` only if user-facing behavior or architecture boundaries changed enough to be durable project knowledge.
- [x] Keep unrelated refactors out of the patch.

Implementation note:

- `pointerHandlersRuntime.ts`, `ShapeToolHandlerRuntime.ts`, and `shapeDrawing.ts` were already above the repo-local hard-stop line budget before this feature. The implementation keeps new behavior mostly in `ccGradientDrawingGeometry.ts` and `ccGradientDrawingRuntime.ts`, with only narrow routing branches in the existing shells. Follow-up refactor: move the remaining CC shape pointer-up/finalize routing out of `pointerHandlersRuntime.ts` / `shapeDrawing.ts` into focused handler modules before adding more CC shape tools.

Definition of done:

- The implementation patch is focused on CC Gradient drawing shapes.
- The saved plan accurately reflects what landed.

## Review Plan

Run this review after implementation and before commit.

### 1. Scope Review

- [x] `git diff --stat` shows only expected files.
- [x] No unrelated formatting churn or broad rewrites.
- [x] Orchestration files stay within guardrails:
  - `src/hooks/useDrawingHandlers.ts`
  - `src/components/canvas/DrawingCanvas.tsx`
  - `src/hooks/canvas/useCanvasEventHandlers.ts`
  - `src/hooks/canvas/handlers/pointerHandlersRuntime.ts`
  - `src/hooks/canvas/handlers/shapes/ShapeToolHandlerRuntime.ts`
  - `src/hooks/canvas/handlers/shapes/shapeDrawing.ts`
- [x] New geometry/routing logic lives in focused helpers with targeted tests.

### 2. Architecture Review

- [x] `Drawing Shape` state is separate from gradient source and fill/render mode state.
- [x] `ccGradientDrawingShape` persists only for `color-cycle-gradient`.
- [x] Final output still goes through `runColorCycleShapeFill(...)`.
- [x] Preview still goes through `ccShapePreviewDitherRuntime.ts` when dither preview is expected.
- [x] Sampled gradients use gesture/source points, not dense generated outline points unless explicitly intended.
- [x] No new code mutates canonical CC runtime/store buffers outside the existing authorized commit path.

### 3. UI Review

- [x] The selector appears directly below `Speed` only for CC Gradient.
- [x] Button labels fit in the brush settings panel at normal and narrow widths.
- [x] Existing `Speed`, gradient source, dither, colors, bands, edge, and fill-mode controls are still reachable.
- [x] The visible `Shape` and `Fill` labels were removed by follow-up request; grouping now relies on row order and compact button labels.
- [x] The UI does not make `Freehand` drawing shape and `Stroke` fill mode look like the same setting.

### 4. Behavior Review

- [x] `Freehand` matches the pre-feature default behavior.
- [x] `Rectangle`, `Ellipse`, `Line`, and `Triangle` preview during drag and finalize on release.
- [x] `Polygon` supports add-point, preview, finalize, and cancel.
- [x] Reverse drags and tiny drags are handled without invalid geometry.
- [x] Escape/cancel/tool switch/layer switch clears transient state.
- [x] Undo/redo restores finalized marks.
- [x] Save/reload preserves finalized marks and selected drawing shape.

### 5. Regression Review

- [x] Existing `Grad`, `Stroke`, and `Concentric` fill modes still preview/finalize.
- [x] Manual, foreground, and sampled gradient sources still bind correctly.
- [x] Dither on/off behavior stays consistent with existing CC Gradient behavior.
- [x] Per-stroke speed from the `Speed` slider is preserved for every drawing shape.
- [x] Goblet/export behavior remains in sync with runtime playback if export-related code is touched.

### 6. Verification Review

- [x] `npm run type-check`
- [x] `npm run lint`
- [x] Focused tests for toolbar, tools slice, geometry, and pointer/shape routing.
- [x] Broader CC shape/fill tests if preview/finalize/runtime code changed.
- [x] Manual browser sanity covers every drawing shape with dither enabled.
- [x] Manual browser sanity covers sampled gradient source for at least freehand, rectangle, line, and polygon.
- [x] Any failed verification is either fixed or recorded as a blocker before commit.

## Tests

Add or update tests around:

- `BrushControls` shows `Drawing Shape` group only for `color-cycle-gradient`.
- `toolsSlice` persists `ccGradientDrawingShape` only for CC Gradient.
- Geometry helper output for rectangle, ellipse, line, triangle, and polygon.
- Pointer routing for drag-defined shapes.
- Preview/finalize use the same geometry snapshot.
- Existing `Grad`, `Stroke`, and `Concentric` fill modes still work.

## Verification

Minimum commands:

- `npm run type-check`
- `npm run lint`
- focused Jest tests for toolbar, tools slice, geometry, pointer/shape routing
- broader CC shape/fill tests if `colorCycleShapeFill.ts` or preview runtime changes

Manual browser sanity:

1. Select a color-cycle layer.
2. Select CC Gradient.
3. Confirm the default drawing shape is `Freehand`.
4. Draw each shape with dither enabled; preview should be dithered.
5. Release/finalize; output should animate as CC paint.
6. Repeat with sampled gradient source.
7. Switch away from CC Gradient and back; selected drawing shape should restore.
8. Save/reload or use undo/redo on finalized marks to confirm canonical data survives.

## Risks

- UI ambiguity if `Freehand` and existing `Stroke` fill mode both appear. Mitigate by clearly separating `Drawing Shape` from fill/render mode and consider renaming `Stroke` fill mode in a later polish pass if needed.
- Preview/finalize mismatch if shape geometry is rebuilt independently in two places. Mitigate by sharing one geometry payload snapshot.
- Polygon routing can collide with existing polygon-gradient state. Reuse existing seams deliberately and test cancel/finalize.
- Sampled gradients can look wrong if dense generated outline points are used as samples. Prefer gesture source points per shape.
- CC persistence/export bugs are high-cost. Keep all final output on the existing CC shape fill commit path.

## Definition of Done

- The CC Gradient brush has a `Drawing Shape` button group below `Speed`.
- `Freehand`, `Rectangle`, `Ellipse`, `Line`, `Triangle`, and `Polygon` are selectable.
- Freehand preserves current default behavior.
- Drag-defined shapes preview through the same dithered CC shape preview path.
- Polygon uses a vertex workflow and finalizes as CC gradient paint.
- Final output is canonical CC paint with per-stroke speed, undo/redo, save/load, and export behavior intact.
- Existing CC Gradient fill/source controls and existing `Grad / Stroke / Concentric` behavior do not regress.
