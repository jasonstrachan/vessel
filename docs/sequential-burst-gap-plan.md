# Sequential Burst/Gap Plan

## Goal
Replace ambiguous temporal smear behavior with explicit, predictable controls for:
- how many frames receive stamps (`burstFrames`)
- how many frames are skipped (`gapFrames`)

## Why
Current behavior mixes several effects (smear, densification, frame bucketing), which makes it hard to predict when animation will:
- keep stamping
- stop stamping
- resume stamping

A deterministic burst/gap cycle gives direct control over visible rhythm.

## Proposed Model
1. Add sequential runtime controls:
- `burstFrames` (int, min 1, max 32)
- `gapFrames` (int, min 0, max 64)

2. Define cycle:
- `cycle = burstFrames + gapFrames`
- For generated temporal buckets, place buckets only in active windows of cycle
- Active window: first `burstFrames` slots
- Gap window: next `gapFrames` slots

3. Keep separation of concerns:
- Temporal controls choose **which frames** get content
- Brush/stamp spacing controls choose **density inside active frames**

## UI
In Animation panel:
- Keep `Time-smear`
- Add `Burst` slider
- Add `Gap` slider
- Optional helper text: `Pattern: {burst} on / {gap} off`

## Defaults
- `burstFrames = 1`
- `gapFrames = 0`

This preserves existing behavior unless user intentionally adds gaps.

## Validation
- Store tests for clamping + actions
- Capture tests for deterministic frame index patterns (e.g. burst=1 gap=2)
- Panel wiring tests for control updates
- Type-check + lint + targeted sequential test suites

## Rollout Notes
- Keep legacy projects safe via defaults
- No migration needed if defaults are non-breaking
- Consider adding export metadata for burst/gap in future if required by external playback tools
