# Revised Spec: 3-Ink Sampled-Flat Sierra-Lite

## Goal

At high spread, sampled flat fills should show more color richness than the current 2-ink path.

At low spread, sampled flat fills should keep the current 2-ink Sierra-Lite behavior.

## Core idea

Spread controls ink count:

- `0-40`: 2 inks, current behavior.
- `41-100`: 3 inks positioned around the sampled target.

The high-spread path uses Sierra-Lite error diffusion across 3 levels. There is no multi-band assignment and no pair-of-pairs routing. The solve is just:

1. compute 3 cycle indices around the representative sampled target,
2. compute one shape-level mix value from the existing flat-position amplification + seed scatter,
3. diffuse across 3 levels using the existing Sierra-Lite kernel,
4. map the chosen level to the resolved low/mid/high indices.

## Why this is simpler

The earlier multi-pair proposal required:

- pair-count thresholds,
- per-band pair computation,
- spatial band assignment,
- per-band occupancy bias,
- a custom multi-band error diffusion loop.

The revised 3-ink path needs:

- one threshold to switch from 2 inks to 3 inks,
- three resolved indices,
- one shape-level mix,
- the existing Sierra-Lite diffusion structure with a custom level-to-index mapper.

## Step 1: Decide ink count

```ts
const MULTI_INK_THRESHOLD = 40;

const useSampledMultiInk = (spread: number): boolean =>
  spread > MULTI_INK_THRESHOLD;
```

## Step 2: Compute 3 ink positions around the target

```ts
const resolveSampledTripleInks = ({
  representativeTone,
  baseOffset,
  spread,
}: {
  representativeTone: number;
  baseOffset: number;
  spread: number;
}): {
  lowIndex: number;
  midIndex: number;
  highIndex: number;
} => {
  const spread01 = clamp01(spread / 100);
  const centerIndex = indexFromNormalized(representativeTone, baseOffset);
  const reach = Math.round(spread01 * 100);

  return {
    lowIndex: clampCycleIndex(centerIndex - reach),
    midIndex: centerIndex,
    highIndex: clampCycleIndex(centerIndex + reach),
  };
};
```

Example at target index `128`, `spread = 80`:

```text
reach = 80
lowIndex  =  48
midIndex  = 128
highIndex = 208
```

At `spread = 100`:

```text
reach = 100
lowIndex  =  28
midIndex  = 128
highIndex = 228
```

This is intentional. Sierra-Lite only mixes adjacent levels, so the visible pairs are `low<->mid` and `mid<->high`. The total `low<->high` span can exceed the old half-cycle cap because those two inks never appear adjacent in the actual diffusion pattern.

## Step 3: Route into Sierra-Lite 3-level error diffusion

The existing multi-level Sierra-Lite branch already performs serpentine diffusion with the correct Sierra-Lite kernel. The revised sampled-flat path keeps that structure and swaps the final level-to-index mapping:

```ts
const tripleInkIndex = (
  level: number,
  inks: { lowIndex: number; midIndex: number; highIndex: number }
): number => {
  if (level <= 0) return inks.lowIndex;
  if (level >= 2) return inks.highIndex;
  return inks.midIndex;
};
```

## Step 4: Resolve the 3-level mix

Flat coverage is uniform, so the high-spread 3-ink path should not use raw per-cell coverage directly. Instead it uses the same shape-level mix logic as the sampled 2-ink path:

```ts
const centered = clamp01(flatPosition) - 0.5;
const amplified = 0.5 + centered * 2.5;
const seedHash = flatSeed
  ? (Math.imul((flatSeed >>> 0) ^ 0x9e3779b9, 2654435761) >>> 0)
  : 0;
const seedNoise = flatSeed
  ? ((seedHash & 0xffff) / 65536 - 0.5) * 0.5
  : 0;
const sampledTripleMix = Math.max(0.02, Math.min(0.98, amplified + seedNoise));
```

That mix is then scaled into a 3-level solve:

```ts
const scaled = sampledTripleMix * 2;
```

This lets flat position move the solve between low/mid and mid/high while keeping the 3 resolved inks stable for the shape.

## Step 5: Error diffusion loop

```ts
const TRIPLE_LEVELS = 3;
let errCurr = new Float32Array(gridW);
let errNext = new Float32Array(gridW);

for (let cy = 0; cy < gridH; cy += 1) {
  const activeRow = activeCellsByRow[cy];
  if (!activeRow.length) {
    const swap = errCurr;
    errCurr = errNext;
    errNext = swap;
    errNext.fill(0);
    continue;
  }

  const swap = errCurr;
  errCurr = errNext;
  errNext = swap;
  errNext.fill(0);

  const serpentine = (cy & 1) === 1;
  const start = serpentine ? activeRow.length - 1 : 0;
  const end = serpentine ? -1 : activeRow.length;
  const step = serpentine ? -1 : 1;

  for (let i = start; i !== end; i += step) {
    const cx = activeRow[i];
    const cellIdx = cy * gridW + cx;

    const scaled = sampledTripleMix * (TRIPLE_LEVELS - 1);
    const lower = Math.max(0, Math.min(TRIPLE_LEVELS - 1, Math.floor(scaled)));
    const frac = scaled - lower;
    const adj = clamp01(frac + (errCurr[cx] || 0));
    const chooseUpper = lower < TRIPLE_LEVELS - 1 && adj >= 0.5;
    const q = chooseUpper ? 1 : 0;
    const err = adj - q;

    if (!serpentine) {
      if (cx + 1 < gridW) errCurr[cx + 1] += err * 0.5;
      if (cx - 1 >= 0) errNext[cx - 1] += err * 0.25;
    } else {
      if (cx - 1 >= 0) errCurr[cx - 1] += err * 0.5;
      if (cx + 1 < gridW) errNext[cx + 1] += err * 0.25;
    }
    errNext[cx] += err * 0.25;

    const level = chooseUpper ? lower + 1 : lower;
    cellIndices[cellIdx] = tripleInkIndex(level, tripleInks);
  }
}
```

## Routing

```ts
if (preferSampledFlatSolver && representativeSampledTarget) {
  if (useSampledMultiInk(flatPairSpread ?? 0)) {
    const tripleInks = resolveSampledTripleInks({
      representativeTone: representativeSampledTarget.tone,
      baseOffset,
      spread: flatPairSpread ?? 0,
    });
    // compute sampledTripleMix from flatPosition + flatSeed
    // run 3-level Sierra-Lite diffusion
    // skip fillFlatPatternMode
  } else {
    // current sampled 2-ink path
    // resolveSampledFlatPositionMix(...)
    // fillFlatPatternMode(...)
  }
} else {
  // non-sampled path unchanged
}
```

## Files touched

- `src/utils/colorCycle/ccGradientDither.ts`
  - add `useSampledMultiInk`
  - add `resolveSampledTripleInks`
  - add `tripleInkIndex`
  - add the sampled 3-ink branch in `clampedLevels === 1`
- `src/utils/colorCycle/ccFlatModePatterns.ts`
  - unchanged

## What does not change

- sampled 2-ink routing below the threshold
- `resolveSampledFlatPositionMix`
- `fillFlatPatternMode`
- non-sampled flat paths
- session plumbing and finalize/binding
- Sierra-Lite kernel weights

## Constants

| Constant | Value | Rationale |
|---|---:|---|
| `MULTI_INK_THRESHOLD` | `40` | below this, keep 2-ink behavior |
| `maxReach` | `100` | adjacent visible pairs can safely exceed the old half-cycle cap |
| `mixAmplification` | `2.5` | same as sampled 2-ink path |
| `seedNoiseAmplitude` | `0.5` | same as sampled 2-ink path |
