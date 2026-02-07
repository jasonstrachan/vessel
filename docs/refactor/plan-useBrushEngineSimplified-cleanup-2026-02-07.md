# useBrushEngineSimplified Cleanup Plan (2026-02-07)

## Date
- 2026-02-07

## Goal
Reduce complexity and risk in `src/hooks/useBrushEngineSimplified.ts` while preserving behavior, performance characteristics, and external hook API.

## Current State Snapshot
- Hook size remains high (`~3697` LOC).
- Multiple no-behavior refactor slices have already been extracted into `src/hooks/brushEngine/*`.
- Existing repo-wide lint warning remains unrelated to this cleanup:
  - `src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts:1089` (`flowBits` unused).
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
