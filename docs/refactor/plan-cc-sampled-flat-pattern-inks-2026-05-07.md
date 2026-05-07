# CC Sampled Flat Pattern Ink Plan

## Goal

Make every pattern selected from the Patterns dropdown preserve color-cycle behavior when `Colors` is set to `1`.

`Colors` controls the number of output inks. It does not control how many colors are sampled from the source.

When sampled mode is on, source sampling must stay full-fidelity. When `Colors = 1`, the output should resolve to the same flat two-ink color-cycle path that Sierra Lite already uses: two animated CC ink indices, full sampled source ownership, and pattern-specific spatial distribution.

## Current Problem

The current code has two meanings coupled together:

- sampled source capture
- output ink/pattern rendering

For sampled CC, `Colors = 1` can be interpreted too late as one flat sampled color or one static ink. That is not the intended contract.

The intended contract is:

- `Samples` controls source capture density.
- `Colors` controls output ink structure.
- `Colors = 1` means one flat target rendered with two CC inks.
- The selected pattern controls where the two inks appear.

## Terms

- Source samples: colors captured from the canvas in sampled mode.
- Output inks: CC palette indices written into the layer's color-cycle buffers.
- Flat pattern mode: `Colors = 1`, where a sampled target is rendered through two animated CC inks.
- Pattern writer: the selected spatial algorithm, such as Sierra Lite, dots, lines, object repeats, or future portrait-relative patterns.

## Non-Negotiable Behavior

1. `Colors` controls inks, not sampling.
2. `Samples` and sampled-session data remain full-fidelity when sampled mode is on.
3. `Colors = 1` routes every flat-mode pattern through a two-ink CC writer.
4. The written pixels keep CC metadata and animation/playback behavior.
5. Sierra Lite is the reference behavior, not a one-off special case.
6. Future Patterns dropdown entries should inherit this behavior without adding new sampled-color branches.
7. `Colors > 1` stays on the existing multi-band path unless a focused test proves it needs adjustment.
8. Do not change renderer behavior to fake the result.
9. Do not add jitter/noise as a workaround for missing CC signal.
10. A sufficiently large active area with a non-extreme mix should show both resolved inks; tiny shapes may legitimately show one visible ink, but they must still use the two-ink CC writer.

## Current High-Signal Code Paths

- `src/utils/colorCycle/ccDitherRenderPalette.ts`
  - `resolveCcDitherBandMode(...)` maps `Colors = 1` to flat mode with `pairBandCount: 0` and `quantLevels: 1`.
  - `buildCcDitherRuntimePalette(...)` builds the runtime palette, including the Sierra Lite flat contrast palette.

- `src/utils/colorCycle/ccGradientDither.ts`
  - `fillCcGradientDither(...)` routes `pairBandCount > 0`, `levels === 1`, and multi-level paths.
  - The `levels === 1` branch is the key flat pattern route.
  - `resolveSampledFlatPositionMix(...)` resolves sampled flat target, mix, and low/high ink indices.

- `src/utils/colorCycle/ccFlatModePatterns.ts`
  - `fillFlatPatternMode(...)` dispatches flat pattern output.
  - `fillSierraLiteFlatPatternMode(...)` already demonstrates the desired two-ink flat CC behavior.
  - `resolveCcPatternThreshold(...)` and `PatternStyle` values define the non-Sierra pattern surface that must keep using the same low/high ink payload.

- `src/hooks/canvas/handlers/colorCycle/ccSampling.ts`
  - `buildSampledStops(...)` must keep normal sampled source capture.
  - The single-point fallback can synthesize animated two-ink stops, but normal sampled paths must not be reduced because `Colors = 1`.

- Shape preview/finalize callers:
  - `src/hooks/canvas/handlers/shapes/ccShapePreviewDitherRuntime.ts`
  - `src/hooks/canvas/handlers/colorCycle/colorCycleShapeFill.ts`
  - These must pass sampled stops/config consistently so preview and final commit use the same flat pattern contract.

## Proposed Design

### 1. Separate Source Sampling From Output Ink Resolution

Keep sampled source capture independent from `Colors`.

`buildSampledStops(...)` should continue using the sampled path's normal sample count rules. If a sampled stroke or shape gathers many source samples, those stops remain available to session/runtime/persistence even when `Colors = 1`.

`Colors = 1` only affects the output resolver:

```text
full sampled stops -> representative flat target -> two CC ink indices -> selected pattern writer
```

### 2. Introduce A Shared Flat Pattern Payload

Create a small typed payload for `Colors = 1` pattern writers.

Possible shape:

```ts
type CcFlatPatternInkPayload = {
  targetColor: string;
  targetRgb: [number, number, number];
  flatPosition: number;
  flatMix: number;
  lowIndex: number;
  highIndex: number;
  sampledSourceStops?: StoredStop[];
  flatSeed?: number;
  spread?: number;
  ditherPatternDiversity?: number;
};
```

The payload is resolved once in the flat branch and passed to the selected pattern writer.

### 3. Make `Colors = 1` Use A Generic Two-Ink Flat Route

The `levels === 1` branch in `fillCcGradientDither(...)` should route all supported patterns through `fillFlatPatternMode(...)`.

For sampled mode, the branch should:

1. Resolve full sampled source stops.
2. Compute the representative sampled target.
3. Resolve `lowIndex`, `highIndex`, and `flatMix`.
4. Pass that data to the selected pattern writer.

Sierra Lite remains the reference implementation. Other existing and future pattern writers use the same `lowIndex` and `highIndex` and only change spatial distribution.

### 4. Keep Pattern Dropdown Semantics Narrow

The Patterns dropdown chooses only spatial distribution.

It should not:

- change source sample count
- collapse sampled stops
- decide whether output is animated CC
- create its own sampled target rules

Future object or portrait-relative patterns should be implemented as new pattern writers that consume the same flat payload.

### 5. Add A Pattern Registry Contract

There are two related selectors in the UI:

- `ditherAlgorithm`
- `patternStyle`

The visible Patterns dropdown maps to `patternStyle`, and it is shown when `ditherAlgorithm === 'pattern'`.

The plan must handle these as separate concerns:

- `ditherAlgorithm` selects the broad algorithm family.
- `patternStyle` selects the spatial pattern inside the `pattern` family.
- Every `PatternStyle` union member must be covered by flat-mode tests.
- Adding a new Patterns dropdown entry requires adding or updating a flat-mode pattern writer test.
- Unknown pattern values should route through a deliberate, tested fallback or fail in tests; they should not silently fall through to accidental one-ink/static behavior.

### 6. Preview And Finalize Must Match

Review the current preview exclusion in the sampled flat branch. If preview avoids sampled-session mutation for stability, keep that protection, but do not make preview fall back to a one-ink or static color path.

The preferred rule:

- preview may use explicit `sampledStopsOverride`
- when preview has `sampledStopsOverride`, it must still use the two-ink sampled flat path
- preview must not mutate sampled session state during drag
- finalize persists the full sampled session/source data
- both preview and finalize use the same flat two-ink pattern payload when `Colors = 1`

## Implementation Steps

Status: implementation completed for the current pattern set on 2026-05-07. Future portrait-relative/object pattern entries still need their own writer/tests when those dropdown values are added.

Follow-up completed: sampled source capture now uses the CC sampled-gradient sampler budget instead of the generic six-stop auto-sample cap, so the Sampled Gradient Live UI and sampled session data can carry richer source stops before `Colors = 1` resolves them to two output inks. The first budget was 32 stops at 16px spacing; it was reduced to 16 stops at 32px spacing after live testing showed the animated color shifts felt too steppy.

Follow-up completed: sampled shape finalize now keeps the reduced flat render palette separate from sampled source stops. Final fill options, sampled slot persistence, and the post-commit runtime palette use the sampled source stops, so a `Colors = 1` pattern can render with two inks without collapsing the Sampled Gradient Live UI data to the flat render palette.

Follow-up completed: the sampled flat ink target now uses a tone-trimmed representative sample instead of a raw average. For five or more sampled stops, the darkest and lightest outliers are trimmed before averaging RGB, which keeps the two selected inks closer to the dominant sampled region and reduces abrupt color-cycle jumps.

### Step 1: Add Regression Tests First

Status: done.

- [x] Add focused tests around `fillCcGradientDither(...)` and sampled stop construction.

Required cases:

1. [x] `Colors = 1`, sampled source, Sierra Lite:
   - [x] uses resolved low/high CC ink indices
   - [x] shows both inks on a sufficiently large deterministic active area with a non-extreme mix
   - [x] does not collapse to one solid index or static raster/color fallback

2. [x] `Colors = 1`, sampled source, `ditherAlgorithm === 'pattern'`:
   - [x] covers at least one concrete `patternStyle` value first
   - [x] uses resolved low/high CC ink indices
   - [x] shows both inks on a sufficiently large deterministic active area with a non-extreme mix
   - [x] changes distribution according to the selected pattern

3. [x] `Colors = 1`, sampled source, all current `PatternStyle` values:
   - [x] every current union member has flat-mode coverage or a deliberate tested fallback
   - [ ] adding a future dropdown pattern should require updating this coverage

4. [x] `Colors = 1`, sampled source with multiple sampled stops:
   - [x] keeps the multi-stop source data available
   - [x] output still resolves to two CC inks
   - [x] uses dense CC sampled-gradient stops instead of the generic six-stop cap

5. [x] Preview path with `sampledStopsOverride`:
   - [x] avoids sampled-session mutation
   - [x] still uses the two-ink sampled flat writer
   - [x] does not fall back to one ink/static color because the trace stage is preview

6. [x] `Colors > 1`:
   - [x] remains on the current multi-band path
   - [x] does not use the flat two-ink route

7. [x] Preview/finalize parity:
   - [x] preview and finalized output use the same low/high ink contract for the same sampled source and pattern settings

8. [x] CC metadata:
   - [x] paint index buffer is written
   - [x] phase data is written when expected
   - [x] gradient def id or slot palette ownership remains aligned with written indices
   - [x] sampled source stops remain attached to the session/commit data

### Step 2: Extract The Flat Payload Resolver

Status: done.

- [x] Move the sampled flat target/ink resolution into a named helper.

Suggested helper:

```ts
resolveCcSampledFlatPatternPayload(...)
```

- [x] Keep it pure where possible. Store/session reads stay at the boundary, with explicit sampled stops passed in when the caller already has them.

### Step 3: Generalize `fillFlatPatternMode(...)`

Status: done.

- [x] Keep the current API compatible, but treat `flatLowIndex`, `flatHighIndex`, and `flatMix` as the generic two-ink flat pattern payload.

- [x] Sierra Lite continues to use its error diffusion implementation.

- [x] Ordered/current pattern modes use the same low/high indices and mix instead of deriving a one-color/static result.

### Step 4: Wire Pattern Dropdown Values To Writers

Status: current pattern set done; future dropdown values still require follow-up tests/writers when added.

- [x] Confirm how `patternStyle` and `ditherAlgorithm` map from the UI.

For existing non-Sierra patterns:

- [x] if the pattern is already supported by `fillFlatPatternMode(...)`, update it to consume the shared payload
- [x] if it is not supported yet, add a narrow writer that chooses between `lowIndex` and `highIndex`
- [x] cover each current `PatternStyle` union member with a flat-mode test or a deliberate tested fallback

For future portrait-relative object patterns:

- [ ] add them as new writer cases behind the dropdown value
- [ ] consume the same payload
- [ ] keep source sampling untouched

### Step 5: Fix Preview/Finalize Routing

Status: done for current preview/finalize sampled flat routing.

- [x] Audit:

  - [x] `ccShapePreviewDitherRuntime.ts`
  - [x] `colorCycleShapeFill.ts`
  - [x] any sampled shape/stroke replay path that passes `sampledStopsOverride`

- [x] Ensure `Colors = 1` does not suppress full sampling or route preview through a static fallback.

### Step 6: Validate Persistence And Runtime Metadata

Status: done.

- [x] CC paint index buffer is written
- [x] phase data is still written when expected
- [x] gradient def/slot metadata stays aligned
- [x] sampled source stops remain attached to the session/commit data
- [x] save/load and Goblet export paths do not see a static raster-only replacement

## Test Commands

Start focused:

- [x] `npm test -- --runInBand src/utils/colorCycle/__tests__/ccGradientDither.test.ts`
- [x] `npm test -- --runInBand src/hooks/canvas/handlers/colorCycle/__tests__`

Then run standard verification:

- [x] `npm run type-check`
- [x] `npm run lint`
- [x] `npm test -- --runInBand`

## Definition Of Done

- [x] `Colors = 1` means flat two-ink CC output for every supported pattern.
- [x] Sampled mode keeps full sampled source data even when `Colors = 1`.
- [x] The Patterns dropdown changes spatial distribution only.
- [x] Sierra Lite and other pattern modes share the same flat sampled ink resolver.
- [x] `Colors > 1` behavior is unchanged unless explicitly covered by tests.
- [x] Preview and finalize match for sampled flat pattern output.
- [x] Preview with explicit sampled stops uses the two-ink sampled flat path without mutating sampled session state.
- [x] Focused tests cover Sierra Lite, each current `PatternStyle` value or a deliberate fallback, sampled multi-stop input, metadata alignment, preview override behavior, and multi-band non-regression.
- [x] Type-check and lint pass.
