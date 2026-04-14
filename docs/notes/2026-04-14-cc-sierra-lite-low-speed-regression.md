## CC Sierra Lite Low-Speed Playback Investigation

Date: 2026-04-14

### Problem

The Color Cycle 1-color Sierra Lite path looks framey at low playback speeds, while other dither algorithms look smooth.

### Test setup

- Compared detached worktrees on separate local dev ports.
- Important: in `next dev`, the app is served from `/`, not `/vessel`.
- Judgment criteria:
  - `smooth`: low-speed Sierra Lite playback does not read as visibly stepped/framey
  - `framey`: low-speed Sierra Lite playback visibly pops/steps
  - `smooth but missing dithering`: playback is smoother, but the intended 1-color Sierra Lite dither look is not really present

### Tested commits

#### Good / smooth

- `592d93e50` — 2026-03-26 09:23:45 AEDT
  - Message: `fix: restore cc gradient dither parity and playback`
  - URL: `http://localhost:3130/`
  - Result: smooth

- `a1f482413` — 2026-03-31 12:29:24 AEDT
  - Message: `fix: finalize selected stroke dither algorithms`
  - URL: `http://localhost:3131/`
  - Result: smooth

- `0bd01842e` — 2026-04-01 22:29:26 AEDT
  - Message: `fix: separate color cycle flow velocity`
  - URL: `http://localhost:3132/`
  - Result: smooth

- `08f616aa4` — 2026-04-02 14:34:29 AEDT
  - Message: `fix(color-cycle): flat sierra mix-driven dithering with runtime band selection`
  - URL: `http://localhost:3133/`
  - Result: smooth, but 1-color Sierra Lite dithering was not visibly present

#### Bad / framey

- `450fd341e` — 2026-04-02 16:09:08 AEDT
  - Message: `fix: stabilize cc flat fg runtime recipe`
  - URL: `http://localhost:3134/`
  - Result: framey, with the visible Sierra Lite dithering look restored

- `e58ed6995` — 2026-04-02 18:48:56 AEDT
  - Message: `fix: checkpoint good cc 1-color flat runtime state`
  - URL: `http://localhost:3120/`
  - Result: framey for this specific low-speed Sierra Lite issue

### Narrowed regression window

Current boundary:

- Last known smooth behavior: `0bd01842e`
- First known framey behavior with visible Sierra Lite runtime dithering: `450fd341e`

This suggests the relevant change started on 2026-04-02 between 14:34 and 16:09 AEDT.

### Interpretation

- `08f616aa4` appears smoother partly because the intended 1-color Sierra Lite runtime effect is under-applied or missing.
- `450fd341e` restores the visible Sierra Lite runtime recipe and is the first commit where the low-speed framey behavior is obvious.
- This does not look like a generic playback FPS problem, because other dither modes remain smooth.
- The issue was exposed most clearly by the Sierra Lite flat runtime path, but the actual low-speed stepping point was in animated palette lookup during rendering.

### Root cause

The real bug was renderer-side palette quantization during animated playback.

Before the fix:

- CPU path in `src/lib/colorCycle/Renderer2D.ts` snapped animated shifts to integer palette indices with `((speedOffset * 256) | 0)`.
- WebGL path in `src/lib/colorCycle/rendering/WebGLColorCycleRenderer.ts` sampled `floor(pIdx)` only.

That meant low-speed playback could only advance in whole palette steps, which reads as visible popping on the Sierra Lite 1-color path.

### Fix

The final fix was to interpolate between adjacent palette entries for animated playback:

- `src/lib/colorCycle/Renderer2D.ts`
- `src/lib/colorCycle/rendering/WebGLColorCycleRenderer.ts`

Static and legacy non-speed paths remain discrete. Only animated palette lookup now blends fractional palette positions.

### Failed approaches that were backed out

These were tested and fully reverted:

- per-pixel phase ramps across the flat Sierra fill
- sparse phase jitter to de-sync cells
- playback-side dissolve-style offsets
- Sierra pattern simplification in `src/utils/colorCycle/ccFlatModePatterns.ts`

Those experiments either caused visible color bands marching across the fill or introduced a dissolve effect that was worse than the original bug.

### Test coverage

Regression coverage was added in:

- `src/lib/colorCycle/__tests__/Renderer2D.test.ts`

The tests now verify:

- static speed byte `0` still behaves as static
- legacy non-speed paths still use discrete shifts
- animated speed paths interpolate between adjacent palette entries
- definition-palette playback uses the same interpolation behavior
