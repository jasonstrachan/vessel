# CC Layer Disappearing Diagnostics

Use this when a color-cycle layer appears to clear, disappear after save/load, or play back blank.

## Failure Classes

Treat these as separate until evidence proves otherwise:

1. Runtime clear
   - The live CC paint buffer goes from non-empty to empty.
   - Expected diagnostic: `color-cycle-layer-cleared`.
   - This means something actually cleared the layer content in memory.

2. Save/archive corruption
   - The live layer may be fine, but the saved `.vs` archive has stale or missing CC binary refs.
   - Example: `project.json` references `buffers/color-cycle/<layer>/paint.bin`, but the zip payload or `binaries.entries` entry is missing.
   - This can produce `Project archive manifest is missing binary entry .../paint.bin`.

3. Playback/presentation failure
   - Canonical CC buffers exist, but playback, materialization, compositor, or presentation draws blank/wrong.
   - A runtime clear log may be absent because the data was not actually cleared.

## Runtime Clear Check

Open DevTools console and run:

```js
window.__VESSEL_GET_CC_MUTATION_LOG__?.()
```

Fallback if the helper is not installed on the page:

```js
JSON.parse(localStorage.getItem('VESSEL_CC_MUTATION_LOG') || '[]')
```

Look for:

```js
event: 'color-cycle-layer-cleared'
```

That entry should include:

- `layerId`
- `reason`
- `href`
- timestamp `t`
- `stack`
- before/after layer summaries
- compact buffer summaries for paint, gradient id, speed, flow, and phase

The paint summaries include:

- `byteLength`
- `nonZeroCount`
- first/last non-zero index
- non-zero bounds
- checksum
- first 16 non-zero samples with index/x/y/value

If this event exists, start from the stack trace and the triggering operation. It is a live-memory clear, not only a save/load problem.

## Save/Archive Check

If there is no `color-cycle-layer-cleared` event, inspect the saved archive.

```bash
unzip -l /path/to/file.vs
unzip -p /path/to/file.vs project.json | jq '.project.layers[] | select(.layerType=="color-cycle") | {id,name,state,colorCycleData}'
```

For every `zip:` ref in `project.json`, confirm:

- the file exists in the zip,
- `project.json.binaries.entries` includes the path,
- the manifest byte length/checksum matches the payload.

Canonical CC runtime refs are not optional:

- `paintRef` / `paint.bin`
- `speedRef` / `speed.bin`
- `flowRef` / `flow.bin`
- `phaseRef` / `phase.bin` when present
- `gradientIdRef` / `gradient-id.bin`
- `gradientDefIdRef` / `gradient-def-id.bin`

If these refs are missing from the archive or binary manifest, this is save/archive corruption even if the app looked correct before saving.

## Playback/Presentation Check

If the clear log is empty and the archive contains valid canonical buffers, treat the issue as playback/presentation until disproven.

Check:

- whether the layer hydrates cold/warm/active correctly,
- whether runtime materialization produces a non-empty surface,
- whether the compositor draws the CC presentation source,
- whether display filters or visibility/layer-eye state hide the result,
- whether Goblet/export path still sees non-empty CC state.

Do not patch save/load or clear handling from a blank visual symptom alone. First prove whether the data was cleared, saved incorrectly, or merely displayed incorrectly.

## Current Diagnostic Coverage

Runtime clear coverage exists for CC region mutations that empty the paint buffer. It records compact data rather than raw full buffers so logs can persist in `localStorage` without exceeding quota.

Known limitation: localStorage is browser/profile/origin-local. Clearing site data, switching browser/profile, or using a different localhost/origin can separate or remove the log.
