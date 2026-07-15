# Film Noise Canvas2D Redesign Plan

Last updated: 2026-07-15

Status: implemented; deterministic verification complete, final visual and
workload performance acceptance pending

## Implementation Status

Implemented on 2026-07-15 within the approved authored and generated file
boundary. Film Noise now uses deterministic single, chain, and island clusters
rendered into cached dark and light plates, with a direct-overlay route for the
single-filter case. The old artwork-frame readback, JavaScript pixel loop, and
`putImageData()` upload have been removed.

Visual feedback on the first implementation showed that it remained too sparse
and read as isolated dust. The morphology was revised to make connected chains
and branching islands dominant, group most clusters into uneven colonies,
increase occupied area and local solidity, and make the reference's dark grains
dominant over the secondary light pass.

Further inspection showed that ellipse overlap alone still read as bead-like
flecks. The final model restores a substantial population of rounded individual
grains and joins only selected groups with explicit wrapped, round-ended bridges
so those dots visibly coalesce into continuous bent strands and branches.

The morphology was then broadened with more lobes per connected cluster, a
wider dot-size distribution, rounder individual dots, and shorter center steps.
This makes visibly different-sized grains overlap into dense islands and strands
instead of reading as evenly sized flecks connected by lines.

At the minimum Grain Size, the original safety cap reduced coverage before the
inverse-area density rule could take effect. The cached plate cap was raised to
10,000 clusters so size `1` retains approximately the same occupied area as the
default size and reads as fine, closely packed grain rather than sparse dust.

Focused tests, Goblet runtime parity, type-check, lint, diff validation, the
renderer line-count check, and the pinned production build pass. A production
preview spot check confirmed that enabling Film Noise changes the displayed
canvas, disabling it restores the original output, and re-enabling it restores
the same deterministic result with no browser errors. The user retains final
visual acceptance, and the calibrated ten-second playback comparison remains
the outstanding performance acceptance step.

## Outcome Goal

Replace the existing `Film Noise` display filter with a deterministic,
procedurally generated Canvas2D grain plate that resembles magnified
photographic silver grain: isolated dots, short worm-like clusters, larger
connected islands, and irregular gaps at several scales.

The replacement must remove Film Noise's per-frame canvas readback and pixel
loop. During playback it should perform at most two cached Canvas2D composites,
remain fixed in document space, and preserve the existing `Opacity`, `Grain
Size`, and legacy saved-project shape in Vessel and Goblet. The serialized
`shadowBias` field remains accepted for compatibility but is no longer exposed
or used by the renderer.

This is a total replacement of the current Film Noise algorithm. The simple
`Noise` filter remains unchanged.

## Reference And Visual Contract

The visual reference is the photomicrograph plate linked from
[Film grain](https://en.wikipedia.org/wiki/Film_grain), particularly its mix of
round grains, bent chains, branching clumps, and uneven open areas. The central
striped specimen in the supplied crop is not part of the target; only the grain
morphology around it is relevant.

At an inspection opacity high enough to expose the pattern, the generated plate
must have:

- isolated rounded grains smaller than the selected base grain size;
- short connected chains built from two to four strongly overlapping lobes;
- larger irregular islands built from five to eight overlapping lobes;
- varied radius, aspect ratio, rotation, and local direction within every
  cluster;
- visibly non-uniform negative space, without an even grid or white-noise field;
- at least three meaningful component-size bands in the default plate;
- clean wrapped edges and no obvious seam;
- no obvious repeated motif within one normal editor viewport at the default
  grain size.

The pattern should borrow the reference's shapes without reproducing its extreme
black-and-white contrast over artwork. Normal use remains subtle and
monochromatic.

## Current Cause And Replacement Boundary

`src/lib/displayFilterPipeline.js` currently creates square random cells at two
scales, reads the complete composited frame with `getImageData()`, calculates a
luma-dependent delta in JavaScript, writes every affected RGB value, and uploads
the result with `putImageData()` on every rendered frame.

That path owns both current problems:

1. square sampled cells do not produce the organic morphology in the reference;
2. full-frame readback, CPU iteration, copying, and upload repeat during every
   color-cycle frame.

The replacement stays in the shared display-filter pipeline. It does not add a
new renderer, worker, shader language, asset, or external dependency.

## Invariants

- Film Noise remains a display-only effect over the final artwork composite.
- The effect never mutates layers, project data, color-cycle buffers, or saved
  artwork pixels.
- Existing Film Noise settings and their serialized shapes remain compatible.
- The grain is deterministic for the same settings and document coordinates.
- The grain is static in document space during playback; animation flicker is
  not introduced.
- Transparent and semi-transparent artwork keeps the established
  background-first compositor behavior.
- Editor overlays, selections, handles, cursors, and guides remain unfiltered.
- Mixed filter stacks preserve their current order.
- Vessel, modular Goblet2, and single-file Goblet2 use the same generated grain
  and compositing contract.
- The existing Canvas2D/CPU fallback remains available; WebGL and WebGPU are not
  required for Film Noise.

## Non-Goals

- Changing the simple `Noise` filter or its appearance.
- Adding film-stock presets, a seed control, color grain, scratches, dust,
  halation, gate weave, or temporal flicker.
- Reproducing photographic chemistry or named film stocks mathematically.
- Adding Python-generated runtime assets or committing the supplied reference
  image.
- Migrating the display-filter stack to WebGL, WebGPU, GLSL, or WGSL.
- Adding new UI controls or changing the existing settings schema.
- Refactoring unrelated filters or splitting the full display-filter pipeline.
- Optimizing legacy Goblet1's renderer fast path. Its generated shared pipeline
  must retain the new appearance, but the performance target is Vessel and
  Goblet2.
- Playwright screenshot baselines or committed PNG evidence.

## Source Ownership

- `src/lib/displayFilterPipeline.js` owns procedural morphology, deterministic
  plate generation, caching, document phase, blend application, mixed-stack
  behavior, and removal of the old CPU pixel kernel.
- `src/lib/displayFilterPipeline.d.ts` owns the typed state and callable
  contracts used by TypeScript callers and tests.
- `src/components/canvas/useDrawingCanvasBaseRenderer.ts` owns selection of the
  direct-overlay path in Vessel and the position of filtering relative to the
  artwork background and editor overlays.
- `public/goblet2/goblet2.js` owns the equivalent Goblet2 direct-overlay route.
- Existing filter state, UI, and persistence remain owned by their current
  files and should not need edits.

## Design

### 1. Replace random cells with a deterministic cluster model

Add a small pure model builder inside `displayFilterPipeline.js`. Given plate
size, Grain Size, and a fixed internal seed, it returns cluster/lobe primitives
without touching a canvas.

Use a deterministic PRNG local to the Film Noise model. Do not use
`Math.random()`.

Populate a seamless plate, initially 768 by 768 source pixels, with fixed
proportions of three cluster families:

- **single grains:** one rounded or elliptical lobe;
- **chains:** two to four overlapping lobes following a short, gently turning
  random walk;
- **islands:** five to eight overlapping lobes with tighter steps and stronger
  size/aspect variation.

Each next lobe must overlap the previous lobe enough to form one organic shape.
Vary aspect ratio and rotation so clusters do not read as bead strings. Render
wrapped copies for lobes that cross any plate edge. Derive cluster count from
plate area and base grain radius, with explicit bounds so the smallest Grain
Size does not create an unbounded amount of draw work.

Preserve the UI's quarter-step Grain Size values instead of rounding Film Noise
to whole-pixel cells. `Grain Size` controls lobe radius and the inverse cluster
count so overall coverage stays broadly stable while morphology becomes coarser.

Start with the 768-pixel plate. Raising it to 1024 is allowed within this plan
only if direct inspection finds visible repetition at a normal viewport and the
two cached plate canvases remain within an 8 MiB combined backing-store budget.

### 2. Build separate cached dark and light plates

Render the model once into two transparent offscreen canvases:

- a dark plate containing black clusters for a `multiply` pass;
- a light plate containing white clusters for a `screen` pass.

Assign cluster polarity deterministically so the two plates are complementary,
not identical passes that cancel each other. Both polarities use the same three
morphology families.

`Opacity` controls the overall strength at composite time and must not rebuild
the morphology. The screen/multiply balance is fixed internally so the dark
silver-grain morphology remains dominant without an additional control.

Cache repeated target overlays by:

- morphology key, including Grain Size and internal model version;
- target width and height;
- document origin modulo the plate dimensions.

Changing only Opacity must reuse the cached morphology and target overlays.
Changing Grain Size rebuilds the plates. Changing target dimensions or document
phase rebuilds only the target overlays.

### 3. Remove the old Film Noise pixel kernel completely

Delete the Film Noise base/clump grid canvases, pattern-data reads,
`Float32Array` combined field, tone lookup, full-frame `ImageData` cache,
per-pixel/block loops, and final `putImageData()` path.

Replace them with named Film Noise helpers that:

- ensure the deterministic dark/light plates;
- ensure phase-aligned cached target overlays;
- apply the multiply and screen composites;
- return whether an effect was applied.

The Film Noise path must not call `getImageData()`, `createImageData()`, or
`putImageData()` on the artwork frame.

### 4. Generalize the direct-overlay fast path

Replace the Noise-specific fast-path terminology with a direct-overlay
contract. A stack qualifies only when exactly one effective filter is enabled
and that filter is either `Noise` or `Film Noise`.

In Vessel and Goblet2:

- composite artwork directly to the visible target;
- apply the cached overlay after artwork compositing and before editor overlays;
- do not allocate, clear, or blit through the generic filter surface or
  ping-pong canvases;
- retain the generic ordered pipeline for mixed stacks.

For a mixed stack, route the Film Noise stage through the same cached plate
helper after copying the current filter result to the next work canvas. This
preserves ordering while still eliminating source readback and JavaScript pixel
processing.

Rename `noiseOnlyTarget` and the corresponding mode string rather than silently
making Noise-specific names mean both filters. Remove directly superseded
Noise-only naming where it is no longer part of the public contract.

### 5. Deterministic and runtime coverage

Tests must prove:

- the same seed/settings produce the same cluster model;
- the model includes single, chain, and island families and meaningful radius,
  aspect, and rotation variation;
- opposing wrapped edges contain the required duplicate lobes without a seam;
- Grain Size changes morphology while Opacity does not regenerate it;
- Film Noise-only selects the direct-overlay route;
- disabled, zero-opacity, and mixed stacks do not incorrectly select it;
- unchanged playback frames reuse both plate and target-overlay caches;
- the Film Noise-only route does not allocate filter/ping-pong surfaces;
- the Film Noise path does not call artwork `getImageData()` or
  `putImageData()`;
- the background/artwork/filter/editor-overlay order remains correct;
- modular and inline Goblet2 contain the same direct-overlay and Film Noise
  helper contract.

Use the pure cluster model for morphology assertions. Do not make the Jest canvas
mock responsible for judging organic visual quality, and do not add fragile
cross-browser pixel hashes.

## File Boundary

Authored implementation and test files, hard limit:

1. `src/lib/displayFilterPipeline.js`
2. `src/lib/displayFilterPipeline.d.ts`
3. `src/components/canvas/useDrawingCanvasBaseRenderer.ts`
4. `public/goblet2/goblet2.js`
5. `src/components/canvas/__tests__/useDrawingCanvasBaseRenderer.test.ts`
6. `tests/goblet-display-filters-runtime.test.ts`

Mechanically generated parity outputs:

1. `public/goblet/displayFilterPipeline.js`
2. `public/goblet/goblet-inline.js`
3. `public/goblet2/displayFilterPipeline.js`
4. `public/goblet2/goblet2-inline.js`

The generated outputs take the implementation above the repository's six-file
guardrail. Implementation must pause for explicit approval of those four
generated files before editing begins. `scripts/build-goblet-runtime.mjs` is not
expected to change because the existing exported entry points can carry the new
internal helpers. If another authored file becomes necessary, stop and revise
the cause and file boundary before touching it.

`useDrawingCanvasBaseRenderer.ts` is currently below its 700-line hard limit.
Recheck it with `wc -l` after the rename and do not move Film Noise generation
or cache logic into that orchestration shell.

## Verification

Run the narrow deterministic checks first:

```bash
npm test -- --runInBand src/components/canvas/__tests__/useDrawingCanvasBaseRenderer.test.ts tests/goblet-display-filters-runtime.test.ts
npm run build:goblet-inline
npm run verify:goblet-runtime
npm run type-check
npm run lint
git diff --check
wc -l src/components/canvas/useDrawingCanvasBaseRenderer.ts
```

Then run the pinned production build:

```bash
mise exec node@22.22.0 -- npm run build
```

### Direct visual inspection

In the production preview, inspect Film Noise over:

- a flat 50% gray document to judge the grain plate itself;
- a black-to-white tonal ramp to judge the fixed dark/light balance;
- transparent and semi-transparent artwork to confirm compositor order;
- moving color-cycle artwork to confirm document locking.

Compare the high-opacity inspection view against the reference morphology. The
user owns final visual acceptance. No screenshot baseline or committed capture
is required.

### Performance measurement

Use the same viewport, DPR, Grain Size, and color-cycle project for both runs.
After a two-second warm-up, record ten seconds with Film Noise disabled and ten
seconds enabled. Capture median and p95 frame duration with one consolidated
production-preview measurement.

Acceptance requires:

- no artwork-frame `getImageData()` or `putImageData()` from Film Noise;
- no plate or target-overlay rebuild during unchanged playback frames;
- at most two Film Noise composite operations per frame;
- no generic filter surface or ping-pong allocation for Film Noise-only;
- Film Noise adds no more than 10% to median frame duration in the same warmed
  playback workload;
- mixed stacks keep their existing order and remain functional.

## Exit Criteria

The redesign is complete when:

1. the old Film Noise CPU pixel kernel and its obsolete state are removed;
2. the deterministic plate exhibits all required morphology families without
   grid cells, seams, or obvious default-view repetition;
3. all three existing controls have visible, stable, and compatible behavior;
4. Vessel and Goblet2 use the direct cached path for Film Noise-only;
5. focused tests, runtime parity, type-check, lint, diff check, line-count check,
   and the production build pass;
6. the performance measurement meets the stated limit; and
7. the user accepts the visual result in the live production preview.

If the cached Canvas2D implementation misses the performance target, stop and
report the measured cost. Do not add WebGL or WebGPU in this change. A shader
prototype requires a separate plan and explicit scope decision.
