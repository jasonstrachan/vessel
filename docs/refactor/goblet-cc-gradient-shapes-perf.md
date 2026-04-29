# Goblet 2 CC Gradient Shapes Performance Fixture

Status: Active.

Purpose: provide a reusable browser-rendered stress file for Goblet 2 color-cycle
performance work.

## Fixture

- File: `tests/goblet2-cc-gradient-shapes-perf.spec.ts`
- Command: `npm run test:goblet2:cc-gradient-shapes-perf`
- Shape count: 256 dithered color-cycle gradient-shape cells arranged as a
  16x16 grid.
- Surface: one 2000x2000 Goblet 2 color-cycle layer.
- Dither: ordered 8x8 dither applied to each shape's color-cycle gradient
  index payload before Goblet render.
- Runtime path: Goblet 2 single-file inline runtime served over HTTP by Playwright.
- Assertions:
  - the page has no browser errors,
  - the Goblet runtime paints non-transparent pixels,
  - the fixture reports RAF callback FPS and callback cost.

## Last Verified Result

2026-04-29:

```text
[goblet-perf] 256 CC gradient shapes: fps=68.4 avgCallback=12.36ms maxCallback=30.60ms
```

## Notes

- The fixture is intentionally deterministic so later optimization work can reuse
  the same exported shape load.
- Playwright may require browser-launch approval in sandboxed runs.
- Treat this as a smoke/perf comparison harness, not as a strict CI-grade FPS
  budget. Hardware and browser scheduling can change the absolute FPS number.
