# CC Play/Pause Cold-Warm Audit Plan

Date: 2026-05-05

Status: completed

## Goal

Audit the full Color Cycle play/pause path and prove whether play/pause can:

- warm cold CC data into a partial runtime state,
- desync visible CC pixels from animated runtime state,
- leave a visible CC preview with no animation,
- publish partial warmup buffers into `colorCycleData`,
- or let empty/partial runtime state replace canonical CC data.

This is an audit plan first. Do not broaden it into general CC architecture work unless the evidence crosses that boundary.

## Working Hypothesis

Play/pause is not just toggling animation. It can trigger this chain:

```text
toolbar play/pause
-> playback UI state
-> runtime warmup
-> lazy archive hydration
-> brush restore
-> runtime sync
-> updateLayer/colorCycleData
-> save/autosave/history
```

The suspected bug class is that `cold but canonical` can become `warm/visible but non-animated`, or worse, `hasContent: false`, when warmup, playback sync, or store updates treat a partial runtime state as authoritative.

## Files To Audit

- `src/utils/colorCyclePlayback.ts`
- `src/runtime/playback/PlaybackRuntimeController.ts`
- `src/runtime/playback/colorCyclePlaybackParticipant.ts`
- `src/stores/slices/colorCycleSlice.ts`
- `src/stores/ccRuntime.ts`
- `src/stores/layers/createLayersSlice.ts`
- `src/stores/layerHydration.ts`
- `src/utils/projectIO.ts`
- `src/hooks/canvas/handlers/colorCycle/colorCyclePlayback.ts`
- `src/utils/colorCycle/ccMutationAudit.ts` (actual canonical/audit summary helper; `src/lib/colorCycle/canonicalPayload.ts` does not exist in this checkout)

## Core Questions

- Who owns desired playback state?
- Who owns actual runtime brush playing state?
- Who is allowed to warm cold CC layers?
- Who is allowed to mark `runtimeHydrationState` as `warm` or `active`?
- Who writes `colorCycleData.hasContent` during play/pause?
- Which paths call `updateLayer({ colorCycleData })` during playback?
- Can pause serialize stale runtime state?
- Can repeated play/pause toggle a cold archive-backed layer into partial warm state?
- Can playback sync skip a visible cold CC layer and leave a static preview with no animation?

## Playback Invariants

- Play/pause must not mutate canonical CC paint.
- Play/pause may warm runtime state only from a verified canonical payload.
- Failed warmup must leave the layer cold.
- A visible CC preview with canonical payload but no runtime brush must be logged as warmup/presentation failure, not treated as empty.
- Pause must stop animation only; it must not serialize runtime emptiness.
- Repeated play/pause must be idempotent for canonical summaries.
- A play/pause operation must never replace a populated committed CC payload with an empty committed payload.

## Phase 1. Authority Graph

- [x] Trace `toggleToolbarColorCyclePlayback`.
- [x] Trace `toggleGlobalColorCyclePlayback`.
- [x] Trace `playColorCycle`, `pauseColorCycle`, `forceResumeColorCycle`, `suspendColorCycle`, and `resumeColorCycle`.
- [x] Trace `PlaybackRuntimeController.requestColorCycleRuntimeStart`.
- [x] Trace `colorCyclePlaybackParticipant.sync`.
- [x] Trace `colorCycleRuntimeHandlers.start/stop`.
- [x] Trace `ensureColorCycleLayerRuntime`.
- [x] Trace `restoreColorCycleBrushes`.
- [x] Produce a short authority diagram showing playback state, runtime brush state, hydration state, and canonical payload state.

## Phase 2. Playback Telemetry

Add or verify compact diagnostics for:

- [x] `cc-playback-toggle-requested`
- [x] `cc-playback-warmup-started`
- [x] `cc-playback-warmup-complete`
- [x] `cc-playback-warmup-failed`
- [x] `cc-playback-runtime-started`
- [x] `cc-playback-runtime-stopped`
- [x] `cc-playback-canonical-summary-before`
- [x] `cc-playback-canonical-summary-after`
- [x] `cc-playback-canonical-mutated`

Each event should include:

- layer id,
- visibility,
- `runtimeHydrationState`,
- `deferredRuntimeRestore`,
- has runtime brush,
- brush `isPlaying`,
- canonical `CcPayloadSummary`,
- stack trace for suspicious canonical mutations.

## Phase 3. Cold/Warm Restore Atomicity

- [x] Prove lazy archive refs hydrate into local variables before publishing to `colorCycleData`.
- [x] Prove failed archive hydration leaves the old cold state intact.
- [x] Prove failed brush creation does not delete lazy restore authority.
- [x] Prove missing canonical paint becomes `repairStatus`, not empty runtime truth.
- [x] Prove warmup cannot publish `gradientIdBuffer` or `gradientDefIdBuffer` without paint/motion payload.
- [x] Add regression coverage for failure during the middle of lazy archive hydration.

## Phase 4. Playback Participant Behavior

- [x] Prove visible cold brush-mode CC layers are warmed before runtime start.
- [x] Prove playback only starts brushes after warmup succeeds.
- [x] Prove hidden brushes stop without clearing payload.
- [x] Prove `lastRuntimeState` cannot suppress restart after brush replacement.
- [x] Prove recolor mode and brush CC mode do not share incorrect assumptions.
- [x] Add regression coverage for active visible cold layer, visible non-active cold layer, and hidden cold layer.

## Phase 5. Store Mutation Audit

- [x] Audit every play/pause path that calls `updateLayer`.
- [x] Prove playback state changes do not overwrite full `colorCycleData` with stale partial data.
- [x] Prove `updateLayer` cannot change populated canonical CC to empty without authorization.
- [x] Prove `isAnimating` sync does not carry stale `hasContent: false`.
- [x] Prove save/autosave cannot run while warmup is mid-transaction.

## Phase 6. Repro Matrix

Run or automate:

- [x] open cold CC file, press play/pause 10 times,
- [x] 1 CC layer vs 5 CC layers,
- [x] active cold layer vs visible non-active cold layers,
- [x] hidden cold layer,
- [x] large archive-backed CC payload,
- [x] corrupt/missing one archive buffer,
- [x] warmup failure followed by save/autosave,
- [x] pause during warmup,
- [x] play during warmup,
- [x] layer switch during warmup,
- [x] export after failed warmup.

After every step, assert:

- canonical summary unchanged unless explicitly destructive,
- failed layer remains cold,
- visible canonical CC without runtime logs presentation/warmup issue,
- no `hasContent: true -> false` canonical replacement,
- no autosave of partial warmed state.

## Phase 7. Tests To Add

- [x] Unit test: toolbar play warms active visible cold brush CC before runtime start.
- [x] Unit test: toolbar play warms visible non-active cold brush CC before runtime start.
- [x] Unit test: toolbar play does not warm hidden cold CC layers unless required by explicit playback policy.
- [x] Unit test: pause does not call canonical payload replacement.
- [x] Integration test: repeated play/pause preserves `CcPayloadSummary`.
- [x] Integration test: failed warmup leaves `runtimeHydrationState: cold`.
- [x] Integration test: failed warmup followed by autosave refuses partial state.
- [x] Regression test: visible CC preview plus no runtime brush logs warmup/presentation failure.

## Definition Of Done

- We can state whether play/pause can still clear canonical CC data.
- We can state whether play/pause can still leave visible static CC pixels with no animation.
- We can state whether failed warmup can partially publish CC buffers.
- We can state whether pause can serialize stale empty runtime state.
- Repeated play/pause is proven canonical-data idempotent.
- Confirmed failure classes have regression tests.
- Any discovered fix is scoped to the specific playback/warmup authority boundary that failed.

## Authority Diagram

```text
toolbar / animation panel
-> toggleToolbarColorCyclePlayback()
-> toggleGlobalColorCyclePlayback(shouldPlay, reason)
-> colorCycleSlice desired playback state
-> warmVisibleBrushColorCycleLayersForPlayback()
-> ensureColorCycleLayerRuntime(layerId, target)
-> scheduleDeferredColorCycleRestore()
-> restoreColorCycleBrushes(lazy: false)
-> publish restored layer only after a runtime brush exists
-> PlaybackRuntimeController.requestColorCycleRuntimeStart()
-> colorCyclePlaybackParticipant.sync()
-> live ColorCycleBrushCanvas2D start/stop
```

Authority split:

- Desired playback state is owned by `src/stores/slices/colorCycleSlice.ts`.
- Runtime brush playing state is owned by `src/runtime/playback/PlaybackRuntimeController.ts` and `src/runtime/playback/colorCyclePlaybackParticipant.ts`.
- Cold/warm/active hydration state is owned by `src/stores/layers/createLayersSlice.ts` through `ensureColorCycleLayerRuntime` and `src/stores/layerHydration.ts`.
- Canonical payload state is owned by project/document serialization and restore boundaries in `src/utils/projectIO.ts`; play/pause now audits summaries but does not write canonical payload fields.

## Audit Result

- Play/pause cannot clear canonical CC data through the audited playback path. `toggleGlobalColorCyclePlayback` warms first, starts runtime only after warmup succeeds, and the new `cc-playback-canonical-mutated` event records any canonical summary change across a toggle.
- Play/pause can leave visible static CC pixels with no animation only when warmup fails or a preview-only/repair-failed layer has no recoverable runtime payload. That state is not treated as empty content; it is logged as a warmup/presentation failure and the layer remains cold or repair-failed.
- Failed warmup cannot partially publish CC buffers in the audited archive path. `restoreColorCycleBrushes` validates primary payload presence before brush publication, and the lazy archive corruption regression keeps the old cold state intact.
- Pause does not serialize stale empty runtime state. The pause branch stops runtime handlers and recolor animation state only; it does not replace brush-mode canonical payloads.
- Repeated play/pause is canonical-data idempotent. The focused playback test toggles play/pause 10 times and asserts no canonical mutation event and unchanged canonical buffers.

## Evidence

- `src/utils/colorCyclePlayback.ts`: added the required playback audit events and canonical before/after mutation detection around toolbar/global play-pause.
- `src/utils/__tests__/colorCyclePlayback.test.ts`: covers active visible warmup, visible non-active warmup, hidden cold layer skip, warmup failure blocking runtime start, pause-during-warmup, and 10x play/pause canonical idempotence.
- `src/stores/__tests__/ccRuntime.test.ts`: proves hidden brushes stop without payload clearing, brush replacement restarts despite `lastRuntimeState`, and stale `isAnimating` does not override desired playback state.
- `src/stores/__tests__/layersSlice.integration.test.ts`: proves failed explicit warmup leaves cold state intact, failed brush creation does not publish active/warm runtime, `updateLayer` blocks destructive CC downgrades, and layer switching during warmup publishes warm rather than active.
- `src/utils/__tests__/projectIO.test.ts`: proves lazy archive hydration stays atomic on mid-payload failure, partial canonical state is blocked during save and warmup, missing canonical paint becomes repair/static-preview state, heavy hidden/non-active CC layers stay cold under lazy mode, and deferred archive binaries survive save before warm restore.
- `tests/cc-layer-wipe-scenario-matrix.test.ts`: covers canonical payload proof across save, autosave, export, warmup, selection, and reload-like validation.
- Review-found fix: `src/utils/colorCycle/resolveColorCycleRuntimeRestore.ts` now treats unresolved string paint refs as canonical brush-state authority even when legacy snapshots omit `layerId`, preventing empty live strokes from clearing string-backed brush-state content.
- Review-found fix: `src/stores/helpers/selectionCapture.ts` and `src/stores/helpers/selectionPaste.ts` now preserve CC scalar payload during selection cut/paste when raster alpha is absent, while still blocking truly incomplete target canonical payloads.

## Verification

- `npm test -- --runTestsByPath src/utils/__tests__/colorCyclePlayback.test.ts`
- `npm test -- --runTestsByPath src/stores/__tests__/ccRuntime.test.ts src/hooks/canvas/handlers/colorCycle/__tests__/colorCyclePlayback.sharedRuntime.test.ts src/stores/__tests__/layersSlice.integration.test.ts tests/cc-layer-wipe-scenario-matrix.test.ts`
- `npm test -- --runTestsByPath src/utils/__tests__/projectIO.test.ts`
- `npm test -- --runTestsByPath src/stores/__tests__/historyIntegration.test.ts src/stores/helpers/__tests__/selectionCapture.test.ts src/stores/helpers/__tests__/selectionPaste.test.ts src/hooks/brushEngine/__tests__/ColorCycleBrushCanvas2D.test.ts src/utils/colorCycle/__tests__/resolveColorCycleRuntimeRestore.test.ts`
- `npm run type-check`
- `npm run lint`
- `npm test`

All commands passed on 2026-05-05.
