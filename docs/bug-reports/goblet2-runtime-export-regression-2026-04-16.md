# Goblet2 Runtime Export Regression

Date: 2026-04-16

## Summary

Goblet export regressions were bisected to the feature set introduced between `18f8d5fab` and `926b540f0`, but selective restoration isolated the break to:

- `public/goblet2/goblet2.js`
- `public/goblet2/goblet2-inline.js`

The display-filter and film-noise pipeline changes were restored independently and did not reintroduce the bug.

## Symptoms

- Exported Goblet output appeared blank or missing expected layer content.
- Restoring only the Goblet2 runtime files from `HEAD` was sufficient to make exports fail again.
- Keeping the Goblet2 runtime files on the `18f8d5fab` version restored working exports.

## Isolated Runtime Differences

The offending runtime diff included two behavior changes in Goblet2:

1. Removing the viewer-only CC time multiplier in `BrushWebGLRenderer.render(...)`.
2. Changing `ColorCycleLayerPlayer.advance(...)` to use target-FPS bucketed accumulation instead of direct `deltaSeconds` stepping.

These changes are guarded by regression tests in:

- `tests/goblet2-runtime-regression.test.ts`

## Current Safe State

- Keep `public/goblet2/goblet2.js` and `public/goblet2/goblet2-inline.js` pinned to the `18f8d5fab` behavior.
- The display-filter / film-noise files can remain on current `HEAD`.

## Follow-up

If Goblet2 runtime improvements need to be reintroduced, do so by replaying the `goblet2.js` / `goblet2-inline.js` diff in small hunks and testing export after each step.
