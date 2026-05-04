# Layer Health Inspector Plan

## Goal

Add a left-toolbar tool that inspects every layer for structural health, with special coverage for color-cycle canonical data, animation channels, runtime/compatibility state, and explicit repair actions where the existing repair path can safely recover data.

## Non-Negotiables

- Inspect canonical color-cycle document data first; do not treat runtime canvas surfaces as document truth.
- Do not add display fallbacks that hide failed runtime materialization.
- Inspection must be read-only: no hydration, no brush creation, no playback start, no materialization, no repair, and no layer mutation during inspection.
- Keep repair explicit and user-triggered.
- Only repair cases the existing CC repair logic can justify, especially missing paint recovered from a compatibility snapshot with valid gradient bindings.
- Reuse the existing import-repair semantics when repairing; do not create a second, weaker repair writer.
- Report unrepairable problems clearly instead of fabricating CC paint, gradient bindings, or animation buffers.

## Implementation Checklist

- [ ] Trace current layer authority paths.
  - Confirm `Layer.colorCycleData` fields for canonical, persisted compatibility, and runtime data.
  - Confirm `normalizeColorCycleLayerDocumentState` success/failure states.
  - Confirm `repairLegacyColorCycleLayer` repairable and unrepairable cases.
  - Confirm the existing project-load repair sequence: lazy archive hydration, saved snapshot binding prep, `repairLegacyColorCycleLayer`, canonical repair-state write, saved brush-state cache update, hydration state, dirty/recomposition invalidation.
  - Confirm the store update path needed to publish repaired layer data, mark dirty, and mark recomposition.

- [ ] Add a pure inspection module.
  - Create `src/lib/layers/layerHealth.ts`.
  - Return structured per-layer results with severity: `ok`, `warning`, `error`, `repairable`.
  - Include common layer checks: dimensions, framebuffer/imageData presence, visibility, opacity, blend mode, and layer type.
  - Include CC checks: document-state normalization, paint buffer presence, expected byte lengths, gradient bindings, palettes/defs, and `hasContent`.
  - Include CC animation checks: phase, speed, flow, gradient-id, and gradient-def-id buffers.
  - Include CC mask checks: erase mask, soft-edge mask, mask image data, enabled/disabled flags, version fields, canvas/imageData parity, mask dimensions versus CC canvas/document dimensions, and whether masks affect save/export/composite.
  - Include compatibility/runtime checks: `canvasImageData`, runtime `canvas`, `brushState`, hydration state, deferred restore, and repair status.
  - Keep the module side-effect free; it accepts layers/project data and returns findings only.

- [ ] Add explicit repair support.
  - Add a function that evaluates whether a layer is repairable using `repairLegacyColorCycleLayer`.
  - Refactor/export the existing import-repair writer from `projectIO` or create a shared helper that preserves the same behavior.
  - Repair must reuse saved brush-state bindings where available; it must not rely only on `updateLayer({ colorCycleData })` if that loses saved canonical state.
  - Repair only when the result is `ok: true` and `repaired: true`.
  - Publish repaired canonical paint into the layer without erasing existing valid gradient/animation metadata.
  - After repair, update saved brush-state/canonical repair metadata, clear stale repair failure state, mark the project dirty, and mark composite segments/recomposition dirty.
  - Leave unrepairable failures as diagnostics with reasons.

- [ ] Wire state minimally.
  - Prefer using existing `updateLayer` and recomposition invalidation paths.
  - Add a small store action only if needed to centralize repair mutation safely.
  - Do not persist diagnostic UI state.

- [ ] Add the left toolbar entry.
  - Add a `Lh` button labeled `Layer Health`.
  - Open a dedicated `layerHealth` modal.
  - Keep active/pressed behavior separate from drawing tools.

- [ ] Add the modal UI.
  - Show summary counts for healthy, warning, error, and repairable layers.
  - Show per-layer rows with type, name, status, and concise issue list.
  - Expand CC details for canonical buffers, animation buffers, compatibility preview, and runtime hydration.
  - Show repair buttons only for repairable layers.
  - After repair, rerun inspection and show feedback.

- [ ] Add targeted tests.
  - Healthy bitmap/sequential layer reporting.
  - Healthy CC layer reporting.
  - CC mask reporting for erase mask and soft-edge mask presence, enabled state, and dimension mismatch.
  - Missing CC paint with compatibility snapshot is repairable.
  - Repair action publishes canonical paint and preserves valid gradient, speed, flow, phase, gradient-id, and gradient-def-id buffers.
  - Repaired layer survives save/load and reopens as healthy canonical CC data.
  - Dimension mismatch reports an error and is not repaired.
  - Missing gradient bindings reports an error and is not repaired.
  - Inspection does not hydrate, create brushes, start playback, materialize runtime canvases, or mutate layers.
  - Toolbar button opens the layer-health modal.

- [ ] Verify.
  - Run targeted Jest for layer health, legacy repair, toolbar, and modal coverage.
  - Run `npm run type-check`.
  - Run `npm run lint`.

## Expected File Areas

- `src/lib/layers/layerHealth.ts`
- `src/lib/layers/__tests__/layerHealth.test.ts`
- `src/components/LeftToolbar.tsx`
- `src/components/modals/LayerHealthModal.tsx`
- `src/components/modals/__tests__/LayerHealthModal.test.tsx`
- `src/stores/slices/uiSlice.ts`
- `src/types/index.ts`
- `src/app/HomeClient.tsx`

## Repair Boundary

The first version should repair only canonical CC paint recovery cases already covered by `repairLegacyColorCycleLayer`. It should not attempt broad healing of missing gradient bindings, invalid dimensions, missing animation buffers, or runtime materialization failures. Those should be reported as actionable health findings.

## Scope Boundary

This plan is for inspecting the currently open in-memory project layers. It does not replace pre-load archive health reporting from `readProjectHealthReport`. File-before-load inspection can be added later by sharing the pure inspection result format, but v1 should not mix load-preview repair/reporting with live layer repair UI.
