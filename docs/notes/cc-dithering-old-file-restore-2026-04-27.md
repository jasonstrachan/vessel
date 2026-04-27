# CC Dithering Flattening In Old-File Restore

Date: 2026-04-27

## Summary

New color-cycle files should preserve dithering through save and reload because dither metadata and canonical CC buffers are serialized through the modern `state` / brush snapshot path.

Old files can still show flattened or degraded dithering after restore if the original per-pixel CC authority is missing or incomplete and import repair has to reconstruct canonical paint from legacy/static data. The current logs show the old file is no longer terminally repair-failed: the layers hydrate and restore to runtime surfaces. The remaining issue appears to be fidelity loss in the repaired/restored canonical data, especially where dither information was not recoverable from the old payload.

## Observed Logs

Manual test file had three legacy CC layers:

- `CC Layer 3` (`layer-1777260435813-0.4191651178773492`)
- `CC Layer 2` (`layer-1777259789006-0.6249068007345484`)
- `CC Layer 1` (`layer-1777004221551-0.3365546708924947`)

Initial lazy load:

```text
CC-WARM-RESTORE layer-enter:
defer=true, hydration=warm, hasBrush=false, hasBrushState=true, hasCanvasImageData=true,
gradientIdBuffer=4000000 bytes, gradientDefIdBuffer=8000000 bytes

CC-WARM-RESTORE deferred-cold:
reason=shouldDeferColorCycleRuntimeRestore
```

Cold presentation before warm restore:

```text
VISIBLE-COMPOSITE draw-cc-segment:
hydration=cold, drawSource=compatibility-snapshot, presentationReason=cold
```

Warm restore after activation/handoff:

```text
CC-WARM-RESTORE archive-runtime-hydrated:
gradientIdBuffer=4000000 bytes, gradientDefIdBuffer=8000000 bytes

CC-WARM-RESTORE brush-state-found:
snapshotCount=1

CC-WARM-RESTORE snapshots-prepared:
paintBuffer=4000000 bytes, gradientIdBuffer=4000000 bytes,
gradientDefIdBuffer=8000000 bytes, hasContent=true, hasSpeedBuffer=false

CC-WARM-RESTORE brush-state-restore-complete:
hydration=active, isAnimating=false, hasSpeedBuffer=false, materialized=true,
hasCanvasImageData=true
```

Compositor after restore:

```text
VISIBLE-COMPOSITE draw-cc-segment:
hydration=warm|active, drawSource=runtime-surface, presentationReason=warm|active
```

## Current Interpretation

The latest architecture fix is working in the sense that the old layers are no longer stuck as static preview only. They hydrate archive refs, restore brush state, materialize a runtime surface, and draw from `runtime-surface`.

The suspicious evidence is:

- `hasSpeedBuffer=false` for restored snapshots.
- The restored `paintBuffer`, `gradientIdBuffer`, and `gradientDefIdBuffer` report valid byte sizes but `nonZeroSample=0` in the first 64 sampled bytes.
- `canvasImageData` is present, so the file has a visible compatibility preview, but that preview is presentation-only after import repair.
- If dither was only represented in old visual pixels or in metadata not present in the canonical restored brush state, repair cannot perfectly recover the original dither authority.

## Architecture Boundary

Do not fix this by making runtime, selected layers, compositor, or export repair from `canvasImageData`.

The correct boundary remains:

```text
import/repair only -> canonical CC buffers -> runtime/export/presentation
```

If old-file dithering is recoverable, it must be recovered during import repair and written into canonical brush state. If it is not recoverable, diagnostics should classify the layer as a lossy repair rather than silently implying full fidelity.

## Follow-Up

- Add a targeted old-file fixture for dithered CC restore.
- Inspect whether the old file contains dither metadata:
  - `state.dither`
  - `brushState.ditherEnabled`
  - `brushState.ditherStrength`
  - `brushState.ditherPixelSize`
  - `brushState.perceptualDither`
  - stamp dither fields
- Verify whether restored snapshots preserve those fields after import repair.
- Compare old-file restored canonical buffers against a new-file save/reload fixture with the same dither settings.
- Add diagnostics for lossy dither recovery if the old payload only provides static `canvasImageData` or lacks dither metadata.

## Expected Outcomes

- New canonical files must not lose dithering across save/reload.
- Old files with canonical buffers and dither metadata should preserve dithering.
- Old files repaired from static preview only may remain visibly static or flattened, but should be explicitly diagnosed as lossy/static-preview-derived repair.
