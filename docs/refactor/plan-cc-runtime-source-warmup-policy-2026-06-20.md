# CC Runtime Source And Warmup Policy Refactor Plan

Date: 2026-06-20

Status: completed

## Goal

Centralize the color-cycle runtime source decision so edit warmup, playback warmup, deferred restore, and persistence hydration agree on the same answer to:

- is this layer editable from canonical CC data,
- is this layer warmable/restorable from cold runtime data,
- is this layer only a static/preview fallback,
- and which legacy/persisted buffer references must still be preserved as restore authority.

This is a narrow structural refactor. It should reduce duplicated source checks without changing rendering, dither behavior, animation timing, or save/export contracts.

## Current Patch Status

- [x] Added `src/lib/colorCycle/runtimeSourcePolicy.ts`.
- [x] Added focused tests in `src/lib/colorCycle/__tests__/runtimeSourcePolicy.test.ts`.
- [x] Replaced local edit-warmup source checks in `colorCycleRuntimeWarmup.ts`.
- [x] Replaced playback warmup source checks in `colorCyclePlayback.ts`.
- [x] Replaced duplicated warmable-source checks in `createLayersSlice.ts`.
- [x] Preserved persisted `brushState.layers[].strokeData.gradientIdBuffer` and `gradientDefIdBuffer` as warmable runtime binding sources.
- [x] Kept gradient-only/runtime-binding refs warmable, but not editable or recoverable paint authority.
- [x] Fixed the adjacent `colorCycleStrokeCommit.ts` type guard surfaced by type-check.
- [x] Rerun the full Jest suite after the reviewer regression fix.
- [x] Commit the refactor after verification.

## Active Files

- `src/lib/colorCycle/runtimeSourcePolicy.ts`
- `src/lib/colorCycle/__tests__/runtimeSourcePolicy.test.ts`
- `src/hooks/canvas/handlers/colorCycle/colorCycleRuntimeWarmup.ts`
- `src/utils/colorCyclePlayback.ts`
- `src/stores/layers/createLayersSlice.ts`
- `src/lib/colorCycle/persistence/index.ts`
- `src/hooks/canvas/handlers/colorCycle/colorCycleStrokeCommit.ts`

## Policy Contract

The new policy distinguishes four related but different concepts:

- `hasEditableSource`: complete canonical document state that can safely enter edit-time warmup.
- `hasRecoverableRuntimeSource`: recoverable paint/runtime authority via existing recovery checks.
- `hasRuntimeRestoreSource`: any source worth attempting runtime restore from, including legacy or persisted binding refs.
- `hasPlaybackWarmupSource`: the existing playback-time behavior, routed through the central policy.

Important nuance:

- Gradient binding refs alone are warmable restore authority because older persisted layers may need them to rebuild runtime bindings.
- Gradient binding refs alone are not editable paint authority and must not be treated as recovered animated paint.
- Static preview/canvas pixels must not become canonical CC paint unless an explicit legacy repair path says so.

## Validation Already Run

- [x] `npm run type-check`
- [x] `npm run lint`
- [x] `git diff --check`
- [x] Focused warmup/restore tests after the brushState gradient-ref fix:
  - `src/lib/colorCycle/__tests__/runtimeSourcePolicy.test.ts`
  - `src/stores/__tests__/layersSlice.integration.test.ts`
  - `src/hooks/canvas/handlers/colorCycle/__tests__/colorCycleRuntimeWarmup.test.ts`
  - `src/utils/__tests__/colorCyclePlayback.test.ts`
- [x] Full `npm test` before the small reviewer regression fix.

## Remaining Verification

- [x] Run full `npm test` after the brushState gradient-ref fix.
- [x] Recheck `git diff --stat` and staged diff before commit.
- [x] Confirm no unrelated user changes are staged.

## Next Refactor Steps

These are deliberately not part of the current patch unless a bug forces them:

- Extract a small runtime hydration boundary around `ensureColorCycleLayerRuntime` and `scheduleDeferredColorCycleRestore`.
- Move brush restore orchestration out of `projectIO.restoreColorCycleBrushes` into a smaller color-cycle hydration module.
- Keep persistence source resolution as the save/history authority and runtime hydration as a consumer of validated state.
- Decompose `ColorCycleBrushCanvas2D` and `ColorCycleAnimator` only after warmup/source authority is stable.

## Non-Goals

- Do not change CC rendering output.
- Do not change dither algorithm selection.
- Do not inject jitter/noise as a workaround.
- Do not rewrite `projectIO.ts` in this patch.
- Do not broaden into Goblet export, playback UX, or brush engine decomposition.

## Definition Of Done

- All source/warmup gates touched by this patch use `runtimeSourcePolicy`.
- Legacy and persisted brushState gradient-binding refs remain warmable.
- Edit-time warmup still requires canonical editable data.
- Playback/store warmup still attempts valid restore sources without promoting preview-only data to canonical paint.
- Focused tests and full repo tests pass.
- The final diff is small enough to review as a policy extraction, not a renderer or persistence rewrite.
