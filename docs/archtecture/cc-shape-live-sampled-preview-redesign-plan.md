# CC Shape Live Sampled Preview Redesign Plan

Date: 2026-04-22

Scope

- `BrushShape.COLOR_CYCLE_SHAPE`
- Shape-mode preview path
- All CC gradient variants share the preview pipeline:
  - `sampled`
  - `fg`
  - `manual`
- The primary pathological case is `sampled`, especially the flat-color / `1`-band / `sierra-lite` preview path.

Goal

- Preserve live CC shape preview during drag.
- Eliminate tab hangs during long or fast sampled CC shape drags.
- Keep preview visually close to finalize.
- Keep finalize authoritative and unchanged in result quality.

Current problem

- The current live preview path still does too much work on or near the live frame path.
- Even after guardrails, sampled CC shape drag can still hang because the preview pipeline continues to schedule and execute heavy sampled fill work while the pointer is moving.
- Small guardrail patches are not sufficient for the full live sampled fill preview requirement.

Non-goals

- No degradation to finalize quality.
- No drag-time sampled store or mark-session mutation.
- No pixel-identical guarantee on every drag tick if that would block responsiveness.

Design principles

1. Split preview into two lanes.
   - Lane A: immediate frame paint.
   - Lane B: latest-only async fill render.

2. Keep sampled preview pure during drag.
   - No sampled gradient store writes.
   - No sampled mark-session churn.
   - No finalize-state coupling.

3. Make async render latest-only.
   - Newer requests invalidate older ones.
   - At most one in-flight render and one pending replacement request.

4. Reuse cached fill aggressively.
   - Drag feedback should remain live even while a better fill is still rendering.

5. Preserve finalize fidelity.
   - Preview should use the same settings family as finalize.
   - Finalize remains the source of truth for the actual committed output.

Architecture

## Lane A: Immediate live frame paint

Purpose

- Keep drag interaction responsive.
- Never block pointer move on sampled fill recomputation.

Responsibilities

- Update geometry.
- Draw outline, anchors, and guide segment immediately.
- Draw the latest cached fill preview if one exists.
- Publish the latest desired preview request to the async controller.

Constraints

- No sampled session mutation.
- No store writes.
- No heavy dither computation.
- No synchronous sampled fill generation beyond cheap request construction.

## Lane B: Latest-only async preview renderer

Purpose

- Produce the best available fill preview without blocking drag.

Responsibilities

- Accept a frozen preview request object.
- Render off the live frame path using offscreen canvases and reusable buffers.
- Drop stale results by sequence or token.
- Promote only the newest completed render into the cached preview frame.

Constraints

- One in-flight job max.
- One pending replacement request max.
- No recursive preview-frame scheduling from within the renderer.
- No dependence on unstable live store state once the request starts.

Preview request model

Each async preview render must work from a self-contained request object.

Required fields

- `source`: `sampled` | `fg` | `manual`
- `fillMode`: `linear` | `concentric`
- `polygon`
- `simplifiedPolygon`
- `roi`
- `previewStops`
- `preparedGradientKey`
- `pixelSize`
- `gradientBands`
- `ditherAlgorithm`
- `patternStyle`
- `ditherPaletteSpread`
- `pressureDerivedState`
- `requestId`

Rules

- Request construction may read live state.
- Async rendering may not depend on mutable live state after request creation.
- Sampled preview stops are derived locally for the request only.

Variant behavior

## Sampled

- Main pathological case.
- Request builder derives sampled stops from current drag geometry and the pixel sampler.
- No drag-time store or session mutation.
- No mark-session dependency for preview.

## FG

- Uses derived foreground stops.
- Shares the same async controller and cached-fill behavior.
- Cheaper request construction than sampled.

## Manual

- Uses configured manual gradient stops.
- Shares the same async controller and cached-fill behavior.
- Cheapest request construction.

Resolution and fidelity

The preview request should carry the same relevant settings as finalize:

- `fillResolution`
- pressure-linked effective resolution
- gradient band count
- dither algorithm
- pattern style
- spread
- fill mode

Expected outcome

- Preview remains visually close to finalize.
- Fast dragging may show the last completed fill briefly.
- When pointer velocity drops, preview converges toward final appearance.

This is acceptable.

- Visual fidelity should be high.
- Exact per-tick parity is not required if it compromises responsiveness.

Controller state

Add a dedicated controller state for CC shape preview, separate from finalize/session state.

Suggested fields

- `latestRequested`
- `pendingRequested`
- `inFlightRequestId`
- `latestCompletedRequestId`
- `latestCompletedCanvas`
- `latestCompletedOrigin`
- `latestCompletedSize`
- `latestCompletedReplayKey`
- `renderInFlight`
- `renderLatencyMs`
- `droppedRequestCount`

Behavior

- Pointer move updates `latestRequested`.
- If idle, the controller starts rendering the latest request.
- If busy, the controller replaces `pendingRequested` with the newest request.
- On completion, stale results are discarded.
- If a pending request exists, launch exactly one new render for it.

Implementation plan

1. Map the current CC shape preview flow for `sampled`, `fg`, and `manual`.
   - `ShapeToolHandler` pointer move
   - preview scheduling
   - `renderPolygonShapePreviewFrame`
   - `ccShapePreviewDitherRuntime`
   - finalize handoff

2. Introduce a dedicated preview controller state.
   - Store latest requested preview state separately from cached completed preview state.

3. Extract pure request-building helpers from `ShapeToolHandler`.
   - Build frozen request objects for the controller.

4. Refactor `ShapeToolHandler` live preview.
   - Frame path paints geometry and cached fill only.
   - Heavy fill recompute leaves the live frame path.

5. Refactor `ccShapePreviewDitherRuntime`.
   - Accept frozen requests.
   - Run latest-only async rendering.
   - Drop stale results.
   - Never recursively pile up frame work.

6. Unify all CC gradient variants on the same controller.
   - `sampled`, `fg`, and `manual` should share controller semantics.

7. Preserve finalize unchanged.
   - Cancel or invalidate stale preview work on pointer up and finalize.
   - Finalize remains authoritative.

8. Add instrumentation.
   - Request count
   - Completed render count
   - Dropped stale render count
   - Last render latency

9. Add tests.
   - Latest-only replacement behavior
   - Stale-result suppression
   - Cached fill reuse while render is in flight
   - No drag-time sampled session/store mutation
   - Shared variant coverage for `sampled` / `fg` / `manual`
   - Cleanup on pointer up and finalize

10. Validate manually.
   - Sampled CC shape drag
   - FG CC shape drag
   - Manual CC shape drag
   - Flat-color / `1`-band / `sierra-lite`
   - Higher-resolution dither settings

Success criteria

- No tab hangs on long or fast sampled CC shape drags.
- Live preview remains visible during drag.
- Preview stays close to finalize.
- Finalize output remains unchanged in quality and correctness.

Files likely involved

- `src/hooks/canvas/handlers/shapes/ShapeToolHandler.ts`
- `src/hooks/canvas/handlers/shapes/ccShapePreviewDitherRuntime.ts`
- `src/hooks/canvas/handlers/shapes/shapeDrawing.ts`
- `src/hooks/canvas/utils/colorCycleMarkSession.ts`
- `src/hooks/canvas/utils/idle.ts`

Recommendation

- Do not continue with local guardrail-only patches if full live sampled fill preview is required.
- Move to the controller-based redesign described here.
