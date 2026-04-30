# CC Archived Layer False Empty Write Bug

## Status

Fixed for the identified C7 cold/warm runtime edit path and the identified false-empty write path. Evidence captured from `http://localhost:3001/` and `http://localhost:3000/` on 2026-04-30.

Older C5/C5-wiped archive evidence remains in this note because it is part of the same CC archive/runtime authority family. The current C7 fix is the complete fix for the reproduced behavior where a loaded CC layer could not finalize gradients/shapes until a CC stroke warmed the runtime, and where finalize could publish an empty layer state.

## Complete Bug Record: C7 Cold/Warm CC Runtime Edit Failure

### User-visible symptoms

The failing file was:

```txt
/Users/jasonstrachan/+Projects/2026/supervised portraits/testing/C7.vs
```

Observed in the app:

- `CC Layer 2` loaded with visible/canonical color-cycle content.
- Attempting to draw/finalize CC gradient shapes on that layer did not produce new committed shape content.
- Shape finalize logs showed `shape-commit-linear`, but the layer stayed `hasContent: false`.
- The failed shape commits reported zero live scalar buffers:
  - `gradientDefBufferBytes: 0`
  - `gradientIdBufferBytes: 0`
  - `hasContent: false`
- Drawing a CC stroke later could create full-size runtime buffers and make the layer editable again.
- A finalize path could publish a false empty layer state after seeing an incomplete live runtime, even though archive/state CC payloads still existed.

### Affected layer evidence

The active/failing layer in the captured C7 session was:

```txt
layer-1777515099706-0.6006024489485631
```

The diagnostic log showed failed shape finalize attempts with:

```json
{
  "event": "shape-commit-linear",
  "layerId": "layer-1777515099706-0.6006024489485631",
  "before": {
    "hasContent": false,
    "gradientDefBufferBytes": 0,
    "gradientIdBufferBytes": 0
  },
  "after": {
    "hasContent": false,
    "gradientDefBufferBytes": 0,
    "gradientIdBufferBytes": 0
  }
}
```

A later stroke on the same layer showed runtime creation was possible:

```json
{
  "event": "stroke-commit",
  "layerId": "layer-1777515099706-0.6006024489485631",
  "after": {
    "hasContent": true,
    "gradientDefBufferBytes": 8000000,
    "gradientIdBufferBytes": 4000000
  }
}
```

Archive inspection of `C7.vs` showed the layer still had canonical sparse buffer payloads (`paint.bin`, `gradient-id.bin`, `gradient-def-id.bin`, `speed.bin`, and `flow.bin`) with non-zero data. The persisted `colorCycleData` was damaged/preview-like (`repairStatus.ok: false`, `reason: "missing-gradient-bindings"`), but the layer still had state refs that could be used as the edit source.

### Root cause

There were three cooperating failures.

1. `restoreColorCycleBrushes()` skipped layers with `repairStatus.ok === false` too broadly.

   That made sense for true preview-only damaged layers, but it was wrong for C7-style layers that had failed repair metadata and still had real canonical state refs/buffers. Those layers were treated as non-editable even though materialization was possible from their archive/state payloads.

2. The stroke/shape edit path could begin against a cold or missing CC runtime.

   Shape finalize was allowed to proceed while the live runtime buffers were absent or incomplete. The commit code then operated on empty live buffers rather than first warming/materializing the layer from its canonical CC source.

3. `ensureColorCycleLayerRuntime()` originally treated hydration state as sufficient.

   The first warmup fix called `ensureColorCycleLayerRuntime()` before allowing edits. Review caught the remaining hole: a layer could be marked `warm` or `active` while the brush manager no longer had the brush runtime. In that state, `ensureColorCycleLayerRuntime()` only updated hydration state and returned based on metadata, so the runtime stayed missing and future edits stayed blocked/misreported as preview-only.

The core authority bug was this: live runtime buffer state was allowed to override or block canonical archive/state CC content, when canonical content should remain authoritative until a real runtime has been materialized.

### Fix implemented

The fix separates three cases explicitly:

- Editable cold/warm CC layer with canonical payload refs: block the gesture, warm/materialize runtime, then let the user retry.
- Preview-only damaged CC layer with no canonical edit source: block the gesture and show a clear message.
- Warm/active CC layer with missing brush runtime: restore/register a brush runtime; do not treat hydration metadata alone as success.

Files changed:

- `src/hooks/canvas/handlers/colorCycle/colorCycleRuntimeWarmup.ts`
  - Added `startColorCycleRuntimeWarmupForEdit()`.
  - Detects canonical edit sources from layer state refs, persisted CC buffers, and brush snapshots.
  - Blocks stroke/shape start while warming.
  - Uses the existing bottom feedback strip:
    - `Preparing color-cycle layer... 0%`
    - `Preparing color-cycle layer... 56%`
    - `Color-cycle layer ready`
  - Shows `This color-cycle layer is preview-only and cannot be edited` when no canonical edit source exists.

- `src/hooks/canvas/handlers/strokeStartPrelude.ts`
  - Calls the warmup guard before a CC stroke can start on a cold/missing runtime layer.

- `src/hooks/canvas/handlers/shapes/shapeDrawing.ts`
  - Calls the warmup guard before a CC shape gesture can start.

- `src/hooks/canvas/useDrawingShapeRuntime.ts`
  - Passes the existing `feedbackMessageRef` into shape drawing so shape warmup uses the bottom app message.

- `src/utils/projectIO.ts`
  - Allows repair-failed CC layers to attempt runtime restore when they still have a canonical runtime source.
  - Still keeps true preview-only damaged layers cold/non-editable.

- `src/stores/layers/createLayersSlice.ts`
  - `ensureColorCycleLayerRuntime()` now restores a missing brush runtime for archive-backed layers even when hydration says `warm` or `active`.
  - `ensureColorCycleLayerRuntime()` now returns success only when a live brush exists and the requested hydration state is satisfied.
  - Deferred restore eligibility now checks canonical payload presence rather than relying only on `deferredRuntimeRestore`.

- `src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts`
  - `endStroke()` now refuses to publish `hasContent: false` if the layer still has canonical CC content refs/buffers or a failed repair marker.
  - The guard logs `cc-empty-live-buffer-write-blocked` so future captures show when an empty live runtime tried to overwrite canonical content.

### Behavior after fix

When the user starts a CC stroke or CC shape on a cold/warm archive-backed layer whose runtime is missing:

1. The gesture is blocked before finalize can run against empty live buffers.
2. The bottom feedback strip shows warming progress.
3. The app attempts to restore/materialize the CC runtime from canonical state refs/buffers.
4. If a runtime brush is registered, the feedback strip reports `Color-cycle layer ready`.
5. The user can retry the stroke/shape; the edit now starts with a live runtime.

When the layer truly has no editable CC source:

1. The gesture is blocked.
2. The feedback strip says `This color-cycle layer is preview-only and cannot be edited`.
3. No fake empty runtime is allowed to publish over the layer.

### Regression coverage

Added/updated tests:

- `src/hooks/canvas/handlers/colorCycle/__tests__/colorCycleRuntimeWarmup.test.ts`
  - Verifies cold editable layers block edits, call runtime ensure, and report `0%`, `56%`, and ready messages.
  - Verifies preview-only layers are blocked without trying restore.

- `src/stores/__tests__/layersSlice.integration.test.ts`
  - Verifies warm archive-backed layers with missing runtime brushes are restored through `restoreColorCycleBrushes()`.
  - Verifies success requires the live brush to be registered.

- `src/hooks/brushEngine/__tests__/ColorCycleBrushCanvas2D.test.ts`
  - Verifies `endStroke()` does not call `updateLayer()` with a false empty write when canonical CC content still exists.

Validation after the fix:

```txt
npm run type-check
npm run lint
npm test
```

Final test result:

```txt
366 test suites passed
2182 tests passed
```

### Remaining risks / not part of this fix

- Existing already-damaged project files may still contain visual/static previews without enough canonical CC data to edit. Those should remain preview-only rather than silently inventing editable runtime state.
- Slot `0` occupancy remains a separate risk if a valid layer uses slot `0` as meaningful paint and some path treats zero as empty.
- This fix was validated by code-level tests and diagnostics; a manual browser reload/edit pass against `C7.vs` is still useful as final UX confirmation.

Fixed in this pass:

- The C5-style metadata collapse where a restored CC brush with rich metadata (`paintSlot: 43`, many palettes/defs) could serialize using a smaller fallback store metadata set (`paintSlot: 0`, fewer palettes/defs).
- The follow-up orphaned-def path where a new committed shape/stroke writes pixels with a new `gradientDefIdBuffer` id while serialization drops that new def because restored metadata is richer but stale.
- Dev restore no longer hard-pauses on already damaged files that contain orphaned def ids; `ColorCycleAnimator` warns and falls back instead of using `console.assert`.
- The `delete-selected` CC clear path now clears all selected scalar buffers (`paint`, `gradientId`, `gradientDefId`, `speed`, `flow`, `phase`) instead of leaving stale auxiliary buffers after paint goes empty.
- Follow-up hardening: `ColorCycleBrushCanvas2D.applyLayerSnapshot()` now treats `hasContent: false` as authoritative empty state and clears all scalar buffers even if a stale caller passes non-zero auxiliary buffers with empty paint.
- Selection delete diagnostics now record selection provenance, delete source, and playback state at delete time. Playback toolbar toggles are also recorded in the CC mutation timeline.
- The C7-style cold/warm runtime edit path now blocks stroke/shape start while the CC runtime is warming and reports progress through the bottom feedback strip.
- Warm/active archive-backed CC layers whose brush runtime was cleaned up are now restored through the same materialization path instead of being permanently blocked as preview-only.
- `ColorCycleBrushCanvas2D.endStroke()` now blocks a false empty live-buffer write when canonical archive/state CC content still exists.
- Added regression coverage in `src/hooks/brushEngine/__tests__/ColorCycleBrushCanvas2D.test.ts`.
- Added regression coverage in `src/stores/helpers/__tests__/colorCycleSelection.test.ts`.
- Added regression coverage in `src/hooks/canvas/handlers/colorCycle/__tests__/colorCycleRuntimeWarmup.test.ts`.
- Added regression coverage in `src/stores/__tests__/layersSlice.integration.test.ts`.

Still open / not proven fixed:

- Slot-0 occupancy detection if a layer is genuinely painted using valid slot `0`.
- End-to-end live repro against `C5.vs` / `C5-wiped.vs` in the browser.

The original slot-zero hypothesis is now too narrow. The before-wipe archive proves at least one wiped layer had millions of non-zero paint bytes, so the bug is not only "slot 0 is treated as empty".

The after-wipe archive also keeps the CC payloads intact. This is not simple archive payload deletion.

## Summary

A color-cycle layer can be marked empty during `ColorCycleBrushCanvas2D.endStroke()` even though the saved project has valid archive-backed CC buffers for that layer. The destructive write happens through normal `updateLayer(... colorCycleData ...)`, not through the runtime clear audit.

This is not the same failure as a runtime clear reported by `color-cycle-layer-cleared`.

The current diagnosis is split into two related failure classes:

1. Fixed in this pass: restored rich CC metadata could be overwritten by a smaller fallback store metadata set during `ColorCycleBrushCanvas2D` serialization.
2. Fixed in this pass: explicit `delete-selected` could clear the CC paint buffer while leaving stale CC auxiliary buffers in the selected region.
3. Still open: an inactive/cold archive-backed CC layer may be finalized, reset, hydrated, or rendered with incomplete runtime buffers. That path can write `colorCycleData.hasContent: false` in memory even while canonical archive refs remain non-empty.

## 2026-04-30 Follow-up: C7 Cold/Warm Edit Block

The C7 investigation exposed a second runtime-authority failure related to the same false-empty family.

Observed behavior:

- A loaded CC layer could contain canonical archive/state payloads but no live brush runtime.
- Shape finalize attempts reported `shape-commit-linear` with `gradientDefBufferBytes: 0`, `gradientIdBufferBytes: 0`, and `hasContent: false`.
- A later CC stroke could create a live runtime and show full-size buffers again, proving the project data was not necessarily gone.

Root cause:

- The edit path could start against a cold or missing runtime before materialization completed.
- The first warmup fix blocked stroke/shape start while calling `ensureColorCycleLayerRuntime()`, but review found a remaining hole: if the layer was marked `warm` or `active` while the brush manager no longer had the brush, `ensureColorCycleLayerRuntime()` only updated hydration and did not recreate/register a runtime brush.
- That meant the gesture stayed blocked and future attempts could be misreported as preview-only.

Fix:

- `startColorCycleRuntimeWarmupForEdit()` blocks CC stroke/shape starts while warming and uses the existing bottom feedback strip:
  - `Preparing color-cycle layer... 0%`
  - `Preparing color-cycle layer... 56%`
  - `Color-cycle layer ready`
- Preview-only layers with no canonical edit source remain blocked with `This color-cycle layer is preview-only and cannot be edited`.
- `ensureColorCycleLayerRuntime()` now treats missing brush runtime as a restore requirement when the layer has canonical CC refs/buffers, even if hydration is already `warm` or `active`.
- `ensureColorCycleLayerRuntime()` now returns success only when a live runtime brush exists and the requested hydration state is satisfied.
- `ColorCycleBrushCanvas2D.endStroke()` refuses to publish `hasContent: false` over a layer that still has canonical CC content refs/buffers or a failed repair marker.

Regression coverage:

- `src/hooks/canvas/handlers/colorCycle/__tests__/colorCycleRuntimeWarmup.test.ts` covers warmup feedback, edit blocking, and preview-only rejection.
- `src/stores/__tests__/layersSlice.integration.test.ts` covers warm/active archive-backed layers with missing runtime brushes being restored through `restoreColorCycleBrushes()`.
- `src/hooks/brushEngine/__tests__/ColorCycleBrushCanvas2D.test.ts` covers blocking the false-empty live-buffer write.

## Latest Prod Capture: Delete-Selected Full Canvas

The 2026-04-30 prod capture from `http://localhost:3001/` is not the same event as the unexplained `endStroke()` false-empty write.

Captured event:

```json
{
  "t": "2026-04-30T00:04:01.625Z",
  "event": "color-cycle-layer-cleared",
  "layerId": "layer-1777507266085-0.0024373580484319257",
  "reason": "delete-selected",
  "details": {
    "source": "selection-region-clear",
    "operation": "delete-selected",
    "expectedDestructive": true,
    "rect": { "x": 0, "y": 0, "width": 2000, "height": 2000 },
    "selectionStart": { "x": 0, "y": 0 },
    "selectionEnd": { "x": 2000, "y": 2000 },
    "selectionMaskBounds": null,
    "paintBefore": { "nonZeroCount": 1196326 },
    "paintAfter": { "nonZeroCount": 0 },
    "gradientIdAfter": { "nonZeroCount": 1196326 },
    "speedAfter": { "nonZeroCount": 1196326 },
    "flowAfter": { "nonZeroCount": 1196326 },
    "phaseAfter": { "nonZeroCount": 67567 }
  }
}
```

Meaning:

- The clear itself was an explicit full-canvas selection delete, so this capture does not prove the mysterious `endStroke()` wipe.
- It did expose a real consistency bug: `clearColorCycleRegion()` zeroed paint only, leaving stale gradient/motion/phase buffers in the selected pixels.
- The immediate follow-up `layer-update-destructive` with `updateKeys: ["imageData", "colorCycleData"]` and `skipColorCycleSync: true` is the store sync for that explicit delete.

Fix applied:

- `clearColorCycleRegion()` now zeros `paint`, `gradientId`, `gradientDefId`, `speed`, `flow`, and `phase` for every selected pixel.
- The clear audit now includes `gradientDefIdAfter`.
- The clear audit now includes `selectionLastAction`, `deleteSource`, `deleteTimestamp`, and `playbackBeforeDelete`.
- Toolbar play/pause clicks now add a `color-cycle-playback-toggle` entry to the same mutation timeline so future captures can show ordering relative to selection deletes.
- Tests now seed non-zero values in all CC scalar buffers and assert selected pixels are zeroed.

## Captured Evidence

Helper availability:

```json
{
  "mutationHelper": "function",
  "dumpHelper": "function",
  "activeLayerHelper": "function",
  "href": "http://localhost:3001/"
}
```

Runtime clear report:

```js
(()=>{const log=window.__VESSEL_GET_CC_MUTATION_LOG__?.()??JSON.parse(localStorage.getItem('VESSEL_CC_MUTATION_LOG')||'[]');return log.filter((entry)=>entry?.event==='color-cycle-layer-cleared');})()
```

Result:

```json
[]
```

Meaning: this origin/session had the runtime-clear logger installed and did not record a covered `color-cycle-layer-cleared` event.

The full diagnostic dump did contain destructive metadata writes:

```json
{
  "event": "layer-update-destructive",
  "reason": "updateLayer",
  "details": {
    "updateKeys": ["colorCycleData"],
    "skipColorCycleSync": false
  },
  "before": {
    "layerType": "color-cycle",
    "hasColorCycleData": true,
    "hasContent": true,
    "gradientDefBufferBytes": 8000000,
    "gradientIdBufferBytes": 4000000,
    "paintSlot": 0
  },
  "after": {
    "layerType": "color-cycle",
    "hasColorCycleData": true,
    "hasContent": false,
    "gradientDefBufferBytes": 8000000,
    "gradientIdBufferBytes": 4000000,
    "paintSlot": 0
  }
}
```

Stack included:

```txt
ColorCycleBrushCanvas2D.endStroke
updateLayer
resetColorCycle / setActiveLayer
```

A later active-layer event showed the same `hasContent: true -> false` transition during `endStroke`, with `paintSlot: 74`. That may be a related content-detection issue or a second path. The C5 archive evidence means slot `0` is only one remaining risk, not the whole bug.

## Before-Wipe Archive Evidence

User supplied the saved state from before the layer wipe:

```txt
/Users/jasonstrachan/+Projects/2026/supervised portraits/testing/C5.vs
```

Archive inspection:

```bash
unzip -l '/Users/jasonstrachan/+Projects/2026/supervised portraits/testing/C5.vs' | rg 'project.json|buffers/color-cycle'
```

Result summary:

- `project.json` exists.
- Three CC layers exist.
- All three CC layers have `paint.bin`, `gradient-id.bin`, `gradient-def-id.bin`, `speed.bin`, `flow.bin`, and `canvas-image.txt`.
- `project.json.binaries.entries` has matching manifest entries.
- No `paint.bin` entry is missing in this before-wipe file.

Project JSON CC state summary:

```json
[
  {
    "id": "layer-1777341840681-0.11510932748275604",
    "name": "CC Layer 3",
    "state": {
      "hasContent": true,
      "paintSlot": 10,
      "paintRef": "zip:buffers/color-cycle/layer-1777341840681-0.11510932748275604/paint.bin"
    }
  },
  {
    "id": "layer-1777340119602-0.40245117407818753",
    "name": "CC Layer 2",
    "state": {
      "hasContent": true,
      "paintSlot": null,
      "paintRef": "zip:buffers/color-cycle/layer-1777340119602-0.40245117407818753/paint.bin"
    }
  },
  {
    "id": "layer-1777504844372-0.2621380683591432",
    "name": "CC Layer 3",
    "state": {
      "hasContent": true,
      "paintSlot": 43,
      "paintRef": "zip:buffers/color-cycle/layer-1777504844372-0.2621380683591432/paint.bin"
    }
  }
]
```

Decoded paint-buffer stats from C5.vs:

```json
[
  {
    "id": "layer-1777341840681-0.11510932748275604",
    "stateHasContent": true,
    "statePaintSlot": 10,
    "paintNonZero": 1804324,
    "paintExpandedBytes": 4000000
  },
  {
    "id": "layer-1777340119602-0.40245117407818753",
    "stateHasContent": true,
    "statePaintSlot": null,
    "paintNonZero": 3699869,
    "paintExpandedBytes": 4000000
  },
  {
    "id": "layer-1777504844372-0.2621380683591432",
    "stateHasContent": true,
    "statePaintSlot": 43,
    "paintNonZero": 66642,
    "paintExpandedBytes": 4000000
  }
]
```

This confirms the two old CC layers had real non-empty saved paint before the wipe. The destructive runtime/store event for `layer-1777340119602-0.40245117407818753` cannot be explained by the archive being empty.

## After-Wipe Archive Evidence

User supplied the saved state from after a later wipe:

```txt
/Users/jasonstrachan/+Projects/2026/supervised portraits/testing/C5-wiped.vs
```

Archive inspection showed the after-wipe file still contains:

- Three CC layers.
- All three `paint.bin` payloads.
- All three `gradient-id.bin`, `gradient-def-id.bin`, `speed.bin`, and `flow.bin` payloads.
- Matching binary manifest entries.
- `state.hasContent: true` for all three CC layers.

Decoded paint-buffer stats in `C5-wiped.vs` match the before file:

```json
[
  {
    "id": "layer-1777341840681-0.11510932748275604",
    "stateHasContent": true,
    "statePaintSlot": 10,
    "paintNonZero": 1804324,
    "paintExpandedBytes": 4000000
  },
  {
    "id": "layer-1777340119602-0.40245117407818753",
    "stateHasContent": true,
    "statePaintSlot": null,
    "paintNonZero": 3699869,
    "paintExpandedBytes": 4000000
  },
  {
    "id": "layer-1777504844372-0.2621380683591432",
    "stateHasContent": true,
    "statePaintSlot": null,
    "paintNonZero": 66642,
    "paintExpandedBytes": 4000000
  }
]
```

Before/after binary checksums for all CC refs matched for these layers:

- `paintRef`
- `gradientIdRef`
- `gradientDefIdRef`
- `speedRef`
- `flowRef`

Important serialized difference:

- In `C5.vs`, the new layer `layer-1777504844372-0.2621380683591432` had `state.paintSlot: 43`.
- In `C5-wiped.vs`, that same layer has `state.paintSlot: null`.
- Its `paint.bin` checksum and non-zero count are unchanged.

Interpretation: the layer data is still in the file. The wipe is more likely a hydrate/runtime/render metadata failure than archive data loss. Losing or ignoring `paintSlot` is now part of the suspected failure class.

## Suspected Root Cause

There are two related risks.

First, `ColorCycleBrushCanvas2D.paintBufferHasContent()` currently checks whether any paint byte is non-zero:

```ts
if (paint[index] !== 0) {
  return true;
}
```

That works only if `0` means unpainted. In the current color-cycle slot model, `paintSlot: 0` can be a valid paint slot, so painted pixels using slot `0` can be misclassified as empty.

Second, and now more likely for the supplied C5.vs case, archive-backed CC layers can exist with their canonical content in `layer.state.*Ref` while `layer.colorCycleData` is only lightweight metadata in the live store. If `endStroke()` runs before that archived content has been hydrated into the brush runtime, `paintBufferHasContent()` can inspect an empty runtime buffer and write `hasContent: false` over a layer whose canonical archive state is non-empty.

Third, `state.paintSlot` can be lost or omitted for a layer whose buffers still contain content. The after-wipe file proves the new layer's `paintSlot` changed from `43` to `null` without changing its binary payloads. Any hydration/render path that requires `paintSlot` to bind the active fill slot may show a blank layer even though `paint.bin` is valid.

The bad metadata write path is:

1. `ColorCycleBrushCanvas2D.endStroke()`
2. `paintBufferHasContent(...)` returns `false` from the runtime buffer currently attached to that brush/layer
3. `strokeData.hasContent = false`
4. `updateLayer(layer.id, { colorCycleData: { ...layer.colorCycleData, hasContent: false } })`
5. Save/autosave can later see stale or contradictory CC state, or produce a dangling archive reference if metadata and archive payload ownership diverge.

A parallel metadata-loss path is:

1. `state.paintSlot` is present in the before file.
2. The layer is saved again with the same `paint.bin` / gradient / speed / flow payload checksums.
3. `state.paintSlot` becomes `null`.
4. Load/render can no longer bind the layer's paint slot reliably even though the archived pixels remain present.

The `C5-wiped.vs` follow-up shows a related editability failure on the top/new CC layer:

- Layer id: `layer-1777504844372-0.2621380683591432`
- The layer still persists as `layerType: 'color-cycle'`.
- The layer still has `state.paintRef`, `gradientIdRef`, `gradientDefIdRef`, `speedRef`, and `flowRef`.
- The user reports that after the layer visually clears, new CC shapes cannot be made on that layer, while the older CC layers remain usable.
- Before file (`C5.vs`):
  - `paintSlot: 43`
  - `strokeCounter: 43`
  - `nextGradientDefId: 43`
  - `gradientDefStoreCount: 42`
  - `slotPaletteCount: 42`
  - no `phaseRef`
  - dither pixel size `4`
- After file (`C5-wiped.vs`):
  - `paintSlot: 0`
  - `strokeCounter: 8`
  - `nextGradientDefId: 44`
  - `gradientDefStoreCount: 43`
  - `slotPaletteCount: 12`
  - has `phaseRef`
  - dither pixel size `6`

This is not "marked as normal layer" in serialized metadata. It is a corrupted CC runtime/editing state: the layer remains a CC layer, but the brush runtime and active slot metadata were rewritten to a fallback/default state that no longer matched the archived buffers.

## Fixed Path: Rich Metadata Collapse

The concrete C5 top-layer collapse was:

```txt
restored/archive metadata:
  paintSlot: 43
  strokeCounter: 43
  slotPaletteCount: 42
  gradientDefStoreCount: 42

fallback store metadata after wipe:
  paintSlot: 0
  strokeCounter: 8
  slotPaletteCount: 12
  gradientDefStoreCount: 43
```

The risky merge lived in `ColorCycleBrushCanvas2D.getLayerColorCycleMeta()`. It previously preferred any non-empty store arrays over restored persisted metadata. That is unsafe after project restore because the store can temporarily contain a smaller fallback metadata set while the restored brush still owns the richer canonical layer state.

The first fix weighted both metadata sources and preferred the richer coherent source before selecting:

- `gradientDefs`
- `slotPalettes`
- `gradientDefStore`
- `paintSlot`
- `activeGradientId`
- derived/foreground metadata

That was still incomplete. The C5 follow-up produced:

```txt
gradientDefIdBuffer: defId 44
gradientIdBuffer: slot 43
gradientDefStore: ids 1..43 only
slotPalettes: slots 0..11 only
```

The root problem was not only "smaller store wins". A smaller live store can also contain the newest committed def while the restored archive metadata contains more old defs. Choosing either source wholesale is unsafe.

The fix now merges identity-bearing metadata:

- `gradientDefs` by gradient id
- `slotPalettes` by slot
- `gradientDefStore` by def id

This keeps old archive-backed defs/palettes and also preserves newly committed defs such as `defId 44` / slot `43`.

Already damaged files can still contain orphaned def ids. In development, `ColorCycleAnimator.validateDefPalettes()` previously used `console.assert(false, ...)`, which paused DevTools during restore before fallback rendering could proceed. That is now a warning so the renderer can continue using its existing base/slot fallback for missing def palettes.

Regression:

- `src/hooks/brushEngine/__tests__/ColorCycleBrushCanvas2D.test.ts`
- Test name: `does not let a smaller fallback store palette collapse richer restored metadata`
- Asserts restored `paintSlot: 43`, `activeGradientId`, palette count, def-store count, and `strokeCounter: 43` survive serialize round-trip even when store metadata has a smaller `paintSlot: 0` fallback.
- Test name: `keeps new store defs when restored metadata is richer but stale`
- Asserts a buffer that references `defId 44` keeps the store's new `gradientDefStore` entry and slot palette even when restored metadata has more old entries.
- `src/lib/__tests__/ColorCycleAnimator.renderParity.test.ts`
- Test name: `does not assert when restored def ids are missing palette metadata`
- Asserts already-orphaned def ids do not trigger a dev assertion during render.

Relevant source:

- `src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts`
  - `paintBufferHasContent()`
  - `endStroke()`
  - `snapshotFromBuffers()`
  - `verifyPaintBufferCleared()`
- `src/stores/layers/createLayersSlice.ts`
  - `updateLayer()` audit reports `layer-update-destructive`.

## Current Coverage Gap

There is no direct regression test proving that an archive-backed inactive CC layer with valid `state.paintRef` cannot be marked empty by `endStroke()` / `resetColorCycle()` / `setActiveLayer()`.

There is no direct regression test proving that `state.paintSlot` survives save/load/save for an archive-backed CC layer whose `paint.bin` remains unchanged.

There is also no direct regression test proving that a paint buffer filled with slot `0` counts as content.

Resolved coverage gap:

- There is now direct regression coverage that a restored rich CC metadata snapshot is not collapsed by a smaller fallback store metadata set during `ColorCycleBrushCanvas2D` serialize/deserialize.
- There is now direct regression coverage that a newly committed def from the live store is not dropped just because the restored archive metadata is larger.

Existing nearby coverage uses non-zero paint bytes, for example:

```ts
strokeData.buffers.paint[0] = 1;
```

That does not catch this bug.

## Remaining Fix Plan

1. Add a failing regression test.
   - Load or synthesize a CC layer shaped like C5.vs:
     - `layerType: 'color-cycle'`
     - `state.hasContent: true`
     - `state.paintRef` / `gradientIdRef` / `gradientDefIdRef` / `speedRef` / `flowRef`
     - no hydrated full runtime buffer yet
   - Trigger the smallest code path matching the captured stacks:
     - `resetColorCycle()` / `endStroke()`
     - `setActiveLayer()` / `endStroke()`
   - Assert the store must not write `colorCycleData.hasContent: false` for a layer whose canonical archive state is still non-empty.
   - Assert no `layer-update-destructive` audit is emitted for this false-empty path.

2. Add slot-zero coverage separately.
   - Use `ColorCycleBrushCanvas2D`.
   - Create/obtain stroke data for a test layer.
   - Set the active layer `paintSlot` to `0`.
   - Mark at least one pixel as painted in the same way real slot-0 painting does.
   - Call `endStroke(layerId)` or the smallest public path that reproduces content detection.
   - Assert `getLayerSnapshot(layerId)?.hasContent === true`.

3. Identify the real occupancy authority.
   - Do not replace this with another `paint.some(value !== 0)` check.
   - Determine whether occupancy should come from canonical archive snapshot metadata, a separate mask, alpha/presence buffer, gradient-id buffer, gradient-def buffer, speed/flow metadata, or an explicit touched-pixel/dirty-region signal.
   - Slot index alone is not a reliable occupancy signal when slot `0` is valid.
   - Empty cold runtime state must not be allowed to override non-empty canonical archive state.
   - Missing `paintSlot` must not make non-empty archive-backed buffers render as empty.

4. Replace or narrow `paintBufferHasContent()`.
   - Make it answer "does this layer have painted pixels?", not "does this array contain a non-zero slot id?"
   - Keep behavior correct for old files and non-slot-0 layers.
   - Update all callers that currently rely on the non-zero byte interpretation:
     - `endStroke()`
     - `snapshotFromBuffers()`
     - `verifyPaintBufferCleared()`
     - render/playback fallback checks if needed.

5. Protect store sync from stale runtime.
   - If `endStroke()` has no authoritative hydrated paint buffer for a layer, it should not write `hasContent: false`.
   - If canonical `layer.state.hasContent === true` and archive refs exist, require successful hydration or an explicit destructive operation before marking empty.
   - Keep legitimate clears working through `color-cycle-layer-cleared` / explicit destructive reasons.

6. Preserve and hydrate paint-slot metadata.
   - Trace save/load/save for `state.paintSlot`.
   - Ensure archive-backed layers keep `state.paintSlot` when canonical refs are preserved.
   - If old files have `state.paintSlot: null`, infer the layer binding from gradient metadata or buffer data without blanking the layer.
   - Add a regression using `C5.vs`-shaped data: save/reopen/save must not change the new layer's `state.paintSlot: 43` to `null`.

7. Preserve CC layer editability after runtime restore.
   - Done for the metadata-collapse unit path: a C5-shaped restored brush no longer serializes with smaller fallback store metadata.
   - Still needed: add a regression for a C5-shaped top CC layer that loads with canonical refs and can still initialize a `ColorCycleBrushCanvas2D`.
   - Assert `runStrokeStartLayerGuards()` accepts CC shape/stroke input on that layer after load.
   - Assert project load/register flow puts a usable brush into `colorCycleBrushManager` for the restored active CC layer.
   - Assert full project restore/save does not collapse the active layer from `paintSlot: 43` / `strokeCounter: 43` into `paintSlot: 0` / low counter metadata unless an explicit clear/reset operation occurred.

8. Re-run persistence checks.
   - Ensure `endStroke()` no longer writes `colorCycleData.hasContent: false` for archive-backed non-empty content.
   - Ensure `endStroke()` no longer writes `colorCycleData.hasContent: false` for slot-0 content.
   - Ensure save/autosave serialization does not produce dangling CC archive refs from stale metadata.
   - Keep `Project save produced dangling archive ref ... paint.bin` as a hard failure if refs and archive payloads disagree.

9. Add a diagnostic follow-up if needed.
   - If slot `74` also reproduces the false-empty transition, add a second test for non-zero slot content.
   - If slot `74` does not reproduce, document it separately as an active-layer switch/finalize timing path.

## Validation Commands

Targeted test after adding coverage:

```bash
npm test -- src/hooks/brushEngine/__tests__/ColorCycleBrushCanvas2D.test.ts --runInBand
```

Full pre-commit validation for a fix:

```bash
npm run type-check
npm run lint
npm test
```

## Prod Capture Commands

Run these in DevTools before reloading the tab after a CC layer clears.

Full recent CC diagnostic capture:

```js
copy(JSON.stringify({href:location.href,active:window.__VESSEL_GET_ACTIVE_CC_LAYER_DIAGNOSTIC__?.(),timeline:(window.__VESSEL_GET_CC_MUTATION_LOG__?.()??[]).filter(e=>e.event==='color-cycle-playback-toggle'||e.event==='layer-update-destructive'||e.event==='color-cycle-layer-cleared'||e.event==='layer-remove').slice(-30).map(e=>({t:e.t?new Date(e.t).toISOString():null,event:e.event,layerId:e.layerId,reason:e.reason,updateKeys:e.details?.updateKeys,skipColorCycleSync:e.details?.skipColorCycleSync,action:e.details?.action,selectionStart:e.details?.selectionStart,selectionEnd:e.details?.selectionEnd,selectionLastAction:e.details?.selectionLastAction,deleteSource:e.details?.deleteSource,playbackBeforeDelete:e.details?.playbackBeforeDelete,before:e.before,after:e.after,stack:e.stack})),fullCc:window.__VESSEL_DUMP_CC_DIAGNOSTICS__?.()},null,2))
```

False-empty filter:

```js
copy(JSON.stringify((window.__VESSEL_GET_CC_MUTATION_LOG__?.()??[]).filter(e=>e.before?.hasContent===true&&e.after?.hasContent===false).map(e=>({t:e.t?new Date(e.t).toISOString():null,event:e.event,layerId:e.layerId,reason:e.reason,before:e.before,after:e.after,stack:e.stack})),null,2))
```

The smoking gun is an `endStroke -> updateLayer` stack where `before.hasContent === true` and `after.hasContent === false` for a layer whose archive refs or decoded buffers are non-empty.

## Related Notes

- `docs/notes/cc-layer-disappearing-diagnostics-2026-04-29.md`
- `docs/notes/prod-cc-layer-clear-console-commands-2026-04-30.md`

## Fix Progress

- Added a regression in `src/hooks/brushEngine/__tests__/ColorCycleBrushCanvas2D.test.ts` for the C5-style collapse where restored metadata has many palettes / `paintSlot: 43`, but store metadata has a smaller fallback palette set / `paintSlot: 0`.
- Added a second regression for the C5 follow-up where the stroke buffers reference `defId 44` / slot `43` and that new live-store def must survive even when restored metadata has more old entries.
- Updated `ColorCycleBrushCanvas2D.getLayerColorCycleMeta()` so restored/persisted CC metadata and live store metadata are merged by identity instead of choosing either source wholesale.
- Updated `ColorCycleAnimator.validateDefPalettes()` so orphaned def ids in already damaged files warn instead of pausing on `console.assert`.
- Updated `clearColorCycleRegion()` so explicit selection deletes zero every CC scalar buffer for selected pixels, not just paint.
- Verified:
  - `npm test -- src/lib/__tests__/ColorCycleAnimator.renderParity.test.ts src/hooks/brushEngine/__tests__/ColorCycleBrushCanvas2D.test.ts --runInBand`
  - `npm test -- src/stores/helpers/__tests__/colorCycleSelection.test.ts src/stores/__tests__/selectionFramebufferDelete.test.ts --runInBand`
  - `npm run type-check`
  - `npm run lint`
