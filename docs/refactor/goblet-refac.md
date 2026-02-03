# Goblet 2 Rewrite Plan (Correctness + Performance) — Revised

This plan replaces Goblet v1 patching with a clean Goblet 2 rewrite that **matches Vessel correctness** and **matches or exceeds Vessel performance** on heavy stroke files.

It incorporates new facts from the codebase (A–D):
- Exporter is currently a **serializer** of buffers written by the brush engine (A1).
- Per-pixel speed/slot are written during fill + stamp paths (A2–A3, C).
- Per-shape speed is persisted on **gradient defs** (defId + slot) as `speedCps` (B, A4).
- Vessel already has a **WebGL playback path** driven by an `offset` uniform (D).

---

## 0) Non-negotiable goals

### Correctness invariants
1) **Per-shape speed**: speed is owned by a *shape/gradient def*, not by a layer.
2) **Palette-shift semantics**: animation is driven by `offset = frac(t * speedCps + startOffset)` and discrete shift of a palette (matching Vessel’s palette-shift semantics).
3) **Deterministic mapping**: the runtime must not guess between `layerSpeed`, `speedBuffer`, etc. The bundle defines the contract and Goblet follows it.
4) **No silent fallbacks**: Goblet 2 refuses ambiguous bundles (explicitly versioned).

### Performance invariants
1) Default playback is **GPU-first** (WebGL2 preferred; WebGL1 optional later; CPU fallback only).
2) Per-frame work must be **O(layers)**, not **O(pixels × layers)** on CPU.
3) Heavy stroke files (multiple animated layers) must not drop to 15–20 fps due to CPU remap.

---

## 1) Key design adjustment (from interrogation)

### Use a “derived anim-group” approach first, then upgrade ownership later
We do not need perfect shape ownership on day 1. We can derive animation groups from the buffers you already export:

- Today, the brush engine writes:
  - `gradientIdBuffer[idx] = (index==0 ? 0 : flowSlot)` (A2, A3, C)
  - `speedBuffer[idx] = (index==0 ? 0 : speedByte)` (A2, A3, C)

So the runtime-visible “shape identity” can be approximated initially as:
- **animKey = (flowSlot, speedByte)**

This gives immediate correctness improvements and allows Goblet 2 to ship without refactoring the brush engine.

Later (optional), we can improve ownership by exporting a true `animIdBuffer` from brush engine metadata, but v1 of Goblet 2 can be correct enough using (slot, speedByte) grouping.

---

## 2) Goblet 2 bundle contract (explicit, versioned)

### Bundle format
- `format: "vessel-goblet2"`
- `colorCycle.schemaVersion: 2`

### Brush-mode (ColorCycleBrushCanvas2D / stamp-dither outputs)
Inputs (already exist today):
- `indexBuffer: Uint8Array` (R8 indices)
- `gradientIdBuffer: Uint8Array` (slot in low 6 bits; flow bits already stripped in export, A1)
- `speedBuffer: Uint8Array` (speedByte per pixel, A1/A2/A3)

New (Goblet 2):
- `slotPalettes: [{ slot: number, stops: GradientStops }]` (already exists, A4)
- `speedMin`, `speedMax` (already exists; required when decoding speedBuffer)
- Optional `startOffset01` at layer level (if needed)

No more “layerSpeed” as a correctness driver for brush-mode; layerSpeed becomes only a UI/debug display.

### Recolor-mode
Keep existing recolor contract; it already has a WebGL renderer in Vessel and uses offset uniform (D3).

---

## 3) Runtime architecture (Goblet 2)

### 3.1 GPU-first pipeline
Target: WebGL2 shader does palette lookup per fragment:
- Fetch index `I` (0..255)
- Fetch slot `S` (0..63) from `gradientIdBuffer`
- Fetch speedByte `B` from `speedBuffer`
- Decode `speedCps = decode(B, speedMin, speedMax)` (or treat B==0 as 0/no-anim for that pixel)
- Compute `offset01 = frac(timeSeconds * speedCps + startOffset01)`
- Compute palette shift: `shift = floor(offset01 * paletteSize)`
- Map `I` → `paletteIndex = clamp(I-1, 0, paletteSize-1)`
- Sample palette row for slot `S` at `(paletteIndex - shift) mod paletteSize` (direction aligned with Vessel)

#### Palette data representation (adjustment)
To avoid stop interpolation differences and reduce runtime cost:
- Exporter (or Goblet 2 init) pre-bakes a **palette RGBA table** for each slot:
  - `paletteSize` = 256 (or brush palette length)
  - `paletteTex` dimensions: width=paletteSize, height=slotCountUsed (≤64), RGBA8
- Slot → row index map.

This matches Vessel semantics and is fast.

### 3.2 CPU fallback (compat mode)
If WebGL2 not available:
- Use the existing fast array loop path, but add two strict optimizations:
  1) **Shift-key early-out**: if no slot’s `shiftKey` changed since last frame, skip fill/blit.
  2) **Adaptive renderScale**: auto-drop to 0.5 when total fill time exceeds a threshold.

CPU fallback is allowed to be slower; GPU is the default.

---

## 4) Exporter work (Vessel → Goblet 2)

### 4.1 Exporter remains a serializer of engine buffers (keep this)
No new per-pixel decision logic required in exporter (A1).

### 4.2 Ensure slot palettes carry speed provenance (optional but valuable)
You already store speed on gradient defs (`speedCps`) (A4, B).
For Goblet 2 brush-mode initial implementation, speed is driven by speedBuffer bytes (per pixel), so `def.speedCps` is not required for playback.
However, it is valuable for:
- debugging
- future migration to “slotSpeeds” if you choose that path later

So: keep `speedCps` on defs and preserve it in export metadata where possible.

---

## 5) Correctness strategy (tests)

### 5.1 Golden reference: Vessel CPU palette shift
Use the reference logic equivalent to:
- decode indices
- apply palette shift per speed
- compare pixel output

### 5.2 Test matrix (small deterministic buffers)
1) Single slot, single speedByte, known speedMin/max
2) Two slots, distinct palettes, same speedByte
3) Same slot, two speedBytes in different pixel regions
4) Index 0 transparency + subtractOne semantics
5) Half-res downsample correctness (if enabled)

### 5.3 GPU correctness tests
For small buffers (e.g. 32×32):
- Render via WebGL2
- `readPixels` back
- Compare against CPU reference output exactly

---

## 6) Performance strategy (what makes Goblet 2 faster than Goblet v1)

### Why Goblet v1 fails on heavy stroke files
Your profile shows CPU per-pixel fill dominating:
- 3 layers: ~55–60ms per frame total → 15–20 fps.

### Goblet 2 performance targets
- WebGL2 path: stable 60fps for typical heavy files with 2–5 animated layers.
- CPU fallback: acceptable degradation with adaptive scale + early-out.

### Mandatory optimizations
- **No per-frame CPU remap** on GPU path.
- On CPU path:
  - early-out when shift doesn’t change
  - adaptive renderScale
  - avoid rebuilding LUT tables unnecessarily

---

## 7) Migration plan

### Phase 0 — Freeze Goblet v1 (immediate)
- No further semantic changes to Goblet v1.
- Keep only minimal “quality/perf” toggles.

### Phase 1 — Implement Goblet 2 WebGL2 renderer
- New entrypoint: `public/goblet2/goblet2.js`
- New metadata version: `format = vessel-goblet2`
- Render brush-mode CC using:
  - indexBuffer tex
  - gradientIdBuffer tex (slots only)
  - speedBuffer tex
  - paletteTex for slots
  - timeSeconds uniform

### Phase 2 — Implement CPU fallback + correctness tests
- CPU fallback uses same contract (slot palettes + speedBuffer)
- Golden tests run CPU vs GPU.

### Phase 3 — (Optional) Upgrade shape identity beyond (slot, speedByte)
If needed for future correctness or scaling:
- introduce `animIdBuffer` and `anims[]` table
- or migrate to slotSpeeds only if slot budget suffices (not recommended unless you can guarantee <64 unique (slot, speed) combos)

---

## 8) Open questions (explicit)
1) **Palette size**: brush-mode uses `brushState.palette.length` (often 256). Confirm that Goblet 2 palette baking uses the same length used in Vessel.
2) **Speed decode range**: ensure `speedMin/speedMax` in export match the encoding used by `encodeColorCycleSpeedByte` in engine paths (A2/A3).
3) **Direction convention**: confirmed via `p - shift` fix; codify it as the contract (and test with a known ramp).

---

## 9) Immediate next implementation steps
1) Add `format: vessel-goblet2` and route viewer to Goblet 2 codepath.
2) Implement WebGL2 shader + textures:
   - R8 index
   - R8 slot
   - R8 speedByte
   - RGBA8 palette rows (slot palettes baked)
3) Implement a minimal CPU reference for tests.
4) Add a small golden test bundle generator.

---

## Appendix: Code facts (A–D) mapped to plan
- A1: exporter serializes existing buffers → Goblet 2 uses them directly.
- A2/A3/C: speedByte + flowSlot written per pixel → initial anim grouping is (slot, speedByte).
- A4/B: speedCps persisted on defs → future-ready metadata + debug.
- D: Vessel already uses WebGL uniform `offset` → Goblet 2 matches that GPU approach.

---
