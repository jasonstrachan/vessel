# Color-Cycle First Stroke Static Until Second Stroke

Context

- Repro: on a color-cycle layer, the first stroke draws visible pixels but remains visually static.
- After drawing a second stroke on the same layer, animation becomes visible.
- Constraint from debugging scope:
  - do not change `spd` write behavior
  - do not change stack-order logic
  - focus on the empty-layer bootstrap path

Current symptom

- First content stroke on an empty color-cycle layer is static while drawing.
- Second and later strokes animate normally.
- The bug is specific to the `hasContent: false -> true` transition.

What logs proved

- On first stroke start, brush state reports:
  - `strokeDataHasContent: false`
- On second stroke start, brush state reports:
  - `strokeDataHasContent: true`
- During the first stroke, paint is not missing:
  - `[cc-first-stamp-state]` showed non-zero `paint` and `gid`
- During the first stroke, playback is not globally stalled:
  - repeated `[cc-render-layer]` logs showed
    - `isAnimating: true`
    - `shouldAdvanceAnimation: true`
- Therefore:
  - the first stroke is not failing because nothing was painted
  - the first stroke is not failing because the shared playback loop is stopped

What has been ruled out

1. Missing first-stamp paint data

- Ruled out by first-stamp logging.
- The first stroke does write authoring data into live stroke buffers.

2. Missing active playback tick

- Ruled out by render/playback logs.
- The active layer is being advanced during the first stroke.

3. Blank erase mask hiding the first stroke

- `MaskManager.applyMaskToCanvas()` only erases if a non-empty `eraseMask` exists.
- New CC layers initialize a blank mask canvas.
- No evidence points to mask erasure as the first-stroke-only cause.

Attempted fixes

1. Live preview fallback bootstrap in brush/animator path

Files touched:

- `src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts`
- `src/lib/ColorCycleAnimator.ts`
- `src/lib/colorCycle/Renderer2D.ts`

Intent:

- When a stroke starts on an empty CC layer, enable the same live fallback used later once content already exists.
- Keep `spd` writes unchanged.
- Do not alter stack order.

Status:

- Still present in the worktree at the time of this note.
- Not yet proven effective in live repro.
- It remains a plausible hypothesis, but not a confirmed fix.

2. Stroke-start overlay bootstrap patch

File:

- `src/hooks/canvas/handlers/strokeStartColorCycle.ts`

Intent:

- Treat the first live CC stroke as owning the overlay immediately, even before global playback is already warm.

Status:

- Backed out.

Reason for backout:

- Live repro still showed:
  - first stroke static
  - second stroke animating
- That made this patch an ineffective behavioral change, so it was removed rather than stacked with further speculation.

What is now proven about the bug shape

- The issue is not simply "first stroke forgot to paint".
- The issue is not simply "playback did not start".
- The issue is not fixed by changing only stroke-start overlay ownership.
- The remaining divergence is more likely in the live authoring/render path that exists only for the first-content bootstrap case.

Most likely remaining branches

1. Animator fallback path is present but not actually used on first-content stroke

- Possible reason:
  - live speed/authoring state flips out of the fallback branch too early
  - renderer ends up reading a non-fallback path before committed state is ready

2. First-content stroke uses a different live source surface than warm strokes

- Possible reason:
  - `renderDirectToCanvas()` is invoked
  - but the source canvas/image being copied is still not the animated surface during the first bootstrap stroke

3. Buffer binding between `strokeData.buffers.*` and animator direct-fill surfaces is incomplete or mistimed only on the empty->non-empty transition

- This would fit the observed pattern:
  - logs show paint/gid changing
  - visible animation still does not appear until a later stroke

Recommended next debugging step

- Continue from the live authoring/render path, not the overlay bootstrap path.
- Specifically inspect first-content behavior around:
  - `ColorCycleBrushCanvas2D.startStroke`
  - `ColorCycleBrushCanvas2D.renderDirectToCanvas`
  - `ColorCycleAnimator.renderFrame`
  - animator/index-buffer direct-fill binding
- If the live fallback path still fails in manual repro, back it out next before trying another behavioral patch.

Validation already completed during this debugging pass

- `npm test -- --runInBand src/hooks/brushEngine/__tests__/ColorCycleBrushCanvas2D.test.ts`
- `npm test -- --runInBand src/lib/__tests__/ColorCycleAnimator.speedScaling.test.ts`
- `npm test -- --runInBand src/lib/colorCycle/__tests__/Renderer2D.test.ts`
- `npm test -- --runInBand src/hooks/canvas/handlers/colorCycle/__tests__/colorCyclePlayback.sharedRuntime.test.ts`
- `npm run type-check`

