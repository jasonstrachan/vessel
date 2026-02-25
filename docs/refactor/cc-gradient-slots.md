# CC Gradient Slots: What They Are, What’s Reserved, and Why It Matters

This doc explains the slot system for Color Cycle (CC) gradients, how it interacts with **def‑bound** commits (Phase 1), and what must be reserved to prevent FG mutation bugs.

---

## Glossary

**Slot (0–255):**  
An 8‑bit index stored per pixel in the **gid** buffer (`Uint8Array`). Slots point to a palette (stops) at render time.

**Editor slot (255):**  
Reserved. Used by the UI/editor and never for committed marks.

**Paint slot:**  
The active slot the brush uses when writing `gid`. This is what live strokes use during drawing.

**FG (foreground) slot:**  
A slot storing the current derived FG gradient. It changes when FG parameters change.

**Gradient Def (def):**  
An immutable gradient stored in `gradientDefStore` with a unique `defId`.

**Def slot:**  
A slot allocated for a def at mark start. Used only for preview/runtime convenience.  
**Important:** This slot must be treated as *reserved* until the def is no longer referenced. There is currently no eviction/GC, so def slots accumulate.

**Def buffer (`def`):**  
A `Uint16Array` per pixel storing the **defId** (authoritative binding).

---

## Two Buffers, Two Roles

- **gid buffer (`Uint8Array`)**  
  Live preview / runtime slot binding. **Not authoritative**.  
  Used during painting for speed and preview.

- **def buffer (`Uint16Array`)**  
  Authoritative binding. **Committed pixels must store defId** here.

If the def buffer isn’t populated for a mark, that mark will keep following whatever the slot palette becomes later (the bug you saw).

---

## Slot Reservations (Rules)

Slots are a scarce shared resource. To prevent mutation bugs:

1) **Editor slot (255) is always reserved.**
2) **All def slots are reserved.**  
   Any slot referenced by `gradientDefStore[].slot` is off‑limits for FG/manual allocation.
3) **Active gradient slots and palette slots are reserved** for allocation purposes.
4) **FG derived slots must never reuse def slots.**

When allocating a slot (FG, manual, etc.), the **used slot set** must include:

- `slotPalettes[].slot`
- `gradientDefs[].currentSlot`
- `gradientDefStore[].slot`
- `EDITOR_SLOT (255)`

This is now enforced in:
- `useDrawingHandlers.ts` (FG slot allocation in stroke path)
- `colorCycleGradients.ts` (`ensureForegroundGradientSlot` for shape path)

---

## Mark Lifecycle (Phase 1, Def‑Bound)

1) **Begin mark session**
   - Freeze stops (manual or FG) immediately.
   - Allocate a def slot + defId (immutable def).
   - Apply that slot to the brush *before* first stamp.

2) **Draw**
   - `gid` buffer receives the **def slot**.
   - Preview renders from that slot palette.

3) **Finalize / Commit**
   - Bind defId into `def` buffer for pixels using that def slot.
   - Persist `gradientDefStore` entry.
   - (Dev) Parity assert: `def.hash === session.frozenHash`.

After commit, **changing FG should not affect the stroke**, because the def buffer is authoritative. If a def slot cannot be allocated, the mark can fall back to a live slot palette, which makes old pixels appear to “reuse” or mutate to a newer gradient.

---

## Common Failure Modes

**A) FG reuses a def slot**  
FG changes overwrite the palette for that slot → old strokes mutate.  
Fix: reserve def slots when allocating FG slots.

**B) Def entry missing at commit**  
Parity assert fails, and tooling can fall back to live slot palette.  
Fix: ensure the def is inserted into `gradientDefStore` at finalize.

**C) Mark session uses stale layer state**  
Freezes the previous FG stops.  
Fix: resolve stops from a fresh store snapshot at mark start.

---

## Where This Is Enforced

- `beginMarkGradientSession`  
  Creates def + slot, freezes stops.

- `ccGradientRuntime.buildRuntimeSnapshot`  
  Uses the active mark session’s slot+stops for preview only.

- `bindGradientDefIdToSlot` (in brush)  
  Writes `def` buffer for committed pixels.

- Slot allocation fixes:
  - `useDrawingHandlers.ts` (FG stroke path)
  - `colorCycleGradients.ts` (`ensureForegroundGradientSlot`)

---

## Quick Checklist (Phase 1)

- Def slots are reserved in every slot allocator ✅
- Mark session uses current FG stops ✅
- Commit writes def buffer ✅
- Def store includes the committed def ✅
- Old strokes do not mutate on FG changes ✅
