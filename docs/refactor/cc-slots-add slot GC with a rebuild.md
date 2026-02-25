# Slot GC + Rebuild-on-Demand (8-bit slots unchanged) — Detailed Plan (Risk-Mitigated)

Goal: prevent “out of slots” by reclaiming slots from gradient defs that are no longer referenced by any **committed pixels**, without changing slot encoding width (`FLOW_SLOT_BITS = 8`, `gid` remains `Uint8Array`).

---

## 0) Decisions to lock in (reduces risk)

### 0.1 Def store scope
Pick one and enforce everywhere:

- **Option G (safe default): Project-global def store**
  - A `defId` may be referenced by pixels on any layer.
  - GC must scan **all layers** before freeing/unassigning anything.

- **Option L: Per-layer def store**
  - `defId` is only meaningful within a single layer.
  - GC may scan **active layer only** and GC within that layer.

If unsure, assume **Project-global**.

### 0.2 Undo/redo resurrection policy (safest default)
To avoid breaking undo/redo:
- GC **must not delete def records**.
- GC may only:
  - unassign/free the slot (`def.slot = null`),
  - clear slot palette bindings / caches,
  - keep def metadata (`stops/hash/kind/source`) intact.
If undo resurrects pixels with that `defId`, the system can reassign a slot later.

---

## 1) Non-negotiable invariants

1. **Committed pixels are defId-bound**
   - Finalized stroke/fill must write `defId` for all affected pixels.
2. **GC uses committed defId buffers as ground truth**
   - Never infer liveness from `gid`, slot palettes, or store state.
3. **Reserved slots are never allocatable/freed**
   - `EDITOR_SLOT`, `TEMP_SAMPLE_SLOT`, etc.
4. **Rebuild is throttled; never loops**
   - One rebuild + one retry max per allocation failure.
5. **Preview/session state does not pollute committed state**
   - Either separate preview state or treat active session slots as reserved during rebuild.
6. **GC never deletes def metadata**
   - Slot may be unassigned; def record remains.

---

## 2) Files / touch points (minimum viable)

- NEW: `src/utils/colorCycleSlotGC.ts`
- MODIFY:
  - `src/utils/colorCycleGradientDefs.ts` (committed allocation failure → rebuild → retry once)
  - `src/hooks/canvas/utils/colorCycleMarkSession.ts` (preview allocation failure → rebuild → retry once)
  - `src/utils/colorCycleGradients.ts` and/or `src/hooks/useDrawingHandlers.ts` (FG-derived allocation failure → rebuild → retry once)
- READ access to per-layer committed `defId` buffers (wherever these live in project/layer state)
- OPTIONAL:
  - layer delete/clear/merge handlers to schedule a debounced rebuild

---

## 3) New module: `colorCycleSlotGC.ts`

Create `src/utils/colorCycleSlotGC.ts` with one entry point and a few helpers.

### 3.1 Export: `rebuildGradientSlotUsageAndGC(args)`
Purpose: reconcile store slots with pixel reality.

Inputs (conceptual):
- `layers`: access to each layer’s committed `defId` buffer (`Uint16Array`)
- `defStore`: iterate defs + get/set slot + find def by `defId`
- `reservedSlots: Set<number>`
- `activeSessionSlots?: Set<number>` (preview safety)
- `scope`: `"project"` or `"layer"` (depends on Decision 0.1)
- `nowMs`: for throttling/diagnostics

Returns stats:
- `scanMs`, `layersScanned`, `pixelsScanned`
- `usedDefsCount`, `missingDefsCount`
- `freedSlotsCount`, `unassignedDefsCount`
- `reassignedSlotsCount`

### 3.2 Export: `rebuildOnDemandAndRetryAllocate(args)`
Purpose: standardize pattern “allocation fails → rebuild → retry once”.

Inputs:
- `attemptAllocate(): number | null`
- `runRebuild(): { ...stats }`
- `throttleMs`, `lastRebuildAt` storage

Returns:
- `{ slot: number | null, didRebuild: boolean, stats?: ... }`

---

## 4) Rebuild algorithm (reconcile, not just “free”)

### 4.1 Sync point (avoid stale scans)
Ensure rebuild runs only at safe points:
- at mark/session start (allocation time), not inside tight stamp loops
- after any pending finalize/commit has written `defId` buffers
If you have a flush method, call it before scanning.

### 4.2 Scan used defIds (ground truth)
**Project scope**: scan committed def buffers across all layers.
**Layer scope**: scan committed def buffer for the target layer.

Procedure:
- Build `usedDefIds = Set<number>()`
- For each pixel in `defIdBuf`:
  - `id = defIdBuf[i]`
  - if `id !== 0`, add to set

Notes:
- `0` should mean “no def” / background; it is never GC-managed.

### 4.3 Validate: defIds in pixels must exist in store
For each `defId` in `usedDefIds`:
- If `defStore.has(defId)` is false:
  - **Dev-hard error**
  - Abort rebuild without mutating anything (prevents corruption)
  - Surface diagnostic listing missing ids

### 4.4 Determine “needsSlot” set
For each used def:
- If `def.slot == null`, add to `needsSlot`

### 4.5 Build reserved/blocked slot set
Compute `blockedSlots = reservedSlots ∪ activeSessionSlots (if any) ∪ slots currently assigned to used defs`.

### 4.6 Unassign slots from dead defs (undo-safe)
Define dead def as:
- `defId` not in `usedDefIds`

For each dead def in store:
- If `def.slot != null`:
  - call `freeSlotEverywhere(def.slot, defId)`:
    - `def.slot = null`
    - remove/clear `slotPalettes` entry (if any)
    - clear any slot→defId caches/maps
    - ensure allocator “usedSlots” sources no longer include it
- Keep def metadata intact in store.

### 4.7 Assign slots for used defs missing a slot
Now allocate slots for `needsSlot` defs:
- Recompute available slots: `[0..255] - blockedSlots`
- Assign deterministically (lowest free slot) to reduce churn.
- For each assignment, call `assignSlotEverywhere(slot, defId)`:
  - set `def.slot = slot`
  - update slot palette binding table (if needed for rendering)
  - update slot→defId maps/caches

If still insufficient slots:
- return failure diagnostics (this means you truly have > allocatable live defs).

---

## 5) Slot bookkeeping (prevents stale “usedSlots” bugs)

Add two helpers used by both allocator and GC:

- `freeSlotEverywhere(slot: number, defId?: number)`
- `assignSlotEverywhere(slot: number, defId: number)`

These must update every structure that contributes to `collectUsedSlots()` today:
- `gradientDefs[].currentSlot` (or equivalent)
- `gradientDefStore[].slot` (or equivalent)
- `slotPalettes[].slot` / slot palette lookup
- any renderer caches that map slot→palette or slot→def

If feasible, add a single authoritative `slotOwner[256]` (optional but reduces risk):
- `slotOwner[slot] = defId` or `0` for free
- derive other views from it

---

## 6) Preview/session safety

### 6.1 Preferred: session-only preview state
Preview should not create committed def entries until finalize.
- Preview uses a session mapping `slot -> palette` only.

### 6.2 If preview defs exist in store: treat session slots as reserved
Provide `activeSessionSlots` to rebuild:
- include them in `blockedSlots`
- do not free/reassign them mid-session

---

## 7) Performance controls

### 7.1 Throttle rebuild calls
Store `lastRebuildAtMs` in module/project runtime state.

Rule:
- if allocation fails and `now - lastRebuildAtMs < 750ms`, skip rebuild and fail fast with diagnostics.

### 7.2 Scan scope policy
- If def store is **project-global**: scan all layers (correctness-first).
- If def store is **per-layer**: scan only that layer (fastest).

Do **not** do “active layer first” unless per-layer; it can free defs used on other layers.

### 7.3 Proactive debounced rebuild (optional)
After:
- delete layer
- clear layer
- merge/flatten
Schedule rebuild debounced (e.g., 250ms) to reduce chance of hitting allocation failure mid-stroke.

---

## 8) Hook points (allocation failure → rebuild → retry once)

### 8.1 Committed def allocation
File: `src/utils/colorCycleGradientDefs.ts` (e.g., `ensureGradientDefForStops`)

If slot allocation returns null:
1) Call `rebuildOnDemandAndRetryAllocate`
2) Retry allocation once
3) If still null: return null + log diagnostics

### 8.2 Preview slot selection
File: `src/hooks/canvas/utils/colorCycleMarkSession.ts` (sampled preview slot)

If preview slot selection returns null:
- same rebuild + retry once
- include `activeSessionSlots`

### 8.3 FG-derived slot selection
Files: `src/utils/colorCycleGradients.ts`, `src/hooks/useDrawingHandlers.ts`

Same pattern.

---

## 9) Diagnostics & assertions (makes rare path safe)

### 9.1 Log rebuild summary
- pixelsScanned, scanMs
- usedDefsCount, missingDefsCount
- freedSlotsCount, reassignedSlotsCount
- scope: project vs layer

### 9.2 Dev assertions after rebuild
- every `defId` found in buffers exists in store
- every used defId has a slot
- no non-reserved slot is assigned to more than one def

---

## 10) Tests (must-have)

### 10.1 Undo resurrection test
1) Paint pixels with def A
2) Erase all pixels with def A (A becomes dead)
3) Run GC (A slot unassigned, def metadata remains)
4) Undo erase (pixels with def A return)
5) Verify A renders correctly (slot reassigned deterministically or lazily)

### 10.2 Cross-layer safety test (project-global)
- Same def used on two layers
- Clear one layer
- Run GC
- Verify def remains valid and other layer rendering unchanged

### 10.3 Preview safety test
- Start preview session
- Fill slots near limit
- Force allocation failure
- Run rebuild
- Verify preview continues (session slot not stolen)

### 10.4 Allocation recovery test
- Create many unique committed gradients to exhaust slots
- Delete/clear to create dead defs
- Next allocation triggers rebuild and succeeds

---

## 11) Rollout sequence (lowest risk)

1) Land `colorCycleSlotGC.ts` with dev-only “Run rebuild now” hook + diagnostics.
2) Wire rebuild to **committed allocation failure** only.
3) Add undo resurrection integration test; fix any issues.
4) Wire preview allocation failure with session-slot blocking.
5) Add proactive debounced rebuild after destructive ops.

---

## 12) Done criteria

- Slot allocation does not remain permanently failed after deleting/clearing content.
- Rebuild runs at most once per failure event and is throttled.
- No regressions in:
  - committed gradient stability (no “old fills mutate”)
  - preview continuity
  - undo/redo correctness




ChatGPT can make mistakes. Check important info.