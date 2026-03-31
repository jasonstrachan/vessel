# CC Slot Architecture Follow-ups

Context

- Fixed a data-loss bug where color-cycle slot GC could remove a `slotPalettes` entry that was still referenced by live non-def pixels in `gradientIdBuffer`.
- Symptom in saved `.vs` files: some CC shapes respond to hue/saturation edits and others do not, because the layer ends up split across:
  - shape-bound defs via `gradientDefIdBuffer` / `gradientDefStore`
  - normal slot-bound palettes via `slotPalettes`
  - orphaned slot ids in `gradientIdBuffer` with no matching `slotPalettes` entry, which fall back to the base gradient

What was fixed

- `src/utils/colorCycleSlotGC.ts` now treats live non-def `gradientIdBuffer` usage as authoritative slot usage before freeing/removing palettes.
- Regression coverage added in `src/utils/__tests__/colorCycleSlotGC.test.ts`.

Architecture note

- Current CC slot truth is duplicated across:
  - `gradientIdBuffer`
  - `gradientDefIdBuffer`
  - `slotPalettes`
  - `gradientDefStore.slot`
  - `gradientDefs.currentSlot`
  - `paintSlot` / `fgActiveSlot`
- This is workable only if live buffer usage is treated as the source of truth for what is actually in use on-canvas.
- Metadata-only cleanup is unsafe.

Future cleanup to consider

1. Centralize slot-usage derivation.
   - Create one helper that reports:
     - live non-def slots from `gradientIdBuffer`
     - live def ids from `gradientDefIdBuffer`
     - reserved metadata slots
   - Reuse it in slot GC, selection/paste transfer, slot allocation, and repair paths.

2. Document the invariant in code.
   - `slotPalettes` must never be removed if any non-def pixel still references that slot in `gradientIdBuffer`.

3. Add broader regression coverage.
   - Project-scope rebuild with live non-def slots across layers.
   - Mixed def-bound + non-def slot-bound content in the same layer.
   - Selection/paste flows that schedule slot rebuilds after merging transferred palettes/defs.

4. Consider a repair utility for already-damaged projects.
   - Scan saved `gradientIdBuffer` values.
   - Detect slot ids with live pixels but no `slotPalettes` entry.
   - Materialize missing palettes from fallback/def data where possible, or report them explicitly.

5. Audit region-write paths for invariant preservation.
   - `writeColorCycleRegion` currently writes raw `gradientIdBuffer` / `gradientDefIdBuffer` values and assumes palette/def metadata is already valid.
   - That is acceptable for trusted callers, but a repair/materialization option may be safer for imported or transferred data.

Practical rule

- Buffers describe live usage.
- Metadata describes how to interpret and edit that usage.
- Cleanup/rebuild code must not assume metadata is complete if buffers disagree.
