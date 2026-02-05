# CC Def-Bound Storage Plan
## Sampled Strokes + CC Gradient Marks
**Revision:** 2026-02-02  
**Scope:** Make sampled CC strokes and CC Gradient (shape + stroke) commit with stable storage that does not mutate and does not “run out” under normal use.

---

## 0) Summary of the problem (why it “runs out”)
Your renderer currently selects palettes by **8-bit slot** (`gid & FLOW_SLOT_MASK`), which gives **256 total slots**. If committed marks are bound by slots, slot reuse is still inevitable over time and older marks will mutate once a slot is reused.

You already have the correct long-lived storage primitive:
- **`defBuffer: Uint16Array`** (per pixel gradientDefId)
- **`gradientDefStore`** (immutable defs: id, kind, stops, hash, source)

But rendering still ignores `defBuffer`, so commits remain slot-bound in practice.

**Fix:** Commit binds pixels by `defId` (wide) and rendering selects palette by `defId`. Slots become preview-only.

---

## 1) Non-negotiable invariants
### I1 — Preview slot is never a committed binding
- Reserve `PREVIEW_SLOT = 63` for preview only.
- Any commit must guarantee ROI contains **no pixels referencing preview slot** (dev tripwire).

### I2 — Committed binding is `defId`, not slot
- After commit, pixels must carry `defId` in `defBuffer` and must render by that `defId`.

### I3 — Slot “active” is UI-only
- Changing `isActive` must not change or delete a slot palette.
- Removing a slot palette is forbidden if any pixel still references it (legacy path).

### I4 — Preview/final parity is enforced
- The `GradientDef.hash` created on finalize must equal the session’s frozen hash.
- Rendering must use the same frozen stops used to create the def.

---

## 2) Phase 0 — Tripwires + API cleanup (small but mandatory)
### 2.1 Split palette APIs
Replace ambiguous calls like:
- `setGradientSlot({ slot, isActive:false, stopsLen: ... })`

With two explicit APIs:
- `setSlotStops(layerId, slot, stopsStored)`  
  Generates and stores palette data for the slot.
- `setSlotActive(layerId, slot, isActive)`  
  UI-only. Must not touch palette data.

### 2.2 Tripwires (dev-only)
- **T0 Preview slot leak:** after commit, scan ROI and assert no `(gid & FLOW_SLOT_MASK) === 254` (TEMP_SAMPLE_SLOT) and no editor slot (255) in committed pixels.
- **T1 Def palette exists:** if `defIdData[i] > 0`, assert a palette exists for defId.
- **T2 Parity:** `def.hash === session.frozenHash` on finalize/commit.
- **T3 No “begin” during finalize:** forbid `beginMarkGradientSession` from any finalize/commit path.

---

## 3) Phase 1 — Def-bound rendering on CPU (the big correctness win)
This phase makes commits effectively unlimited (within `Uint16` range) and stops all mutation due to slot reuse.

### 3.1 Build per-def palettes (runtime cache)
Add a runtime cache per layer:
- `defPalettesById: Map<number, Uint32Array>`  
  Key: `defId`, Value: `palette32[256]`

Palette generation:
- Reuse your existing “stops → palette32” pipeline (the same logic used for slot palettes).

Cache policy (simple first):
- Keep palettes for all defs in the store while the layer is loaded.
- If memory becomes an issue later, add LRU or “only keep palettes for defs referenced on screen”.

### 3.2 Render path: prefer defId palette
#### File: `src/lib/colorCycle/Renderer2D.ts`
Extend `render()` inputs:
- `defIdData?: Uint16Array`
- `defPalettesById?: Map<number, Uint32Array>`

Per-pixel palette selection:
- If `defIdData && defIdData[i] > 0`:
  - `palette = defPalettesById.get(defId) || basePalette`
- Else:
  - legacy `slot = gid & FLOW_SLOT_MASK`
  - `palette = paletteSlots[slot] || basePalette`

Keep shift/speed/flow logic as-is (still from `gid/spd`).

### 3.3 Wire defId into Animator CPU render
#### File: `src/lib/ColorCycleAnimator.ts`
In the CPU path of `renderFrame()`:
- Acquire `defIdData` from wherever your brush snapshot stores it (you already persist `gradientDefIdBuffer`).
- Convert to a `Uint16Array` view:
  - `const defIdData = gradientDefIdBuffer ? new Uint16Array(gradientDefIdBuffer) : undefined;`
- Pass `defIdData` and `defPalettesById` into `renderer2D.render(...)`.

### 3.4 Force CPU for def-bound modes (temporary)
Until GPU defId is implemented, ensure correctness by forcing CPU in these cases:
- `tools.ccGradientSource === 'sampled'`
- CC Gradient marks (shape fill tool)
- or “def rendering enabled” flag per layer/project

Implementation options:
- Set `ColorCycleAnimator.forceCanvas2D = true` for these modes.
- Or provide a “renderMode: cpu|gpu|auto” override.

---

## 4) Phase 1 commit rules — Apply to both strokes and CC Gradient marks
### 4.1 Def creation (dedupe)
Continue using:
- `ensureGradientDefForStops(...)`
But **do not rely on its slot** for correctness anymore.

Rules:
- Dedupe by `hashStops(stops, kind)`.
- `defId` is monotonic, never reused.

Also ensure `defPalettesById` contains palette for the new/returned defId.

### 4.2 Sampled strokes: commit writes defId in ROI
On finalize stroke:
1) finalize session → `frozenStopsStored`, `frozenHash`
2) `defId = ensureGradientDefForStops(...)`
3) ROI write:
   - For each pixel in bbox/dirty rect:
     - if `paintBuffer[idx] != 0` then `defBuffer[idx] = defId`

Do **not** remap gid slots for correctness in Phase 1.  
(You may still remap away TEMP_SAMPLE_SLOT (254) as a cleanliness step, but it is no longer required to prevent mutation once renderer prefers defId.)

### 4.3 CC Gradient shapes: commit writes defId directly
On shape finalize (linear/concentric):
1) finalize session → frozen stops/hash
2) ensure defId
3) fill writes:
   - `paintBuffer[idx] = computedIndex`
   - `defBuffer[idx] = defId`

Preview while dragging can continue to use TEMP_SAMPLE_SLOT (254), but the commit must write defId.

---

## 5) Phase 2 — GPU defId rendering (performance; correctness already solved by Phase 1)
GPU needs a way to read 16-bit defId and select a palette by defId.

### 5.1 defId texture packing (WebGL1 friendly)
Pack `defId` into two 8-bit channels:
- `R = defId & 255`
- `G = (defId >> 8) & 255`

Shader reconstruct:
- `defId = r + g*256` (with correct rounding to byte domain)

### 5.2 Palette atlas texture by defId row
Create a 2D palette texture:
- width = 256 (palette entries)
- height = `N` (number of resident defs)

Maintain:
- `defId -> rowIndex`
- palette upload when a new def appears or when reassigning rows.

Shader:
- compute palette index with shift as you already do
- sample palette texture at `(u, v)` where `v` corresponds to def row

### 5.3 Residency policy
To avoid GPU “running out”:
- Keep CPU path as fallback.
- GPU atlas can be limited to last `N` defs (e.g. 512 or 1024).
- If a frame needs a non-resident def, fallback CPU for that frame or force CPU until atlas rebuilt.

---

## 6) What changes after this plan
### You keep 8-bit slots, but only for preview/legacy
- Preview: TEMP_SAMPLE_SLOT (254) is always safe.
- Committed identity: defId is unlimited and stable.

### You stop seeing:
- “After N strokes everything becomes the latest sampled gradient”
- “Committed stroke vanishes because slot palette was evicted”
- Slot exhaustion as a correctness failure

---

## 7) Acceptance checks
### Sampled strokes
- Draw 200+ sampled strokes on one layer.
- Earlier strokes never mutate when sampling new strokes.
- Reload project: strokes remain stable.

### CC Gradient shapes
- Draw 200+ gradient shapes (mix linear/concentric).
- Earlier shapes never mutate on later edits/samples.
- Preview == final (hash parity tripwire never fires).

### Tripwires
- No preview slot (254) remains in committed ROI.
- Renderer never encounters defId without a palette.

---

## 8) Estimated work size (practical)
### Phase 1 (CPU def-bound)
Medium-sized.
- Renderer2D signature + palette selection change
- Animator plumbing for defIdData + def palettes
- Commit paths write defId for both marks
This is the “reasonable storage that doesn’t run out” milestone.

### Phase 2 (GPU def-bound)
Large.
- Texture packing, atlas management, shader changes, residency policy

Recommendation:
- Ship Phase 1 first and gate Phase 2 behind a feature flag.




ChatGPT can make mistakes. Check important info.
