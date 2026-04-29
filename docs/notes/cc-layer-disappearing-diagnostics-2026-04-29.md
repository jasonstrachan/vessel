# CC Layer Disappearing Diagnostics

Use this when a color-cycle layer appears to clear, disappear after save/load, or play back blank.

## Failure Classes

Treat these as separate until evidence proves otherwise:

1. Runtime clear
   - The live CC paint buffer goes from non-empty to empty.
   - Expected diagnostic: `color-cycle-layer-cleared`.
   - This means something actually cleared the layer content in memory.
   - This is separate from save/load corruption. If it happens before saving or reopening, investigate runtime mutation first.

2. Save/archive corruption
   - The live layer may be fine, but the saved `.vs` archive has stale or missing CC binary refs.
   - Example: `project.json` references `buffers/color-cycle/<layer>/paint.bin`, but the zip payload or `binaries.entries` entry is missing.
   - This can produce `Project archive manifest is missing binary entry .../paint.bin`.
   - Save and autosave use the same serialization guard. A save that would produce dangling refs should fail before writing the archive.

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
- `details.source`
- `details.expectedDestructive`
- `href`
- timestamp `t`
- `stack`
- before/after layer summaries
- compact buffer summaries for paint, gradient id, gradient def id, speed, flow, and phase

The paint summaries include:

- `byteLength`
- `nonZeroCount`
- first/last non-zero index
- non-zero bounds
- checksum
- first 16 non-zero samples with index/x/y/value

If this event exists, start from the stack trace, `reason`, and `details.source`. It is a live-memory clear, not only a save/load problem. `details.expectedDestructive: true` means the clear came through an intentional destructive runtime path, but it is still persisted so the event can explain why the layer became empty.

### Runtime Logging Scope

The persistent mutation log is intentionally scoped:

- destructive/error events persist to `localStorage`,
- `color-cycle-layer-cleared` persists and includes stack/buffer summaries,
- normal production mutation events such as routine stroke commits do not persist or create stack traces,
- development builds can still keep broader in-memory/dev diagnostics.

This keeps the log useful for data-loss review without turning every normal drawing action into synchronous storage work.

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

### Save/Autosave Guard

Current save behavior should fail closed for dangling archive refs:

```txt
Project save produced dangling archive ref buffers/color-cycle/<layer>/paint.bin at ...
```

That error means the serializer produced a `zip:` ref that did not have a matching binary manifest entry or zip payload. Treat it as a save-path bug until proven otherwise.

Autosave goes through the same serialization path, so the same guard should catch autosave attempts that would otherwise write corrupt CC archive refs.

The guard covers canonical color-cycle refs including:

- `paint.bin`
- `speed.bin`
- `flow.bin`
- `phase.bin` when present
- `gradient-id.bin`
- `gradient-def-id.bin`

## Repair Path

Strict open/read remains strict for missing canonical CC buffers. If a damaged archive has dangling canonical CC refs, direct load should not silently pretend the animated CC data exists.

For a repairable damaged `.vs` file, use `Repair & Save Copy` from the load modal. That path:

- analyzes dangling archive refs,
- strips missing canonical CC refs, including gradient id and gradient def refs,
- marks affected layers with `colorCycleData.repairStatus`,
- keeps the repaired layer as preview/static-only if canonical animated paint data is missing,
- saves a separate repaired copy instead of overwriting the damaged source file.

After repair, review affected layers manually. Repaired layers may reopen, but missing canonical paint/playback data cannot be reconstructed from the archive.

## Playback/Presentation Check

After the runtime mutation single-authority refactor, an empty clear log means no covered live CC runtime paint buffer transitioned from non-empty to empty through app logic in the current origin/profile. If the archive also contains valid canonical buffers, treat the issue as playback/presentation until disproven.

Check:

- whether the layer hydrates cold/warm/active correctly,
- whether runtime materialization produces a non-empty surface,
- whether the compositor draws the CC presentation source,
- whether display filters or visibility/layer-eye state hide the result,
- whether Goblet/export path still sees non-empty CC state.

Do not patch save/load or clear handling from a blank visual symptom alone. First prove whether the data was cleared, saved incorrectly, or merely displayed incorrectly.

## Current Diagnostic Coverage

Runtime clear coverage exists for the core CC runtime mutation paths that can empty paint:

- region mutations through `mutateColorCycleLayer`,
- `ColorCycleBrushCanvas2D.clearPaintBuffer`,
- `ColorCycleBrushCanvas2D.startStroke(clearBuffer = true)`,
- `ColorCycleBrushCanvas2D.applyLayerSnapshot` populated-to-empty replacement,
- `ColorCycleBrushCanvas2D.restoreFullState` non-history replacement,
- explicit runtime reset paths such as `ColorCycleBrushCanvas2D.clear()`.

Lifecycle teardown paths such as orphan brush `cleanup()` / `destroy()` during project load are intentionally excluded. Disposing an orphaned brush is not evidence that a live project layer was cleared.

It records compact data rather than raw full buffers so logs can persist in `localStorage` without exceeding quota.

Save/archive coverage is not a passive log. It is a hard postcondition on serialization: a corrupt archive should not be written if serialized refs and binary payloads disagree.

Known limitation: localStorage is browser/profile/origin-local. Clearing site data, switching browser/profile, or using a different localhost/origin can separate or remove the log.
