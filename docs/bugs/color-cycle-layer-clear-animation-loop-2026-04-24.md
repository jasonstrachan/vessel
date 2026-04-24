## Color Cycle Layer Clear Animation Loop

Date: 2026-04-24

Problem

- A color-cycle layer could clear completely and remain visually empty even though the app stayed alive.
- After the clear, new shapes painted through the CC gradient sample path could still stick.
- Production tracing on the older build showed a repeating `requestAnimationFrame` stack rather than a crash.

Observed facts

- The failure was not a full browser or renderer crash.
- The app remained interactive enough to accept new sampled CC shape input afterward.
- The bad production stack was dominated by repeated `requestAnimationFrame` scheduling.
- This strongly suggested a color-cycle runtime loop continuing after the layer no longer had animated content to render.

What turned out to be wrong

- The color-cycle brush animation runtime could remain active after the last painted content on a layer had been cleared.
- That left an animation loop alive for a layer with no remaining animated pixels.
- In that state, the layer could appear blank while the animation runtime kept ticking.

Root cause

- `ColorCycleBrushCanvas2D` did not stop its animation loop when the final animated content disappeared.
- Clearing the paint buffer removed visible content, but the animation state could still remain active.
- The runtime then kept scheduling animation ticks with no remaining animated stroke content to drive.

What landed in code

Files:

- `src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts`
- `src/hooks/brushEngine/__tests__/ColorCycleBrushCanvas2D.regression.test.ts`

Code changes:

1. Added `hasAnimatedContent()`.
   - Scans `layerStrokes` and returns `true` only when at least one stroke still has content.

2. Stop the loop after clearing the last content.
   - After `clearPaintBuffer(...)` forces a render, the brush now checks `hasAnimatedContent()`.
   - If no animated content remains and the brush was still animating, it calls `stopAnimation()`.

3. Bail out at the top of the animation tick when content is gone.
   - `handleAnimationTick(...)` now checks `hasAnimatedContent()` before continuing.
   - If the layer has no remaining animated content:
     - `isAnimating = false`
     - `isPaused = false`
     - `animationFrameId = null`
     - no new animation frame is scheduled

Why this fixes the bug

- The animation runtime is now tied to real animated content instead of only prior playback state.
- Clearing the final content no longer leaves a zombie animation loop running.
- That prevents the empty cleared layer from continuing to churn frames after its animated buffers are gone.

Regression coverage

- `ColorCycleBrushCanvas2D.regression.test.ts` now includes:
  - `stops the animation loop after the last color-cycle layer is cleared`

What that regression test verifies

- A brush can be animating with real content.
- Clearing the paint buffer for the last content-bearing layer immediately stops playback.
- After pending frames are drained, no further animation frames remain scheduled.

Notes from production comparison

- The old production build still reproducing the clear bug does not contradict the local fix.
- The production behavior:
  - layer clears completely
  - new sampled CC shapes still stick
  - repeated `requestAnimationFrame` loop
  is consistent with the pre-fix animation-loop behavior described here.

Status

- This document records the layer-clearing bug separately from the sampled CC shape drag hang.
- The two issues can both involve color-cycle rendering, but this bug was specifically about animation continuing after the last animated content was cleared.

Related bug document

- `docs/bugs/sampled-cc-shape-drag-hang-2026-04-22.md`
  - separate issue covering the sampled CC shape drag hang and the later composite bitmap invalidation loop

---

## Follow-up Findings

Date: 2026-04-24

Why the first fix was not sufficient

- The earlier `ColorCycleBrushCanvas2D` fix correctly stopped the brush-local animation loop when the final animated content disappeared.
- That did not fully eliminate the production-style blank-layer behavior.
- Later tracing showed a second runtime owner could keep animation alive even when the global play/pause state was paused.

What the later capture proved

- A sampled CC shape could finalize successfully while global playback remained paused.
- The debug overlay showed:
  - `resumeColorCycleAfterInteraction()` ended with `shouldResume: false`
  - `globalIsPlaying: false`
  - repeated `renderAllCC`
  - repeated `RAF tick`
  - `reason: "cc-runtime"`
  - `animating: 1`
- That combination proved the shared runtime was still rendering because at least one color-cycle layer remained flagged as animating even though the UI playback state was paused.

Updated root cause

- The remaining loop was not owned by the toolbar/global playback toggle.
- A stale layer-level `colorCycleData.isAnimating = true` could survive sampled shape persist/finalize.
- `syncCCRuntimes()` in `src/stores/ccRuntime.ts` treated that stale layer flag as authoritative and restarted `colorCycleRuntimeHandlers.start('cc-runtime')`.
- Once that happened, the shared runtime kept rendering the layer while paused, which matched the repeated `requestAnimationFrame` stack and `cc-runtime` overlay logs.

Files involved in the second failure path

- `src/stores/ccRuntime.ts`
- `src/hooks/canvas/handlers/colorCycle/colorCycleShapeFill.ts`
- `src/hooks/canvas/handlers/colorCycle/colorCyclePlayback.ts`
- `src/hooks/canvas/createDrawingPlaybackSync.ts`
- `src/hooks/canvas/useDrawingPlaybackSyncEffect.ts`
- `src/hooks/canvas/useDrawingPlaybackStoreTraceEffect.ts`

What landed in code for the follow-up fix

1. Prevent sampled shape persist from preserving a stale animating flag.
   - `persistCommittedSampledSlot(...)` now rewrites `colorCycleData.isAnimating` from effective playback state instead of blindly preserving the previous value.

2. Guard `ccRuntime` against paused global playback.
   - `syncCCRuntimes()` now only treats a layer as animating when both of these are true:
     - the layer requests animation
     - global playback is effectively active
   - It also no longer requests `colorCycleRuntimeHandlers.start('cc-runtime')` while global playback is paused.

3. Add broader diagnostics around playback state drift.
   - Added overlay logs for:
     - playback store flips
     - start/stop sync decisions
     - shared runtime register/start/cancel
     - blank-frame fallback renders
   - These logs were used to prove the paused-global / stale-layer mismatch.

What we learned about the play/pause button

- Multiple UI entry points were deriving playback state differently.
- Some code paths used `desiredPlaying`.
- Others used `effectivePlaying`.
- The panel also mixed in sequential state when deciding whether to show Play or Pause.
- That allowed the button label and the underlying playback intent to drift apart.

What landed for the play/pause source of truth

- Added shared playback selectors in `src/stores/useAppStore.ts`:
  - playback UI state
  - playback toggle action
- Added a single toolbar toggle helper in `src/utils/colorCyclePlayback.ts`.
- Updated playback UI consumers to use the shared selector/helper instead of open-coded local interpretations.

Regression coverage added/updated

- `src/stores/__tests__/ccRuntime.test.ts`
  - verifies `cc-runtime` does not start while global playback is paused, even if a layer flag is stale
- `src/hooks/canvas/__tests__/createDrawingPlaybackSync.test.ts`
  - verifies sync decision logging captures playback and layer snapshots
- `src/hooks/canvas/handlers/colorCycle/__tests__/colorCyclePlayback.sharedRuntime.test.ts`
  - remains green with the new shared-runtime diagnostics
- `src/components/panels/__tests__/AnimationControlsPanel.test.tsx`
  - verifies Play / Pause / Resume button behavior from shared state
- `src/utils/__tests__/colorCyclePlayback.test.ts`
  - verifies the single toolbar toggle helper routes to pause or resume correctly

Revised understanding of the bug

- There were two distinct zombie-loop paths:
  1. brush-local animation continuing after the last animated content disappeared
  2. shared `cc-runtime` playback restarting from stale layer animation state while global playback was paused
- The second path explains why the first fix improved the system but did not fully eliminate the blank-layer repro.

---

## Handover

Date: 2026-04-24

Current state

- The bug is not fully resolved.
- The layer can still clear visually after enough sampled CC shape commits.
- However, the latest capture no longer shows the previously confirmed runtime-loop owner.

What the latest repro ruled out

- The latest overlay dump after another clear did **not** show:
  - `cc-runtime`
  - `renderAllCC`
  - `RAF tick`
  - `shared runtime blank frame`
- It still showed:
  - sampled shape finalize completing
  - `shouldResume: false`
  - `globalIsPlaying: false`
- That means the remaining repro is no longer explained by the stale-layer / paused-runtime restart path that was previously fixed.

Why recent patches should not be backed out

- The newer fixes addressed real, independently proven faults:
  - stale `isAnimating` surviving sampled persist
  - `cc-runtime` restarting while global playback was paused
  - play/pause UI drift across multiple consumers
- The later repro did not disprove those fixes.
- Backing them out would likely reintroduce confirmed bugs without explaining the remaining layer-clear failure.

Most likely remaining failure

- The next strongest hypothesis is now a sampled commit/render-state mismatch rather than a playback-state mismatch.
- The suspicious signals from the latest capture were:
  - `bindingSlot: 94`
  - `paintSlotAfterPersist: 0`
  - runtime snapshot still reporting `paintSlot: 0`
  - `paletteCount: 95`
- That suggests the sampled commit may be persisting a new palette slot while the active paint/render path continues resolving through slot `0`, or the committed layer snapshot/canvas is not being rebound to the newly persisted sampled slot.

Primary files to inspect next

- `src/hooks/canvas/handlers/colorCycle/colorCycleShapeFill.ts`
- `src/hooks/canvas/handlers/colorCycle/colorCycleCommit.ts`
- `src/hooks/brushEngine/ccGradientRuntime.ts`
- `src/hooks/brushEngine/ccGradientApplyScheduler.ts`
- any path that derives or reapplies:
  - `paintSlot`
  - active gradient slot
  - slot palettes
  - committed layer snapshot render state

Next debugging target

- Instrument the sampled commit/render path around:
  - persisted `bindingSlot`
  - resulting `paintSlot`
  - active gradient slot / active gradient id
  - post-commit canvas content / snapshot content
  - brush runtime state after `persistCommittedSampledSlot(...)`
- The next pass should prove whether the layer clears because:
  1. the new sampled slot is never becoming the active paint slot
  2. a later write resets `paintSlot` back to `0`
  3. the brush snapshot/canvas render path ignores the persisted sampled slot

Recommended next step

- Keep the current runtime/playback fixes in place.
- Do **not** back out the recent patches yet.
- Add focused diagnostics and tests for sampled slot persistence and active paint-slot rebinding after sampled shape finalize.

Latest pass

- The sampled shape persist path now stores the committed sampled binding slot as `colorCycleData.paintSlot`.
- This directly targets the captured mismatch where `bindingSlot` advanced while `paintSlotAfterPersist` stayed at `0`.
- Added a regression proving a sampled linear shape bound to slot `94`:
  - fills with `paintSlotOverride: 94`
  - persists `paintSlot: 94`
  - applies the brush runtime active slot as `94`
- No extra debug overlay fields were added in this pass because the existing `shape: sampled persist begin/end` logs are enough to verify whether `bindingSlot` and `paintSlotAfterPersist` now match.

Near-slot-ceiling smoke

- Added smoke coverage for sampled/def slot pressure near the 8-bit ceiling.
- Confirmed slot `253` is the final valid committed sampled slot.
- Confirmed reserved slots are not used for committed sampled defs:
  - `254` remains the temporary sampled preview slot.
  - `255` remains the editor slot.
- When old defs have no pixel references, slot GC can free and reuse old sampled slots instead of failing.
- When slots `0..253` are all still referenced by pixels, allocation returns `null` rather than using `254` or `255`.
