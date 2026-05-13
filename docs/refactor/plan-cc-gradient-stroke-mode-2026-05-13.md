# CC Gradient Stroke Mode Plan

## Goal

Add a new `Stroke` mode alongside the existing CC Gradient `Grad` and `Concentric` modes. The new mode should use a cursor stroke to define a filled color-cycle gradient shape, then preview and finalize through the same CC shape/dither pipeline used by current shape mode.

## User Decisions

- Mode name: `Stroke`.
- Caps: square/rectangular caps, matching the rectangle brush-tip feel.
- Pressure:
  - When pressure is enabled, pressure affects the swept stroke tip width.
  - When pressure-linked fill resolution is enabled, pressure also affects preview/final fill resolution through the existing shape pressure-resolution behavior.
- Preview:
  - The live preview must show the dithered CC shape preview when dither is enabled.
  - It must not use a smooth placeholder if current shape mode would show dither.
- Finalize:
  - Final output should behave like finalized CC Gradient shape paint: stable canonical color-cycle data, not ordinary stamp-stroke paint.

## Behavior Contract

`Stroke` mode is a drag-defined CC gradient fill shape.

1. Pointer down starts collecting a stroke path.
2. Pointer move extends the path and updates the live preview.
3. The path is converted into a swept polygon using pressure-scaled rectangular brush width.
4. The preview feeds that polygon into the existing CC shape preview/dither renderer.
5. Pointer up finalizes that same polygon through the existing CC shape fill commit path.

The gradient direction comes from the stroke gesture. The first implementation should use the stroke start-to-end vector as the linear gradient direction. Curved path-distance gradient mapping can be considered later if the start-to-end direction is not visually sufficient.

## Implementation Plan

### 1. Extend Fill Mode Types

- Add `'stroke'` to `BrushSettings.colorCycleFillMode` in `src/types/index.ts`.
- Preserve existing gradient-definition identity as `'linear' | 'concentric'` unless implementation proves storage needs a third kind.
- Treat `stroke` as a linear-gradient fill for slot/def hashing and final render binding.
- Keep interaction mode and render mode separate:
  - interaction mode remains `stroke` so pointer routing can bypass the current linear direction-selection phase,
  - render/finalize mode resolves to `linear` so existing CC shape fill, slot binding, and gradient-def contracts can be reused.
- Update or split current fill-mode resolver helpers so they do not accidentally coerce `stroke` to `linear` before interaction logic has had a chance to branch.

### 2. Add Toolbar UI

- Update the CC Gradient fill-mode button group in `src/components/toolbar/BrushControls.tsx`.
- Change the options from:
  - `Grad`
  - `Concentric`
- To:
  - `Grad`
  - `Concentric`
  - `Stroke`
- Ensure `toolsSlice` persistence keeps `colorCycleFillMode: 'stroke'` only for the `color-cycle-gradient` preset, matching the existing fill-mode persistence rules.

### 3. Build Swept-Stroke Geometry

Create a focused geometry utility rather than adding inline logic to orchestration files.

Likely location:

- `src/hooks/canvas/handlers/shapes/ccStrokeShapeGeometry.ts`

Responsibilities:

- Accept ordered pointer samples with `{ x, y, pressure }`.
- Resolve effective width from brush size and pressure settings.
- Generate a filled polygon with square/rectangular caps.
- Keep joins deterministic and robust for short segments, sharp turns, and repeated points.
- Return:
  - `shapePoints`: polygon points for preview/finalize.
  - `direction`: start-to-end direction for linear CC gradient fill.
  - optional bounds/diagnostics for tests.

Initial guardrails:

- Ignore duplicate zero-distance samples.
- Require enough distance/points to form a non-empty polygon.
- Clamp width to at least 1 px.
- Prefer simple, stable joins before adding complex miter/round handling.

Do not use the existing `shapePointsRef` as the only source of truth for stroke mode. It currently stores `{ x, y }` points and would lose pressure. Add a stroke-specific raw sample ref/state, for example `ccStrokeSamplesRef`, that stores centerline samples with pressure. The swept polygon should be derived from those raw samples for preview and finalize.

### 4. Route Preview Through Existing CC Shape Preview

Do not create a separate smooth preview renderer.

- In `ShapeToolHandlerRuntime` / shape preview flow, recognize `colorCycleFillMode === 'stroke'`.
- Convert the collected stroke samples to swept polygon points.
- Feed the polygon into the same CC shape preview/dither runtime used by current `Grad` shape mode.
- Ensure dither-enabled preview uses `ccShapePreviewDitherRuntime.ts`, including current reduced/capped preview behavior and pressure-linked pixel-size handling.

Preview/finalize parity requirement:

- The preview and finalize paths must consume the same geometry snapshot.
- The preview should not mutate the authoritative raw stroke samples.
- For sampled gradients, sampling should use the raw stroke centerline samples, not the generated outline polygon. The sampled gradient should follow the user's gesture direction rather than sampling both rails and caps of the swept shape.

### 5. Finalize Through Existing CC Shape Fill

On pointer up:

- Build the final swept polygon from the same stroke sample model.
- Resolve pressure-linked dither/fill pixel size using the existing shape pressure-resolution helper.
- Call `runColorCycleShapeFill(...)` with:
  - `mode: 'linear'`
  - `shapePoints: sweptStrokePolygon`
  - `direction: strokeStartToEndDirection`
  - existing session/slot/def binding logic
  - existing overlay clear and deferred save logic

This should preserve the current CC Gradient finalize contracts in:

- `src/hooks/canvas/handlers/shapes/shapeDrawing.ts`
- `src/hooks/canvas/handlers/colorCycle/colorCycleShapeFill.ts`
- `ColorCycleBrushCanvas2D.commitCommittedLayerState(...)`

### 6. Pointer/Input State

Add stroke-mode handling without expanding orchestration shells heavily.

Candidate shape:

- Add small state helpers under `src/hooks/canvas/handlers/shapes/`.
- Keep `pointerHandlersRuntime.ts` limited to routing.

Required interaction:

- Pointer down: start stroke sample collection when active brush is CC Gradient and fill mode is `stroke`.
- Pointer move: append samples, update preview.
- Pointer up: finalize if geometry is valid, otherwise cancel cleanly.
- Escape/cancel: clear preview and stroke sample state.

Avoid the current linear-shape direction-selection step for `Stroke`; direction is implicit from the stroke path.

State requirement:

- Store raw stroke samples separately from generated polygon points.
- Generated polygon points may be copied into existing shape-preview/finalize refs only at the preview/finalize boundary.
- Cancel/reset paths must clear both the raw stroke samples and any generated preview polygon.

### 7. Pressure Semantics

When pressure is disabled:

- Use configured brush size for the swept width.
- Use configured fill resolution.

When pressure is enabled:

- Use the existing pressure curve/min/max behavior to scale swept width.
- Preserve the existing shape-mode behavior where pressure-linked fill resolution affects dither/fill pixel size.

Tests should cover both pressure-enabled and pressure-disabled cases.

### 8. Tests

Add targeted tests before or with implementation.

Geometry tests:

- Straight horizontal stroke creates a rectangle with square caps.
- Diagonal stroke has stable perpendicular width.
- Duplicate/near-duplicate samples do not create invalid geometry.
- Pressure increases width on later samples when pressure is enabled.
- Pressure-disabled mode ignores sample pressure for width.

Preview/finalize routing tests:

- `stroke` mode uses CC shape preview/dither path when dither is enabled.
- `stroke` mode does not enter the separate linear direction-selection phase.
- Finalize calls CC shape fill as linear with generated polygon and stroke direction.
- Preview and finalize use the same geometry snapshot.
- Sampled-gradient stroke mode samples from the raw centerline, not the outline polygon.

Regression areas:

- Existing `Grad` and `Concentric` behavior remains unchanged.
- Sampled/foreground/manual gradient sources still bind through existing mark-session logic.
- Finalized stroke-mode marks remain stable canonical CC paint after runtime refresh/save.

### 9. Verification

Minimum local commands:

- `npm run type-check`
- `npm run lint`
- Focused Jest for changed shape/pointer/geometry tests
- Broader relevant CC tests if shape fill or mark-session code changes

Manual browser sanity:

1. Select CC Gradient.
2. Switch fill mode to `Stroke`.
3. Draw a straight stroke with dither on; preview should be visibly dithered.
4. Release pointer; finalized result should match preview and animate as CC paint.
5. Repeat with pressure enabled; width and pressure-linked resolution should respond.
6. Verify `Grad` and `Concentric` still preview/finalize normally.

## Risks

- Preview/finalize mismatch if live preview rebuilds geometry differently from finalize.
- Pointer routing complexity if `Stroke` is bolted onto existing polygon shape state instead of getting a small stroke-specific helper.
- Curved strokes may not visually read as "gradient follows the path" if start-to-end linear direction is too simple. Treat this as a follow-up renderer upgrade only after testing the simpler behavior.
- CC shape code has known sensitivity around sampled sessions, slot binding, and committed runtime/store parity; keep `Stroke` on the existing finalize path to avoid reintroducing persistence bugs.

## Definition of Done

- `Stroke` appears beside `Grad` and `Concentric`.
- Stroke-mode preview uses the current CC shape dither preview behavior.
- Square/rectangular caps are visible in preview and final output.
- Pressure changes stroke width when pressure is enabled.
- Pressure-linked fill resolution still affects dither/fill resolution.
- Finalized output is committed canonical CC paint and survives redraw/save paths.
- Existing `Grad` and `Concentric` tests and behavior remain intact.
