# CC Gradient Direction Stage Plan

## Goal

Make multi-color linear CC Gradient shape authoring a two-stage interaction:

1. Draw and finalize the shape geometry.
2. Set the linear gradient direction, then click to commit the fill.

This should make gradient direction intentional instead of relying on the current automatic shape-axis fallback.

## Implementation Status

- Implemented:
  - Linear CC Gradient shape authoring enters direction selection when `Colors > 1`.
  - `Colors = 1`, concentric, stroke, click-line, and drag-defined CC Gradient shapes keep the direct finalize path.
  - Right-click cancels a pending direction stage and clears pending geometry/session state.
  - Escape cancellation clears the active CC mark session through the shared canvas cancel path.
- Verified:
  - `npm test -- --runInBand src/hooks/canvas/handlers/__tests__/pointerHandlers.main.test.ts`
  - `npm test -- --runInBand src/hooks/canvas/handlers/shapes/__tests__/shapeDrawing.finalizeResolution.test.ts src/hooks/canvas/handlers/colorCycle/__tests__/colorCycleShapeFill.direction.test.ts`
  - `npm run type-check`
  - `npm run lint`

## Product Contract

- Applies to CC Gradient shape authoring when:
  - the active brush is Color Cycle Shape,
  - the active preset is `color-cycle-gradient`,
  - `colorCycleFillMode === 'linear'`,
  - the CC Gradient `Colors` slider is greater than `1`.
- Stage 1:
  - Pointer drag/clicks define the shape as they do today.
  - Mouse up locks the shape geometry but does not commit the final fill.
- Stage 2:
  - Pointer movement previews the gradient direction from the shape center.
  - Click commits the CC shape fill using that explicit direction.
  - Shift snaps the direction to 45-degree increments.
  - Escape/right-click cancels direction selection and clears the pending shape/session.
- Single-color, concentric, and stroke modes should keep the current one-stage behavior unless product scope expands.

## Current Code Seams

- `src/hooks/canvas/handlers/pointerHandlersRuntime.ts`
  - Already has direction-selection pointer down/move handling via `isSelectingDirectionRef`.
  - Currently excludes the `color-cycle-gradient` preset from entering direction selection.
- `src/hooks/canvas/handlers/shapes/shapeDrawing.ts`
  - Owns `isSelectingDirectionRef`, `directionPreviewRef`, and the second finalize path.
  - Computes final direction from `directionPreviewRef - shapeCenter`.
  - Calls `runColorCycleShapeFill({ mode: 'linear', direction })`.
- `src/hooks/canvas/handlers/colorCycle/colorCycleShapeFill.ts`
  - Receives explicit linear direction and forwards it to the brush runtime.
- `src/hooks/brushEngine/colorCycleShapeFillDispatchRuntime.ts`
  - Enforces that linear shape fill requires a `direction`.
- `src/hooks/canvas/handlers/colorCycle/colorCycleShapeGeometry.ts`
  - Contains `computeFallbackLinearDirection(...)`, which should remain fallback behavior rather than the primary CC Gradient authoring path.

## Implementation Plan

### Phase 1 - Confirm Behavior

- Reproduce current CC Gradient linear shape authoring in the app.
- Confirm finalized linear direction comes from fallback shape geometry rather than a user-selected direction.
- Confirm regular Color Cycle linear shape still enters direction selection.

Definition of done:

- We can point to the exact gate preventing CC Gradient from using the existing direction-selection path.

### Phase 2 - Add an Explicit Gate Helper

- Add a small helper near the pointer shape-finalize path, for example `shouldEnterCcLinearDirectionStage(...)`.
- The helper should return true only for eligible multi-color linear CC shape fills.
- Include `color-cycle-gradient` instead of excluding it.
- Keep `Colors = 1`, single-color, and no-gradient cases on the existing direct finalize path.

Definition of done:

- Eligibility is readable and covered by focused tests.

### Phase 3 - Reuse Direction Selection

- On Stage 1 mouse up, call the existing `finalizeShapeDrawing()` path that sets `isSelectingDirectionRef`.
- Keep `shapePointsRef` intact while direction selection is active.
- Do not clear sampled CC preview/session state until Stage 2 commit or cancel.
- Preserve sampled, foreground, and manual gradient session handling.

Definition of done:

- CC Gradient linear shape enters direction selection after geometry is complete.

### Phase 4 - Direction Preview

- Reuse the existing direction preview in `continueShapeDrawing(...)`.
- Keep the locked shape visible.
- Prefer a lightweight gradient preview if the current overlay path can do it without widening the handler further.
- If full live gradient preview is risky, first ship the guide line and final commit correctness.

Definition of done:

- During Stage 2, pointer movement visibly communicates the chosen direction.

### Phase 5 - Commit and Cancel

- On click, compute `direction = pointer - shapeCentroid`.
- Normalize/fallback only if the vector is too short.
- Commit with `runColorCycleShapeFill({ mode: 'linear', direction })`.
- On cancel, clear:
  - `isSelectingDirectionRef`,
  - `directionPreviewRef`,
  - pending shape points,
  - pending CC sampled/session state,
  - overlay preview.

Definition of done:

- Finalized fill direction matches the Stage 2 click direction.
- Cancel leaves no stale preview/session state.

### Phase 6 - Tests

- Pointer handler test:
  - CC Gradient linear multi-color shape enters direction selection on shape mouse up.
  - Concentric and stroke modes do not enter direction selection.
- Shape finalize test:
  - Stage 2 click direction is passed to `runColorCycleShapeFill`.
  - Explicit direction wins over `computeFallbackLinearDirection`.
- Cancel test:
  - pending shape/session state is cleared.
- Regression test:
  - existing drag-defined CC Gradient line mode still uses its stored drag axis.

## Verification

Focused tests first:

- `npm test -- --runInBand src/hooks/canvas/handlers/__tests__/pointerHandlers.main.test.ts`
- `npm test -- --runInBand src/hooks/canvas/handlers/shapes/__tests__/shapeDrawing.finalizeResolution.test.ts`
- `npm test -- --runInBand src/hooks/canvas/handlers/colorCycle/__tests__/colorCycleShapeFill.direction.test.ts`

Broader checks after implementation:

- `npm run type-check`
- `npm run lint`
- relevant CC shape/preview tests if preview code changes

Manual verification:

- Draw a multi-color linear CC Gradient shape.
- Mouse up to lock the shape.
- Move pointer to aim the gradient.
- Click to commit.
- Confirm final fill direction matches the aimed direction.
- Repeat with Shift snapping.
- Confirm concentric and `Colors = 1` cases do not add an unnecessary second step.

## Non-goals

- Do not change the linear fill renderer.
- Do not alter Goblet/export behavior unless authored data changes require it.
- Do not rewrite sampled gradient session lifecycle.
- Do not expand `ShapeToolHandlerRuntime.ts` with more inline workflow logic if a small helper or existing seam can own it.

## Open Questions

- Should Stage 2 show a full live gradient preview, or is a direction guide enough for the first implementation slice?
- Should manual linear CC Shape, outside the `color-cycle-gradient` preset, use the same two-stage contract everywhere for consistency?
- Should very short click vectors commit fallback direction or keep waiting for a clearer click?
