# CC Gradient Click Line Preview Flash Plan

Last updated: 2026-05-25

Status: implemented

## Problem

Click Line still flashes when adding a new point. The blank gap becomes longer
as the boundary grows.

## Current Evidence

- `ShapeToolHandlerRuntime` appends each click-line point, rebuilds geometry,
  then calls `triggerSimpleShapePreview()` on pointer down.
- The simple shape preview path in `pointerHandlersRuntime` still clears the
  overlay during publish. This prevents an early blank, but it still swaps the
  whole overlay for every point.
- The CC dither preview path in `ccShapePreviewDitherRuntime` clears the overlay
  when it cannot replay the current preview cache. A new click-line point changes
  the replay key, so the cache is often treated as non-replayable.
- New points expand the polygon ROI and rerun dither/sample preview work. More
  points and larger ROIs make the async preview job slower, so the visible blank
  lasts longer.

## Likely Cause

Click Line is using the full filled CC preview as the live point-placement
feedback. Every click invalidates the filled preview, clears or replaces the
overlay, and waits for a new expensive dither preview. This is correct for final
fidelity but wrong for interactive vertex placement.

## Intended Behavior

- Adding a point must never blank the existing preview.
- While the next filled preview is rendering, keep the previous filled preview
  visible and draw the new boundary/guide chrome immediately.
- The filled preview may update asynchronously, but the user should see stable
  continuity on every click.
- Finalize must still use the existing CC shape finalize path.

## Implementation Plan

### 1. Add a click-line preview mode predicate

- Add a narrow helper for active CC Gradient Click Line sessions.
- Use it only in preview rendering and scheduling, not in finalization.

### 2. Stop clearing stale CC preview on click-line cache misses

- In `ccShapePreviewDitherRuntime`, let callers request stale-cache retention.
- For click-line preview only, draw the last cached preview even when the new
  replay key does not match.
- Keep existing strict replay behavior for normal polygon/drag previews.

### 3. Draw immediate boundary chrome separately from filled preview

- On click-line pointer down and move, draw boundary anchors/outline/guide
  synchronously even if the filled dither preview is still in flight.
- Do not block chrome on `runCcDitherPreviewRuntime` or sampled preview jobs.
- Keep old fill visible beneath the updated chrome.

### 4. Coalesce fill preview jobs during point placement

- If a fill preview job is already in flight, replace the pending click-line
  request with the newest geometry instead of scheduling multiple frames.
- Do not clear the overlay while waiting for the latest job.
- Preserve sampled-source point correctness for the eventual preview/finalize.

### 5. Tests

- Add a focused preview-runtime test proving stale cached preview is retained
  for click-line cache misses.
- Add/update pointer handler tests proving ordinary click-line point append does
  not clear `ccShapePreviewCacheRef` and still triggers immediate chrome.
- Keep existing Enter/Escape/finalize tests intact.

### 6. Verification

- `npm test -- src/hooks/canvas/handlers/__tests__/pointerHandlers.main.test.ts`
- `npm test -- src/hooks/canvas/handlers/shapes/__tests__/ShapeToolHandler.ccDitherReplay.test.ts`
- Existing affected suite:
  `npm test -- src/hooks/canvas/handlers/__tests__/pointerHandlers.main.test.ts src/hooks/canvas/handlers/shapes/__tests__/ccGradientDrawingGeometry.test.ts src/hooks/canvas/handlers/__tests__/keyboardHandlers.test.ts src/hooks/canvas/__tests__/useShapePressureResetEffects.test.tsx src/components/toolbar/__tests__/BrushControls.colorCycle.test.tsx`
- `npm run type-check`
- `npm run lint`
- `git diff --check`

Verification record:

- 2026-05-25: focused preview/runtime checks passed:
  `npm test -- src/hooks/canvas/handlers/shapes/__tests__/ShapeToolHandler.ccDitherReplay.test.ts src/hooks/canvas/handlers/__tests__/pointerHandlers.main.test.ts`
  - Result: 2 test suites passed, 81 tests passed.
- 2026-05-25: affected click-line suite passed:
  `npm test -- src/hooks/canvas/handlers/__tests__/pointerHandlers.main.test.ts src/hooks/canvas/handlers/shapes/__tests__/ShapeToolHandler.ccDitherReplay.test.ts src/hooks/canvas/handlers/shapes/__tests__/ccGradientDrawingGeometry.test.ts src/hooks/canvas/handlers/__tests__/keyboardHandlers.test.ts src/hooks/canvas/__tests__/useShapePressureResetEffects.test.tsx src/components/toolbar/__tests__/BrushControls.colorCycle.test.tsx`
  - Result: 6 test suites passed, 135 tests passed.
- 2026-05-25: `npm run type-check` passed.
- 2026-05-25: `npm run lint` passed.
- 2026-05-25: `git diff --check` passed for the touched preview-runtime files.
- 2026-05-25: headless Playwright smoke check against `http://localhost:3000`
  passed: app title `vessel`, 5 canvases, 51 buttons.

## Non-goals

- Do not change final CC shape geometry.
- Do not change sampled-gradient source semantics.
- Do not disable dither preview globally.
- Do not introduce jitter/noise or alter dither algorithm selection.
