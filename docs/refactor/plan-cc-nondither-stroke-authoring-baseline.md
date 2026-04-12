# CC Non-Dither Stroke Authoring Baseline

## Scope

Burn down only the non-dither color-cycle stroke authoring path.

Do not change:

- dither stroke authoring or `applyStampDitherStamp`
- shape fill paths
- gradient definition or slot binding storage
- playback, compositor, animator rendering, or export playback

Custom stamp authoring is in scope only where it shares this exact non-dither
phase/color progression bug:

- use the same integer stamp-count color progression rule
- ignore captured-data phase maps for non-dither live preview
- do not rewrite stamp mask/scaling behavior

Primary implementation file:

- `src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts`

Secondary diagnostic entry path, if needed:

- `src/hooks/brushEngine/colorCycleDrawController.ts`

## Baseline Rule

Non-dither stroke authoring must be deterministic and integer-only:

- stroke begin resets authored local state
- phase does not drive non-dither live-preview color selection
- non-dither live-preview color selection is stamp-count based
- each stamp center paints one integer color-cycle palette index
- each non-dither live-preview stamp uses one integer color index across its footprint
- non-dither live preview writes static speed metadata so render-time animation cannot reorder the authored preview while drawing
- end-stroke upgrades painted non-dither pixels to playback speed metadata after the static preview render
- non-dither stroke color choice does not use the `gradientBands` band mapper

Distance progression and spatial projection were explicitly backed out while
isolating the live-preview bug. Do not reintroduce them until the simple
baseline is proven stable.

Canonical rule:

```ts
const colorIndex = 1 + (strokeData.stampCounter % 255);
const speedByte = stampDitherEnabled ? getWriteSpeedByte(strokeData) : 0;
```

## Confirmed Bug Isolation

The visible non-dither CC stroke bug returned immediately when non-dither live
preview speed metadata was restored via `getWriteSpeedByte(strokeData)`.

Confirmed behavior:

- spatial non-dither stamp authoring was already removed
- per-pixel non-dither projection was already removed
- direction-dependent intra-stamp ordering was already removed
- custom captured-data phase maps were ignored for non-dither live preview
- restoring non-dither speed bytes still made the visual bug return

Conclusion: non-dither live preview must keep `speedByte = 0` while drawing. The
problem is not only stamp-internal spatial ordering; render-time speed shifting
can visibly reorder the live preview even when each stamp writes one integer
index.

Playback still needs speed metadata after the stroke is committed. Populate it
only after the static end-stroke preview render. Do not restore non-dither
live-preview speed metadata without a deeper renderer semantics fix or a
separate kill switch that defaults off.

## Diagnostics To Keep Temporarily

- `[cc-stroke-begin]`
- `[cc-stroke-end]`
- `[cc-nodither-decision]`
- `[cc-nodither-zero-dist]`
- `[cc-zero-dist-phase-check]`
- `[cc-nodither-postpaint]`

Use diagnostics only to verify the baseline. Do not layer new behavior while they are in place.
After the baseline is covered by regression tests, remove these hot-path
diagnostics or gate them behind an explicit debug flag before shipping the
change.

## Acceptance Criteria

- New non-dither stroke starts at `stampCounter: 0`, `phase: 0`, `lastPoint: null`.
- Non-dither live preview writes static speed byte `0` while drawing.
- Non-dither committed stroke pixels have playback speed metadata after `endStroke`.
- Non-dither phase remains stable during live preview.
- Non-dither stamp color progression is deterministic and stamp-count based.
- Expected index equals the actual paint buffer index at the stamp center.
- No float index is written into the paint path.
- No non-dither cross-stroke authored phase carry.

## Regression Tests

Add focused tests under `src/hooks/brushEngine/__tests__/`:

- first non-dither stroke stamp writes palette index `1`
- repeated paint calls progress by stamp count, not distance or phase
- non-dither phase remains `0` while preview color progresses
- distinct authored stamps continue the same stamp-count progression
- `gradientBands` does not collapse early non-dither stroke indices through the band mapper
- a new non-dither stroke resets stamp count and starts again at index `1`
- custom stamp authoring follows the same non-dither baseline only for shared phase/color progression
- large built-in stamp footprints write one non-dither index per stamp
- non-captured custom stamp masks write one non-dither index per stamp
- non-dither stroke preview speed metadata stays static while drawing
- non-dither stroke playback speed metadata is restored after `endStroke`
- restoring non-dither stroke preview speed metadata is expected to reintroduce the visual bug and should stay off

## Rebuild Order After Baseline

After the baseline is stable:

1. Distance progression, integerized by accumulating distance and converting to whole steps.
2. Optional velocity coupling only when the velocity toggle is enabled.

Do not combine both rebuilds in one change.

Current implementation status:

- baseline phase/index reset and duplicate-stamp behavior: implemented
- integerized distance progression: backed out
- spatial per-pixel non-dither authoring for built-in stamp footprints: backed out
- spatial per-pixel non-dither authoring for non-captured custom stamp masks: backed out
- non-dither live-preview speed animation: disabled while drawing after A/B confirmed it reintroduces the visual bug
- non-dither committed playback speed metadata: restored after static end-stroke preview render
- velocity coupling: not implemented
