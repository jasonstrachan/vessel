# Plan: reset only the flat sampled solve contract

## Recommendation up front

Yes: reset the **flat sampled solve contract** in `resolveSampledFlatPositionMix(...)`.

Do **not** reset the broader sampled branch, sampled session plumbing, or runtime palette system.

What to reset:
- the overlapping pair-selection logic inside `src/utils/colorCycle/ccGradientDither.ts`
- the part of sampled-flat solve that mixes multiple ideas about where the low/high pair should come from
- any solver behavior where sampled-flat pair selection depends on helper reuse that is not specific to the flat sampled solve contract

What to leave alone for now:
- sampled session capture
- sampled preview/finalize plumbing
- runtime snapshot/session binding machinery
- `buildCcDitherRuntimePalette(...)`
- `resolveFlatSierraBandPairs(...)`
- non-flat sampled behavior
- FG behavior

The reason is simple: the current highest-risk seam is not the whole sampled pipeline. It is the sampled-flat pair-selection block inside `resolveSampledFlatPositionMix(...)`.

---

## Goal

Rebuild the flat sampled Sierra solve path so it has one clean contract:

1. sample the target color from the real sampled stops
2. choose the flat ink pair from sampled-flat position logic
3. build one optical low/high pair around that target
4. project the target onto that pair to get one stable `flatMix`
5. feed pair + mix into the existing flat pattern engine

No broad sampled-branch rollback.
No first-pass rewrite of runtime palette generation.
No first-pass rewrite of band-pair helpers.
No overlapping pair-builder policy inside the sampled-flat solver.

---

## Scope

This reset applies only to:

- sampled source
- shape fills
- flat branch
- `clampedLevels === 1`
- `algorithm === 'sierra-lite'`
- sampled-flat solve logic inside `resolveSampledFlatPositionMix(...)`

Do not change:

- non-flat paths
- `clampedLevels > 1`
- FG path
- sampled session lifecycle outside flat solving
- general runtime palette use outside flat sampled Sierra
- `buildCcDitherRuntimePalette(...)` behavior, except for debug logging or narrow regression tests
- `resolveFlatSierraBandPairs(...)` behavior, except for debug logging or narrow regression tests

---

## Problem statement

The current sampled-flat path still carries too many overlapping ideas in one block:

- real sampled stops as the target source
- optional `sampledSourceStops` as a second source of truth
- monochrome/runtime spread fallback behavior
- 2-stop sampled-family pair construction
- generic target-centered contrast construction

That overlap makes the solver hard to reason about and easy to destabilize.

This refactor should treat sampled-flat solve as its own contract, not as a thin wrapper over older helper behavior.

---

## Phase 1 - narrow reset of the sampled-flat solver

## 1. Keep the reset inside `resolveSampledFlatPositionMix(...)`

In `src/utils/colorCycle/ccGradientDither.ts`:

Focus the refactor on the pair-selection block inside `resolveSampledFlatPositionMix(...)`.

Do not start by rewriting:
- `buildCcDitherRuntimePalette(...)`
- `resolveFlatSierraBandPairs(...)`
- broader sampled session code

Those systems can stay stable unless a narrow failing test proves they are still feeding bad data into flat sampled solve.

### Expected result

The sampled-flat solver becomes a single understandable unit:
- one target source
- one pair-selection policy
- one `flatMix` projection path

---

## 2. Make `stops` the target source of truth

Inside `resolveSampledFlatPositionMix(...)`:

- `stops` must remain the source of truth for `targetRgb`
- `targetRgb` must be sampled from the real sampled stops passed into the solver
- `sampledSourceStops` may remain only as optional debug/reference context if still needed

### Explicit rule

Do not let the solver choose target color from an alternate synthetic stop source.

### Expected result

Solver logs always describe the target color as coming from the real sampled stops used for the solve.

---

## 3. Replace the overlapping pair-selection policy with one flat-only policy

The current block mixes several pair-builder strategies.

Replace that with one explicit sampled-flat policy:

1. compute `targetRgb` from real sampled stops
2. compute `lowIndex/highIndex` from `resolveSampledFlatInkSetForPosition(...)`
3. derive `spreadDistance` from that pair span
4. build exactly one optical pair for sampled-flat solve
5. project `targetRgb` onto that pair to get `flatMix`

This refactor is about unifying the pair-selection contract, not changing the flat pattern writer.

### Expected result

When reading the solver, there should no longer be ambiguity about which pair-builder won for a given sampled-flat case.

---

## Phase 2 - define the replacement solver contract

## 4. New sampled-flat solve contract

In `resolveSampledFlatPositionMix(...)`, the contract should be:

### input
- `stops` = real sampled stops for the solve
- `flatPosition`
- `spread`
- `baseOffset`

### output
- `targetColor`
- `lowIndex`
- `highIndex`
- `lowColor`
- `highColor`
- `flatMix`

### steps
1. sample `targetRgb` from `stops`
2. choose `lowIndex/highIndex` from `resolveSampledFlatInkSetForPosition(...)`
3. build a target-centered contrast pair for sampled-flat solve
4. project `targetRgb` onto that pair to get `flatMix`
5. clamp only enough to avoid dead endpoints or degenerate spans

---

## 5. Use one dedicated flat-only pair builder

Create or reuse one helper for sampled-flat pair building with a shape like:

```ts
buildFlatTargetContrastPair({
  target,
  spreadDistance,
}): { low, high }
```

Requirements:
- centered on the sampled target
- spread controls pair separation
- returns luminance-ordered `low/high`
- avoids collapsing into an almost identical pair
- avoids foreign-family drift caused by unrelated endpoint heuristics
- first pass must be purely target-centered, with no sampled-endpoint family tint at all

This helper should serve the sampled-flat solver contract directly.

It should not depend on:
- sampled-family inference
- sampled-endpoint tinting
- band identity
- legacy flat-band helper assumptions

---

## 6. Keep the pattern system stable, but validate it aggressively

Do **not** rewrite the flat pattern engine as part of this refactor.

The current change target is solver input quality:
- chosen pair
- chosen mix

The downstream flat pattern writer should stay as-is unless a failing regression proves otherwise.

That said, pattern correctness is part of the definition of done.

The solver refactor must preserve:
- sampled-flat Sierra pattern identity being derived from pair + mix instead of legacy band identity
- stable bit layout across nearby sampled positions when pair/mix are effectively equivalent
- visible variation when pair/mix materially differ
- no collapse into flat or noisy output

Reference:
- `docs/refactor/cc-gradient-dither-parity.md`

---

## Phase 3 - regression coverage

## 7. Required test coverage

Before trusting the refactor, tighten or add regression coverage in:

- `src/utils/colorCycle/__tests__/ccGradientDither.test.ts`
- `src/utils/colorCycle/__tests__/ccDitherRenderPalette.test.ts` only if needed for narrow guardrails

Must cover:

- sampled-flat target color comes from real sampled stops
- sampled-flat pair indices still come from `resolveSampledFlatInkSetForPosition(...)`
- sampled-flat pair selection uses the dedicated flat-only policy
- sampled-flat `flatMix` remains non-degenerate for representative 2-stop and 3-stop sampled gradients
- monochrome/collapsed sources do not produce dead identical pairs
- pattern identity still follows pair + mix, not legacy band assumptions
- nearby sampled positions with equivalent solve results keep stable bit layout
- materially different solve results produce visibly different pattern output

Also preserve the existing parity guards described in:

- `docs/refactor/cc-gradient-dither-parity.md`

Especially:

- no repeating-row band artifacts in `sierra-lite`
- no preview/finalize parity regressions for CC shape fills

---

## 8. Logging requirements

Keep or improve sampled-flat debug logging in `ccGradientDither.ts`.

Log enough to audit:

- sampled target color
- source stops used for solve
- low/high indices
- pair span
- resolved low/high colors
- projected `flatMix`
- solve error

Do not expand runtime-palette logging as a substitute for fixing the solver.
Use runtime-palette logging only to disprove upstream contamination if a narrow regression points there.

---

## Definition of done

This refactor is done when:

- `resolveSampledFlatPositionMix(...)` has one explicit sampled-flat pair-selection policy
- target color is sampled from real sampled stops
- pair selection no longer depends on overlapping helper policy inside the solver
- flat sampled output remains pattern-stable and varied in the intended ways
- existing parity guarantees remain intact
- tests pass:
  - `npm test -- --runTestsByPath src/utils/colorCycle/__tests__/ccGradientDither.test.ts`
  - `npm run type-check`
  - `npm run lint`

Optional but recommended:

- run any targeted CC shape finalize tests affected by sampled-flat fills

---

## Non-goals

This plan does not:

- reset the full sampled branch
- rewrite sampled session capture
- rewrite runtime palette generation
- rewrite flat band-pair helpers as a first step
- redesign the flat pattern engine

If later evidence shows upstream runtime palette generation is still contaminating sampled-flat solve, treat that as a follow-up with its own narrow failing test.
