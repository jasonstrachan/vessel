# Final burn plan — CC gradient binding + preview/final parity (REVISION 5, phased + Mode D + tripwires)

This revision prevents the two mistakes we already hit:

- **F1:** Preview shows the correct manual gradient, but finalise commits a different gradient.
- **F2:** Marks/strokes disappear because buffers get overwritten from renderer/animator state.

It also splits delivery into two phases so **live sampling cannot destabilize correctness**.

**Key update in Rev 5:** Phase 1 adopts **Mode D (def-bound)** so slot/override mistakes become structurally impossible.

---

## 0) Root causes (explicit)

### RC1 — Slot/ID confusion (root cause of “preview OK / final wrong”)
Current fill code treats `gradientIdOverride` as a slot id and writes it into an 8-bit `gid` buffer.  
If UI passes a TEMP id (e.g. `13`) but slot 13 contains the default palette, the committed pixels bind to the wrong gradient.

### RC2 — Renderer readback overwrites authoritative state (root cause of “no pixels”)
Runtime code copies buffers back from `animator.serialize()` / `getIndexBuffers()` at end stroke/finalise.  
If those reads are stale/zero, it erases the real writes.

---

## 1) Non-negotiable invariants (Rev 5)

### I0 — Authoritative buffers only
All CC content is authored into **layer buffers**. Renderer/animator is never the source of truth.

### I1 — Def-bound commit (Mode D)
Committed pixels bind to an immutable `gradientDefId` stored in a **wide buffer** (`Uint16Array` or `Uint32Array`).  
Slots (0..255) are allowed only as preview/runtime conveniences, never as the committed binding.

### I2 — Preview/final parity is enforced
The last preview frame’s stops must equal the stops used to create the committed `GradientDef` and the stops resolved at render.

### I3 — Live sampling cannot affect commit correctness
Sampling may update session preview stops only. Commit path is identical for all sources.

---

## 2) Explicit bans (Rev 5)

### B0 — Ban ambiguous override params
`gradientIdOverride` is banned.

- Def override: `gradientDefIdOverride`
- Slot override (preview/runtime only): `gradientSlotOverride`

### B1 — Ban committing via slots
No committed mark may store a slot id as its binding. Only `defId` is committed.

### B2 — Ban animator readback overwrite in runtime
No runtime path may assign to layer buffers from:
- `animator.serialize()`
- `animator.getIndexBuffers()`

Readback is allowed only in explicit import/restore migrations.

### B3 — Ban sampling module from writing pixels/palettes/defs
Sampling code may not:
- call fill/commit functions
- mutate slot palettes (except explicitly permitted TEMP preview slot if you still use one)
- create/modify `gradientDefs`
- mutate active slot for correctness

---

## 3) Authoritative storage model (Mode D)

### 3.1 Immutable gradient defs (persisted)
In `layer.colorCycleData`:

```ts
type StoredStop = {
  position: number; // canonical, e.g. 0..1000
  color: string | { r: number; g: number; b: number; a?: number };
};

type GradientDef = {
  id: number; // never reused
  kind: 'linear' | 'concentric';
  stops: StoredStop[]; // immutable
  hash: string;
  source: 'manual' | 'fg' | 'sampled';
  createdAtMs: number;
};

gradientDefs: GradientDef[];
nextGradientDefId: number; // monotonic allocator
3.2 Pixel buffers (authoritative)
paint: Uint8Array;    // palette index (0 transparent)
def:   Uint16Array;   // gradientDefId per pixel (authoritative binding)
spd:   Uint8Array;    // speed byte per pixel
// optional: flowSlot Uint8Array if needed as a separate concept from defId
Ban: using Uint8 gid to store def ids.

4) Mark session (def-bound)
type MarkGradientSession = {
  markId: string;
  layerId: string;
  markKind: 'stroke' | 'shape';
  gradientKind: 'linear' | 'concentric';
  source: 'manual' | 'fg' | 'sampled';

  frozenStopsStored: StoredStop[];
  frozenHash: string;

  binding: { kind: 'def'; defId: number } | null;

  // Sampled-only (Phase 2)
  samples?: Array<{ t01: number; rgba: [number, number, number, number] }>;
  previewStopsStored?: StoredStop[];
  fallbackStopsStored?: StoredStop[];
};
Finalise must use only session.frozenStopsStored.

5) APIs (Rev 5)
5.1 Def store API (persisted, pure contract)
createGradientDef(layerId, kind, stopsStored, source): number

getGradientDef(layerId, defId): GradientDef | null

Optional: findDefByHash(layerId, hash): number | null (dedupe)

5.2 Mark session owner (runtime only)
beginMarkSession(...)

getActiveMarkSession()

getPreviewGradientForActiveMark(layerId)

finalizeMarkSession()

cancelMarkSession()

5.3 Writers (explicit def id)
Shape fill:

runColorCycleShapeFill({ ..., gradientDefIdOverride: number })
Stroke:

During stroke: write TEMP defId into def buffer (runtime-only)

On end: remap TEMP defId -> committed defId in ROI and assert temp cleared

6) Finalise algorithm (def-bound, parity-safe)
session = finalizeMarkSession() → produces session.frozenStopsStored + session.frozenHash

defId = createGradientDef(layerId, kind, session.frozenStopsStored, source)

Bind pixels by writing def = defId:

Shape: fill writes defIdOverride = defId directly

Stroke: ROI remap tempDefId -> defId, then commit

Mark session.binding = { kind:'def', defId }

7) Preview correctness contract (single truth)
P0 — Single preview provider
Overlay preview and brush preview must call:

getPreviewGradientForActiveMark(targetLayerId)
No preview code may consult:

brushSettings at render time

active slot

slot palettes

schedulers’ “current palette”

P1 — Preview result
type PreviewGradientResult = {
  source: 'manual' | 'fg' | 'sampled' | 'fallback';
  phase: 'frozen' | 'sampling' | 'final';
  stopsStored: StoredStop[]; // always >=2
  defIdPlanned?: number;     // after finalise
};
8) Tripwires (mandatory; would have caught our bugs)
T1 — Animator readback overwrite tripwire (prevents F2)
In dev builds, throw if any runtime code path tries to overwrite layer buffers from animator state.

Implementation rule:

search for assignments like strokeData.buffers.* = toU8(animator.serialize()....) in runtime

replace with asserts and delete the overwrite

T2 — Commit parity tripwire (prevents F1)
On finalise (dev builds), assert:

const def = getGradientDef(layerId, defId);
assert(def && def.hash === session.frozenHash);
If this fails, finalise is using different stops than preview/session.

9) Required dev asserts (Rev 5)
Ban any parameter named gradientIdOverride

Ban any use of FLOW_SLOT_MASK on def buffers

After ROI remap, assert temp def ids count is 0 in ROI

During preview render, log:
{ markId, layerId, source, phase, stopsLen }
and throw if phase==='sampling' && stopsLen<2

10) Phased implementation order
Phase 1 — Correctness refactor (Manual + FG only, Mode D, NO live sampling)
Goal: fix F1 + F2 and lock preview/final parity for Manual/FG.

Stop animator readback overwrite (T1)

remove/disable runtime overwrites from serialize() / getIndexBuffers()

keep import/restore-only helpers separate

Add gradientDefs + allocator persistence

Add def: Uint16Array buffer and write paths

Implement mark session for Manual + FG

freeze stops at mark start

preview uses session provider only

Implement finalise path (def-bound)

create def

fill/remap writes defId

enforce T2 parity assert

Deliverable Phase 1:

Manual + FG shapes/strokes: preview == final; never change after commit; survive reload.

Phase 2 — Live sampling (isolated module; cannot affect commit correctness)
Goal: add sampled mode without risking regressions.

Feature flag: features.ccSampledEnabled

Sampling module ccSampling.ts:

reads pixels, accumulates session samples

produces session.previewStopsStored only

cannot call commit/palette/def APIs (enforced)

Sampling policy at finalise:

0 samples: use fallback OR cancel (choose one and enforce)

1 sample: synthesize 2-stop sampled gradient and commit it (no fallback)

≥2 samples: compute sampled stops (bounded), freeze into session

Commit path unchanged (still Mode D):

create def

write defId to pixels

Deliverable Phase 2:

Sampled preview and commit parity-locked with the same session stops and same def-bound commit.

11) UI + wiring (required) — Manual | FG | Sampled button group
11.1 Tool state (persisted intent only)
tools.ccGradientSource: 'manual' | 'fg' | 'sampled';
Rules:

intent for the next mark only

switching source must not mutate committed data

11.2 Controls layout
Row 1: segmented control Manual | FG | Sampled

Row 2: subpanel:

Manual editor / presets

FG derived controls

Sampled panel (Phase 2 gated)

11.3 Button behavior (strict)
On click:

setTools({ ccGradientSource: ... })

if mark session active:

cancelMarkSession()

clear overlay preview

do not hot-swap mid-mark

11.4 Sampled panel (Phase 2 gated)
If features.ccSampledEnabled === false, show disabled “WIP”.
If enabled, show sample count + reset + helper text.

12) Acceptance checks (must pass)
Phase 1:

Manual shape preview == final

Manual stroke preview == final

FG marks never change after later FG adjustments

Save/reload stable

No T1/T2 tripwires fire

Phase 2:

Sampled: 1-sample synthesizes, 2+ samples stable, no mysterious fallback

Sampling cannot call commit/palette/def APIs





ChatGPT can make mistakes. Check important info.