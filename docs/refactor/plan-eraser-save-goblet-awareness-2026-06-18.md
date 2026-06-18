# Plan: Eraser State, Save/Load, and Goblet Awareness

## Goal

Make erasing behave as a reliable document-state operation across raster layers, color-cycle layers, sequential layers, save/load, undo/redo, and Goblet export.

## Problem Summary

Raster erasing can directly remove pixels. Color-cycle erasing cannot safely erase only the rendered canvas because the canonical color-cycle data lives in buffers and brush state. If rendered pixels are erased while the underlying CC state remains unchanged, erased content can reappear during redraw, animation, save/load, undo/redo, or Goblet export.

The current mask approach is acceptable short term, but it must be treated as canonical eraser state for CC layers. Cached mask snapshots such as `eraseMaskImageData` must be derived from the live mask, not treated as a competing source of truth.

## Review Findings To Fix

- `src/utils/projectIO.ts` currently resolves save data as `sourceColorCycleData.eraseMaskImageData ?? captureCanvasImageData(sourceColorCycleData.eraseMask ?? null)`. That ordering can persist stale mask data even when a newer live `eraseMask` exists.
- `src/utils/export/goblet/gobletColorCycleSerializer.ts` currently resolves Goblet alpha masks with the same stale-first ordering in `resolveColorCycleMaskImage`.
- Background autosave and history paths already prefer live masks where they can (`captureCanvasImageData(eraseMask) ?? existing snapshot`), so the first fix should align regular project save and Goblet export with those paths instead of introducing a second mask authority.
- Existing Goblet tests cover stale all-erasing mask rejection, but that guard only prevents one failure shape. It does not prove that a fresh live mask wins over a stale snapshot for partial erases.

## Canonical Model

- Raster layers: erased pixels are canonical.
- Sequential layers: destination-out erase events are canonical.
- Color-cycle layers, short term: live `eraseMask` is canonical; `eraseMaskImageData` is a derived persistence/export snapshot.
- Color-cycle layers, possible later refactor: destructive CC buffer erase can replace masks if the product decision is that erased CC paint should be permanently removed from the canonical buffers.

## Phase 1: Audit Current Erase Paths

- Trace eraser start, move, finalize, history, persistence, and export paths.
- Document every reader/writer of:
  - `eraseMask`
  - `eraseMaskImageData`
  - `eraseMaskVersion`
  - color-cycle brush/canonical buffers
  - raster layer pixels
  - sequential erase events
  - Goblet alpha masks
- Identify stale-cache paths where `eraseMaskImageData` is preferred over the live mask.
- Confirm recomposition invalidation paths that depend on `eraseMaskVersion`:
  - `src/components/canvas/layersHash.ts`
  - `src/components/canvas/resolveColorCyclePresentation.ts`
  - history mask snapshots in `src/history/helpers/colorCycle.ts`

## Phase 2: Fix Save/Load Freshness

- Save should capture the current live `eraseMask` whenever one exists.
- Do not prefer stale `eraseMaskImageData` over a newer live mask.
- In `src/utils/projectIO.ts`, change the color-cycle save resolver to use:
  - `captureCanvasImageData(sourceColorCycleData.eraseMask ?? null) ?? sourceColorCycleData.eraseMaskImageData`
  - preserve `eraseMaskVersion` from `sourceColorCycleData`
  - do not mutate the live layer during serialization
- On save, regenerate the serialized `eraseMaskImageData` from the live mask. Clearing the cached snapshot is only acceptable if every downstream serializer also captures from the live mask before reading the cache.
- On load, restore the mask canvas, image data, version, and recomposition invalidation together.
- Add regression coverage:
  - construct a CC layer with both a live `eraseMask` and contradictory stale `eraseMaskImageData`
  - save project via `serializeProject`
  - reload project via `deserializeProject`
  - assert the restored `eraseMaskImageData` and `eraseMask` match the live mask, not the stale snapshot
  - assert `eraseMaskVersion` round-trips

## Phase 3: Fix Goblet Export Awareness

- Goblet export must read the same canonical eraser state as save.
- If mask mode remains, Goblet should serialize a fresh mask snapshot from the live `eraseMask`.
- In `src/utils/export/goblet/gobletColorCycleSerializer.ts`, update `resolveColorCycleMaskImage` to prefer `captureCanvasImageData(data.eraseMask ?? null)` over `data.eraseMaskImageData`.
- Keep mask extraction local to serialization; do not update `data.eraseMaskImageData` as a side effect of exporting.
- Keep the existing stale all-erasing-mask guard as a safety net, not the main correctness mechanism.
- Add regression coverage:
  - CC layer has live partial mask plus stale all-erasing `eraseMaskImageData`
  - Goblet 2 export serializes the live partial alpha mask
  - Goblet runtime output matches Vessel visibility
  - partial erase and full erase cases are both covered
  - keep the existing stale all-erasing-mask guard test, but do not rely on it as the only correctness proof

## Phase 4: Unify Eraser Transaction Lifecycle

Introduce one internal eraser transaction contract with layer-specific strategies:

- `begin`
- `captureBefore`
- `applySegment`
- `preview`
- `commit`
- `captureAfter`
- `historyPayload`
- `dispose`

Strategies:

- Raster strategy commits pixels.
- Color-cycle strategy commits mask state, or later canonical CC buffer erasure.
- Sequential strategy commits destination-out events.

The orchestration layer should not need separate finalize semantics for each layer type beyond selecting the strategy.

Scope guard:

- Do not start this refactor until save/export freshness tests are green.
- Keep orchestration files within the repository size guardrails:
  - `src/hooks/useDrawingHandlers.ts`
  - `src/components/canvas/DrawingCanvas.tsx`
  - `src/hooks/canvas/useCanvasEventHandlers.ts`
- Put layer-specific eraser workflow logic under `src/hooks/canvas/handlers/**` and pure helpers under `src/hooks/canvas/utils/**`.

## Phase 5: Parity and UI Truthfulness

- Verify eraser size, opacity, pressure, shape, custom tip, resampler behavior, and ROI are consistent across raster and CC where supported.
- Verify current CC eraser settings through `src/hooks/canvas/handlers/colorCycle/colorCycleEraserSettings.ts` and `src/stores/helpers/eraserSettings`.
- Fix any CC eraser custom/resampler gap found during the audit, or explicitly disable unsupported eraser-tip modes when erasing CC layers.
- Ensure cursor preview, live stroke preview, committed result, undo/redo, save/load, and Goblet export all agree.

## Validation Checklist

- Raster erase undo/redo passes.
- Sequential erase undo/redo passes.
- CC erase undo/redo passes.
- CC erase save/load passes.
- CC erase Goblet export passes.
- Painting over an erased CC region clears/restores eraser state intentionally.
- Cached mask data cannot resurrect stale erased or unerased pixels.
- Goblet does not export stale all-erasing alpha masks.
- Goblet exports live partial alpha masks when `eraseMaskImageData` is stale.
- Regular save/load restores live partial masks when `eraseMaskImageData` is stale.
- `npm run type-check`, `npm run lint`, and targeted tests pass before broadening to the full suite.

## Recommended Implementation Order

1. Add failing stale-snapshot tests for project save/load and Goblet export.
2. Fix project save mask freshness in `src/utils/projectIO.ts`.
3. Fix Goblet mask freshness in `src/utils/export/goblet/gobletColorCycleSerializer.ts`.
4. Run the targeted project IO and Goblet export tests, then type-check.
5. Refactor erasing into one transaction lifecycle only after the persistence/export bug is closed.
6. Resolve CC eraser tip parity or make unsupported modes explicit in UI.
7. Consider destructive CC buffer erasure only after the mask lifecycle is stable.
