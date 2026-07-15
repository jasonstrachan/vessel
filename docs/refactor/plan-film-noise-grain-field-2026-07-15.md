# Film Noise Grain-Field Plan (supersedes plate ellipse rendering)

Last updated: 2026-07-15

Status: implemented; deterministic and production-preview verification
complete; user visual acceptance and the 25 ms plate-rebuild target remain
open

## Implementation result

Implemented on 2026-07-15 within the approved authored and generated file
boundary. The plate renderer now builds separate deterministic dark/light
scalar fields, sums anisotropic soft lobe splats, applies periodic density
modulation plus coordinate-hash edge jitter, and uploads one thresholded
`ImageData` per cached plate. Explicit bridge geometry and its wrapped-segment
helper are removed. The former `connectFrom` rendering field is retained as the
topology-only `parentIndex` so tests can prove intended chain and branch necks.

Deterministic coverage passes at Grain Size 1, 1.5, and 8. Measured dark-plate
coverage (`alpha >= 128`) is approximately 18.15%, 18.09%, and 17.55%
respectively. The fixed 64-pixel fixture checksum is `2714665275`. Focused
tests, Goblet runtime parity, type-check, lint, diff validation, and the pinned
production build pass.

Production-preview inspection over flat 50% gray at 100% opacity confirms
ragged thresholded boundaries, merged waists, irregular blobs/strands, sparse
satellites, no constant-width bridge strokes, and no browser errors. Disabling
Film Noise restores the flat surface; re-enabling it reproduces the same Size 8
surface byte-for-byte (matching SHA-256 capture hashes). Final subjective
comparison against the reference remains user-owned.

The warmed ten-second playback comparison passed: disabled and enabled runs
each recorded 601 frames with a 16.7 ms median. Enabled p95 was 17.7 ms and
disabled p95 was 18.1 ms, so measured median overhead was 0% in this workload.

A post-implementation review restored the exported `noise-only` filter-list
mode with its original Noise-only semantics while retaining
`direct-overlay-only` for Noise and Film Noise, avoiding a public API break for
existing modular and generated-runtime consumers.

The one-time rebuild target did not pass and is not treated as complete. A
six-run Node CPU breakdown measured Grain Size 1 at 46–60 ms warm after a
117 ms cold run, excluding canvas upload; Grain Size 8 measured 13–15 ms warm.
The production-preview control-to-second-frame measurement recorded a 121.6 ms
Size 1 update with a 120 ms long task and a 53.8 ms Size 8 update with a 52 ms
long task. Achieving a 25 ms complete rebuild would require a follow-up beyond
this field-rasterizer replacement, most likely worker/off-main-thread plate
construction or a materially different model representation.

Supersedes the plate *rendering* section of
`plan-film-noise-canvas2d-redesign-2026-07-15.md`. Everything else in that plan
— the cached dark/light plates, overlay caching, direct-overlay fast path,
settings compatibility, invariants, non-goals, file boundary, and the per-frame
performance contract — is already implemented in the working tree, verified,
and is **kept unchanged**.

## Why another pass

Three visual iterations of the ellipse-lobe renderer (sparse dust → colonies →
explicit round-capped bridges) still read as beads and stroked worms, not like
the reference photomicrograph. The failure is structural, not a tuning problem:

- A filled ellipse has a mathematically clean boundary. Real grain boundaries
  are ragged at the pixel scale.
- Two overlapping ellipses meet in a concave cusp; the eye reads "two beads
  touching". Real merged grains form one convex-ish blob with a smooth waist.
- Stroked connection lines have constant width and parallel edges — nothing in
  the reference has parallel edges.

No amount of count/size/bridge tuning fixes those three properties. The fix is
to stop drawing shapes and instead **accumulate a scalar field and threshold
it** (metaball-style). Overlapping grains then merge into single organic blobs
with smooth waists automatically, and a per-pixel jitter term before the
threshold gives ragged edges and satellite micro-specks — the two signature
qualities of the reference.

## What changes and what does not

Unchanged (already fast, keep as-is):

- `createFilmGrainPlateModel` cluster/lobe geometry: deterministic PRNG,
  single/chain/island families, colonies, quarter-step Grain Size, wrap logic,
  and cluster-count bounds. Rename the rendering-oriented `connectFrom` field
  to topology-only `parentIndex`; retain it until field-connectivity tests prove
  every intended chain and branch neck.
- `ensureFilmGrainPlates` cache keys, `ensureFilmGrainOverlays` target-overlay
  cache, `applyFilmGrainOverlay` multiply/screen composites and opacity math.
- Direct-overlay route in Vessel and Goblet2; mixed-stack ordering.
- Per-frame cost: still at most two cached composites, zero readback.

Replaced:

- `renderFilmGrainPlate` (ellipse fills + bridge strokes) becomes a field
  rasterizer. The bridge segments and
  `getFilmGrainWrappedConnectionSegments` are deleted — field summation
  supersedes explicit bridges. `getFilmGrainWrappedLobePositions` stays (splats
  still wrap).

## Design

### 1. Field accumulation (one-time, at plate build)

In `displayFilterPipeline.js`, add a pure `buildFilmGrainFields` helper that
takes the existing cluster model and returns two `Float32Array` fields of
`plateSize * plateSize`: `{ darkField, lightField }`.

- For each lobe, splat an anisotropic soft falloff into its polarity field over
  the lobe's bounding box only. Scale the support radii by `1.6`, rotate/scale
  the sample coordinate by those radii, and use
  `max(0, 1 - d^2)^2 * lobe.strength`. **Sum** contributions so nearby lobes
  merge like metaballs. The wider soft support creates a field neck without
  inflating the final thresholded radius or reintroducing connector geometry.
- Chain/island lobes already overlap by construction, so chains become
  continuous bent strands and islands become branching clumps without any
  bridge geometry. Tighten chain center steps to `0.5–0.9 * Grain Size` and
  island steps to `0.4–0.8 * Grain Size`; the prior wider bounds leave rare
  subpixel gaps at Grain Size 1 after bridge removal.
- Splat wrapped copies via `getFilmGrainWrappedLobePositions` for seamlessness.

Cost bound: work is proportional to total lobe area, which the existing
inverse-area density rule already keeps roughly constant across Grain Size.
Measure the complete synchronous plate rebuild — model, both fields, threshold
modulation, both alpha rasters, both `ImageData` writes, and both uploads — not
field accumulation alone. Target ≤ 25 ms warm at Grain Size 1 and 8 on the
development machine; if that target fails, do not conceal it behind a looser
partial measurement. Record the measured result and keep rebuilds entirely out
of the per-frame path.

### 2. Threshold with jitter and local density modulation

Second pure `rasterizeFilmGrainFields` step converts both fields to dark/light
alpha coverage in one pixel traversal:

- **Local threshold modulation:** precompute an 8-by-8 periodic value-noise
  lattice with wrapped lattice coordinates, then bilinearly sample it with a
  smooth interpolation curve. Shift the base threshold `0.42` by at most
  `±0.035`. This
  produces the reference's uneven density — dense colonies fading into open
  areas — more convincingly than colony placement alone.
- **Edge raggedness:** add deterministic integer-coordinate hash jitter with a
  total amplitude of `0.045` to the field before thresholding. This must roughen
  near-threshold boundaries without turning open areas into uniform pepper.
  Satellite specks remain a visual acceptance target rather than an automatic
  consequence claimed by the algorithm.
- **Soft threshold:** `alpha = smoothstep(t, t + 0.07, field + jitter)` so edges
  are softly quantized rather than vector-crisp.

Calibrate dark-plate coverage to 14–22% occupied area at Grain Size 1, 1.5, and
8, where occupied means `alpha >= 128` (reference is
denser but is an extreme-contrast micrograph; normal use composites at low
opacity — morphology, not absolute density, is the target). Light plate uses
the same field pipeline for its own (much smaller) cluster population,
unchanged polarity assignment.

### 3. Write plates once

Rasterize the alpha array into each plate canvas through a plate-local
`ImageData` (black or white RGB, alpha from the field) and one `putImageData`
per plate **at plate build only**. The existing prohibition on
`getImageData`/`putImageData` applies to the artwork frame and per-frame work;
a one-time plate upload is explicitly allowed. Downstream overlay/composite
code is untouched.

### 4. Determinism and tests

Adapt in place (same test files as the prior plan's boundary):

- Same seed/settings → identical fields and alpha rasters; freeze a small
  accepted alpha-raster checksum after calibration.
- A small pure-field two-lobe fixture has one component and a thresholded waist
  at least 65% as wide as the narrower lobe center. Connectivity alone is not
  sufficient because the superseded ellipse union was already connected.
- Generated parent/child topology retains a field neck at the calibrated
  threshold. If a connection fails, repair lobe support or placement rather
  than restoring a drawn bridge.
- A lobe centered on a plate boundary produces symmetric field values on both
  sides. Periodic density modulation wraps its lattice indices; do not require
  arbitrary rows or columns `0` and `N-1` to be identical.
- Grain Size rebuilds the plate; Opacity does not (existing cache-key tests
  keep passing).
- Default-size coverage fraction within the calibrated band.
- Remove bridge-segment tests along with the bridge code.
- Runtime parity tests for modular/inline Goblet2 keep asserting the shared
  helper contract (helper names unchanged where possible).

## File boundary

Authored (hard limit, same list as the prior plan):

1. `src/lib/displayFilterPipeline.js`
2. `src/lib/displayFilterPipeline.d.ts`
3. `tests/goblet-display-filters-runtime.test.ts`
4. `src/components/canvas/__tests__/useDrawingCanvasBaseRenderer.test.ts`

`useDrawingCanvasBaseRenderer.ts` and `goblet2.js` should need **no edits** —
the direct-overlay route consumes the same plate canvases.

Mechanically generated parity outputs (approval already granted in the prior
plan; regenerate, do not hand-edit):

1. `public/goblet/displayFilterPipeline.js`
2. `public/goblet/goblet-inline.js`
3. `public/goblet2/displayFilterPipeline.js`
4. `public/goblet2/goblet2-inline.js`

Bump `FILM_GRAIN_MODEL_VERSION` so stale cached plates cannot survive.

## Verification

Same battery as the prior plan:

```bash
npm test -- --runInBand src/components/canvas/__tests__/useDrawingCanvasBaseRenderer.test.ts tests/goblet-display-filters-runtime.test.ts
npm run build:goblet-inline
npm run verify:goblet-runtime
npm run type-check
npm run lint
git diff --check
mise exec node@22.22.0 -- npm run build
```

Visual inspection at high opacity over flat 50% gray against the reference,
checking specifically for the three failure properties: no clean ellipse
boundaries, no bead cusps at overlaps, no parallel-edged connectors. Plus the
existing ramp / transparency / color-cycle-locking checks.

Performance acceptance is unchanged from the prior plan (≤10% median frame
cost and no per-frame rebuilds). Additionally measure the complete cold and
warm plate build at Grain Size 1 and 8, report every included phase, and compare
the warm total with the 25 ms target. The per-frame result is expected to remain
unchanged, but it is still measured rather than assumed.

## Exit criteria

1. Thresholded-field plates replace ellipse/bridge rendering; bridge code
   removed.
2. High-opacity inspection shows ragged-edged merged blobs, strands, clumps,
   satellite specks, and uneven negative space matching the reference
   morphology.
3. All prior invariants (determinism, seamlessness, cache behavior, direct
   overlay, settings compatibility, parity) still pass.
4. Complete build timing is recorded at Grain Size 1 and 8; no rebuild occurs
   on Opacity changes or during unchanged playback frames.
5. User accepts the visual result in the production preview.
