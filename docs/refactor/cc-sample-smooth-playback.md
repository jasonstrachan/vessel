# Redo: Smooth Sample Preview Without Touching Slots

## Back out first (required)
- Yes: back out the last preview/animator edits before applying this redo.
- With no commit, restore the files you touched (at minimum):
  - src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts
  - src/lib/ColorCycleAnimator.ts
  - src/lib/AnimationController.ts
- Verify:
  - No `[floatingPaste] committing ...` logs appear when you merely open/animate the preview.
  - Preview does not touch normal layers at all.

---

## Goal
Make the sample preview:
- Animate smoothly (continuous time, no segmented stepping).
- Be read-only (cannot commit, allocate slots/defs, or mutate layer data).
- Be isolated (no per-layer animators, no IndexBuffer/layer iteration).

---

## Non-negotiable invariants
1. Preview never references layerId/layerType/store layers.
2. Preview never calls commit/finalize/apply/ensureDef/slot allocation paths.
3. Preview does not maintain per-layer maps (no `animators`, no `layerStrokes`).
4. Preview phase is derived from rAF timestamp (continuous), not fixed-step FPS or accumulators.
5. No allocations in the rAF loop.

---

## Step 1 — Define a pure PreviewModel (frozen inputs)
Create a preview-only model, updated only when UI changes:

- stops (or palette colors)
- gradientKind (linear/radial/etc.)
- flowMode
- speed
- dimensions (w/h)

No layer ids. No slot ids. No def ids.

---

## Step 2 — Delete preview’s per-layer animation system
Remove from the sample preview path:
- `this.animators` map
- `this.layerStrokes` map
- any loops over layers
- any “hasIndices/indicesLen” logic
- any code path that can print or trigger `[floatingPaste] committing ...`
- any call to `animator.updateFrame()` that owns its own time/render

Preview should not know layers exist.

---

## Step 3 — Replace fixed-step logic with continuous phase from timestamp
In the preview rAF tick:
- `tSeconds = timestampMs / 1000`
- `phase = fract((tSeconds - t0Seconds) * speed)`  (t0Seconds captured when preview starts)
- If paused: freeze `phase` (store `phaseAtPause`)

No accumulator. No `frameIntervalMs()` stepping. No targetFPS.

Optional:
- If you need to cap draw cost: throttle renders to ~60fps, but still compute phase from timestamp.

---

## Step 4 — Implement a pure renderer (recommended: strip renderer)
### A) Strip renderer (fastest, simplest)
On preview model change (stops/kind):
- Precompute a small palette array (e.g. 256 colors) from stops once.

Per frame:
- Compute phaseShift = floor(phase * 256)
- Draw the strip by indexing palette with `(x + phaseShift) & 255`
- Scale up to preview canvas

This avoids all CC layer rendering complexity.

### B) If you must reuse Renderer2D.render
- Allocate a small dedicated preview buffer (w*h <= 256*64)
- Fill index/gid/speed ONCE (on init/resize)
- Each frame call renderer with:
  - stable buffers
  - changing `phase` and/or `baseTimeOverride`
- Still: no layer/store coupling, no commits.

---

## Step 5 — Add tripwires to prevent regression
- Preview module must not import allocator/commit modules.
- Dev assertions:
  - preview tick must not call any function containing: commit/finalize/apply/ensureDef/slot
- Remove any code that can print `[floatingPaste] committing ...` from preview pathways.

---

## Step 6 — Verification checklist
1. Start preview, do not paint.
   - No commit logs.
   - No layer access.
2. Change speed slider:
   - Motion stays continuous (no segments).
3. Pause/resume:
   - Phase freezes and resumes without jump.
4. Performance:
   - No noticeable GC stutters.
   - No allocations per frame (confirm via profiler).

---

## Implementation note (to keep diffs small)
- Keep the existing preview UI and canvas.
- Replace only:
  - the preview tick logic
  - the preview draw function
- Do not touch:
  - slot storage
  - def storage
  - layer rendering paths
  - stroke stamping/index buffer writers

---

## Next paste needed (for exact code edits)
Paste the function that draws the sample preview canvas (the one that currently calls `renderer2D.render(...)` or the 2D draw for the preview). Then this plan can be converted into a precise patch.




ChatGPT can make mistakes. Check important info.