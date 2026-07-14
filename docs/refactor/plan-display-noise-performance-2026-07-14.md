# Display Noise Performance Plan

Last updated: 2026-07-14

Status: implemented; runtime acceptance remains user-verified

## Goal

Remove the substantial playback slowdown caused by the simple `Noise` display
filter in Vessel and Goblet without changing its grain, blend mode, opacity,
scale, document alignment, or saved settings.

This plan fixes one measured path: a project whose only effective display filter
is `Noise`. That is the reported calibration-project configuration and the
smallest path that removes the unnecessary full-frame filter pipeline.

## Current Cause

The noise tile itself is small, deterministic, and cached. The repeated cost is
the generic post-process path used on every color-cycle animation frame:

1. Vessel and Goblet render the final artwork into a full-size filter surface.
2. `applyDisplayFilterStack` allocates or reuses full-size ping-pong canvases.
3. The Noise branch clears a work canvas and copies the full composite into it.
4. It performs a full-surface `soft-light` pattern fill.
5. The caller copies the filtered work canvas back to the display canvas.

`clearDisplayFilterCanvas` also requests `willReadFrequently` for every work
context. That hint favors pixel-read workloads even though simple Noise never
reads pixels. During color-cycle playback, the complete path repeats every
frame.

The filter is already applied once after layer compositing. Applying it “as a
layer over all layers” therefore means removing the generic intermediate
surfaces for the Noise-only case, not changing layer ownership.

## Invariants

- Noise remains a display-only effect over the final on-screen composite.
- Vessel keeps its established background-first compositor order for Noise-only
  frames. The checker or gray transparency preview can therefore participate in
  the soft-light blend, but it is never written into artwork, layers, or saved
  project data.
- Source artwork, layers, color-cycle data, and saved filter settings are never
  mutated.
- The existing deterministic tile generator remains the grain authority.
- Noise remains static in document space while playback animates underneath it.
- The blend remains `soft-light` with the current opacity and scale semantics.
- Canvas overlays, cursors, selections, and handles remain unfiltered.
- Mixed filter stacks retain the existing ordered post-process pipeline.
- Vessel, modular Goblet, and single-file Goblet use the same Noise rendering
  contract.

## Non-Goals

- Film Noise optimization.
- Fast paths for LCD Mask, CRT Grid, Chromatic Aberration, or any other filter.
- Reclassifying every filter into CPU and compositor canvas pools.
- Removing `willReadFrequently` from the generic pipeline.
- WebGL post-processing, shaders, filter downscaling, or adaptive quality.
- Changing or consuming the currently ignored `lengthScale` argument.
- Color-cycle seam profiles, gradients, archive normalization, or export
  serialization.
- General canvas-compositor or color-cycle playback refactoring.
- Playwright, screenshot capture, or automated visual comparison.

## Source Ownership

- `src/lib/displayFilterPipeline.js` owns Noise tile generation, caching,
  alignment, and application.
- `src/components/canvas/useDrawingCanvasBaseRenderer.ts` owns whether Vessel
  needs an intermediate filter surface.
- `public/goblet2/goblet2.js` owns the equivalent modular Goblet render route.
- `scripts/build-goblet-runtime.mjs` remains the existing generator for public
  pipeline mirrors and the inline runtime; it should not need behavior changes.

## Implementation

### 1. Add a narrow Noise-only contract

In `src/lib/displayFilterPipeline.js`, add explicit helpers that:

- identify a stack where Noise is the only enabled filter with a non-zero
  effect;
- build and cache a full-target Noise overlay from the existing deterministic
  tile;
- key that overlay by Noise tile settings, target dimensions, and document
  origin modulo the tile dimensions;
- draw the cached overlay once with `soft-light` and the configured opacity;
- accept a target context and rectangle so Vessel can filter only the artwork
  viewport, leaving UI overlays untouched.

The cached overlay must use a normal Canvas2D context because it never calls
`getImageData`. Rebuild it only when its key changes, not on animation frames.

Keep the current generic Noise branch for mixed stacks, but route its Noise
application through the same helper where that does not alter filter order or
output. Do not change the context policy for any other filter.

### 2. Bypass Vessel's generic filter surfaces for Noise-only stacks

In `useDrawingCanvasBaseRenderer.ts`:

- distinguish `Noise only` from `other enabled filters`;
- render the visible composite directly to the display context for Noise-only;
- apply the cached Noise overlay to `visibleRect` after compositing and before
  `drawCanvasOverlayLayer`;
- preserve the current filter-surface and final-blit route for every mixed or
  non-Noise stack.

The Noise-only frame must not resize, clear, copy through, or present
`filterSurfaceCanvas`, `workCanvasA`, or `workCanvasB`.

### 3. Apply the same bypass in Goblet

In `public/goblet2/goblet2.js`:

- render layers directly to the display context when Noise is the only
  effective filter;
- apply the shared cached overlay once after the final artwork composite;
- retain the existing full filter pipeline for all other stacks;
- preserve fixed-layout sizing, device-pixel-ratio behavior, background paint,
  and document-space pattern alignment.

Regenerate the inline runtime and public pipeline mirrors through the existing
build command. Do not hand-edit generated inline code.

### 4. Add focused regression coverage

Tests must prove:

- disabled Noise and zero-opacity Noise do not select the fast path;
- enabled non-Noise filters or a mixed stack do not select the fast path;
- Noise-only selection avoids the intermediate-surface route in Vessel and
  Goblet;
- the overlay cache is reused across unchanged animation frames;
- changing scale, target dimensions, or document-origin tile phase rebuilds the
  overlay;
- the existing tile wraps without a boundary seam;
- modular and inline Goblet runtimes include the same helper/export contract.

Canvas output comparison should use a tight pixel tolerance rather than require
byte identity, because changing canvas backing/compositor paths can introduce
small browser rounding differences.

## File Boundary

Authored implementation and test files:

1. `src/lib/displayFilterPipeline.js`
2. `src/lib/displayFilterPipeline.d.ts`
3. `src/components/canvas/useDrawingCanvasBaseRenderer.ts`
4. `public/goblet2/goblet2.js`
5. `src/components/canvas/__tests__/useDrawingCanvasBaseRenderer.test.ts`
6. `tests/goblet2-runtime-regression.test.ts`

Mechanically generated parity outputs:

1. `public/goblet/displayFilterPipeline.js`
2. `public/goblet2/displayFilterPipeline.js`
3. `public/goblet2/goblet2-inline.js`

The generated outputs are required by the repository's existing runtime parity
contract, but they bring the total touched-file count above the six-file project
guardrail. Implementation must pause for explicit approval of those generated
outputs before editing begins. No other file is in scope; any further expansion
requires a revised cause and approval.

## Verification

Run the smallest checks first:

```bash
npm test -- --runInBand src/components/canvas/__tests__/useDrawingCanvasBaseRenderer.test.ts tests/goblet2-runtime-regression.test.ts
npm run build:goblet-inline
npm run verify:goblet2-inline
npm run type-check
npm run lint
git diff --check
```

Because runtime export behavior changes, also run the normal production build
after focused checks pass:

```bash
mise exec node@22.22.0 -- npm run build
```

No Playwright run or screenshot capture is part of this plan. The final runtime
gate is manual verification by the user with color-cycle playback running in:

- Vessel using
  `/Users/jasonstrachan/+Projects/2026/Art/calibration/2.2-repaired.vs`;
- the newly re-exported Goblet HTML at
  `/Users/jasonstrachan/+Projects/2026/Art/calibration/2.html`.

Compare Noise off and on after warm-up at the same viewport and DPR. Acceptance
requires:

- no substantial playback slowdown when Noise is enabled;
- no visible change to grain scale, opacity, softness, or alignment;
- no movement of the noise pattern relative to the artwork during playback;
- no filtering of editor overlays;
- no regression when another filter is enabled alongside Noise.

## Stop Conditions

This work is complete when focused tests and build checks pass, the Noise-only
route performs one cached overlay composite per frame with no filter-surface or
ping-pong copies, generated Goblet assets are current, and the user accepts the
exact Vessel and exported-HTML runtime behavior.

If playback remains substantially slow after the intermediate surfaces are
removed, stop and profile the remaining `soft-light` composite. Do not expand
into other filters, WebGL, downscaling, color-cycle rendering, or seam-profile
work without a new evidence-based plan.
