# Film Noise Grain-Field Plan (supersedes plate ellipse rendering)

Last updated: 2026-07-16

Status: implemented; deterministic verification complete for the 2026-07-16
Amount and Grain Tone calibration; user visual acceptance and the 25 ms
plate-rebuild target remain open

## Implementation result

Implemented on 2026-07-15 within the approved authored and generated file
boundary. The plate renderer now builds separate deterministic dark/light
scalar fields, sums anisotropic soft lobe splats, applies periodic density
modulation plus coordinate-hash edge jitter, and uploads one thresholded
`ImageData` per cached plate. Explicit bridge geometry and its wrapped-segment
helper are removed. The former `connectFrom` rendering field is retained as the
topology-only `parentIndex` so tests can prove intended chain and branch necks.

Deterministic combined coverage passes at Grain Size 1, 1.5, and the authored
maximum 2.65 within the 14–22% target, with each balanced polarity plate
independently within 6–12%. The legacy runtime value 8 remains covered for
backward compatibility. The recalibrated fixed 64-pixel fixture checksum is
`2260246826`.

The 2026-07-16 compositing follow-up renamed the visible control from Opacity
to Amount while retaining the serialized `opacity` field for compatibility.
Cluster polarity is now split evenly between dark and light. The existing
raster traversal records each plate's mean alpha, and the compositor scales
the multiply/screen passes to the lower measured mean so neither polarity can
dominate the average tone. Amount uses a smoothstep response for finer control
at low settings. A full 768-by-768 composite over RGB 128 gray at 100% Amount
keeps the mean channel within one level of the input. Amount changes continue
to reuse cached morphology and overlays; the per-frame path remains two draws
with zero artwork readback. Focused UI/renderer/runtime tests, Goblet parity,
type-check, lint, diff validation, and the pinned production build pass.

The Grain Tone follow-up adds a distinct persisted `tone` setting from `-1`
(black/multiply only) through `0` (balanced) to `1` (white/screen only).
Existing projects without `tone` sanitize to balanced, while the deprecated
`shadowBias` field remains compatibility-only. Tone reassigns the already-
cached fields between black/multiply and white/screen after their mean-alpha
calibration, so it does not rebuild plates or target overlays and adds no
artwork readback. At either endpoint both fields render in the selected colour,
preserving the balanced center's combined grain density instead of discarding
half the morphology. Intermediate values crossfade one field between operations
and use three cached overlay draws; the center and endpoints use two. A scoped
review also corrected the prior UI label swap so simple Noise remains Opacity
and Film Noise exposes Amount.

The 2026-07-16 morphology calibration packs grain centers closer without
changing Grain Size, field thresholding, or compositing. Cluster density is
about `1.88x` the prior model, the deterministic family mix is now 50% singles,
35% short chains, and 15% islands, chains contain 3–6 lobes, and islands contain
6–10 lobes. This replaces large clumps with more individual grains and short
marks while keeping total lobe work near the previous model. The model version
is bumped so existing cached plates rebuild with the denser morphology.

The 2026-07-15 production-preview inspection over flat 50% gray confirmed
ragged thresholded boundaries, merged waists, irregular blobs/strands, sparse
satellites, no constant-width bridge strokes, and no browser errors. Disabling
Film Noise restores the flat surface; re-enabling it reproduces the same Size 8
surface byte-for-byte (matching SHA-256 capture hashes). That inspection
predates the balanced-polarity Amount calibration; final subjective comparison
against the reference remains user-owned.

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
`plan-film-noise-canvas2d-redesign-2026-07-15.md`. The Amount and Grain Tone
follow-ups also supersede that plan's fixed dark-dominant balance and no-extra-
control decisions. The cached dark/light plates, overlay caching,
direct-overlay fast path, settings compatibility, invariants, non-goals, and
per-frame performance contract remain unchanged.

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

Unchanged by the grain-field renderer replacement:

- `createFilmGrainPlateModel` cluster/lobe geometry: deterministic PRNG,
  single/chain/island families, colonies, 0.05-step Grain Size, wrap logic,
  and cluster-count bounds. The later morphology calibration adjusts only the
  population and family proportions within this seam. Rename the
  rendering-oriented `connectFrom` field to topology-only `parentIndex`; retain
  it until field-connectivity tests prove every intended chain and branch neck.
- `ensureFilmGrainPlates` cache keys, `ensureFilmGrainOverlays` target-overlay
  cache, and `applyFilmGrainOverlay` multiply/screen composite architecture.
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

Calibrate combined dark/light coverage to 14–22% occupied area at Grain Size
1, 1.5, and the authored maximum 2.65, with each polarity plate independently
within 6–12%, where occupied means `alpha >= 128`. Retain coverage at legacy
runtime value 8 for backward compatibility. The reference is denser but is an
extreme-contrast micrograph; normal use composites at low Amount, so morphology
rather than absolute density is the target. Split deterministic cluster
polarity evenly so the two passes begin from comparable populations.

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
- Grain Size rebuilds the plate; Amount does not (existing cache-key tests
  keep passing).
- Grain Tone `-1`, `0`, and `1` resolve to black-only, balanced, and white-only
  operations without changing either morphology or overlay cache key; both
  fields remain visible at the endpoints so coverage density is preserved.
- Rasterization records both plates' mean alpha. At composite time, scale both
  passes to the lower measured mean and verify a full-plate RGB 128 fixture
  drifts by no more than one channel level at 100% Amount.
- Default-size coverage fraction within the calibrated band.
- Remove bridge-segment tests along with the bridge code.
- Runtime parity tests for modular/inline Goblet2 keep asserting the shared
  helper contract (helper names unchanged where possible).

## File boundary

Authored (hard limit for the 2026-07-16 Grain Tone follow-up):

1. `src/lib/displayFilterPipeline.js`
2. `src/lib/displayFilters.ts`
3. `src/types/index.ts`
4. `src/components/canvas/__tests__/useDrawingCanvasBaseRenderer.test.ts`
5. `src/components/panels/DisplayFiltersSection.tsx`
6. `src/components/panels/__tests__/DisplayFiltersSection.test.tsx`
7. `src/stores/__tests__/canvasSlice.test.ts`
8. `docs/refactor/plan-film-noise-grain-field-2026-07-15.md`

`useDrawingCanvasBaseRenderer.ts` and `goblet2.js` should need **no edits** —
the direct-overlay route consumes the same plate canvases.

Mechanically generated parity outputs (approval already granted in the prior
plan; regenerate, do not hand-edit):

1. `public/goblet/displayFilterPipeline.js`
2. `public/goblet/goblet-inline.js`
3. `public/goblet2/displayFilterPipeline.js`
4. `public/goblet2/goblet2-inline.js`

Bump `FILM_GRAIN_MODEL_VERSION` for the morphology change so stale cached
plates cannot survive. Grain Tone alone does not change the model version or
invalidate morphology caches.

## Verification

Same battery as the prior plan:

```bash
npm test -- --runInBand src/components/canvas/__tests__/useDrawingCanvasBaseRenderer.test.ts src/components/panels/__tests__/DisplayFiltersSection.test.tsx src/stores/__tests__/canvasSlice.test.ts tests/goblet-display-filters-runtime.test.ts
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
   on Amount or Grain Tone changes or during unchanged playback frames.
5. Grain Tone reaches black-only and white-only endpoints while preserving the
   existing balanced center behavior.
6. User accepts the visual result in the production preview.
