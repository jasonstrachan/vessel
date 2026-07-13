# CC Gradient Click Line Drawing Mode Plan

Last updated: 2026-07-13

Status: implemented

## Goal

Add a Color Cycle Gradient drawing shape named `Click Line`: click to place each
boundary vertex, preview the filled CC Gradient shape as the cursor moves, and
finalize the enclosed fill with double-click or Enter. Escape cancels the
in-progress session.

This is a click-defined fill boundary mode. It must not widen the clicked line
path into a stroked tube.

## Product Contract

- Available only for the `color-cycle-gradient` preset in the existing CC
  Gradient drawing shape control.
- UI label: `Click Line`.
- Stored value: `'click-line'`.
- First click starts a transient click-line session and commits the first
  boundary point.
- Later ordinary clicks append committed boundary points.
- Pointer move previews the next segment from the last committed point to the
  cursor without committing it.
- Shift while clicking or previewing snaps the next point to 45 degree
  increments from the previous committed point, matching existing line snapping.
- Double-click finalizes only after at least three committed points can produce
  valid fill geometry.
- Enter finalizes the active session after at least three committed points can
  produce valid fill geometry.
- Escape cancels the session and clears preview state.
- The finalized mark must use the existing CC shape finalize path so manual, FG,
  and sampled gradient sources, animation, history, undo/redo, save/load, and
  Goblet export remain on the current CC shape contract.
- Multi-color linear Click Line completion enters the same explicit direction
  stage whether completion comes from double-click or Enter.
- Pointer events collect vertices only. Completion uses the native `dblclick`
  event because `PointerEvent.detail` is not a browser click-count signal.
- Palette binding completes before the shape stroke begins so one finalized
  mark produces one document publication and one history boundary.

## Architecture Decision

Implement `Click Line` as a new `ccGradientDrawingShape` variant, not as a new
top-level tool or preset.

Reasons:

- `src/components/toolbar/BrushControls.tsx` already exposes CC Gradient drawing
  shapes through `tools.brushSettings.ccGradientDrawingShape`.
- `src/hooks/canvas/handlers/shapes/ccGradientDrawingGeometry.ts` already owns
  CC Gradient geometry conversion.
- `src/hooks/canvas/handlers/shapes/ccGradientDrawingRuntime.ts` already owns CC
  Gradient shape mode predicates and geometry rebuild helpers.
- Selection already has `click-line` interaction vocabulary, but its session and
  keyboard handling must remain separate.

## Implementation Plan

### 1. Extend the public shape value and UI

- Add `'click-line'` to `BrushSettings['ccGradientDrawingShape']` in
  `src/types/index.ts`.
- Add `{ label: 'Click Line', value: 'click-line' }` to the CC Gradient drawing
  shape `ButtonGroup` in `src/components/toolbar/BrushControls.tsx`.
- Keep the default fallback as `freehand`.
- Update `src/components/toolbar/__tests__/BrushControls.colorCycle.test.tsx`
  to prove the button exists and writes
  `ccGradientDrawingShape: 'click-line'`.

### 2. Add first-class click-line geometry

- In `src/hooks/canvas/handlers/shapes/ccGradientDrawingGeometry.ts`, add
  `buildClickLineGeometry({ points, previewPoint })`.
- Build a fill boundary from committed `points` plus optional `previewPoint`.
- Reject geometry when the effective boundary has fewer than 3 points.
- Return:
  - `shapePoints`: clicked boundary points.
  - `sampleSourcePoints`: committed boundary points only for final geometry;
    include `previewPoint` only for preview geometry.
  - `direction`: first-to-last boundary direction.
  - `bounds`: from boundary points.
- Add `isClickLineCcGradientShape(...)` beside
  `isDragDefinedCcGradientShape(...)` and `isPolygonCcGradientShape(...)`.
- Extend `buildCcGradientDrawingGeometry(...)` to route `'click-line'` through
  the new builder.
- Keep existing `line` and `polygon` behavior unchanged.

### 3. Add a transient click-line runtime boundary

- In `src/hooks/canvas/handlers/shapes/ccGradientDrawingRuntime.ts`, add a small
  runtime type and helpers:
  - `CcGradientClickLineSession`
  - `createCcGradientClickLineSession()`
  - `appendCcGradientClickLinePoint(...)`
  - `previewCcGradientClickLinePoint(...)`
  - `cancelCcGradientClickLineSession(...)`
  - `prepareCcGradientClickLineFinalize(...)`
  - `isCcGradientClickLineDrawingShapeMode(...)`
- Store only ephemeral interaction data:
  - committed boundary points
  - optional preview point
  - active state
  - last pressure/raw pressure if needed for preview parity
- Do not persist this session in Zustand.
- Rebuild `shapePointsRef`, `ccStrokeDirectionRef`, and
  `ccGradientDrawingGeometryRef` through one helper so preview and finalization
  use the same geometry.
- Clear `shapePointsRef`, `ccStrokeDirectionRef`,
  `ccGradientDrawingGeometryRef`, and cached CC preview on cancel.

### 4. Wire session refs through the existing shape runtime

- Add the click-line session ref in the existing shape-handler refs/runtime
  area, not in `DrawingCanvas.tsx`.
- Prefer `src/hooks/canvas/handlers/shapes/ShapeToolHandlerRuntime.ts` or the
  shape runtime bridge that already owns shape refs and calls
  `triggerSimpleShapePreview()` / `finalizeShapeDrawing()`.
- Keep orchestration files thin:
  - `src/hooks/useDrawingHandlers.ts`
  - `src/components/canvas/DrawingCanvas.tsx`
  - `src/hooks/canvas/useCanvasEventHandlers.ts`
- If any touched orchestration file grows meaningfully, move logic back into
  `src/hooks/canvas/handlers/shapes/**` before merging.

### 5. Route pointer input

- Route CC Gradient `click-line` through the existing shape-handler runtime seam
  in `src/hooks/canvas/handlers/shapes/ShapeToolHandlerRuntime.ts`, where shape
  preview/finalize routing already lives. Keep `pointerHandlersRuntime.ts` as
  the outer pointer orchestration layer.
- On pointer down:
  - convert to world position through the existing pointer path.
  - snap to the previous committed point when Shift is held.
  - append the point to the click-line session.
  - set shape drawing state active without starting a drag-defined shape.
  - call `triggerSimpleShapePreview()` when at least two effective points exist.
- On pointer move:
  - when a click-line session is active, rebuild preview geometry from committed
    points plus the current cursor point.
  - snap the preview point when Shift is held.
  - call `triggerSimpleShapePreview()`.
- On pointer up:
  - ordinary clicks must not finalize.
  - no completion decision reads `PointerEvent.detail`.
- On native double-click:
  - finalize only when the session has at least three committed points and valid
    fill geometry.
  - for multi-color linear gradients, enter the shared direction stage.
- Keep drag-defined `Line`, `Rect`, `Oval`, `Tri`, and `Poly` paths unchanged.

### 6. Route keyboard finalize/cancel

- In `src/hooks/canvas/handlers/keyboardHandlers.ts`, add a CC Gradient
  click-line branch scoped to `ui.keyboardScope.active === 'canvas'`.
- Escape cancels the active CC Gradient click-line session and redraws/clears
  preview.
- Enter and NumpadEnter finalize through the same click-line finalize helper
  used by double-click.
- Keep the existing selection `click-line` keyboard branch unchanged and
  explicitly test that it still works.

### 7. Preserve sampled-gradient correctness

- For `ccGradientSource === 'sampled'`, sample from the clicked boundary points.
- Preview must not mutate active slots or persisted sampled sources.
- Final geometry must leave `ccGradientDrawingGeometryRef.current` populated so
  `resolveFinalSampledShapeSourcePoints(...)` receives the committed boundary.
- Do not introduce jitter/noise or change dither algorithm selection.

### 8. Finalize through the existing CC shape contract

- Reuse `triggerSimpleShapePreview()` for live preview.
- Reuse `finalizeShapeDrawing()` for completion.
- Before finalization, ensure `ccGradientDrawingGeometryRef.current` carries:
  - boundary `shapePoints`
  - committed boundary `sampleSourcePoints`
  - boundary `direction`
  - ROI/history `bounds`
- Clear the click-line session after successful finalize or cancel.
- Ensure history ROI is bounded by the filled boundary geometry.

### 9. Tests

- `src/hooks/canvas/handlers/shapes/__tests__/ccGradientDrawingGeometry.test.ts`
  - builds click-line geometry from 3+ committed boundary points
  - rejects fewer than 3 points
  - preserves boundary points as sampled source
  - preserves multi-segment fill geometry
  - includes preview point only for preview geometry
- `src/hooks/canvas/handlers/__tests__/pointerHandlers.main.test.ts`
  - ordinary clicks append points and do not finalize
  - pointer move updates preview geometry
  - Shift snaps the pending segment
  - double-click finalizes after three committed points
  - drag-defined `Line` still behaves unchanged
- `src/hooks/canvas/handlers/__tests__/keyboardHandlers.test.ts`
  - Enter finalizes active CC Gradient click-line
  - Escape cancels active CC Gradient click-line
  - selection `click-line` keyboard behavior remains unchanged
- `src/components/toolbar/__tests__/BrushControls.colorCycle.test.tsx`
  - UI exposes `Click Line`
  - clicking it writes `'click-line'`

### 10. Verification

Run focused checks first:

```bash
npm test -- src/hooks/canvas/handlers/shapes/__tests__/ccGradientDrawingGeometry.test.ts
npm test -- src/hooks/canvas/handlers/__tests__/pointerHandlers.main.test.ts
npm test -- src/hooks/canvas/handlers/__tests__/keyboardHandlers.test.ts
npm test -- src/components/toolbar/__tests__/BrushControls.colorCycle.test.tsx
```

Then run the normal gates:

```bash
npm run type-check
npm run lint
npm test
```

Verification record:

- 2026-07-13: replaced synthetic pointer click-count completion with the native
  `dblclick` path, unified Enter/double-click direction-stage entry, and moved
  shape-stroke begin after palette binding. Added real-event-shape and ordering
  regression coverage.

- 2026-05-25: focused automated checks passed:
  `npm test -- src/hooks/canvas/handlers/__tests__/pointerHandlers.main.test.ts src/hooks/canvas/handlers/shapes/__tests__/ccGradientDrawingGeometry.test.ts src/hooks/canvas/handlers/__tests__/keyboardHandlers.test.ts src/components/toolbar/__tests__/BrushControls.colorCycle.test.tsx`
  - Result: 4 test suites passed, 123 tests passed.
- Full `npm run type-check`, `npm run lint`, full `npm test`, and manual
  app/Goblet verification remain the broader pre-merge gates when this feature
  is finalized for commit.

Manual app verification:

- Manual CC Gradient click-line previews and finalizes.
- Sampled CC Gradient click-line samples from the clicked boundary.
- Undo/redo restores the finalized mark.
- Save/load restores playback.
- Goblet export shows the same animated filled shape as Vessel.

## Non-Goals

- Do not add a new tool or brush preset.
- Do not merge this into polygon mode.
- Do not persist in-progress click-line state.
- Do not change existing `line`, `polygon`, sampled-source, or dither behavior
  except where explicitly needed for `click-line`.
- Do not add heavy workflow logic to orchestration shells.
