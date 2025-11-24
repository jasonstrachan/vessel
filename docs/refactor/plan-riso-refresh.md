# Plan: Risograph realism, color shift, and performance

## Goal
Make the risograph slider produce a more organic, inky texture (no halftone), introduce subtle CMY-tinted shifts tied to brush color, and hold ≥30 FPS while drawing.

## Scope
- Riso UI: `src/components/toolbar/BrushControls.tsx`
- Riso effect internals: `src/utils/risographTexture.ts`, `src/hooks/useBrushEngineSimplified.ts`
- Optional helpers/tests: `src/hooks/__tests__/useBrushEngineSimplified.harness.test.tsx`, visual snapshot harness

## Constraints & targets
- Look: organic paper grain + imperfect dots; **no halftone screens**.
- Performance: sustain ~30 FPS on typical device with riso intensity at 90.
- Color: pattern tinted off the brush color, gently nudged toward C/M/Y with small hue/sat jitter; deterministic per stroke.
- UX: keep existing Riso slider; add small sub-control + 40×40 preview; no backward-compat guarantee needed.

## Phased work

### 1) Realism (texture + stroke-consistent randomness)
- Build two precomputed patterns (once per session):
  - **Coarse organic dots**: irregular radii (0.8–2.4px), mild clustering noise, slight per-stroke rotation/scale jitter.
  - **Fine paper grain**: low-contrast noise for tooth.
- Seed per stroke: derive a seed on stroke start; reuse for misregistration offsets, rotation, and scale to avoid per-stamp shimmer.
- Clip/cache: reuse clip bounds for a stroke; skip pattern fill on areas < ~16 px².
- UI swatch: 40×40 live preview in `BrushControls` showing current intensity + outline state (uses same seeded generation path).

### 2) Color shift (CMY-ish, tied to brush color)
- Add `risographColorShift` (0–10, default ~3) to `BrushSettings`.
- Derive pattern tint from brush color:
  - Find nearest plate vector (C/M/Y) and nudge hue ±3–5°, sat/value ±3%.
  - Apply tint only to the pattern layer; base fill remains untouched.
- Deterministic per stroke using the same seed; no extra per-stamp RNG.
- UI: small sub-slider under Riso slider labeled “Hue Jitter” (0–10) + tooltip that it tints grain only.

### 3) Performance hardening
- Offscreen overlay: draw blended riso texture once per frame/layer into an offscreen canvas; composite to main ctx (soft-light/multiply) instead of per-stamp fills.
- Seeded RNG eliminates repeated `Math.random` calls in hot paths.
- Early-outs: skip outline jitter on tiny areas; clamp effect curve so 0–30 is gentle, 70–100 ramps.
- Perf harness: add a quick benchmark page/test sweeping intensities 0/30/60/90 across key brushes; record FPS/frame time and assert ≥30 FPS locally.
- Visual snapshots: capture grain at intensities 10/50/90 to guard regressions in texture and tint.

## Risks / watch-outs
- Texture generation cost: mitigate with one-time OffscreenCanvas generation and caching per device pixel ratio.
- Color shifts muddying dark inks: cap tint alpha; keep value jitter tiny.
- Mobile: if perf dips, fall back to fine-grain-only path (skip coarse dots) when canvas area or memory flags are high.

## Definition of done
- New organic texture + color shift visible; slider preview matches strokes.
- Brush strokes remain deterministic within a stroke; no shimmering grain.
- Perf harness shows ≥30 FPS with Riso at 90 in the test scene.
- Tests updated/added; visual snapshots generated and documented.

## Next actions
- Implement phase 1 (texture + seed + swatch), then phase 2 (color shift), then phase 3 (perf harness/offscreen path). 
