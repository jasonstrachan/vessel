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

## 2026-04-29 Confirmed Runtime Clear Bug

### Symptom

A full CC selection delete could empty the runtime paint buffer while the Zustand layer still reported `colorCycleData.hasContent: true`.

That stale metadata is dangerous because later presentation, playback, save, and hydrate code can believe a CC layer still has animated content even after the runtime buffer has been cleared.

### Root Cause

The `deleteSelectedPixels()` path for color-cycle layers routes through:

```txt
deleteSelectedPixels()
  -> clearColorCycleRegion()
  -> mutateColorCycleLayer()
```

`mutateColorCycleLayer()` already computed the correct post-mutation content state:

```txt
hasContent = working.some((value) => value !== 0)
```

It passed that value into `brush.applyLayerSnapshot(...)`, so the runtime brush knew the paint was empty. But it did not write that same `hasContent` value back to `layer.colorCycleData` during `state.updateLayer(...)`.

Result before the fix:

```txt
runtime paint buffer: empty
layer.colorCycleData.hasContent: true
```

### Fix

`clearColorCycleRegion()` / `mutateColorCycleLayer()` now persists `colorCycleData.hasContent` whenever the paint-buffer content state changes.

The destructive clear log was also expanded so the next runtime clear records enough context to identify the exact operation and affected region.

For selection-driven clears, the persisted `color-cycle-layer-cleared` event now includes:

- named operation in `reason`, such as `delete-selected`, `cut-selection`, or `extract-selection-transform`,
- `details.source: 'selection-region-clear'`,
- `details.operation`,
- `details.expectedDestructive: true`,
- layer name, visibility, opacity, blend mode,
- project dimensions,
- canvas dimensions,
- raw selection/delete rect,
- clamped rect,
- selection start/end/mask bounds when applicable,
- before/after scalar summaries for paint and sibling CC buffers.

## 2026-04-29 Console Result That Exposed A Diagnostic Gap

Observed on a production bundle URL. Ignore unrelated prior hang reports when diagnosing this path.

The first pasted diagnostic command was split across a newline inside `VESSEL_CC_MUTATION_LOG`, causing:

```txt
Uncaught SyntaxError: Invalid or unexpected token
```

Running the helper by itself returned:

```js
window.__VESSEL_GET_CC_MUTATION_LOG__?.()
// undefined
```

Running the localStorage fallback returned an empty persisted mutation log:

```js
JSON.parse(localStorage.getItem('VESSEL_CC_MUTATION_LOG') || '[]')
// []
```

Interpretation: this capture does not contain a persisted `color-cycle-layer-cleared` event. Either the helper was not installed in that bundle/session, no covered destructive CC clear was logged for that origin/profile, or the issue is outside the covered runtime-clear paths. Treat the visual disappearance as unresolved evidence, not proof of a recorded runtime clear.

This was not good enough as a diagnostic contract. The helper used to be installed only after the first persisted mutation, so `undefined` could mean either "wrong bundle / module not loaded" or "no event has happened yet".

That ambiguity is fixed. `window.__VESSEL_GET_CC_MUTATION_LOG__` is now installed before the first mutation event. After the fix:

- `typeof window.__VESSEL_GET_CC_MUTATION_LOG__ === 'function'` with an empty array means the logger is available and no persisted destructive event exists for that origin/profile.
- `typeof window.__VESSEL_GET_CC_MUTATION_LOG__ === 'undefined'` means wrong URL, old bundle, or the audit module did not load.

### Next Capture Commands

Use this process after a CC layer disappears or unexpectedly clears:

1. Keep the same app tab open.
2. Open DevTools Console on that same tab/origin.
3. Run the full dump first.
4. Then run the clear-report command.
5. Preserve the returned object, especially `mutationLog`, `colorCycleLayers`, and any `color-cycle-layer-cleared` entries.

Full diagnostic dump:

```js
window.__VESSEL_DUMP_CC_DIAGNOSTICS__?.()
```

Check whether the diagnostic helpers are actually loaded:

```js
({
  mutationHelper: typeof window.__VESSEL_GET_CC_MUTATION_LOG__,
  dumpHelper: typeof window.__VESSEL_DUMP_CC_DIAGNOSTICS__,
  activeLayerHelper: typeof window.__VESSEL_GET_ACTIVE_CC_LAYER_DIAGNOSTIC__,
  href: location.href,
})
```

Retrieve only layer-clear reports:

```js
(() => {
  const log =
    window.__VESSEL_GET_CC_MUTATION_LOG__?.() ??
    JSON.parse(localStorage.getItem('VESSEL_CC_MUTATION_LOG') || '[]');

  return log.filter((entry) => entry?.event === 'color-cycle-layer-cleared');
})()
```

Retrieve a compact clear summary for quick review:

```js
(() => {
  const log =
    window.__VESSEL_GET_CC_MUTATION_LOG__?.() ??
    JSON.parse(localStorage.getItem('VESSEL_CC_MUTATION_LOG') || '[]');

  return log
    .filter((entry) => entry?.event === 'color-cycle-layer-cleared')
    .map((entry) => ({
      t: new Date(entry.t).toISOString(),
      layerId: entry.layerId,
      reason: entry.reason,
      href: entry.href,
      source: entry.details?.source,
      operation: entry.details?.operation,
      direction: entry.details?.direction,
      expectedDestructive: entry.details?.expectedDestructive,
      rect: entry.details?.rect,
      clampedRect: entry.details?.clampedRect,
      roi: entry.details?.roi,
      patchRoi: entry.details?.patchRoi,
      selectionStart: entry.details?.selectionStart,
      selectionEnd: entry.details?.selectionEnd,
      paintBeforeNonZero: entry.details?.paintBefore?.nonZeroCount,
      paintAfterNonZero: entry.details?.paintAfter?.nonZeroCount,
      patchPaintNonZero: entry.details?.patchPaint?.nonZeroCount,
      beforeHasContent: entry.before?.hasContent,
      afterHasContent: entry.after?.hasContent,
      stack: entry.stack,
    }));
})()
```

For a smaller active-layer-only check:

```js
window.__VESSEL_GET_ACTIVE_CC_LAYER_DIAGNOSTIC__?.()
```

If `helperType` is not `function`, inspect exposed debug globals:

```js
Object.keys(window).filter((key) => /VESSEL|TB|STORE|APP|CC/i.test(key)).sort()
```

Read the result as:

- `clearEvents.length > 0`: actual runtime deletion; use the event stack and reason.
- `clearEvents.length === 0` and the active layer still has CC content: presentation/compositor/playback failure.
- `clearEvents.length === 0` and the active layer lost CC data, type, or content: store mutation bypassing the runtime-clear audit.
- `helperType === 'undefined'` after the helper-install fix is deployed: wrong/old bundle, wrong URL, or the diagnostic module did not load.

For a selection/delete clear, the `color-cycle-layer-cleared` entry should include at least:

- `reason: 'delete-selected'`, `reason: 'cut-selection'`, or another named operation
- `details.source: 'selection-region-clear'`
- `details.expectedDestructive: true`
- layer/project/canvas dimensions
- raw and clamped rect
- selection start/end/mask bounds when applicable
- before/after paint summaries with non-zero counts and sample coordinates

For a history undo/redo clear, the `color-cycle-layer-cleared` entry should include at least:

- `reason: 'history-undo-patch'` or `reason: 'history-redo-patch'`
- `details.source: 'history-color-cycle-stroke-patch'`
- `details.operation: 'undo'` or `details.operation: 'redo'`
- `details.direction: 'backward'` or `details.direction: 'forward'`
- `details.expectedDestructive: true`
- `details.roi` and `details.patchRoi`
- `details.patchPaint`, `details.patchGradientId`, and `details.patchGradientDefId` summaries
- before/after `hasContent` summaries

## 2026-04-29 Undo/History Clear Capture

The console report that actually pinpointed the later clear was:

```txt
event: layer-update-destructive
reason: updateLayer
layerId: layer-1777341840681-0.11510932748275604
before.hasContent: true
after.hasContent: false
details.updateKeys: ["colorCycleData"]
details.skipColorCycleSync: false
```

The stack showed the destructive state change came from undo:

```txt
ColorCycleStrokePatchDelta.apply()
  -> HistoryManager.applyEntry()
  -> HistoryManager.undo()
  -> withColorCycleSuspended()
  -> useDrawingCanvasKeyboard / useComprehensiveKeyboard
```

Interpretation:

- This was not a save/load symptom.
- This was not only a compositor/presentation blank.
- The store layer's `colorCycleData.hasContent` changed from `true` to `false`.
- The direct caller was `ColorCycleStrokePatchDelta.apply()` while applying a history patch during undo.

That generic `layer-update-destructive` report is useful, but it was too late in the chain and did not say what patch made the runtime brush empty. `ColorCycleStrokePatchDelta.apply()` now emits a dedicated clear report before the follow-up `updateLayer()` call when a history patch changes the runtime brush from populated to empty.

Expected next capture for this path:

```txt
event: color-cycle-layer-cleared
reason: history-undo-patch
details.source: history-color-cycle-stroke-patch
details.operation: undo
details.direction: backward
details.roi: <history delta roi>
details.patchRoi: <patch roi>
details.patchPaint.nonZeroCount: <patch paint non-zero count>
before.hasContent: true
after.hasContent: false
```

If the user intentionally undoes the last CC content, this is an expected destructive history operation. If the visible layer should still have CC content after undo, inspect this report first: the bug is then in the history patch contents or the captured before/after state for `ColorCycleStrokePatchDelta`, not in save/load.

## 2026-04-29 Confirmed History Snapshot Bug

Follow-up context:

1. An old project was opened.
2. The bottom CC layer was selected.
3. That layer was warm and visibly animating before the edit.
4. New CC shapes were drawn on that layer.
5. Undo was pressed once and appeared to do nothing.
6. Undo was pressed again and the whole layer cleared.

The clear report for the destructive undo was:

```txt
event: color-cycle-layer-cleared
reason: history-undo-patch
details.source: history-color-cycle-stroke-patch
details.operation: undo
details.direction: backward
details.roi: 0,0,2000,2000
details.patchRoi: 0,0,2000,2000
details.patchPaint.nonZeroCount: 0
before.hasContent: true
after.hasContent: false
```

Diagnosis:

- The undo patch covered the full 2000x2000 layer.
- The backward paint patch had zero non-empty pixels.
- Because the layer was visibly animating before the new shapes, this was not a legitimate "undo first content on an empty layer" case.
- The dangerous behavior was in `createColorCycleStrokePatchDelta()`: when the backward paint snapshot was missing but the forward paint snapshot existed, it synthesized an empty backward patch for every buffer. That made a missing before-state indistinguishable from an intentionally empty before-state.

Why the backward snapshot was missing:

- In code terms, the history commit reached `createColorCycleStrokePatchDelta()` with no usable `backwardState.paintBuffer`.
- That means the earlier before-state capture from `captureColorCycleBrushState(layerId)` returned `null` or returned a serialized layer without canonical paint.
- For an old loaded file that was visibly animating, the most likely classes are: the runtime brush was present for playback but did not serialize canonical paint for history, the persistence snapshot validator rejected the serialized state, or the loaded layer had metadata/rendered presentation but not a canonical paint buffer available to the history capture path.
- The old diagnostic did not preserve the exact branch because `captureColorCycleBrushState()` swallowed capture/validation failures and returned `null`.

Plain-language meaning:

When a CC edit is recorded into history, history needs two paint states:

```txt
backward paint snapshot = the layer's canonical CC paint before the new edit
forward paint snapshot  = the layer's canonical CC paint after the new edit
```

Undo applies the backward snapshot. Redo applies the forward snapshot.

For the old-file repro, the expected sequence was:

```txt
old loaded CC shapes still present
  -> draw new CC shape 1
  -> draw new CC shape 2
  -> undo should restore "old loaded CC shapes plus shape 1" or "old loaded CC shapes"
```

The destructive report instead showed:

```txt
backward patch = full 2000x2000 layer
backward patch paint non-zero count = 0
```

That means history did not have the old loaded CC layer's paint as the before-state. It had either no before paint at all, or an invalid before paint capture that was converted into zeroes. Before this fix, missing before paint was treated as "the layer used to be empty." For this old-file case, that was wrong because the layer was visibly warm and animating before the new shapes were drawn.

Expected runtime behavior after the fix:

- If backward paint is missing, the layer should not clear.
- A dev console warning should be emitted.
- The history entry may be skipped or incomplete, so undo may do nothing for that edit.
- Doing nothing is the safe failure mode; clearing old CC content is not.
- First-stroke undo is still preserved when history has an explicit empty before-state. The guard blocks unknown/missing before-state, not a correctly captured empty CC layer.

Fix:

- Missing/unknown backward paint is no longer converted into a zero paint patch.
- An explicit empty before-state can still synthesize a zero backward patch so the first CC stroke on an empty layer remains undoable.
- If forward paint exists but backward paint is missing, the CC history delta is skipped and a warning diagnostic is persisted instead.
- Sibling buffers such as gradient id, gradient def id, speed, flow, and phase may still synthesize empty companion buffers only when a real backward paint patch exists.
- `captureColorCycleBrushState()` now also logs `history-cc-before-state-capture-failed` with the failure reason, validation diagnostics, and serialized buffer byte lengths when a non-empty CC layer cannot produce a usable history before-state.

Expected warning for this protected path:

```txt
event: history-cc-before-state-missing
reason: missing-backward-paint-patch
details.source: history-color-cycle-stroke-patch
details.expectedDestructive: false
details.roi: <attempted history ROI>
details.forwardPaint.nonZeroCount: <new content count>
```

If the problem happens before history delta creation, expected capture warning:

```txt
event: history-cc-before-state-capture-failed
reason: missing-runtime-brush | missing-canonical-paint | missing-motion-buffers | dimension-mismatch | capture-exception
details.source: captureColorCycleBrushState
details.project.width / details.project.height
details.project.activeLayerId
details.targetLayer.id / name / visible / order
details.colorCycleData.hasContent
details.colorCycleData.runtimeHydrationState
details.colorCycleData.deferredRuntimeRestore
details.colorCycleData.canvasWidth / canvasHeight
details.colorCycleData.canvasImageDataWidth / canvasImageDataHeight
details.colorCycleData.brushStateLayers
details.colorCycleData.paintBufferBytes / gradientIdBufferBytes / gradientDefIdBufferBytes
details.runtimeBrush.present
details.runtimeBrush.hasSerialize
details.runtimeBrush.constructorName
details.damageKind
details.diagnostics
details.rawSnapshot.paintBytes: <serialized paint bytes>
details.rawSnapshot.strokeHasContent: <serialized hasContent>
details.rawSnapshot.stateLayerIds
details.rawSnapshot.dimensions
details.rawSnapshot.buffers.paint.summary.nonZeroCount
details.rawSnapshot.buffers.paint.summary.bounds
details.rawSnapshot.buffers.paint.summary.checksum
details.rawSnapshot.buffers.gradientId.summary
details.rawSnapshot.buffers.gradientDefId.summary
details.rawSnapshot.buffers.speed.summary
details.rawSnapshot.buffers.flow.summary
details.rawSnapshot.buffers.phase.summary
```

This is intentionally a no-clear failure mode. It may mean the attempted edit has no undo entry if the before-state capture failed, but it prevents history from destroying existing CC layer content.

## Verification Performed

Targeted Jest coverage:

```bash
npm test -- --runTestsByPath \
  src/history/deltas/__tests__/colorCycleStrokePatchDelta.test.ts \
  src/stores/__tests__/selectionFramebufferDelete.test.ts \
  src/stores/helpers/__tests__/colorCycleSelection.test.ts \
  src/utils/colorCycle/__tests__/ccMutationAudit.test.ts \
  src/debug/__tests__/ccDebug.test.ts
```

Expected and observed:

```txt
Test Suites: 5 passed
Tests: 29 passed
```

TypeScript verification:

```bash
npm run type-check
```

Expected and observed: pass.

Browser-level validation used a real Next dev page and Playwright. The repro:

1. Opened the real app page.
2. Selected a CC layer.
3. Seeded non-zero CC runtime paint.
4. Set the full-project selection bounds.
5. Called the real store `deleteSelectedPixels()` action.
6. Read `window.__VESSEL_DUMP_CC_DIAGNOSTICS__()`.

Observed browser result after the fix:

```txt
helpers:
  mutation: function
  active: function
  dump: function

before active CC layer:
  hasContent: true

after active CC layer:
  hasContent: false

clear event:
  event: color-cycle-layer-cleared
  reason: delete-selected
  severity: error
  source: selection-region-clear
  operation: delete-selected
  expectedDestructive: true
  rect: 0,0,2000,2000
  clampedRect: 0,0,2000,2000
  selectionStart: 0,0
  selectionEnd: 2000,2000
  paintBeforeNonZero: 1024
  paintAfterNonZero: 0
```

This proves both parts:

- the runtime clear bug is fixed for the tested full-selection CC delete path,
- the persistent logging now captures the destructive operation with actionable forensic detail.
- the history undo path now emits a precise clear report before the generic destructive `updateLayer` audit, and that logging is covered by Jest.
