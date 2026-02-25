Goal

Make these simultaneously true for stamp-dither strokes:

Pressure-Res is dynamic across the whole in-progress stroke (older parts update when pressure changes later).

BG fill OFF: last stamp’s transparency wins (new stamp holes reveal what was there before this stroke, not previous stamps).

Never erase prior strokes: painting over existing content cannot remove it (holes reveal base, never write 0).

The current implementation can’t satisfy (1) with the current “incremental paint over the layer” model because you can’t “unpaint” previously drawn pixels without either (a) copy-rewriting the whole layer from a correct full composite or (b) explicitly restoring base pixels.

This plan makes the stroke a deterministic overlay over a frozen base, and it makes “holes” mean restore base, not “skip write” and not “write 0”.

Architecture change
A. Freeze the base at stroke start

At startStroke() create a snapshot of the current committed layer content:

baseIdx: strokeData.paintBuffer (indices)

baseGid: strokeData.gradientIdBuffer (slot ids)

This base never changes during the stroke.

B. Track “last stamp wins” ownership per pixel

Add a per-pixel stamp owner map:

owner[idx] = 0 means untouched this stroke

owner[idx] = stampSeq means last stamp that touched this pixel is stampSeq

This is what allows requirement (2): a later stamp can “make a hole” over an earlier stamp and that hole must override earlier stamp pixels.

C. Store the per-pixel “primary” index for the stroke

You already do this (stampDitherPrimaryBuffer). Keep it, but it must represent the last stamp’s intended primary value for each pixel that stamp touches (even if it ends up being a hole for that stamp).

D. Compose the visible buffer as: base + overlay(owner, primary, tileScale)

Rendering during drawing is not “draw new pixels over old”. It is:

For each pixel:

if owner==0 → output = base

else:

compute tile decision using current tileScale and stable origin

if tile “on” → output = primary

else:

BG fill OFF → output = base (this is the hole rule)

BG fill ON → output = secondary (or whatever your fill mode is)

This is the only hole rule that satisfies (2) and (3) together.

Detailed implementation plan
Phase 0: Define semantics and stop overloading flags

Right now stampDitherClears is being used as “BG fill off”. Rename internally to avoid future confusion:

Add stampDitherBgFill: boolean (default true)

Map existing UI flag:

if UI says “BG Fill OFF” → stampDitherBgFill = false

keep stampDitherClears only if you still need a true erase mode (you likely don’t)

You can keep the old field for compatibility but do not use it for holes.

Also lock the pattern origin explicitly per stroke (do not derive from the first stamp position).
Store a stable origin (e.g., originUnits 0..TILE-1) in LayerStrokeState at startStroke and derive
maskOrigin from that + current tileScale for all stamps and recomposes.

Phase 1: Add the new stroke-only buffers

Extend LayerStrokeState:

stampDitherOwner?: Uint16Array;        // last-stamp-wins map (2 bytes/pixel)
stampDitherStampSeq?: number;          // increments per stamp
stampDitherBaseIdx?: Uint8Array;       // frozen base indices for this stroke
stampDitherBaseGid?: Uint8Array;       // frozen base gradient ids
stampDitherLastTileScale?: number;     // last applied integer scale for recompose
stampDitherLockedBucket?: number;      // lock bucket per stroke (important for recomposition)


Use Uint16Array for owner; it’s enough for any realistic number of stamps per stroke and halves memory vs Uint32Array.

Phase 2: StartStroke freezes base and initializes owner map

In startStroke() after you have strokeData and animator:

Ensure buffers sized to width*height.

Freeze base:

strokeData.stampDitherBaseIdx = strokeData.paintBuffer.slice();
strokeData.stampDitherBaseGid = strokeData.gradientIdBuffer ? strokeData.gradientIdBuffer.slice() : undefined;


Initialize owner + primary:

const n = this.width * this.height;
strokeData.stampDitherOwner ??= new Uint16Array(n);
strokeData.stampDitherOwner.fill(0);

strokeData.stampDitherPrimaryBuffer ??= new Uint8Array(n);
strokeData.stampDitherPrimaryBuffer.fill(0);

strokeData.stampDitherStampSeq = 0;
strokeData.stampDitherBounds = null;
strokeData.stampDitherLastTileScale = undefined;


Make animator start from base so full-layer copy is safe during drawing:

try {
  animator.setIndexBufferFromArray(
    new Uint8Array(strokeData.stampDitherBaseIdx),
    strokeData.stampDitherBaseGid ? new Uint8Array(strokeData.stampDitherBaseGid) : undefined
  );
} catch {}


Lock bucket per stroke (critical to make recomposition reproducible without storing per-stamp buckets):

compute once (use your existing coverage logic with a fixed phase like 0.5) and store in stampDitherLockedBucket.

Capture stable origin per stroke:
store originUnits (0..TILE-1) at startStroke and use origin = -originUnits * tileScale.

Phase 3: Each stamp writes ownership for the full stamp footprint

Modify applyStampDitherMask(...) so when a pixel is inside the stamp shape, you set:

mask[idx] = 1 (current stamp footprint; you already do)

primary[idx] = primaryIndex (already)

owner[idx] = currentStampSeq (new)

Important: ownership must be written for the whole stamp shape footprint, not only where tile “on”.

Implementation detail:

At the start of stamping in paint(), increment stamp sequence:

strokeData.stampDitherStampSeq = (strokeData.stampDitherStampSeq ?? 0) + 1;
const curStamp = strokeData.stampDitherStampSeq;


Pass curStamp into applyStampDitherMask() or set it on strokeData temporarily.

Phase 4: Replace “apply stamp to region” with “compose current stamp”

Rewrite applyStampDitherToRegion(...) to only touch pixels owned by the current stamp (so overlaps work):

Inputs needed:

curStamp

baseIdx/baseGid

owner

primary

bgFill flag

tileScale, origin, locked bucket

Core rules inside the loop:

If pixel not in mask → continue

If owner[idx] != curStamp → continue

Compute tileIdx from (x,y,origin,tileScale)

If tile “on” → write primary

Else:

if BG fill OFF → write base (index + gid)

else → write secondary

This is where requirement (2) is enforced.

Phase 5: Pressure-Res becomes dynamic via recompose on scale changes

Stop using stampDitherLockedScale. Pressure-res must compute scale every paint().

Compute tileScale each paint:

keep your computePressureResolution, but quantize to integer scale.

use ceil or hysteresis so it changes meaningfully (round often collapses).

When integer scale changes, recompose the whole stroke overlay:

Only trigger when tileScaleInt !== strokeData.stampDitherLastTileScale

if (strokeData.stampDitherLastTileScale == null) strokeData.stampDitherLastTileScale = tileScaleInt;
if (tileScaleInt !== strokeData.stampDitherLastTileScale) {
  strokeData.stampDitherLastTileScale = tileScaleInt;
  this.recomposeStrokeOverlay(strokeData, animator, activeSlot, tileScaleInt);
}


Implement recomposeStrokeOverlay(...):

Iterate the union bounds stampDitherBounds (already tracked).

For each pixel where owner[idx] != 0:

compute tile decision with current scale + stable origin

write primary or base/secondary using the same rule as Phase 4

This is what makes requirement (1) true: older pixels update when scale changes later.

Phase 6: Render path during drawing must rewrite the layer from animator (safe copy)

To make recomposition visible (holes can appear where pixels used to be “on”), you must rewrite.

In render():

while isDrawing === true use copy from a full correct composite (now safe because animator starts from base and you always modify the animator buffer, not the layer canvas directly).

after stroke end, source-over is fine (or always copy).

If you keep source-over while drawing, requirement (1) will visually fail because you can’t “unpaint” previously drawn pixels.

Phase 7: EndStroke commits merged result; delete base-merge hacks

At endStroke():

serialize animator index buffer into strokeData.paintBuffer and strokeData.gradientIdBuffer (you already do).

remove any code that “fills zeros from base” (it’s incompatible with the new semantics).

clear stroke-only buffers:

strokeData.stampDitherBaseIdx = undefined;
strokeData.stampDitherBaseGid = undefined;
strokeData.stampDitherOwner = undefined;         // free memory
strokeData.stampDitherPrimaryBuffer = undefined; // optional; free if large
strokeData.stampDitherStampSeq = 0;
strokeData.stampDitherBounds = null;


Keeping them allocated is fine for perf, but freeing reduces peak memory.

Overflow note:
If you use Uint16Array for owner, guard stamp sequence overflow (very long strokes).
If overflow is a real risk, prefer Uint32Array or add a fallback strategy.

Where requirements would still fail (explicit checklist)
Requirement 1 fails if:

you don’t implement recomposeStrokeOverlay() on scale change, or

you keep source-over while drawing, or

bucket/origin aren’t stable (pattern “swims” and looks wrong), or

scale never changes because quantization/hysteresis collapses to a constant.

Requirement 2 fails if:

holes are implemented as “skip write”, or

ownership isn’t written for the whole stamp footprint, or

you allow per-stamp bucket changes without storing per-stamp bucket (recompose can’t reproduce).

Requirement 3 fails if:

holes write index 0, or

you use copy without composing base+overlay into the animator first, or

base snapshot is taken after the animator was cleared/changed.

Acceptance tests you should run

Overlap transparency test (Req 2):

BG fill OFF, stamp A paints solid area, stamp B overlaps with holes → overlapped holes must reveal the layer content from before the stroke (base), not A.

No-erasure test (Req 3):

Paint a prior stroke, start new stroke with BG fill OFF, place a stamp with big holes over prior stroke → prior stroke must remain visible through holes.

Dynamic res test (Req 1):

During a single stroke: stamp with low pressure (coarse), then high pressure (fine) while continuing. After pressure crosses threshold, earlier part must re-tile to new resolution (verify by sampling a fixed pixel and observing its on/off decision flips after scale change).

If you implement Phases 2–6 exactly as above, all three requirements are satisfied simultaneously.
