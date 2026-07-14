# CC Brush-Layer Speed Authority — Core Bug-Fix Plan

**Date:** 2026-07-14
**Status:** implemented and verified after expanded-boundary approval

## Goals

The reported bug is that brush-layer speed is destructive: moving the layer
multiplier through slow values permanently changes the per-pixel speed data,
so raising the multiplier does not restore the expected animation rate.

This plan has four required goals:

### G1 — Preserve authored speed data

Changing the layer multiplier or global playback rate must not change authored
per-pixel speed bytes. A stepped multiplier sweep and a direct jump from the
same starting state must produce the same final data and rate.

### G2 — Apply speed controls correctly in live playback

Brush-mode playback must resolve speed as:

```text
effective cycles/sec = decoded authored speed byte
                     * layer speed multiplier
                     * global brush playback rate
```

Each visible layer must retain its own multiplier, global playback must scale
all layers without erasing their individual values, and a multiplier change
must be visible without switching layers.

### G3 — Preserve existing projects

Existing effective-byte projects must open within the defined byte-quantization
tolerance of their prior effective rate, convert to the authored-byte runtime
invariant no more than once, and remain stable through save/reopen. Cold legacy
payloads must retain their original meaning if they are saved without
hydration.

### G4 — Keep editor and Goblet playback equivalent

Given the same authored source bytes, layer multiplier, global rate, and
deterministic base time, the editor and Goblet must resolve the same effective
speed. A legacy-to-authored comparison may differ only by the explicit
migration quantization bound.

These goals define the scope. Work that does not directly satisfy G1-G4 or
prove them is out of scope.

## Confirmed root cause

The current write and edit path mixes two authorities:

- `colorCycleCoreBrushSettingsState.ts` multiplies authored brush speed by the
  layer multiplier before encoding a pixel.
- `colorCycleLayerBaseSpeedRuntime.ts` later decodes those effective bytes,
  applies `next / previous`, and re-encodes them in place for every slider
  step.

The destructive sequence is:

```text
byte 4 at 1.00x -> byte 2 at 0.27x -> byte 2 after stepping to 2.64x
```

The multiplier is already persisted as `layerBaseSpeedCps`, and global playback
is already a runtime scalar. The broken invariant is that the layer scalar is
also baked into the pixel bytes.

## Runtime invariant

Use one meaning inside the live editor:

- resident `speedBuffer`: authored quantized per-pixel speed;
- `layerBaseSpeedCps`: per-layer multiplier;
- global playback scale: global multiplier;
- byte `0`: static under all multipliers.

The runtime must not carry both legacy-effective and authored buffers. Legacy
data is normalized once at the load boundary before it becomes a resident
document or animator buffer.

Speed-source semantics are serialized only. They do not become a field on
`ColorCycleLayerDocumentState`: every resident document is authored by
invariant.

`ColorCycleAnimator` keeps the two runtime scalars separate internally:

- `setSpeed(...)` continues to set the global playback rate;
- a narrow layer-multiplier setter updates only that animator;
- the animator sends the composed value to its existing animation clock;
- rebuild initializes the layer multiplier from the canonical document
  snapshot.

This avoids a new controller map and preserves the existing CPU/WebGL time
path.

## Compatibility boundary

Existing saved buffers contain effective speed bytes. New saved buffers contain
authored speed bytes. That distinction is required, but it stays at the
serialized speed-source boundary instead of being propagated through every
runtime type.

Do not repurpose the existing persistence `schemaVersion`. It remains the
canonical-payload schema contract at version `1`.

Add a narrow `speedSourceVersion` beside every serialized speed source:

- `SerializedColorCycleLayerState.speedSourceVersion` travels with `speedRef`;
- `PersistedColorCycleStrokeData.speedSourceVersion` travels with
  `speedBuffer`;
- missing or `1`: legacy effective bytes;
- `2`: authored bytes.

If both serialized representations are present, their markers must agree. A
conflict is invalid source metadata and must fail closed rather than guessing.
The marker must never be copied into the resident document contract.

On legacy hydration, `projectIO.ts` owns the ordering and calls a pure
normalization helper from `brushPersistenceAdapter.ts` before it constructs or
applies any runtime snapshot:

1. Read the saved layer multiplier.
2. Divide each non-zero decoded effective speed by that multiplier.
3. Encode once into a new authored buffer.
4. Preserve byte `0` as static.
5. Mark the converted source as version `2` only after conversion succeeds.
6. Use the normalized buffer for both serialized-state restore and the later
   direct snapshot application. Do not allow an original animator `speedData`
   copy to overwrite it.
7. Commit only the authored buffer to the resident runtime/document.

For an explicit legacy multiplier of zero, do not divide. Preserve non-zero
bytes as recoverable authored data while the zero scalar keeps the layer
static.

New resident saves write speed source version `2`. A cold legacy save that does
not hydrate the speed payload must preserve its version `1` marker and refs; it
must not relabel untouched effective bytes as authored. History/runtime
snapshots are authored and never enter the legacy conversion path.

The damaged source cannot be reconstructed automatically because its original
speed information is already gone. The existing repaired archive already
contains authored replacement bytes but has no `speedSourceVersion`; loading it
directly through the missing-marker legacy rule would convert it again. Its
structural state version remains `1`, but that field is not the speed-semantics
marker.

Preserve both existing files as evidence:

- damaged: `/Users/jasonstrachan/+Projects/2026/Art/calibration/1.5.vs`
- repaired:
  `/Users/jasonstrachan/+Projects/2026/Art/calibration/1.5-speed-repaired.vs`

Before runtime acceptance, create a byte-identical tagged witness whose speed
sources are explicitly version `2`:

- authored witness:
  `/Users/jasonstrachan/+Projects/2026/Art/calibration/1.5-speed-repaired-authored-v2.vs`

Do not use the untagged repaired archive as post-migration runtime proof.

### Quantization contract

Let one decoded byte step be:

```text
speedByteStep = (MAX_BRUSH_COLOR_CYCLE_SPEED
               - MIN_BRUSH_COLOR_CYCLE_SPEED) / 254
```

Legacy migration is accepted when the restored effective rate differs from the
legacy effective rate by no more than:

```text
0.5 * speedByteStep * abs(layer multiplier) * abs(global rate)
```

Use a small floating-point epsilon in tests. Editor/Goblet comparisons that
start from the same authored bytes must use the same decoded value and scalar;
they do not get an additional migration allowance.

## Scope

In scope:

- authored brush speed bytes;
- the brush-layer multiplier;
- global brush playback composition;
- one-time legacy normalization at restore/hydration;
- preservation of cold legacy payload meaning;
- editor, save/reopen, and Goblet interpretation of the same speed source;
- immediate visible playback after a multiplier-only change.

Out of scope:

- recolor-layer speed;
- automatic repair of already-damaged artwork;
- a general persistence migration framework;
- a new speed-model subsystem or renderer;
- controller, compositor, shader, gradient, flow, phase, dither, or palette
  refactors;
- frame-publication work already owned by the restored-brush binding;
- unrelated color-cycle performance work.

## Owning code boundary

The code trace maps each goal to these existing owners:

| Goal | Expected owner | Required responsibility |
| --- | --- | --- |
| G1 | `src/hooks/brushEngine/colorCycleCoreBrushSettingsState.ts` | Return authored write speed instead of multiplying by layer speed. |
| G1, G2 | `src/hooks/brushEngine/colorCycleLayerBaseSpeedRuntime.ts` | Remove ratio rescaling; publish multiplier metadata and update the active animator scalar. |
| G2 | `src/lib/ColorCycleAnimator.ts` | Keep global and layer scalars separate, compose them into the existing clock, and initialize the layer scalar during rebuild. |
| G3 | `src/lib/colorCycle/document/brushPersistenceAdapter.ts` | Define the pure speed-source normalization helper, emit version `2` for resident/runtime serialization, and preserve source markers when adapting serialized snapshots. |
| G3 | `src/lib/colorCycle/persistence/colorCyclePersistenceTypes.ts` | Type the marker next to persisted speed buffers without changing canonical `schemaVersion`. |
| G3 | `src/lib/colorCycle/persistence/captureColorCyclePersistenceSnapshot.ts` | Mark resident/document captures as authored version `2`. |
| G3 | `src/utils/projectIO.ts` | Normalize before either runtime-apply path, preserve cold legacy refs and markers, and write authored markers only for authored payloads. |
| G3 | `src/utils/projectPersistence.ts` | Accept `speedSourceVersion` as canonical state metadata while retaining strict unknown-field rejection. |
| G4 | `src/utils/export/goblet/gobletColorCycleSerializer.ts` | Resolve source semantics and apply the correct scalar exactly once without re-encoding buffer-mode bytes. |

This nine-production-file list is the audited consequence of G1-G4. It exceeds
the repository's six-file bug-fix guardrail; the expanded boundary, including
the strict project-state metadata classifier, was explicitly approved before
implementation. Treat it as a hard boundary. If code evidence shows that a
goal cannot be completed through these owners, stop and explain the missing
ownership seam before expanding it.

Do not add `speedModel.ts`, a resident document semantics field, a playback
controller map, or UI/store wiring unless evidence demonstrates that an
existing owner cannot maintain the required invariant. Do not change
`COLOR_CYCLE_PERSISTENCE_SCHEMA_VERSION` for this migration.

## Implementation sequence

### 1. Lock G1 and G2 with the reported failure

Add a regression that compares these paths from the same deterministic source:

```text
direct:  1.00x -> 2.64x
stepped: 1.00x -> 0.27x -> 2.64x in 0.01 increments
```

The final authored bytes must remain unchanged in both paths, and the composed
animator speed must match.

### 2. Establish the G1 authored-data invariant

- Make `getResolvedWriteCycleSpeed(...)` return authored tool speed.
- Preserve an explicit layer multiplier of `0`; do not pass multiplier zero
  through the authored-speed sanitizer that replaces it with a positive
  fallback.
- Remove the ratio field and the decode/rescale/re-encode loop completely.
- Keep the existing scalar metadata transaction, dirty/render request, and
  frame publication path.
- Do not clone, upload, or regenerate the speed buffer for a scalar edit.

### 3. Satisfy G2 at the animator clock

- Store global rate and layer multiplier separately in `ColorCycleAnimator`.
- Recompose when either changes without resetting phase.
- Rebuild reads the target layer's multiplier from its document snapshot.
- Switching layers must not change another animator's multiplier.
- A layer edit updates only the target animator's layer scalar. The existing
  global playback setter remains responsible for updating global rate across
  animators.

### 4. Satisfy G3 at persistence boundaries

- Keep canonical persistence `schemaVersion` at `1` and add
  `speedSourceVersion` only beside serialized speed sources.
- Treat missing or version `1` speed semantics as legacy effective bytes.
- Convert in `projectIO.ts` only when the bytes are hydrated for resident use,
  before both serialized restore and direct snapshot apply.
- Never convert an authored payload twice.
- Preserve cold legacy refs and their legacy version during a save that does
  not hydrate them.
- Reject conflicting state/snapshot speed-source markers.
- Tag a byte-identical authored-v2 copy of the repaired witness.

### 5. Satisfy G4 at the existing export boundary

- Resolve one source scalar:
  - legacy effective payload: global export scale;
  - authored payload: layer multiplier times global export scale.
- Slot mode may decode and multiply the slot speed by that scalar.
- Buffer mode must preserve the original bytes and compose the scalar into the
  exported `speedMin`/`speedMax` range. Do not use
  `scaleEncodedSpeedBuffer(...)` for this path; re-encoding would quantize and
  clamp high effective rates.
- Ensure fallback/controller metadata does not apply the same scalar again.
- Do not modify shaders or add a second runtime speed path.

## Verification ownership

Use the existing focused suites owned by the four goals:

1. `src/hooks/brushEngine/__tests__/colorCycleCoreBrushSettingsState.test.ts`
2. `src/hooks/brushEngine/__tests__/ColorCycleBrushCanvas2D.test.ts`
3. `src/lib/__tests__/ColorCycleAnimator.speedScaling.test.ts`
4. `src/utils/__tests__/projectIO.test.ts`
5. `src/lib/colorCycle/persistence/__tests__/captureColorCyclePersistenceSnapshot.test.ts`
6. `src/utils/export/goblet/__tests__/gobletSlotSpeedExport.test.ts`

Required proof:

- G1: slider sweep versus direct jump leaves authored bytes identical.
- G1: a multiplier-only edit performs zero speed-buffer rewrites.
- G1: mixed static/non-static bytes preserve byte `0`.
- G2: two visible layers retain independent multipliers.
- G2: global rate changes preserve each layer multiplier.
- G3: an explicit zero multiplier preserves non-zero authored bytes, renders
  static, and resumes from those bytes when raised above zero.
- G3: legacy load converts once, remains within the quantization bound, and is
  stable through save/reopen.
- G3: cold legacy save does not relabel untouched bytes.
- G3: authored save/reopen does not re-convert.
- G3: conflicting state/snapshot markers fail closed.
- G3: canonical persistence `schemaVersion` remains `1`.
- G4: Goblet legacy and authored sources produce the same effective rate.
- G4: buffer-mode export preserves source bytes and represents scalar
  composition through its speed range without clipping.
- G1-G4 runtime gate: the repaired witness changes speed visibly without a
  layer switch and matches Goblet at a deterministic base time.

## Runtime acceptance

Unit tests and a build do not prove this fix.

1. Restart production preview with
   `mise exec node@22.22.0 -- npm run preview:prod:restart`.
2. Confirm the authored witness has `speedSourceVersion: 2` beside every
   repaired speed source and that its speed bytes match the untagged repaired
   archive exactly.
3. Load `1.5-speed-repaired-authored-v2.vs` at `/vessel/`.
4. Capture CC diagnostics before changing speed and confirm the resident source
   is authored without a migration event.
5. Compare a direct jump with a slow down/up sweep from the same starting
   multiplier.
6. Verify equal final measured rate without switching layers.
7. Keep two affected layers visible at different multipliers and confirm they
   remain independent.
8. Save, reopen, confirm the saved marker remains version `2`, and repeat one
   representative comparison.
9. Export Goblet and compare editor/Goblet rate at the same deterministic base
   time.
10. Confirm the multiplier interaction caused zero speed-buffer rewrites and no
   speed-texture upload.

## Verification commands

Run smallest to broadest under the pinned runtime:

```bash
mise exec node@22.22.0 -- npm test -- --runInBand <focused speed tests>
mise exec node@22.22.0 -- npm run type-check
mise exec node@22.22.0 -- npm run type-check:tests
mise exec node@22.22.0 -- npm run lint
mise exec node@22.22.0 -- npm test
mise exec node@22.22.0 -- npm run verify:goblet-runtime
```

Do not run a separate build while `preview:prod:watch` owns the production
build.

## Stop conditions

- Any slider path writes or regenerates the speed buffer.
- Legacy effective bytes receive the layer multiplier twice.
- Authored bytes receive the layer multiplier zero times or twice.
- A cold legacy payload is relabeled without hydration/conversion.
- A converted payload can be converted again after save/reopen.
- The untagged repaired archive is used as authored post-migration proof.
- Canonical persistence `schemaVersion` is changed to represent speed semantics.
- Conflicting speed-source markers are accepted or silently reconciled.
- Byte `0` becomes animated.
- A zero layer multiplier destroys non-zero authored bytes or restores as a
  positive fallback.
- Global speed overwrites a layer multiplier or one layer changes another.
- Goblet buffer-mode export re-encodes scaled bytes or clips a valid composed
  rate.
- Visible speed still requires switching layers.
- The fix touches recolor, shaders, compositor architecture, or unrelated
  persistence code.
- Evidence requires a production owner outside the audited G1-G4 boundary;
  stop, update the ownership trace, and request review before touching it.

The stop condition is evidence that the audited ownership boundary is
incomplete. It is not permission to add patches around the missing seam.
