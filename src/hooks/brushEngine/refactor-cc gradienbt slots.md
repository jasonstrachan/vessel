# Color Cycle Gradient Refactor Plan (Total Rip-Out, Updated)

## Objective
Rebuild Color Cycle gradient handling so it is deterministic and debuggable:
- One authoritative **paint slot** for all new writes (`gid`)
- Explicit, centralized **runtime application** to the brush (no scattered slot writes)
- Strict separation between **UI editing/preview** and **painting**
- Clear semantics for when edits **recolor existing pixels** vs affect **future only**
- Eliminate hidden coupling from **flow-slot encoding** and EDITOR_SLOT (63) misuse

---

## What’s broken today (observed)
- Multiple call sites write `setGradientSlot` / `setActiveGradientSlot` (init, render, dropdown flush, FG prefill).
- Non-FG fill path uses `activeSlot=63` while UI edits other slots (0/1/2…), producing recolors and “flashing”.
- `gid` writes use `flowSlot` (encoded) but palettes are managed as if `gid` were raw slots → mismatched indexing.
- Slot forking can exhaust available slots → “runs out of slots then repeats”.

---

## Critical Decisions (must resolve up front)

### Decision 1 — What does `gid` store?
Pick ONE model and enforce it everywhere.

#### Model A (recommended): `gid` stores RAW slot (0..FLOW_SLOT_MASK)
- `gid[idx] = paintSlot`
- Flow mode is stored separately (layer/brush setting) and applied during render (or via a separate buffer).
- `slotPalettes` keyed by raw slot.
- Simplifies editor behavior; avoids palette mismatch.

#### Model B: `gid` stores ENCODED slot (encodeFlowSlot(slot, mode))
- `gid[idx] = encodeFlowSlot(paintSlot, flowMode)`
- `slotPalettes` must be keyed by encoded values or use a decode/mapping layer.
- Harder to reason about; easier to break.

**This plan assumes Model A.** If you choose Model B, the plan must be adapted and tested accordingly.

---

### Decision 2 — Preview semantics for the gradient editor
Choose ONE preview behavior.

#### Preview P1 (recommended): Non-destructive overlay preview
- Editor updates a preview-only surface/overlay.
- No `gid` changes; no mutation of palettes used by painted pixels.
- Commit applies fork/overwrite according to user intent.

#### Preview P2: Temporary editor slot (63) + render override
- Editor writes stops to EDITOR_SLOT (63), but rendering temporarily uses that palette for preview.
- MUST NOT write `gid=63` ever.
- Commit moves to a real paint slot (fork/overwrite).

**This plan supports P1 by default; P2 is acceptable** if overlay is too hard.

---

### Decision 3 — What happens to legacy pixels that already use `gid=63`?
Pick ONE.

#### Legacy L1 (recommended): Remap legacy 63 to a dedicated legacy slot once
- One-time migration: replace all `gid==63` with `gid==legacySlot` (allocated per layer).
- Then forbid 63 forever (preview-only if needed).
- Prevents accidental recolor of old work.

#### Legacy L2: Keep supporting 63 as a normal slot (not recommended)
- Old work remains on 63.
- Editor must never touch 63 unless “recolor existing” is explicit.
- Risky: accidental writes to 63 recolor legacy content.

**This plan uses L1.**

---

## Target Model (Hard Rules)

### Rule 1 — Paint Slot is authoritative for new writes
All paint/fill writes must use:
- `paintSlot = resolvePaintSlot(layer, tools)`
- `gid[idx] = paintSlot`  (Model A)

No brush/fill path may guess EDITOR_SLOT (63).

Additional constraint:
- `resolvePaintSlot` is **pure and deterministic** (no side effects, no allocation).

### Rule 2 — Palette edits require an explicit intent
Gradient edits must declare intent:
- `preview` (non-destructive)
- `commitFuture` (fork; affects future only)
- `commitRecolor` (overwrite; recolors existing pixels referencing that slot)

Default: `commitFuture`.

### Rule 3 — Init/render do not mutate gradient policy
- No gradient slot writes during render.
- Init/hydration never forces active slot or EDITOR_SLOT.
- Only one module is allowed to apply gradient runtime to the brush.

### Rule 4 — Single writer for runtime application
Only `applyRuntimeToBrush(...)` may call:
- `setGradientSlot(...)`
- `setActiveGradientSlot(...)`

All other code must request an apply via the scheduler.

---

## New Layer State (Single Source of Truth)
Add to `layer.colorCycleData`:

```ts
paintSlot: number;  // authoritative slot for NEW writes; never 63
activeGradientId: string;
gradientDefs: Array<{ id: string; name?: string; currentSlot: number }>;
slotPalettes: Array<{ slot: number; stops: GradientStop[] }>;
fgActiveSlot?: number; // only when FG mode enabled
legacyRemap?: { from: 63; to: number }; // L1 migration
Notes:

EDITOR_SLOT (63) may exist for preview only (P2), but never becomes paintSlot.
Invariant: `paintSlot` must always exist in `slotPalettes` (materialize a default palette if missing).

New Modules
1) ccGradientRuntime.ts (Pure logic + runtime snapshot builder)
Pure functions (no side effects):

resolvePaintSlot(layer, tools): number

FG on → fgActiveSlot

FG off → activeGradientId -> gradientDef.currentSlot

clamps to [0..FLOW_SLOT_MASK], forbids 63 as paint slot

No allocation or mutation (pure function).

getStopsForSlot(layer, slot): GradientStop[]

applyGradientEdit(layer, edit): { nextColorCycleData, runtimeSnapshot, effects }

edit kinds: preview, commitFuture, commitRecolor

handles forking/overwriting/selection updates

optionally produces preview artifacts if P1/P2

Edit-session handling (fork-once) is runtime-only and not persisted:
- store in a controller/scheduler runtime map keyed by layerId
- never write to layer state, autosave, or history

buildRuntimeSnapshot(layer, tools): CCRuntimeSnapshot

includes paintSlot, slotPalettes, and preview info (if needed)

2) ccGradientApplyScheduler.ts (Single coalescing applier)
A per-layer scheduler that:

coalesces requests into at most one apply per frame

always applies the latest store snapshot

applies deltas only (signature compare)

API:

requestApply(layerId, reason)

flush(layerId?)

Responsibilities:

call applyRuntimeToBrush(brush, layerId, snapshot) with latest snapshot

trigger renderDirectToCanvas / recomposition events in correct order

ensure strict ordering: store update → apply runtime → render

3) ccGradientController.ts (UI/tool events → layer updates)
Only entry point from UI:

dropdown selection changes activeGradientId (and possibly paintSlot)

stop edits call applyGradientEdit with preview/commit intent

FG toggles update fgActiveSlot via existing derived pipeline

Outputs:

state.updateLayer(layerId, { colorCycleData: next })

scheduler.requestApply(layerId, 'ui-edit')

No direct brush calls from UI.

Deletes / Prohibitions (Enforced)
Remove any non-FG slot resolution that returns EDITOR_SLOT (63).

Remove init logic that calls setActiveGradientSlot(63) or writes palettes as defaults.

Remove any “mirror stops into slot 0 and 63” behavior.

Remove any render-time mutation of gradient slots or active slot.

Any call to setGradientSlot / setActiveGradientSlot outside applyRuntimeToBrush is a failure.

Implementation Phases (Reordered for fastest stabilization)
Phase A — Immediate stabilization (same-day)
Decide Model A vs B (plan assumes A).

Delete the two top culprits immediately:

non-FG resolution returning 63

init forcing active slot 63

Introduce ccGradientApplyScheduler (even if it initially applies full snapshots).

Replace all direct brush slot calls with scheduler.requestApply(...) + applier.

Exit criteria

Slot application happens only in one place.

No code path sets active slot to 63 in non-FG mode.

Render path is pure (no slot writes).

Phase B — Introduce paintSlot + migrate legacy 63 (L1)
Add paintSlot to colorCycleData.

Migration for each CC layer:

if FG on: paintSlot = fgActiveSlot

else: paintSlot = activeDef.currentSlot (or 0 fallback)

forbid 63: if computed is 63, move to 0 or allocate a free slot

Legacy remediation (L1):

allocate legacySlot (non-63)

remap gidBuffer: replace 63 → legacySlot (one-time)

store legacyRemap: { from: 63, to: legacySlot }

Migration policy:

apply as a load-time schema migration (non-undoable) gated by a project schema version

use project.schemaVersion (integer, preferred)

TARGET_SCHEMA_VERSION = 2 for paintSlot + L1 remap + raw gid policy

apply to autosaves and any persisted history snapshots

Exit criteria

paintSlot !== 63 for all layers.

gidBuffer contains no 63 after migration.

Phase C — Enforce gid write model (Model A)
Modify paint + fill write paths:

gid[idx] = paintSlot (raw)

flow mode stored separately; do not encode into gid

Update render path:

apply flow mode when sampling palette / cycling, not when writing gid

Remove any remaining encodeFlowSlot(...) usage from write paths.

Exit criteria

gid values map directly to slotPalettes slots.

No palette mismatch between fill and editor.

Phase D — Rewrite gradient editor pipeline with explicit intent
Implement applyGradientEdit(...):

preview: updates overlay (P1) or editor slot (P2) without touching painted palettes

commitFuture (default): fork once per edit session, set paintSlot to new slot

commitRecolor: overwrite stops for the slot referenced by existing pixels

Replace flushPendingGradient / dropdown handlers to call controller:

no brush calls

updates layer state only

schedules apply via scheduler

Exit criteria

Editing stops does not recolor existing pixels unless explicitly set to recolor.

No slot flapping during dropdown changes.

Phase E — Slot allocator + exhaustion policy
Implement slot allocation strategy to prevent running out:

Allocate at most once per “edit session” (e.g., on mouse down in gradient editor).

Reuse the “session slot” for continuous stop dragging.

Add GC policy:

track which slots are referenced in gidBuffer (scan on demand, or maintain counts incrementally)

slots not referenced and not in use can be reclaimed

Exit criteria

No slot exhaustion during typical workflows.

Forking does not create unbounded slot growth.

Phase F — Cleanup + deletion of dead paths
Delete resolveColorCycleGradientsForLayer usage in painting/fill paths (keep only migration helpers).

Delete any “FG prefill” that runs when useFG:false.

Ensure render is pure: draw current buffers only.

Ensure init is pure: hydrate resources only.

Exit criteria

Only controller/runtime/scheduler pipeline remains.

No duplicate gradient propagation paths.

Runtime Applier Spec (applyRuntimeToBrush)
Central function (called only by scheduler):

Inputs:

layerId

paintSlot

slotPalettes[]

optional preview data (P1 overlay or P2 slot override)

Behavior:

Diff by signature per slot; only call setGradientSlot for changed slots.

Call setActiveGradientSlot(layerId, paintSlot) exactly once if it changed.

Never touches EDITOR_SLOT unless preview option requires it (P2).

Never runs from render; only from scheduler.

Testing Strategy (Must-have)
Unit tests (pure)
resolvePaintSlot: FG on/off, clamps, forbids 63

applyGradientEdit:

preview does not mutate painted palettes

commitFuture forks once per session and updates paintSlot

commitRecolor overwrites existing slot stops

Integration tests (runtime)
Fill shape (slot X), commit.

Edit gradient:

preview: no change to existing fill

commitFuture: only future strokes change

commitRecolor: existing fill changes

Toggle FG mode:

paint slot changes deterministically

no gid corruption

Dev assertions
In stroke/fill write paths: assert(paintSlot !== 63)

In render: assert(no setGradientSlot/setActiveGradientSlot called)

Enforce “single writer” via lint rule or runtime guard in dev.

Acceptance Criteria (Binary)
setGradientSlot / setActiveGradientSlot called only from runtime applier.

paintSlot exists and is stable; never equals 63.

gidBuffer contains no 63 post-migration (L1).

With FG off: fills/strokes write raw slots consistent with palettes (Model A).

Gradient edits do not recolor existing content unless explicitly requested.

No visible “flashing” or slot flapping during dropdown edits or mouse up.

Slot allocation never silently exhausts during normal use.

First Cut (Highest leverage)
Remove non-FG activeSlot=63 assumptions immediately.

Stop init from forcing active slot 63.

Add paintSlot + legacy remap 63 → legacySlot.

Centralize all brush slot application behind scheduler + applier.

Switch write paths to gid = paintSlot (raw model).
