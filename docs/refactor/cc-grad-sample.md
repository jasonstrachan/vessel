# Color Cycle Gradients v2 Spec
Persistent across all modes, fast preview, preview == finalize, no cross-shape recolor unless explicitly requested.

## 1) Non-negotiable invariants
1. **Committed pixels never depend on “current gradient” state.**  
   Changing gradient settings must not reinterpret already-committed pixels.
2. **Preview uses the exact same EffectiveGradient and banding math as finalize.**  
   Preview/finalize equality is guaranteed at a defined render time `t_commit` (see §6.3).
3. **Pointer-move never mutates persistent layer gradient state.**  
   No `gradientDefs/slotPalettes/activeSlot/gradient` writes during preview.
4. **All gradient fill modes share the same “write contract”.**  
   Every filled pixel stores:
   - `bandIndex` (which band within a gradient)
   - `gid` (which gradient instance it belongs to)

If you enforce (4), “all shapes change to newest gradient” cannot happen again across any mode.

---

## 2) Data model (per CC layer)

### 2.1 Persistent per-pixel buffers (core)
- `idx: Uint8Array` length `W*H`  
  Band index `0..(bands-1)` (or `0..254`).
- `gid: Uint8Array` length `W*H`  
  Gradient instance id per pixel `0..255`.

### 2.2 Persistent gradient instances
A gradient instance represents “the gradient used when those pixels were filled”.

```ts
type GradientMode = 'manual' | 'fg' | 'sample';

type GradientInstance = {
  gid: number;                // 0..255
  mode: GradientMode;
  hash: string;               // stops/spec + bands + algo versions + relevant params
  bands: number;              // number of bands used for idx encoding
  lutKey: string;             // key to LUT cache (can equal hash)
  stops?: Stop[];             // manual/sample
  fgSpec?: DerivedSpec;       // fg mode
  createdAt: number;
};
```

Stored in:

layer.colorCycleData.gradientInstances: Record<number, GradientInstance>

layer.colorCycleData.nextGid: number (allocator cursor)

### 2.3 LUT cache (fast render)
Rendering needs a fast lookup table per instance:

lutByGid: Record<number, Uint32Array> where each LUT is bands entries packed RGBA
(Or a slot-backed LUT cache if you keep palette slots; render must still choose by gid.)

Critical: LUT selection is by gid (per pixel), not by “active slot”.

### 2.4 Legacy/migration semantics (required)
Reserve gid=0 as the safe fallback instance.

Initialization of gid=0 (on layer init/load):

gradientInstances[0] = { gid:0, mode:'manual', hash:'__default__', bands:<default>, stops:<DEFAULT_STOPS>, ... }

LUT[0] is built from DEFAULT_STOPS + default band count.

Load-time migration for legacy layers:

If layer is CC and has indices but no gids:

allocate gid buffer, fill with 0

ensure instance 0 exists

If gids exist but refer to missing instances:

remap those pixels to gid=0 (or recreate if recoverable), log once per missing gid.

This preserves legacy “single gradient for whole layer” behavior.

## 3) UI
Button group (exact):

Manual Grad | FG Grad | Sample

Mode semantics:

Manual Grad: uses user-edited stops.

FG Grad: derived from foreground + params; produces deterministic stops/spec.

Sample: samples from canvas during stroke/shape.

Optional toggles (recommended, can default):

Freeze per shape (default ON for Sample; optional for Manual):
New fills allocate a new gid; old fills remain unchanged.

Recolor existing (explicit tool action only):
Edits existing regions by rewriting pixels’ gid in a region OR updating the instance the region references.

Without “Recolor existing”, changing gradient settings only affects new fills.

## 4) EffectiveGradient: single source of truth
Every preview frame and the finalize must reference a single computed object:

```ts
type EffectiveGradient = {
  mode: GradientMode;
  stops: Stop[];          // resolved stops for manual/fg/sample
  hash: string;           // includes mode + spec/stops + bands + algo versions + relevant params
  bands: number;          // final band count used for idx
  gid: number;            // target instance id for this fill
  version: number;        // monotonic per-stroke (debug only)
};
```
Rules:

hash MUST include anything that affects pixels: stops/spec, bands, perceptual/dither params, quantization, sampling algo version.

Preview and finalize must use the same EffectiveGradient (or same hash/bands/gid).

## 5) Stroke/shape pipeline (single controller)
Create CcGradientControllerV2 as the only owner of gradient preview + commit.

### 5.1 Session model
One session per (layerId, strokeId):

```ts
type CcSession = {
  layerId: string;
  strokeId: string;
  mode: GradientMode;
  lastEffective: EffectiveGradient | null;
  previewActive: boolean;
  previewOverlayDirtyRoi?: ROI;
};
```
### 5.2 Controller API
beginStroke(layerId, strokeId)

updatePreview(layerId, strokeId, geometry, samplingPts?)

finalize(layerId, strokeId, geometry, roi)

No other code may:

mutate gradientInstances during pointer move

derive stops independently for finalize

“apply gradient” by writing to persistent layer state during preview

## 6) Preview: fast and correct (no lag)
### 6.1 Preview rendering strategy
Preview renders to overlay only. It never changes committed idx/gid.

Option A (recommended): CPU preview into overlay ImageData (ROI-only)

Compute EffectiveGradient and LUT (cached by hash).

Compute per-pixel bandIndex for only the preview ROI.

Render into overlayCanvas via putImageData for ROI.

Option B: Brush runtime preview path
Allowed only if:

it renders to overlay only, and

it never alters committed layer buffers.

### 6.2 Preview performance guarantees
ROI-only work bounded by bbox + small padding.

LUT caching: never rebuild LUT if hash unchanged.

No per-move allocations (reuse arrays/buffers; bucket ROI sizes).

### 6.3 Preview/finalize identity lock (time-scoped)
On pointer-up:

capture `t_commit` (monotonic time or animation phase).

finalize uses session.lastEffective exactly.

finalize must not re-sample, re-derive, or re-read UI state.

finalize render uses `t_commit` (or freezes animation for that render pass), so the last preview frame and first committed render sample identical time.

If session.lastEffective is null: finalize is a no-op (or uses a logged fallback).

## 7) Finalize: persistent across all modes
Finalize commits into persistent buffers.

### 7.1 Resolve/allocate GID (instance identity)
Given hash:

If Freeze per shape is ON:

allocate a new gid per finalize (or reuse only under explicit grouping rules).

If freeze is OFF:

reuse an existing gid that matches hash if present; else allocate new.

Allocator:

gid is 0..255 (reserve some ids if needed).

Exhaustion policy must be explicit:

recommended: refcount-based reuse + optional compaction

Maintain gidRefcount[gid] = number of pixels referencing gid (incremental or lazy scan).

Prefer free gids (unused ids not in gradientInstances).

Else reuse gids with gidRefcount==0.

If none, optionally compact (LRU of low-refcount gids). If Freeze per shape is strict, do not evict nonzero refcount gids.

If still none, degrade gracefully by switching to grouped reuse (Freeze per hash) and warn in UI/logs.

### 7.2 Commit pixels (the persistence contract)
For each pixel p in the shape mask:

layer.idx[p] = bandIndex

layer.gid[p] = effective.gid

### 7.3 Render final
After commit:

Re-render ROI (or schedule layer recompose) using gid-aware decode.

Clear overlay preview.

## 8) Rendering (gid-aware decode)
When composing the CC layer:

For each pixel p:

g = gid[p]

i = idx[p]

rgba = LUT[g][i] (or via instance→slot→lut)

No “active slot” is consulted for committed pixels.

If animation is supported:

animation updates LUT contents per instance over time

it must not change which gid a pixel references

## 9) Mode-specific stop resolution
All modes output stops[] and a hash.

### 9.1 Manual mode
Source: brushSettings.colorCycleGradient

Hash: manual:{stops}:{bands}:{dither/perceptual params}:{algo versions}

### 9.2 FG mode
Source: buildForegroundDerivedGradientSpec(...)

Stops: deriveForegroundGradientStops(spec)

Hash: fg:{spec.key}:{bands}:{params}:{algo versions}

### 9.3 Sample mode
Source: sampled polyline points (deterministic sampling)

Stops: computed deterministically from sampling algorithm

Hash: sample:{stops}:{bands}:{sampling algo version}:{params}

### 9.4 Canonical hashing/normalization (normative)
Canonical stop serialization:

Stops are sorted by position ascending.

Positions are quantized (e.g., round(position * 10000) / 10000).

Colors are normalized to a single representation (e.g., #RRGGBB + separate alpha, or rgba(r,g,b,a) with a quantized to 0..255).

All colors must be interpreted in a declared space: sRGB for stops storage and hashing (recommended).

Hash inputs (minimum set):

mode

canonical stops OR canonical FG spec key

bands

dither/perceptual flags + parameters

sampling algo version

fill-mode-specific math version (linear/concentric, distance metric, etc.)

Sampling requirements (normative):

deterministic (no time dependence)

consistent quantization (positions rounded; colors normalized)

Sample in layer pixel space (world/canvas pixel coordinates aligned to the layer buffer). Never sample in screen space.

All sampling points are quantized to integer pixel coordinates at the moment they’re recorded.

Any stochastic element must be seeded by a deterministic seed (e.g., hash(layerId, gid, shapeStableId) or hash(layerId, strokeId)); never wall-clock time.

## 10) Dither/perceptual and band count
For CC gradient fills, band count must be user-controlled and stable:

bands = clamp(settings.gradientBands ?? 12, 2, 64) (or your max)

Do not derive bands from projection span/spacing for ccGradient shape fills.

Dither/perceptual affects LUT and/or band selection and must be included in hash.

## 11) Explicit “recolor existing” (optional but recommended)
If you want intentional recolor of older shapes:

provide a tool action that rewrites pixels’ gid within a region to a target gid, OR

provide an edit operation that updates an instance and is expected to recolor all pixels referencing it

This is the only workflow where old pixels change, and it is explicit.

## 12) Guardrails and logging (no silent failure)
### 12.1 Hard assertions (dev)
Preview must not write to layer.idx or layer.gid.

Finalize must write gid for any pixel written.

Renderer: if gid[p] references missing instance, log once and fallback to gid 0.

### 12.2 Log keys (always include)
layerId, strokeId, mode, hash, gid, bands, roi, elapsedMs

Throttle preview logs by hash changes only.

## 13) Tests (must exist before “done”)
### 13.1 Persistence tests (prevents the bug forever)
For each mode (manual/fg/sample) and each fill geometry (linear/concentric/circular if supported):

Fill shape A with gradient GA

Change UI gradient to GB

Fill shape B

Assert A still renders as GA after:

full redraw

play/pause animation

undo/redo

save/load

### 13.2 Preview/finalize equivalence (time-scoped)
Compare preview ROI pixels vs finalize ROI pixels for deterministic inputs at identical `t_commit`.

A separate test asserts animation can change appearance over time (expected).

### 13.3 No preview mutation
Assert pointer-move does not change layer.idx/gid or gradientInstances.

## 14) Integration checklist (wiring points)
Touch:

useDrawingHandlers pointer down/move/up for CC gradient shape

runColorCycleShapeFill to call controller preview/finalize

CC layer render path to decode via gid

Must delete/disable:

any pointer-move call that writes layer.colorCycleData.gradient

any pointer-move call to setLayerColorCycleGradient, applyColorCycleGradientEdit,
setGradientSlot, setActiveGradientSlot that affects committed pixels

## 15) Why this fixes the original failure mode
The prior plan controlled preview/finalize consistency but still relied on mutable palette/slot state.
This spec fixes persistence at the data model layer:

Old shapes persist because pixels store gid.

All modes persist because they all write (gid, idx) under one contract.

Preview is fast because it’s ROI-only and LUT-cached.

Preview == finalize at `t_commit` because both use the same EffectiveGradient captured in the session and identical time sampling.
