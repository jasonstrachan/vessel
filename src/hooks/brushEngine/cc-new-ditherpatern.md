Implement “Option B”: true dithering once per stroke at endStroke() (error diffusion), while preserving:

Dynamic pressure-linked pre-res (tileScale/cellSize can change during the stroke)

BG Fill OFF semantics (skipped pixels restore the pre-stroke buffer, not “secondary fill”)

Also keep live painting responsive by using the current fast ordered/tile preview during the stroke, then finalize to true diffusion on mouse-up.

Core invariants (do not break)
Dynamic pressure res

During the stroke, the user can have stampDitherPressureLinked = true, which changes tileScaleInt per stamp.

Finalization must respect that: regions stamped at different tileScale must keep their coarse/pixelated look.

BG Fill OFF

“Not chosen” pixels must revert to the pre-stroke index + gid at that pixel (base snapshot), not to secondary index.

This must work even when the stroke overlaps existing painted content.

Data model changes (minimal, explicit)

Add these fields to LayerStrokeState:

type LayerStrokeState = {
  // existing...
  stampDitherChoice?: Uint8Array;         // 0/1 per pixel: choose primary?
  stampSeqMeta?: Array<[number, number]>; // [stampSeq, tileScaleInt] for this stroke
  stampSeqToTileScale?: Uint16Array;      // built at finalize: seq -> tileScaleInt
  strokeDitherSeed?: number;              // locked per stroke (based on selected color + slot + strokeCounter)
  strokeDitherLockedBucket?: number;      // lock once at stroke start (or reuse existing stampDitherLockedBucket)
};


Notes:

stampDitherChoice is full-canvas sized like your other stamp arrays (simple and fast indexing).

stampSeqMeta is a small JS array used only during the stroke; on finalize you compress into a typed lookup (stampSeqToTileScale).

Stroke lifecycle changes
1) startStroke() – lock the stroke dithering “identity” and capture base if BG off

Add at the end of your existing startStroke stamp-dither setup:

Lock seed per stroke

Use the foreground color + active gradient slot + strokeCounter.

If you can’t easily get foreground RGB here, use a stable “dither key” already available (e.g. active gradient id/signature + strokeCounter). Foreground color is ideal.

Example seed:

strokeData.strokeDitherSeed = hash32(fgR, fgG, fgB, activeSlot, this.strokeCounter);
strokeData.stampDitherSeed = strokeData.strokeDitherSeed; // reuse existing field


Lock bucket once per stroke

You already compute stampDitherLockedBucket at startStroke. Keep it stroke-locked (do not recompute per stamp).

Initialize stamp seq metadata

strokeData.stampSeqMeta = [];
strokeData.stampSeqToTileScale = undefined;


BG off base snapshot (do not break)

If BG fill is off: ensure you have base buffers for the stroke.

V1 (simple, safe): full-copy at stroke start, same as you already do for stamp mode.

if (!this.stampDitherBgFill) {
  strokeData.stampDitherBaseIdx = strokeData.paintBuffer.slice();
  strokeData.stampDitherBaseGid = strokeData.gradientIdBuffer?.slice();
}


This is the cleanest way to guarantee correctness. Optimize later (ROI-only copy) once stable.

2) paint() – keep your current fast preview, but record per-stamp tileScale

You already compute:

tileScaleInt (pressure-linked or base)

stampSeq increments

stampBounds from applyStampDitherMask(...)

Add one line when a stamp is actually applied (i.e. useStampDither && stampBounds):

strokeData.stampSeqMeta?.push([stampSeq, tileScaleInt]);


That’s it. No heavy work during paint.

Important: This preserves dynamic pressure res because each stampSeq gets its tileScale.

3) endStroke() – finalize true error diffusion before snapshotting

Insert a new step before animator.endStroke() / forceRender() / snapshot:

if (this.stampDitherEnabled && isErrorDiffusionAlgo(this.stampDitherAlgorithm)) {
  this.finalizeStrokeErrorDiffusion(id, animator, strokeData, flowSlot);
}


Then proceed with your normal animator.endStroke() and snapshot logic. This ensures history captures the finalized result.

Finalization algorithm (the core)
A) Build seq -> tileScale lookup once

At finalize:

Determine maxSeq = strokeData.stampDitherStampSeq.

Allocate Uint16Array(maxSeq + 1) and fill from stampSeqMeta.

const maxSeq = strokeData.stampDitherStampSeq ?? 0;
const lut = new Uint16Array(maxSeq + 1);
for (const [seq, scale] of strokeData.stampSeqMeta ?? []) {
  if (seq >= 0 && seq <= maxSeq) lut[seq] = scale;
}
strokeData.stampSeqToTileScale = lut;


Now you can determine the tileScale for any pixel:

const seq = owner[idx];
const scale = lut[seq];


This is how you preserve dynamic pressure res during finalize.

B) Compute diffusion choices per tileScale group (block diffusion)

You will run diffusion in cell space where cellSize = tileScaleInt * basePixelSize.

basePixelSize is your stampDitherPixelSize (or the pre-res size).

tileScaleInt is the pressure-linked multiplier you recorded.

For each unique tileScale present in the stroke:

Find bounds for that tileScale (tight union).
Efficient approach: single pass over ROI pixels and track min/max if lut[owner[idx]] == tileScale.

Run binary error diffusion over cells in that bounds:

Only process cells that contain at least one owned pixel for that tileScale (same cellHasAnyOwnedPixel idea).

Output is choice[idx] = 1|0 for pixels owned by that tileScale (fill the whole cell decision).

Inputs to diffusion:

coverage = lockedBucket / (STAMP_DITHER_BUCKETS - 1) (use your existing locked bucket)

seed = strokeData.strokeDitherSeed (locked per stroke)

strength = this.ditherStrength (or separate stamp-strength if you want)

algo = this.stampDitherAlgorithm (e.g. Floyd vs Sierra Lite)

Key: diffusion is per tileScale group, so the “pixel size” look remains correct for dynamic pre-res.

C) Apply choices to the animator buffer with BG-off semantics

Use animator.beginDirectFill():

For each pixel idx in stroke ROI:

if (owner[idx] == 0) continue

seq = owner[idx]

scale = lut[seq]

usePrimary = (choice[idx] == 1) (computed for that scale)

primaryIndex = primary[idx]

Apply:

If usePrimary:

write primaryIndex and gid = flowSlot (or 0 if index 0)

Else:

If BG off:

restore baseIdx[idx] and baseGid[idx] exactly

Else:

write secondaryIndex(primaryIndex) and gid = flowSlot

This exactly preserves BG fill off behavior.

Finally:

animator.endDirectFill({ markDirty: animator.hasWebGL?.() ?? false })

animator.markDirtyBounds(strokeData.stampDitherBounds) (or tight ROI)

Worker strategy (so it stays fast)
Thresholding

You already use COLOR_CYCLE_FILL_WORKER_AREA = 240_000.
Reuse the same threshold for stroke finalize:

If ROI area <= 240k: run diffusion on main thread (block diffusion, should be OK).

If ROI area > 240k: offload to a worker.

Worker inputs/outputs (minimal transfer)

To avoid transferring full-canvas arrays:

Send only ROI sub-rect data:

maskROI (Uint8Array)

ownerROI (Uint16Array)

primaryROI (Uint8Array) (optional; you can apply primary on main thread since it’s already resident)

seqToTileScale (Uint16Array up to maxSeq; usually small)

bounds, basePixelSize, tileScaleList, coverage, seed, algo, strength

Worker outputs:

choiceROI (Uint8Array) for the ROI (0/1 per pixel)

Main thread then applies choice to animator with BG-off restore using base buffers that never left the main thread.

This keeps BG-off correct and avoids sending base buffers.

Compatibility details (explicit)
Dynamic pressure res

Preserved because:

Each stamp records its tileScaleInt

Finalize groups pixels by tileScaleInt and diffuses in cell space for that scale

Output keeps coarse blocks where pressure requested it

BG fill OFF

Preserved because:

Base buffers are captured at stroke start when BG off is enabled

Finalize uses base restore on “not chosen” pixels

Stable pattern “based on selected color”

Achieved by:

Locking strokeDitherSeed from foreground color (and slot) at startStroke()

Using that seed for diffusion thresholds/jitter

Do not reseed per stamp

(If you want exactly identical pattern for two strokes with same color, omit strokeCounter from the seed; otherwise include it so different strokes don’t look copy-pasted.)

Implementation phases (safe rollout)
Phase 1: Record metadata + ROI plumbing (no visual change)

Add stampSeqMeta recording in paint()

Add seed lock in startStroke()

Add base capture guarantee when BG off

No finalize step yet

Phase 2: Finalize diffusion for single tileScale (pressureLinked off)

Implement finalizeStrokeErrorDiffusion assuming one tileScale (use strokeData.stampDitherStrokeScale or base)

Gate it behind a flag: FF.ccStrokeFinalizeDither

Phase 3: Multi-tileScale finalize (pressureLinked on)

Build seqToTileScale

Group by tileScale and diffuse per group

This is the “do not break dynamic pre-res” milestone

Phase 4: Worker offload for large ROI

Add runStrokeDitherJob worker message type

ROI packing/unpacking

Test plan (must pass)

BG off correctness

Paint over existing CC content with BG off.

Ensure “skipped” pixels restore previous content exactly (both index and gid).

Validate by comparing buffer before/after finalize in ROI.

Dynamic pressure res correctness

Enable pressureLinked.

Draw a stroke where pressure ramps from low to high.

Verify coarse block size changes along the stroke after finalize (no all-uniform cellSize regression).

Undo/redo stability

Ensure finalize runs before snapshot.

Undo restores the finalized buffer (not the preview).

Determinism

Same seed + same stroke input = same result.

Changing only foreground color changes the dither pattern.

Performance

Very large ROI triggers worker; UI remains responsive.

Small ROI stays main-thread, no noticeable hitch.

Where this touches your code (specific insertion points)

startStroke():

set strokeDitherSeed, init stampSeqMeta, ensure base capture when BG off

paint():

when useStampDither && stampBounds, push [stampSeq, tileScaleInt]

endStroke():

before animator.endStroke() / snapshot: call finalizeStrokeErrorDiffusion(...) if algo is error diffusion

If you want, I can outline the exact function signatures and where to store ROI-packed arrays for the worker job, matching your existing runConcentricFillJob/runPerceptualDitherJob pattern.