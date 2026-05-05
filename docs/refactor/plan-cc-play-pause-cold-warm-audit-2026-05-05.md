# CC Play/Pause Cold-Warm Audit Plan

Date: 2026-05-05

Status: planned

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
- `src/utils/colorCycle/ccMutationAudit.ts`
- `src/lib/colorCycle/canonicalPayload.ts`

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

- [ ] Trace `toggleToolbarColorCyclePlayback`.
- [ ] Trace `toggleGlobalColorCyclePlayback`.
- [ ] Trace `playColorCycle`, `pauseColorCycle`, `forceResumeColorCycle`, `suspendColorCycle`, and `resumeColorCycle`.
- [ ] Trace `PlaybackRuntimeController.requestColorCycleRuntimeStart`.
- [ ] Trace `colorCyclePlaybackParticipant.sync`.
- [ ] Trace `colorCycleRuntimeHandlers.start/stop`.
- [ ] Trace `ensureColorCycleLayerRuntime`.
- [ ] Trace `restoreColorCycleBrushes`.
- [ ] Produce a short authority diagram showing playback state, runtime brush state, hydration state, and canonical payload state.

## Phase 2. Playback Telemetry

Add or verify compact diagnostics for:

- [ ] `cc-playback-toggle-requested`
- [ ] `cc-playback-warmup-started`
- [ ] `cc-playback-warmup-complete`
- [ ] `cc-playback-warmup-failed`
- [ ] `cc-playback-runtime-started`
- [ ] `cc-playback-runtime-stopped`
- [ ] `cc-playback-canonical-summary-before`
- [ ] `cc-playback-canonical-summary-after`
- [ ] `cc-playback-canonical-mutated`

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

- [ ] Prove lazy archive refs hydrate into local variables before publishing to `colorCycleData`.
- [ ] Prove failed archive hydration leaves the old cold state intact.
- [ ] Prove failed brush creation does not delete lazy restore authority.
- [ ] Prove missing canonical paint becomes `repairStatus`, not empty runtime truth.
- [ ] Prove warmup cannot publish `gradientIdBuffer` or `gradientDefIdBuffer` without paint/motion payload.
- [ ] Add regression coverage for failure during the middle of lazy archive hydration.

## Phase 4. Playback Participant Behavior

- [ ] Prove visible cold brush-mode CC layers are warmed before runtime start.
- [ ] Prove playback only starts brushes after warmup succeeds.
- [ ] Prove hidden brushes stop without clearing payload.
- [ ] Prove `lastRuntimeState` cannot suppress restart after brush replacement.
- [ ] Prove recolor mode and brush CC mode do not share incorrect assumptions.
- [ ] Add regression coverage for active visible cold layer, visible non-active cold layer, and hidden cold layer.

## Phase 5. Store Mutation Audit

- [ ] Audit every play/pause path that calls `updateLayer`.
- [ ] Prove playback state changes do not overwrite full `colorCycleData` with stale partial data.
- [ ] Prove `updateLayer` cannot change populated canonical CC to empty without authorization.
- [ ] Prove `isAnimating` sync does not carry stale `hasContent: false`.
- [ ] Prove save/autosave cannot run while warmup is mid-transaction.

## Phase 6. Repro Matrix

Run or automate:

- [ ] open cold CC file, press play/pause 10 times,
- [ ] 1 CC layer vs 5 CC layers,
- [ ] active cold layer vs visible non-active cold layers,
- [ ] hidden cold layer,
- [ ] large archive-backed CC payload,
- [ ] corrupt/missing one archive buffer,
- [ ] warmup failure followed by save/autosave,
- [ ] pause during warmup,
- [ ] play during warmup,
- [ ] layer switch during warmup,
- [ ] export after failed warmup.

After every step, assert:

- canonical summary unchanged unless explicitly destructive,
- failed layer remains cold,
- visible canonical CC without runtime logs presentation/warmup issue,
- no `hasContent: true -> false` canonical replacement,
- no autosave of partial warmed state.

## Phase 7. Tests To Add

- [ ] Unit test: toolbar play warms active visible cold brush CC before runtime start.
- [ ] Unit test: toolbar play warms visible non-active cold brush CC before runtime start.
- [ ] Unit test: toolbar play does not warm hidden cold CC layers unless required by explicit playback policy.
- [ ] Unit test: pause does not call canonical payload replacement.
- [ ] Integration test: repeated play/pause preserves `CcPayloadSummary`.
- [ ] Integration test: failed warmup leaves `runtimeHydrationState: cold`.
- [ ] Integration test: failed warmup followed by autosave refuses partial state.
- [ ] Regression test: visible CC preview plus no runtime brush logs warmup/presentation failure.

## Definition Of Done

- We can state whether play/pause can still clear canonical CC data.
- We can state whether play/pause can still leave visible static CC pixels with no animation.
- We can state whether failed warmup can partially publish CC buffers.
- We can state whether pause can serialize stale empty runtime state.
- Repeated play/pause is proven canonical-data idempotent.
- Confirmed failure classes have regression tests.
- Any discovered fix is scoped to the specific playback/warmup authority boundary that failed.
