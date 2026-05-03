# CC Layer Wipe Authority Boundaries

Date: 2026-05-03

## Invariant

Canonical color-cycle layer data is the editable animated payload. A destructive path must not silently replace that payload with empty pixels, gradient-only metadata, missing def ids, missing motion buffers, static preview pixels, or sequential layer data.

Healthy editable CC payload requires the canonical channel set:

- paint
- gradient id
- gradient def id
- speed
- flow
- phase

Rendered RGBA, `canvasImageData`, compositor output, and compatibility previews are not canonical CC paint except inside explicit import/repair flows.

## Boundary Map

| Boundary | Authority | Guardrail | Regression coverage |
| --- | --- | --- | --- |
| Write-side capture/finalize/commit | `ColorCycleBrushCanvas2D` runtime buffers and `commitCommittedLayerState(...)` | Finalize/commit writes through runtime snapshots and stamped gradient-def bindings; committed store sync only patches binding buffers and keeps the layer type/color-cycle data intact. | `src/hooks/brushEngine/__tests__/ColorCycleBrushCanvas2D.regression.test.ts`, `src/hooks/canvas/handlers/colorCycle/__tests__/colorCycleCommit.test.ts`, `src/hooks/canvas/handlers/colorCycle/__tests__/colorCycleShapeFill.transparencyLock.test.ts` |
| Runtime mutation | `src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts` | Runtime clears are audited by `color-cycle-layer-cleared`; reset/clear reasons are explicit destructive events, not hidden persistence state. | `src/hooks/brushEngine/__tests__/ColorCycleBrushCanvas2D.regression.test.ts` |
| Committed layer store sync | `src/stores/layers/createLayersSlice.ts` and runtime sync calls | `updateLayer(...)` blocks CC-to-normal downgrades and blocks `colorCycleData` clears on CC layers. | `src/stores/__tests__/layersSlice.integration.test.ts` |
| History/undo snapshots | `src/history/helpers/colorCycle.ts` | History uses `captureColorCyclePersistenceSnapshot(...)` rather than accepting metadata-only state as animated CC. | `tests/history/historyManager.test.ts`, `src/stores/__tests__/historyIntegration.test.ts` |
| Save/autosave serialization | `src/utils/projectIO.ts` through `src/lib/colorCycle/persistence/` | Save/autosave call `captureColorCyclePersistenceSnapshot(...)`; primary payload failures log `cc-save-primary-payload-drop-blocked` and fail closed instead of publishing partial canonical refs. | `src/lib/colorCycle/persistence/__tests__/captureColorCyclePersistenceSnapshot.test.ts`, `src/utils/__tests__/projectIO.test.ts`, `tests/cc-layer-wipe-scenario-matrix.test.ts` |
| Warmup/restore hydration | `src/utils/projectIO.ts` and `src/hooks/canvas/handlers/colorCycle/colorCycleRuntimeWarmup.ts` | Warmup validates canonical payload before publishing editable runtime; failures log `cc-warmup-canonical-payload-drop-blocked` and remain cold/static-preview/repair-failed. | `src/hooks/canvas/handlers/colorCycle/__tests__/colorCycleRuntimeWarmup.test.ts`, `src/utils/__tests__/projectIO.test.ts`, `tests/cc-layer-wipe-scenario-matrix.test.ts` |
| Goblet/export packaging | `src/utils/export/goblet/gobletColorCycleSerializer.ts` | Export uses snapshot mode `export`; unresolved cold refs are not converted into fake animated brush data, and gradient-only CC rejects with missing animated brush data. | `src/utils/export/goblet/__tests__/gobletBrushStateFallbacks.test.ts`, `tests/cc-layer-wipe-scenario-matrix.test.ts`, `tests/goblet2-runtime-regression.test.ts` |
| Selection/marquee delete authorization | `src/stores/helpers/selectionDeleteAuthorization.ts`, `src/stores/helpers/colorCycleSelection.ts`, `src/stores/slices/selectionSlice.ts` | Delete requires same-layer ownership and full canonical paint proof; suspicious keyboard full-content clears are blocked unless they come from explicit same-layer select-all. Missing canonical paint logs `color-cycle-selection-clear-skipped-missing-canonical-paint`. | `src/stores/helpers/__tests__/selectionDeleteAuthorization.test.ts`, `src/stores/__tests__/selectionFramebufferDelete.test.ts`, `tests/cc-layer-wipe-scenario-matrix.test.ts` |

## Remaining Risks

- Full manual browser signoff is still useful because automated tests cover the destructive boundaries and archive contracts, but not every human drawing gesture sequence.
- Static-preview/repair-failed layers can preserve visual pixels but are intentionally not editable animated CC. Export and save paths must keep treating them as damaged unless an explicit repair flow succeeds.
- Future features that mutate CC data must enter through the existing boundary modules above. New ad hoc uses of `canvasImageData`, `gradientIdBuffer`, `gradientDefIdBuffer`, or `brushState` as independent truth should be treated as data-loss risk.

## Audit Commands

Targeted boundary tests:

```bash
npm test -- --runTestsByPath tests/cc-layer-wipe-scenario-matrix.test.ts src/stores/__tests__/layersSlice.integration.test.ts src/stores/__tests__/selectionFramebufferDelete.test.ts src/stores/helpers/__tests__/selectionDeleteAuthorization.test.ts src/lib/colorCycle/persistence/__tests__/captureColorCyclePersistenceSnapshot.test.ts src/utils/__tests__/projectIO.test.ts src/hooks/canvas/handlers/colorCycle/__tests__/colorCycleRuntimeWarmup.test.ts src/hooks/brushEngine/__tests__/ColorCycleBrushCanvas2D.regression.test.ts --runInBand
```

Release gates:

```bash
npm run type-check
npm run lint
npm test
```
