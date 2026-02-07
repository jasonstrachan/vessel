# useBrushEngineSimplified Cleanup Plan (2026-02-07)

## Date
- 2026-02-07

## Goal
Reduce complexity and risk in `src/hooks/useBrushEngineSimplified.ts` while preserving behavior, performance characteristics, and external hook API.

## Current State Snapshot
- Hook size remains high (`~3697` LOC).
- Multiple no-behavior refactor slices have already been extracted into `src/hooks/brushEngine/*`.
- Previous repo-wide lint warning for `flowBits` has been removed during this cleanup stream.
- Focused validation currently passes after each extraction:
  - `npm run type-check`
  - `npm run lint` (with the existing warning above)
  - `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts`

## Completed Refactor Work (Already Landed)
- Extracted shared engine utilities and stroke pipeline helpers into dedicated modules:
  - `engineShared.ts`, `colorCycleSurface.ts`, `liveStrokeBuffers.ts`, `strokeDitherUtils.ts`, `strokeDitherRegion.ts`, `liveStrokePreview.ts`, `strokePressure.ts`, `liveStrokeTracking.ts`, `strokePressureDither.ts`, `strokeLivePressurePass.ts`, `strokeDitherBlit.ts`, `strokeStateReset.ts`, `strokeFinalize.ts`, `strokeFinalizeController.ts`, `strokeResetController.ts`, `strokeEntry.ts`, `strokePostRender.ts`, `strokeLiveContext.ts`, `strokeRenderStep.ts`, `strokeDrawEntry.ts`.
- Kept compatibility exports in the main hook module.
- Normalized stroke orchestration flow through dedicated controller-style helpers.

## Priority Order (Remaining Cleanup)
1. Decompose remaining large feature blocks in `useBrushEngineSimplified.ts` into controllers.
2. Remove the unused `flowBits` variable lint warning.
3. Unify duplicated local types and callback arg contracts across `stroke*` modules.
4. Reduce hook dependency-array noise via stable adapter boundaries.
5. Increase coverage for extracted modules to lock behavior during further decomposition.

## Detailed Execution Plan

### Phase 1: Structural Decomposition (Highest Priority)
Target extraction candidates from `src/hooks/useBrushEngineSimplified.ts`:
- Shape/gradient fill flow (`drawRectangleGradient`, `drawPolygonGradient`, fill helpers).
- Risograph overlay/effect flow (`applyRisographEffect`, related compositing helpers).
- Color-cycle drawing and animation control orchestration (`initializeColorCycleBrush`, `drawColorCycle`, `renderColorCycle`, reset/end lifecycle handlers).

Required invariants:
- Preserve handler ordering semantics for color-cycle lifecycle (initialize/start -> draw/render -> reset/end).
- Preserve existing gradient fill parity for rectangle/polygon flows and alpha-lock interaction behavior.

Deliverables:
- New focused modules in `src/hooks/brushEngine/` with explicit input/output contracts.
- Main hook reduced to orchestration and public API composition.

Guardrails:
- No change to public return signature of `useBrushEngineSimplified`.
- No behavior changes to dithering, alpha-lock, color-cycle paint paths, or stroke finalization.
- Avoid introducing hidden state singletons.

### Phase 2: Lint/Static Hygiene
- Fix `flowBits` unused variable in `src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts:1089`.
- Ensure all new modules compile cleanly and do not add unused imports/params.

Deliverables:
- Lint baseline clean except intentionally accepted repo-level warnings (target: remove this one now).

### Phase 3: Type Contract Consolidation
- Consolidate duplicate point/rect and stroke payload types into shared contracts (prefer `engineShared.ts` + facade types).
- Replace ad-hoc inline object types in callback signatures with shared named types.

Deliverables:
- Reduced type duplication and drift risk.
- Cleaner module boundaries and easier refactor safety.

### Phase 4: Dependency Boundary Cleanup
- Move callback-heavy logic into stable controller factories where appropriate.
- Minimize dependency arrays in top-level hook callbacks by passing stable adapters and refs.
- Keep `react-hooks/exhaustive-deps` fully enforced (no disables/ignores in touched files).
- Add or update tests for callback rebinding-sensitive paths when dependency boundaries change.

Deliverables:
- Lower chance of accidental stale-closure bugs.
- Better readability and easier reasoning for future changes.

### Phase 5: Test Expansion for Extracted Units
Add focused unit tests for:
- `strokeDrawEntry.ts` (draw-brush vs draw-stamp orchestration and parameter shaping).
- `strokeFinalizeController.ts` context builder and finalize prelude behavior.
- Any newly extracted controllers from Phase 1.
- `shape/gradient` extraction parity, including rectangle vs polygon gradient behavior and fill helper wiring.
- `risograph` extraction parity, including compositing mode and effect application sequencing.
- `color-cycle` extraction parity, including initialize/draw/render/reset/end lifecycle ordering.

Deliverables:
- Behavior lock for critical orchestration paths.
- Safer continued decomposition with quick regression feedback.

## Interrogation of the Plan (Risk Review)

### Assumptions
- Existing focused tests plus type/lint checks are sufficient to detect regressions introduced by extraction-only changes.
- Runtime behavior parity can be maintained without adding feature flags for internal module movement.

### Risks
- Subtle rendering behavior shifts from extraction ordering changes.
- Ref-based state timing differences across callback boundaries.
- Dependency array edits accidentally changing when callbacks rebind.

### Mitigations
- Keep each extraction slice small and single-purpose.
- Validate after each slice with the same command set.
- Prefer pure helper extraction first; postpone semantic edits.
- Keep old/new code paths logically equivalent before deleting old branches.
- Require a runtime parity check for affected flows in every slice before moving to next slice.

### Abort/Revert Criteria Per Slice
- Any change causing type-check failure, new lint errors, or focused test regression is reverted in the same slice before proceeding.
- Any observed runtime parity break in stroke/dither/finalize behavior blocks next phase until fixed.

## Validation Gate (Required Per Slice)
Run after every meaningful extraction:
1. `npm run type-check`
2. `npm run lint`
3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts`
4. Runtime parity sanity for changed flow(s):
   - Brush stroke + stamp
   - Alpha lock
   - Dithered stroke
   - Color-cycle draw/fill and lifecycle ordering (initialize/reset/end)
   - Gradient fill path parity (rectangle/polygon)

For major phase completion:
1. `npm test`
2. Manual sanity on drawing flows (brush stroke, stamp, alpha lock, dithered stroke, color-cycle draw/fill).

## Definition of Done
- `useBrushEngineSimplified.ts` is <= 3000 LOC and primarily orchestration (measured with `wc -l`).
- Largest function in `useBrushEngineSimplified.ts` is <= 200 LOC.
- Remaining large concerns are split into focused modules under `src/hooks/brushEngine/`.
- No new lint/type/test failures.
- Existing `flowBits` warning removed.
- Refactor progress and outcomes documented in this file (append dated updates at bottom).

## Progress Log
- 2026-02-07: Plan created from active cleanup stream; baseline validation commands and priorities recorded.
- 2026-02-07: Review feedback integrated: added explicit Phase 1 invariants and tests, per-slice runtime parity gate, measurable DoD thresholds, and dependency-array safety guardrails.
- 2026-02-07: Phase 1 slice 1 completed for rectangle-gradient extraction.
  - Extracted rectangle-gradient orchestration into `src/hooks/brushEngine/shapeRectangleGradientController.ts`.
  - Kept `useBrushEngineSimplified` public API unchanged; `drawRectangleGradient` now delegates to the controller.
  - Added focused parity tests in `src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts`.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass with existing repo warning: `ColorCycleBrushCanvas2D.ts:1089` `flowBits` unused)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts` (pass)
- 2026-02-07: Phase 1 slice 2 completed for polygon-gradient extraction.
  - Extracted polygon-gradient orchestration into `src/hooks/brushEngine/shapePolygonGradientController.ts`.
  - Kept `useBrushEngineSimplified` public API unchanged; `drawPolygonGradient` now delegates to the controller.
  - Added focused parity tests in `src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts`.
- 2026-02-07: Phase 2 lint/static hygiene progress.
  - Removed unused `flowBits` from `src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts`.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts` (pass)
- 2026-02-07: Phase 1 slice 3 completed for risograph effect extraction.
  - Extracted shape risograph overlay helper into `src/hooks/brushEngine/shapeRisographEffect.ts`.
  - Kept `useBrushEngineSimplified` public API unchanged; `applyRisographEffect` now delegates to the controller.
  - Added focused guard-path tests in `src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts`.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts` (pass)
- 2026-02-07: Phase 1 slice 4 completed for color-cycle init/animation orchestration extraction.
  - Extracted initialization/toggle logic into `src/hooks/brushEngine/colorCycleInitController.ts`:
    - `initializeColorCycleBrushForActiveLayer`
    - `ensureColorCycleAnimationForLayers`
  - Kept `useBrushEngineSimplified` public API unchanged; `initializeColorCycleBrush` and `ensureColorCycleAnimation` now delegate to controller helpers.
  - Added focused tests in `src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts`.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts` (pass)
- 2026-02-07: Phase 1 slice 5 completed for color-cycle render/draw orchestration extraction.
  - Extracted draw/render orchestration into `src/hooks/brushEngine/colorCycleDrawController.ts`:
    - `renderColorCycleToContext`
    - `drawColorCycleStroke`
  - Kept `useBrushEngineSimplified` public API unchanged; `renderColorCycle` and `drawColorCycle` now delegate to controller helpers.
  - Added focused tests in `src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts`.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts` (pass)
- 2026-02-07: Phase 1 slice 6 completed for color-cycle stroke lifecycle extraction.
  - Extracted stroke lifecycle helpers into `src/hooks/brushEngine/colorCycleStrokeLifecycleController.ts`:
    - `resetColorCycleStroke`
    - `endColorCycleStrokeForLayer`
  - Kept `useBrushEngineSimplified` public API unchanged; `resetColorCycle` and `endColorCycleStroke` now delegate to controller helpers.
  - Added focused tests in `src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts`.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts` (pass)
- 2026-02-07: Phase 1 slice 7 completed for color-cycle fill orchestration extraction.
  - Extracted shape-fill orchestration into `src/hooks/brushEngine/colorCycleFillController.ts`:
    - `fillColorCycleLinear`
    - `fillColorCycleConcentric`
  - Kept `useBrushEngineSimplified` public API unchanged; `fillCcGradientLinear` and `fillCcGradientConcentric` now delegate to controller helpers.
  - Added focused tests in `src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts`.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts` (pass)
  - Hook size checkpoint: `src/hooks/useBrushEngineSimplified.ts` at `2512` LOC (`wc -l`), down from initial `~3697` LOC.
- 2026-02-07: Phase 3 type contract consolidation progress.
  - Added shared controller contracts in `src/hooks/brushEngine/shapeTypes.ts`:
    - `Point2D`, `PolygonGradientData`, `RoiRect`, `GradientDitherOptions`
    - `RectangleGradientSettings`, `PolygonGradientSettings`
  - Updated extracted modules to use shared types (`shapeRectangleGradientController.ts`, `shapePolygonGradientController.ts`, `colorCycleFillController.ts`).
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts` (pass)
- 2026-02-07: Phase 4 dependency-boundary cleanup progress.
  - Introduced stable memoized settings adapters for extracted controller calls in `useBrushEngineSimplified` (`rectangleGradientSettings`, `polygonGradientSettings`, `drawColorCycleSettings`, `fillColorCycleSettings`).
  - Reduced dependency-array noise by replacing broad `tools.brushSettings` dependencies in extracted callback boundaries with focused adapter dependencies.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts` (pass)
- 2026-02-07: Phase 1 slice 8 completed for color-cycle risograph overlay extraction.
  - Extracted overlay compositing logic into `src/hooks/brushEngine/colorCycleRisographOverlayController.ts`:
    - `applyColorCycleRisographOverlay`
  - Kept `useBrushEngineSimplified` public API unchanged; local `applyColorCycleRisographOverlay` now delegates to controller helper.
  - Added focused tests in `src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts`.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts` (pass)
  - Hook size checkpoint: `src/hooks/useBrushEngineSimplified.ts` at `2488` LOC (`wc -l`).
- 2026-02-07: Additional Phase 4 dependency/effect cleanup.
  - Removed duplicate color-cycle band-spacing update effect in `useBrushEngineSimplified` (kept the primary CC-layer effect that also re-renders + dispatches frame-ready event).
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts` (pass)
  - Hook size checkpoint: `src/hooks/useBrushEngineSimplified.ts` at `2466` LOC (`wc -l`).
- 2026-02-07: Additional Phase 4 effect-body decomposition.
  - Extracted color-cycle settings/effect helpers into `src/hooks/brushEngine/colorCycleBrushSettingsController.ts`:
    - `updateColorCycleGradientBandsForLayer`
    - `updateColorCycleBandSpacingForLayer`
    - `updateColorCycleDitherSettings`
    - `updateColorCycleFillDitherPixelSize`
    - `updateColorCycleStampDitherPixelSize`
  - Replaced large inline effect bodies in `useBrushEngineSimplified` with thin delegated calls.
  - Added focused tests in `src/hooks/brushEngine/__tests__/colorCycleBrushSettingsController.test.ts`.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts src/hooks/brushEngine/__tests__/colorCycleBrushSettingsController.test.ts` (pass)
  - Hook size checkpoint: `src/hooks/useBrushEngineSimplified.ts` at `2407` LOC (`wc -l`).
- 2026-02-07: Phase 1 slice 9 completed for color-cycle blend/alpha-lock render extraction.
  - Extracted `renderCCWithBlendAndLock` internals into `src/hooks/brushEngine/colorCycleBlendLockController.ts`:
    - `renderColorCycleWithBlendAndLock`
  - Kept `useBrushEngineSimplified` public API unchanged; local callback now delegates to controller helper.
  - Added focused tests in `src/hooks/brushEngine/__tests__/colorCycleBlendLockController.test.ts`.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts src/hooks/brushEngine/__tests__/colorCycleBrushSettingsController.test.ts src/hooks/brushEngine/__tests__/colorCycleBlendLockController.test.ts` (pass)
  - Hook size checkpoint: `src/hooks/useBrushEngineSimplified.ts` at `2337` LOC (`wc -l`).
- 2026-02-07: Phase 1 slice 10 completed for generic alpha-lock paint orchestration extraction.
  - Extracted `withAlphaLock` internals into `src/hooks/brushEngine/alphaLockController.ts`:
    - `applyAlphaLockToPaint`
  - Kept `useBrushEngineSimplified` public API unchanged; local callback now delegates to controller helper.
  - Added focused tests in `src/hooks/brushEngine/__tests__/alphaLockController.test.ts`.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts src/hooks/brushEngine/__tests__/colorCycleBrushSettingsController.test.ts src/hooks/brushEngine/__tests__/colorCycleBlendLockController.test.ts src/hooks/brushEngine/__tests__/alphaLockController.test.ts` (pass)
  - Hook size checkpoint: `src/hooks/useBrushEngineSimplified.ts` at `2203` LOC (`wc -l`).
- 2026-02-07: Phase 1 slice 11 completed for brush stamp/temp-canvas helper extraction.
  - Extracted stamp helper internals into `src/hooks/brushEngine/brushStampController.ts`:
    - `getPatternTempContext`
    - `getRotationTempContext`
    - `createPixelSquareStamp`
    - `createPixelCircleStamp`
  - Kept `useBrushEngineSimplified` public API unchanged; local callbacks now delegate to controller helpers.
  - Added focused tests in `src/hooks/brushEngine/__tests__/brushStampController.test.ts`.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts src/hooks/brushEngine/__tests__/colorCycleBrushSettingsController.test.ts src/hooks/brushEngine/__tests__/colorCycleBlendLockController.test.ts src/hooks/brushEngine/__tests__/alphaLockController.test.ts src/hooks/brushEngine/__tests__/brushStampController.test.ts` (pass)
  - Hook size checkpoint: `src/hooks/useBrushEngineSimplified.ts` at `2083` LOC (`wc -l`).
- 2026-02-07: Phase 1 slice 12 completed for stroke bounds estimation extraction.
  - Extracted `estimateStrokeBounds` internals into `src/hooks/brushEngine/strokeBoundsController.ts`.
  - Kept `useBrushEngineSimplified` public API unchanged; local callback now delegates to controller helper.
  - Added focused tests in `src/hooks/brushEngine/__tests__/strokeBoundsController.test.ts`.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts src/hooks/brushEngine/__tests__/colorCycleBrushSettingsController.test.ts src/hooks/brushEngine/__tests__/colorCycleBlendLockController.test.ts src/hooks/brushEngine/__tests__/alphaLockController.test.ts src/hooks/brushEngine/__tests__/brushStampController.test.ts src/hooks/brushEngine/__tests__/strokeBoundsController.test.ts` (pass)
  - Hook size checkpoint: `src/hooks/useBrushEngineSimplified.ts` at `2042` LOC (`wc -l`).
- 2026-02-07: Phase 1 slice 13 completed for stroke draw-core orchestration extraction.
  - Extracted `runStrokeDrawCore` internals into `src/hooks/brushEngine/strokeDrawCoreController.ts`.
  - Kept `useBrushEngineSimplified` public API unchanged; local callback now delegates to controller helper.
  - Added focused tests in `src/hooks/brushEngine/__tests__/strokeDrawCoreController.test.ts`.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts src/hooks/brushEngine/__tests__/colorCycleBrushSettingsController.test.ts src/hooks/brushEngine/__tests__/colorCycleBlendLockController.test.ts src/hooks/brushEngine/__tests__/alphaLockController.test.ts src/hooks/brushEngine/__tests__/brushStampController.test.ts src/hooks/brushEngine/__tests__/strokeBoundsController.test.ts src/hooks/brushEngine/__tests__/strokeDrawCoreController.test.ts` (pass)
  - Hook size checkpoint: `src/hooks/useBrushEngineSimplified.ts` at `2037` LOC (`wc -l`).
- 2026-02-07: Phase 1 slice 14 completed for live pressure-dither orchestration extraction.
  - Extracted `runLivePressureDitherForCurrentStroke` internals into `src/hooks/brushEngine/livePressureDitherController.ts`.
  - Kept `useBrushEngineSimplified` public API unchanged; local callback now delegates to controller helper.
  - Added focused tests in `src/hooks/brushEngine/__tests__/livePressureDitherController.test.ts`.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts src/hooks/brushEngine/__tests__/colorCycleBrushSettingsController.test.ts src/hooks/brushEngine/__tests__/colorCycleBlendLockController.test.ts src/hooks/brushEngine/__tests__/alphaLockController.test.ts src/hooks/brushEngine/__tests__/brushStampController.test.ts src/hooks/brushEngine/__tests__/strokeBoundsController.test.ts src/hooks/brushEngine/__tests__/strokeDrawCoreController.test.ts src/hooks/brushEngine/__tests__/livePressureDitherController.test.ts` (pass)
  - Hook size checkpoint: `src/hooks/useBrushEngineSimplified.ts` at `2034` LOC (`wc -l`).
- 2026-02-07: Phase 1 slice 15 completed for pressure-runtime helper extraction.
  - Extracted pressure runtime helpers into `src/hooks/brushEngine/pressureRuntimeController.ts`:
    - `resolveStrokePressureForRender`
    - `resetPressureDitherState`
  - Kept `useBrushEngineSimplified` public API unchanged; local callbacks now delegate to controller helpers.
  - Added focused tests in `src/hooks/brushEngine/__tests__/pressureRuntimeController.test.ts`.
- 2026-02-07: Phase 1 slice 16 completed for stroke-dither wrapper extraction.
  - Extracted dither wrapper helpers into `src/hooks/brushEngine/strokeDitherController.ts`:
    - `ditherRegionWithCurrentPressure`
    - `applyStrokeDither`
  - Kept `useBrushEngineSimplified` public API unchanged; local callbacks now delegate to controller helpers.
  - Added focused tests in `src/hooks/brushEngine/__tests__/strokeDitherController.test.ts`.
- 2026-02-07: Phase 1 slice 17 completed for live-preview/overlay scheduling extraction.
  - Extracted live preview helpers into `src/hooks/brushEngine/liveStrokePreviewController.ts`:
    - `applyStrokeRisographOverlay`
    - `renderLiveStrokePreview`
    - `scheduleLiveStrokeRender`
  - Kept `useBrushEngineSimplified` public API unchanged; local callbacks now delegate to controller helpers.
  - Added focused tests in `src/hooks/brushEngine/__tests__/liveStrokePreviewController.test.ts`.
  - Validation run (post slices 15-17):
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts src/hooks/brushEngine/__tests__/colorCycleBrushSettingsController.test.ts src/hooks/brushEngine/__tests__/colorCycleBlendLockController.test.ts src/hooks/brushEngine/__tests__/alphaLockController.test.ts src/hooks/brushEngine/__tests__/brushStampController.test.ts src/hooks/brushEngine/__tests__/strokeBoundsController.test.ts src/hooks/brushEngine/__tests__/strokeDrawCoreController.test.ts src/hooks/brushEngine/__tests__/livePressureDitherController.test.ts src/hooks/brushEngine/__tests__/pressureRuntimeController.test.ts src/hooks/brushEngine/__tests__/strokeDitherController.test.ts src/hooks/brushEngine/__tests__/liveStrokePreviewController.test.ts` (pass)
  - Hook size checkpoint: `src/hooks/useBrushEngineSimplified.ts` at `2036` LOC (`wc -l`).
- 2026-02-07: Phase 1 slice 18 completed for pressure dither sampling extraction.
  - Extracted pressure dither sampling helpers into `src/hooks/brushEngine/pressureDitherSamplingController.ts`:
    - `updateStrokePresResPressure`
    - `getStrokeDitherPixelSize`
  - Kept `useBrushEngineSimplified` public API unchanged; local callbacks now delegate to controller helpers.
  - Added focused tests in `src/hooks/brushEngine/__tests__/pressureDitherSamplingController.test.ts`.
  - Validation run (post slices 18+):
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts src/hooks/brushEngine/__tests__/colorCycleBrushSettingsController.test.ts src/hooks/brushEngine/__tests__/colorCycleBlendLockController.test.ts src/hooks/brushEngine/__tests__/alphaLockController.test.ts src/hooks/brushEngine/__tests__/brushStampController.test.ts src/hooks/brushEngine/__tests__/strokeBoundsController.test.ts src/hooks/brushEngine/__tests__/strokeDrawCoreController.test.ts src/hooks/brushEngine/__tests__/livePressureDitherController.test.ts src/hooks/brushEngine/__tests__/pressureRuntimeController.test.ts src/hooks/brushEngine/__tests__/strokeDitherController.test.ts src/hooks/brushEngine/__tests__/liveStrokePreviewController.test.ts src/hooks/brushEngine/__tests__/pressureDitherSamplingController.test.ts` (pass)
  - Hook size checkpoint: `src/hooks/useBrushEngineSimplified.ts` at `1997` LOC (`wc -l`).
- 2026-02-07: Phase 1 slice 19 completed for finalize-stroke orchestration extraction.
  - Extracted finalize orchestration into `src/hooks/brushEngine/strokeFinalizeOrchestrator.ts`:
    - `finalizeStrokeOrchestrated`
  - Kept `useBrushEngineSimplified` public API unchanged; local `finalizeStroke` callback now delegates to orchestrator.
  - Added focused tests in `src/hooks/brushEngine/__tests__/strokeFinalizeOrchestrator.test.ts`.
- 2026-02-07: Phase 1 slice 20 completed for active-layer bitmap lookup extraction.
  - Extracted active-layer bitmap resolution logic into `src/hooks/brushEngine/activeLayerBitmapController.ts`:
    - `getActiveLayerBitmapCanvas`
  - Kept `useBrushEngineSimplified` public API unchanged; local callback now delegates to controller helper.
  - Added focused tests in `src/hooks/brushEngine/__tests__/activeLayerBitmapController.test.ts`.
  - Validation run (post slices 19-20):
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts src/hooks/brushEngine/__tests__/colorCycleBrushSettingsController.test.ts src/hooks/brushEngine/__tests__/colorCycleBlendLockController.test.ts src/hooks/brushEngine/__tests__/alphaLockController.test.ts src/hooks/brushEngine/__tests__/brushStampController.test.ts src/hooks/brushEngine/__tests__/strokeBoundsController.test.ts src/hooks/brushEngine/__tests__/strokeDrawCoreController.test.ts src/hooks/brushEngine/__tests__/livePressureDitherController.test.ts src/hooks/brushEngine/__tests__/pressureRuntimeController.test.ts src/hooks/brushEngine/__tests__/strokeDitherController.test.ts src/hooks/brushEngine/__tests__/liveStrokePreviewController.test.ts src/hooks/brushEngine/__tests__/pressureDitherSamplingController.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeOrchestrator.test.ts src/hooks/brushEngine/__tests__/activeLayerBitmapController.test.ts` (pass)
  - Hook size checkpoint: `src/hooks/useBrushEngineSimplified.ts` at `1915` LOC (`wc -l`).
- 2026-02-07: Phase 5 test expansion slice completed for direct extracted-unit coverage.
  - Added direct unit coverage for `strokeDrawEntry.ts` in `src/hooks/brushEngine/__tests__/strokeDrawEntry.test.ts`:
    - `runDrawBrushEntry` argument shaping (pressure/sampleTag/fallback flag/velocity/timestamp/custom brush forwarding)
    - `runDrawStampEntry` argument shaping (point stamp params/sampleTag/fallback flag/velocity/timestamp)
  - Added direct unit coverage for `strokeFinalizeController.ts` in `src/hooks/brushEngine/__tests__/strokeFinalizeController.test.ts`:
    - `buildStrokeFinalizeContext` region normalization + context resolution and live-bounds fallback
    - `finalizeStrokeEngineBuffers` raw-context finalize path vs alpha-lock finalize path
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts src/hooks/brushEngine/__tests__/colorCycleBrushSettingsController.test.ts src/hooks/brushEngine/__tests__/colorCycleBlendLockController.test.ts src/hooks/brushEngine/__tests__/alphaLockController.test.ts src/hooks/brushEngine/__tests__/brushStampController.test.ts src/hooks/brushEngine/__tests__/strokeBoundsController.test.ts src/hooks/brushEngine/__tests__/strokeDrawCoreController.test.ts src/hooks/brushEngine/__tests__/livePressureDitherController.test.ts src/hooks/brushEngine/__tests__/pressureRuntimeController.test.ts src/hooks/brushEngine/__tests__/strokeDitherController.test.ts src/hooks/brushEngine/__tests__/liveStrokePreviewController.test.ts src/hooks/brushEngine/__tests__/pressureDitherSamplingController.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeOrchestrator.test.ts src/hooks/brushEngine/__tests__/activeLayerBitmapController.test.ts src/hooks/brushEngine/__tests__/strokeDrawEntry.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeController.test.ts` (pass)
  - Hook size checkpoint (no behavior/structure changes in this slice): `src/hooks/useBrushEngineSimplified.ts` at `1915` LOC (`wc -l`).
- 2026-02-07: Phase 1 slice 21 completed for transparency/composite helper extraction.
  - Extracted transparency/compositing helpers into `src/hooks/brushEngine/transparencyCompositeController.ts`:
    - `withTransparencyLockComposite`
    - `setBlendModeIfUnlocked`
    - `setMultiplyIfUnlocked`
  - Kept `useBrushEngineSimplified` public API unchanged; local callbacks now delegate to controller helpers.
  - Added focused tests in `src/hooks/brushEngine/__tests__/transparencyCompositeController.test.ts`.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts src/hooks/brushEngine/__tests__/colorCycleBrushSettingsController.test.ts src/hooks/brushEngine/__tests__/colorCycleBlendLockController.test.ts src/hooks/brushEngine/__tests__/alphaLockController.test.ts src/hooks/brushEngine/__tests__/brushStampController.test.ts src/hooks/brushEngine/__tests__/strokeBoundsController.test.ts src/hooks/brushEngine/__tests__/strokeDrawCoreController.test.ts src/hooks/brushEngine/__tests__/livePressureDitherController.test.ts src/hooks/brushEngine/__tests__/pressureRuntimeController.test.ts src/hooks/brushEngine/__tests__/strokeDitherController.test.ts src/hooks/brushEngine/__tests__/liveStrokePreviewController.test.ts src/hooks/brushEngine/__tests__/pressureDitherSamplingController.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeOrchestrator.test.ts src/hooks/brushEngine/__tests__/activeLayerBitmapController.test.ts src/hooks/brushEngine/__tests__/strokeDrawEntry.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeController.test.ts src/hooks/brushEngine/__tests__/transparencyCompositeController.test.ts` (pass)
  - Hook size checkpoint: `src/hooks/useBrushEngineSimplified.ts` at `1916` LOC (`wc -l`).
- 2026-02-07: Major-phase validation checkpoint completed.
  - Full repository test suite run:
    1. `npm test` (pass: 205/206 suites passed, 1 skipped; 867/868 tests passed, 1 skipped)
  - Plan DoD status checkpoint:
    - `useBrushEngineSimplified.ts` remains below threshold at `1916` LOC.
    - Largest remaining `useCallback` block in `useBrushEngineSimplified.ts` is `layerHasAnyAlpha` at `101` LOC, below the `<= 200` DoD cap.
- 2026-02-07: Phase 1 slice 22 completed for alpha-presence detection extraction.
  - Extracted active-layer alpha detection/cache logic into `src/hooks/brushEngine/alphaPresenceController.ts`:
    - `detectLayerHasAnyAlpha`
  - Kept `useBrushEngineSimplified` public API unchanged; local `layerHasAnyAlpha` callback now delegates to controller helper.
  - Added focused tests in `src/hooks/brushEngine/__tests__/alphaPresenceController.test.ts`.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts src/hooks/brushEngine/__tests__/colorCycleBrushSettingsController.test.ts src/hooks/brushEngine/__tests__/colorCycleBlendLockController.test.ts src/hooks/brushEngine/__tests__/alphaLockController.test.ts src/hooks/brushEngine/__tests__/brushStampController.test.ts src/hooks/brushEngine/__tests__/strokeBoundsController.test.ts src/hooks/brushEngine/__tests__/strokeDrawCoreController.test.ts src/hooks/brushEngine/__tests__/livePressureDitherController.test.ts src/hooks/brushEngine/__tests__/pressureRuntimeController.test.ts src/hooks/brushEngine/__tests__/strokeDitherController.test.ts src/hooks/brushEngine/__tests__/liveStrokePreviewController.test.ts src/hooks/brushEngine/__tests__/pressureDitherSamplingController.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeOrchestrator.test.ts src/hooks/brushEngine/__tests__/activeLayerBitmapController.test.ts src/hooks/brushEngine/__tests__/strokeDrawEntry.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeController.test.ts src/hooks/brushEngine/__tests__/transparencyCompositeController.test.ts src/hooks/brushEngine/__tests__/alphaPresenceController.test.ts` (pass)
  - Hook size checkpoint: `src/hooks/useBrushEngineSimplified.ts` at `1825` LOC (`wc -l`).
  - Largest remaining `useCallback` block now: `runStrokeDrawCore` at `59` LOC.
- 2026-02-07: Phase 3 type-contract consolidation slice completed for stroke draw payloads.
  - Replaced ad-hoc custom-brush payload types with shared `CustomBrushStrokeData` contracts:
    - `src/hooks/brushEngine/strokeDrawCoreController.ts`
    - `src/hooks/useBrushEngineSimplified.ts` (`drawBrush` cursor contract)
  - Preserved behavior and callback flow; this is a type-surface cleanup only.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts src/hooks/brushEngine/__tests__/colorCycleBrushSettingsController.test.ts src/hooks/brushEngine/__tests__/colorCycleBlendLockController.test.ts src/hooks/brushEngine/__tests__/alphaLockController.test.ts src/hooks/brushEngine/__tests__/brushStampController.test.ts src/hooks/brushEngine/__tests__/strokeBoundsController.test.ts src/hooks/brushEngine/__tests__/strokeDrawCoreController.test.ts src/hooks/brushEngine/__tests__/livePressureDitherController.test.ts src/hooks/brushEngine/__tests__/pressureRuntimeController.test.ts src/hooks/brushEngine/__tests__/strokeDitherController.test.ts src/hooks/brushEngine/__tests__/liveStrokePreviewController.test.ts src/hooks/brushEngine/__tests__/pressureDitherSamplingController.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeOrchestrator.test.ts src/hooks/brushEngine/__tests__/activeLayerBitmapController.test.ts src/hooks/brushEngine/__tests__/strokeDrawEntry.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeController.test.ts src/hooks/brushEngine/__tests__/transparencyCompositeController.test.ts src/hooks/brushEngine/__tests__/alphaPresenceController.test.ts` (pass)
  - Hook size checkpoint: `src/hooks/useBrushEngineSimplified.ts` at `1820` LOC (`wc -l`).
- 2026-02-07: Phase 4 dependency-boundary cleanup slice completed for stroke settings adapters.
  - Added stable memoized adapters in `useBrushEngineSimplified`:
    - `strokeDrawRuntimeSettings`
    - `finalizeStrokeSettings`
  - Replaced direct `tools.brushSettings.*` reads in `runStrokeDrawCore`/`finalizeStroke` callbacks with adapter fields.
  - Reduced callback dependency-array noise by depending on stable settings adapters rather than individual setting keys in those callbacks.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts src/hooks/brushEngine/__tests__/colorCycleBrushSettingsController.test.ts src/hooks/brushEngine/__tests__/colorCycleBlendLockController.test.ts src/hooks/brushEngine/__tests__/alphaLockController.test.ts src/hooks/brushEngine/__tests__/brushStampController.test.ts src/hooks/brushEngine/__tests__/strokeBoundsController.test.ts src/hooks/brushEngine/__tests__/strokeDrawCoreController.test.ts src/hooks/brushEngine/__tests__/livePressureDitherController.test.ts src/hooks/brushEngine/__tests__/pressureRuntimeController.test.ts src/hooks/brushEngine/__tests__/strokeDitherController.test.ts src/hooks/brushEngine/__tests__/liveStrokePreviewController.test.ts src/hooks/brushEngine/__tests__/pressureDitherSamplingController.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeOrchestrator.test.ts src/hooks/brushEngine/__tests__/activeLayerBitmapController.test.ts src/hooks/brushEngine/__tests__/strokeDrawEntry.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeController.test.ts src/hooks/brushEngine/__tests__/transparencyCompositeController.test.ts src/hooks/brushEngine/__tests__/alphaPresenceController.test.ts` (pass)
  - Hook size checkpoint: `src/hooks/useBrushEngineSimplified.ts` at `1835` LOC (`wc -l`).
  - Largest remaining `useCallback` block: `runStrokeDrawCore` at `58` LOC.
- 2026-02-07: Phase 4 dependency-boundary cleanup slice completed for pressure-reset runtime deduplication.
  - Consolidated repeated `resetStrokePressureDitherRuntime(...)` arg wiring behind a single stable helper in `useBrushEngineSimplified`:
    - `runResetPressureDitherRuntime(resetCommittedAndPending)`
  - Updated all call sites to use this helper:
    - pressure-linked mode toggle effect
    - `resetPressureDitherState`
    - `resetStroke`
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts src/hooks/brushEngine/__tests__/colorCycleBrushSettingsController.test.ts src/hooks/brushEngine/__tests__/colorCycleBlendLockController.test.ts src/hooks/brushEngine/__tests__/alphaLockController.test.ts src/hooks/brushEngine/__tests__/brushStampController.test.ts src/hooks/brushEngine/__tests__/strokeBoundsController.test.ts src/hooks/brushEngine/__tests__/strokeDrawCoreController.test.ts src/hooks/brushEngine/__tests__/livePressureDitherController.test.ts src/hooks/brushEngine/__tests__/pressureRuntimeController.test.ts src/hooks/brushEngine/__tests__/strokeDitherController.test.ts src/hooks/brushEngine/__tests__/liveStrokePreviewController.test.ts src/hooks/brushEngine/__tests__/pressureDitherSamplingController.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeOrchestrator.test.ts src/hooks/brushEngine/__tests__/activeLayerBitmapController.test.ts src/hooks/brushEngine/__tests__/strokeDrawEntry.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeController.test.ts src/hooks/brushEngine/__tests__/transparencyCompositeController.test.ts src/hooks/brushEngine/__tests__/alphaPresenceController.test.ts` (pass)
  - Hook size checkpoint: `src/hooks/useBrushEngineSimplified.ts` at `1813` LOC (`wc -l`).
  - Largest remaining `useCallback` block: `runStrokeDrawCore` at `58` LOC.
- 2026-02-07: Phase 4 dependency-boundary cleanup slice completed for live-stroke runtime settings adapters.
  - Added stable memoized adapters in `useBrushEngineSimplified` for remaining callback-local setting reads:
    - `livePressureDitherSettings`
    - `strokePressureRuntimeSettings`
    - `liveStrokeTrackingSettings`
  - Replaced direct `tools.brushSettings.*` reads in these callbacks with adapter fields:
    - `runLivePressureDitherForCurrentStroke`
    - `resolveStrokePressureForRender`
    - `trackLiveStrokeSegment`
  - Also consolidated the last ad-hoc inline `customBrushData` callback type in `runStrokeDrawCore` to shared `CustomBrushStrokeData`.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts src/hooks/brushEngine/__tests__/colorCycleBrushSettingsController.test.ts src/hooks/brushEngine/__tests__/colorCycleBlendLockController.test.ts src/hooks/brushEngine/__tests__/alphaLockController.test.ts src/hooks/brushEngine/__tests__/brushStampController.test.ts src/hooks/brushEngine/__tests__/strokeBoundsController.test.ts src/hooks/brushEngine/__tests__/strokeDrawCoreController.test.ts src/hooks/brushEngine/__tests__/livePressureDitherController.test.ts src/hooks/brushEngine/__tests__/pressureRuntimeController.test.ts src/hooks/brushEngine/__tests__/strokeDitherController.test.ts src/hooks/brushEngine/__tests__/liveStrokePreviewController.test.ts src/hooks/brushEngine/__tests__/pressureDitherSamplingController.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeOrchestrator.test.ts src/hooks/brushEngine/__tests__/activeLayerBitmapController.test.ts src/hooks/brushEngine/__tests__/strokeDrawEntry.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeController.test.ts src/hooks/brushEngine/__tests__/transparencyCompositeController.test.ts src/hooks/brushEngine/__tests__/alphaPresenceController.test.ts` (pass)
  - Hook size checkpoint: `src/hooks/useBrushEngineSimplified.ts` at `1824` LOC (`wc -l`).
  - Largest remaining `useCallback` block: `runStrokeDrawCore` at `53` LOC.
- 2026-02-07: Phase 1 slice 23 completed for finalize-stroke callback entry extraction.
  - Extracted finalize callback entry wiring into `src/hooks/brushEngine/strokeFinalizeEntryController.ts`:
    - `finalizeStrokeCurrent`
  - Kept `useBrushEngineSimplified` public API unchanged; local `finalizeStroke` callback now delegates to the new entry controller.
  - Added focused tests in `src/hooks/brushEngine/__tests__/strokeFinalizeEntryController.test.ts`.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts src/hooks/brushEngine/__tests__/colorCycleBrushSettingsController.test.ts src/hooks/brushEngine/__tests__/colorCycleBlendLockController.test.ts src/hooks/brushEngine/__tests__/alphaLockController.test.ts src/hooks/brushEngine/__tests__/brushStampController.test.ts src/hooks/brushEngine/__tests__/strokeBoundsController.test.ts src/hooks/brushEngine/__tests__/strokeDrawCoreController.test.ts src/hooks/brushEngine/__tests__/livePressureDitherController.test.ts src/hooks/brushEngine/__tests__/pressureRuntimeController.test.ts src/hooks/brushEngine/__tests__/strokeDitherController.test.ts src/hooks/brushEngine/__tests__/liveStrokePreviewController.test.ts src/hooks/brushEngine/__tests__/pressureDitherSamplingController.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeOrchestrator.test.ts src/hooks/brushEngine/__tests__/activeLayerBitmapController.test.ts src/hooks/brushEngine/__tests__/strokeDrawEntry.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeController.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeEntryController.test.ts src/hooks/brushEngine/__tests__/transparencyCompositeController.test.ts src/hooks/brushEngine/__tests__/alphaPresenceController.test.ts` (pass)
  - Hook size checkpoint: `src/hooks/useBrushEngineSimplified.ts` at `1822` LOC (`wc -l`).
  - Largest remaining `useCallback` block: `runStrokeDrawCore` at `53` LOC.
- 2026-02-07: Phase 1 slice 24 completed for stroke-draw callback entry extraction.
  - Extracted stroke-draw callback entry wiring into `src/hooks/brushEngine/strokeDrawCoreEntryController.ts`:
    - `runStrokeDrawCoreEntry`
  - Kept `useBrushEngineSimplified` public API unchanged; local `runStrokeDrawCore` callback now delegates to the new entry controller.
  - Added focused tests in `src/hooks/brushEngine/__tests__/strokeDrawCoreEntryController.test.ts`.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts src/hooks/brushEngine/__tests__/colorCycleBrushSettingsController.test.ts src/hooks/brushEngine/__tests__/colorCycleBlendLockController.test.ts src/hooks/brushEngine/__tests__/alphaLockController.test.ts src/hooks/brushEngine/__tests__/brushStampController.test.ts src/hooks/brushEngine/__tests__/strokeBoundsController.test.ts src/hooks/brushEngine/__tests__/strokeDrawCoreController.test.ts src/hooks/brushEngine/__tests__/strokeDrawCoreEntryController.test.ts src/hooks/brushEngine/__tests__/livePressureDitherController.test.ts src/hooks/brushEngine/__tests__/pressureRuntimeController.test.ts src/hooks/brushEngine/__tests__/strokeDitherController.test.ts src/hooks/brushEngine/__tests__/liveStrokePreviewController.test.ts src/hooks/brushEngine/__tests__/pressureDitherSamplingController.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeOrchestrator.test.ts src/hooks/brushEngine/__tests__/activeLayerBitmapController.test.ts src/hooks/brushEngine/__tests__/strokeDrawEntry.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeController.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeEntryController.test.ts src/hooks/brushEngine/__tests__/transparencyCompositeController.test.ts src/hooks/brushEngine/__tests__/alphaPresenceController.test.ts` (pass)
  - Hook size checkpoint: `src/hooks/useBrushEngineSimplified.ts` at `1821` LOC (`wc -l`).
  - Largest remaining `useCallback` block: `runStrokeDrawCore` at `52` LOC.
- 2026-02-07: Phase 3 type-contract consolidation follow-up for stroke-draw callback args.
  - Exported and adopted shared entry-arg contract type:
    - `RunStrokeDrawCoreEntryArgs` from `src/hooks/brushEngine/strokeDrawCoreEntryController.ts`
  - Replaced hook-local inline `runStrokeDrawCore` argument typing with a typed `Omit<RunStrokeDrawCoreEntryArgs, ...>` contract in `src/hooks/useBrushEngineSimplified.ts`.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts src/hooks/brushEngine/__tests__/colorCycleBrushSettingsController.test.ts src/hooks/brushEngine/__tests__/colorCycleBlendLockController.test.ts src/hooks/brushEngine/__tests__/alphaLockController.test.ts src/hooks/brushEngine/__tests__/brushStampController.test.ts src/hooks/brushEngine/__tests__/strokeBoundsController.test.ts src/hooks/brushEngine/__tests__/strokeDrawCoreController.test.ts src/hooks/brushEngine/__tests__/strokeDrawCoreEntryController.test.ts src/hooks/brushEngine/__tests__/livePressureDitherController.test.ts src/hooks/brushEngine/__tests__/pressureRuntimeController.test.ts src/hooks/brushEngine/__tests__/strokeDitherController.test.ts src/hooks/brushEngine/__tests__/liveStrokePreviewController.test.ts src/hooks/brushEngine/__tests__/pressureDitherSamplingController.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeOrchestrator.test.ts src/hooks/brushEngine/__tests__/activeLayerBitmapController.test.ts src/hooks/brushEngine/__tests__/strokeDrawEntry.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeController.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeEntryController.test.ts src/hooks/brushEngine/__tests__/transparencyCompositeController.test.ts src/hooks/brushEngine/__tests__/alphaPresenceController.test.ts` (pass)
  - Hook size checkpoint: `src/hooks/useBrushEngineSimplified.ts` at `1825` LOC (`wc -l`).
  - Largest remaining `useCallback` block: `runStrokeDrawCore` at `56` LOC.
- 2026-02-07: Phase 3 type-contract consolidation completion for stroke-draw callback signature.
  - Added shared hook-facing type alias:
    - `RunStrokeDrawCoreHookArgs` in `src/hooks/brushEngine/strokeDrawCoreEntryController.ts`
  - Simplified `useBrushEngineSimplified` `runStrokeDrawCore` callback signature/body to consume `RunStrokeDrawCoreHookArgs` and forward `...args` to `runStrokeDrawCoreEntry`.
  - This removes duplicated callback arg shape declarations from the hook while keeping behavior unchanged.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts src/hooks/brushEngine/__tests__/colorCycleBrushSettingsController.test.ts src/hooks/brushEngine/__tests__/colorCycleBlendLockController.test.ts src/hooks/brushEngine/__tests__/alphaLockController.test.ts src/hooks/brushEngine/__tests__/brushStampController.test.ts src/hooks/brushEngine/__tests__/strokeBoundsController.test.ts src/hooks/brushEngine/__tests__/strokeDrawCoreController.test.ts src/hooks/brushEngine/__tests__/strokeDrawCoreEntryController.test.ts src/hooks/brushEngine/__tests__/livePressureDitherController.test.ts src/hooks/brushEngine/__tests__/pressureRuntimeController.test.ts src/hooks/brushEngine/__tests__/strokeDitherController.test.ts src/hooks/brushEngine/__tests__/liveStrokePreviewController.test.ts src/hooks/brushEngine/__tests__/pressureDitherSamplingController.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeOrchestrator.test.ts src/hooks/brushEngine/__tests__/activeLayerBitmapController.test.ts src/hooks/brushEngine/__tests__/strokeDrawEntry.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeController.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeEntryController.test.ts src/hooks/brushEngine/__tests__/transparencyCompositeController.test.ts src/hooks/brushEngine/__tests__/alphaPresenceController.test.ts` (pass)
  - Hook size checkpoint: `src/hooks/useBrushEngineSimplified.ts` at `1799` LOC (`wc -l`).
  - Largest remaining `useCallback` block: `finalizeStroke` at `40` LOC.
- 2026-02-07: Phase 1 slice 25 completed for reset-stroke callback entry extraction.
  - Extracted reset callback entry wiring into `src/hooks/brushEngine/strokeResetEntryController.ts`:
    - `resetStrokeCurrent`
  - Kept `useBrushEngineSimplified` public API unchanged; local `resetStroke` callback now delegates to the new entry controller.
  - Added focused tests in `src/hooks/brushEngine/__tests__/strokeResetEntryController.test.ts`.
  - Validation run:
    1. `npm run type-check` (pass)
    2. `npm run lint` (pass, no ESLint warnings/errors)
    3. `npm test -- src/hooks/__tests__/useBrushEngineSimplified.test.ts src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx src/stores/__tests__/colorCycleBrushManager.integration.test.ts src/hooks/brushEngine/__tests__/shapeRectangleGradientController.test.ts src/hooks/brushEngine/__tests__/shapePolygonGradientController.test.ts src/hooks/brushEngine/__tests__/shapeRisographEffect.test.ts src/hooks/brushEngine/__tests__/colorCycleInitController.test.ts src/hooks/brushEngine/__tests__/colorCycleDrawController.test.ts src/hooks/brushEngine/__tests__/colorCycleStrokeLifecycleController.test.ts src/hooks/brushEngine/__tests__/colorCycleFillController.test.ts src/hooks/brushEngine/__tests__/colorCycleRisographOverlayController.test.ts src/hooks/brushEngine/__tests__/colorCycleBrushSettingsController.test.ts src/hooks/brushEngine/__tests__/colorCycleBlendLockController.test.ts src/hooks/brushEngine/__tests__/alphaLockController.test.ts src/hooks/brushEngine/__tests__/brushStampController.test.ts src/hooks/brushEngine/__tests__/strokeBoundsController.test.ts src/hooks/brushEngine/__tests__/strokeDrawCoreController.test.ts src/hooks/brushEngine/__tests__/strokeDrawCoreEntryController.test.ts src/hooks/brushEngine/__tests__/strokeResetEntryController.test.ts src/hooks/brushEngine/__tests__/livePressureDitherController.test.ts src/hooks/brushEngine/__tests__/pressureRuntimeController.test.ts src/hooks/brushEngine/__tests__/strokeDitherController.test.ts src/hooks/brushEngine/__tests__/liveStrokePreviewController.test.ts src/hooks/brushEngine/__tests__/pressureDitherSamplingController.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeOrchestrator.test.ts src/hooks/brushEngine/__tests__/activeLayerBitmapController.test.ts src/hooks/brushEngine/__tests__/strokeDrawEntry.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeController.test.ts src/hooks/brushEngine/__tests__/strokeFinalizeEntryController.test.ts src/hooks/brushEngine/__tests__/transparencyCompositeController.test.ts src/hooks/brushEngine/__tests__/alphaPresenceController.test.ts` (pass)
  - Hook size checkpoint: `src/hooks/useBrushEngineSimplified.ts` at `1799` LOC (`wc -l`).
  - Largest remaining `useCallback` block: `finalizeStroke` at `40` LOC.
- 2026-02-07: Final closure checkpoint after slice 25.
  - Full repository suite re-run at HEAD:
    1. `npm test` (pass: 209/210 suites passed, 1 skipped; 874/875 tests passed, 1 skipped)
  - DoD metric re-check:
    - `src/hooks/useBrushEngineSimplified.ts` remains at `1799` LOC (`wc -l`).
    - Largest remaining `useCallback` block remains `finalizeStroke` at `40` LOC.
  - Manual sanity status:
    - Interactive drawing-flow sanity checklist from this plan is pending local UI verification (cannot be executed in headless CLI).
