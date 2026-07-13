# CC Layer Performance Plan: Playback Ownership, Batched Presentation, GPU Recovery

Last updated: 2026-07-13

Status: implemented; exact restored-file acceptance passed; trace comparison pending

## Goal

Make projects with several animated color-cycle layers smooth without changing
saved CC data, animation semantics, or export output.

The work is ordered by source ownership and evidence:

1. Measure the current playback-to-presentation path with repeatable counters.
2. Make playback the only owner that advances animation and renders a new frame.
3. Batch frame publication into one selective presentation flush per display frame.
4. Make GPU fallback observable and repair the specific fallback reason shown by
   diagnostics.

Do not implement frame-signature skipping as a no-op optimization. CC output is
continuously interpolated between palette entries on both CPU and GPU, so an
unchanged integer palette step does not prove unchanged pixels.

Each implementation phase is a separate focused commit and must pass its own
runtime acceptance gate before the next phase begins.

## Invariants

- `ColorCyclePlaybackController` is the only runtime clock for its animators.
- A frame-ready publication reports completed work; handling it must not advance
  animation or force another animator render.
- Presentation may copy or composite an already-rendered frame, but it must not
  change animation time.
- Explicit operations such as paint finalization, restore, `forceRender()`,
  `setPhase()`, export, and scrubbing may render outside the playback tick.
- CPU and GPU paths preserve the same continuous palette interpolation.
- User-forced Canvas2D is distinct from temporary GPU unavailability.
- Cold/runtime teardown continues through the registry and brush lifecycle that
  already owns animator cleanup; GPU disposal must not create a second lifecycle.

## Phase 0 — Repeatable baseline and counters

### Fixture

Create or identify one stable local `.vessel` fixture with:

- 2048 x 2048 canvas;
- four visible animated CC brush layers;
- non-zero paint on every layer;
- mixed speed bytes, forward/reverse/ping-pong flow, and at least one gradient-def
  palette;
- no active stroke, selection transform, export, or recording.

Use the same fixture for every comparison. Record the fixture path, browser,
machine, commit, viewport, device-pixel ratio, and whether DevTools is open.

### Capture

Run the production preview, wait two seconds for warm-up, then capture ten
seconds of playback:

- DevTools Performance trace;
- FPS and long-frame count;
- `__VESSEL_DUMP_CC_DIAGNOSTICS__()` before and after;
- development-only counters for:
  - playback ticks per brush;
  - `ColorCycleAnimator.renderFrame` calls per layer and render path;
  - presenter composite calls;
  - forced direct renders;
  - frame-ready publications;
  - CC segment-refresh passes;
  - main-canvas redraw requests and committed draws.

Add counters through the existing debug/diagnostic surface. Do not add production
console noise or per-frame object allocation solely for measurement.

### Baseline questions

The trace must answer these before code changes:

1. Does one playback tick cause more than one animator render for the same layer?
2. Does one frame publication advance any other layer's clock?
3. How many layer surfaces are copied for one published layer?
4. How many main-canvas redraws occur per display frame?
5. Which layers use CPU, and why?
6. Is the dominant cost animator rendering, presenter copying/compositing,
   static-composite rebuild, React work, or CPU fallback?

### Acceptance metrics

Use deterministic call-count gates plus same-machine trace comparison:

- one playback tick produces at most one animator render per eligible layer;
- presentation of a completed frame produces zero `updateAnimation()` calls and
  zero forced animator renders;
- at most one CC presentation flush and one main redraw request occur per display
  frame;
- a published layer refresh does not copy unrelated CC layer surfaces;
- the four-layer trace reduces p95 main-thread playback cost by at least 30%
  without making the one-layer trace more than 10% slower;
- no visual, playback-speed, restore, mask, or export parity regression.

If the baseline disproves the suspected duplicate work, update this plan before
implementing a replacement hypothesis.

---

## Phase 1 — Repair playback and presentation ownership

### Current failure

`useDrawingCanvasColorCycleSegmentRefresh.refreshColorCycleSegments` currently
does three different jobs for every CC segment:

1. synchronizes play/stop state;
2. calls `brush.updateAnimation()` for each animated layer;
3. calls `brush.renderDirectToCanvas(...)`.

`updateAnimation()` advances the animator, renders, composites, and publishes a
new frame-ready event. `renderDirectToCanvas(...)` then calls the presenter's
forced-render path before copying the layer surface. Handling one completed frame
can therefore advance every layer and render the publishing layer again.

This is the source contract to fix before event coalescing.

### Change

#### 1. Separate playback lifecycle from frame presentation

- Remove `brush.updateAnimation()` from
  `useDrawingCanvasColorCycleSegmentRefresh`.
- Move play/stop synchronization out of the per-frame refresh pass and into a
  layer/playback-state effect or the existing playback action boundary.
- Keep `ColorCyclePlaybackController.updateAnimation()` as the sole automatic
  advancement path.
- Add a regression assertion that frame-ready handling never calls
  `updateAnimation()`.

#### 2. Add a present-only surface boundary

Add an explicit narrow operation, named for example
`presentCurrentFrameToCanvas(targetCanvas, layerId)`, through the surface brush
contract and `ColorCyclePresenter`.

It must:

- assert that the derived surface matches the current document version;
- copy the animator's already-rendered canvas into the layer canvas;
- apply the layer mask exactly as the current direct path does;
- preserve external-base behavior;
- never call `forceRender()`, `updateFrame()`, `updateAnimation()`, or mutate
  animation time.

Keep the existing forced `renderDirectToCanvas` behavior for explicit callers
that require a fresh render, including restore/commit/export paths. Do not add a
boolean option whose meaning is easy to misuse; use separate named operations.

#### 3. Publish the source layer explicitly

Extend frame publication with the brush/layer that completed the frame:

```ts
type ColorCycleFrameReadyDetail = {
  sourceLayerId: string;
  dirtyBatches?: ColorCycleLayerDirtyBatch[];
};
```

Pass the known layer id through `bindColorCycleFramePublication`. Do not infer it
from `dirtyBatches`: ordinary animation frames may legitimately publish no dirty
document batch.

### Tests

- `useDrawingCanvasColorCycleSegmentRefresh` presents only requested layer ids
  and never advances animation.
- Present-only copying never calls `forceRender`.
- Forced direct rendering retains its existing behavior for explicit callers.
- A frame-ready event carries `sourceLayerId` even when `dirtyBatches` is empty.
- One layer's publication does not advance or render another layer.
- Masks, external bases, cold surfaces, and document-version assertions retain
  their current behavior.

### Runtime gate

On the four-layer fixture, counters show one animator render per playback tick,
no render caused by presentation, correct speed/flow on every layer, and no blank
or stale layer surface.

---

## Phase 2 — Coalesce and selectively present completed frames

### Change

Add a coalescer owned by `useDrawingCanvasRedrawEffects` with a pure helper in
`src/components/canvas/colorCycleFrameCoalescer.ts`.

The queue accumulates:

- `Set<sourceLayerId>` for layer surfaces that need presentation;
- `Map<layerId, ColorCycleDirtyRect[]>` for document dirty batches;
- a redraw-only flag for `vessel:animationFrameUpdate` and
  `vessel:sequentialFrameUpdate`.

On the first request, schedule one flush with the existing
`createRafRedrawQueue` pattern. The flush must:

1. snapshot and clear the accumulator before invoking callbacks;
2. present only the published CC layer ids through the Phase 1 present-only
   operation;
3. rebuild the static composite once when merged dirty batches touch a static
   segment;
4. request one main-canvas redraw;
5. avoid emitting another frame-ready event as a consequence of presentation.

If new publications arrive while a flush is running, retain them for the next
display frame. Cancel the queued callback on effect cleanup.

The accepted cost is up to one display frame of presentation latency. Stroke
preview must be verified separately; do not assume it bypasses this path.

### Tests

- N publications before a flush schedule one rAF callback.
- Repeated source ids are deduplicated.
- Dirty rectangles concatenate per layer without losing disjoint regions.
- Flush snapshots and clears state safely; events raised during flush survive for
  the next frame.
- Cancel drops pending work and permits a later schedule.
- Redraw-only events do not trigger CC surface presentation.
- Presentation emits no recursive frame-ready event.
- Existing redraw, composite-split, mask, and DrawingCanvas smoke tests pass.

### Runtime gate

On the four-layer fixture:

- at most one CC presentation flush and one main redraw request occur per display
  frame;
- only layers that published are copied;
- no self-sustaining second rAF chain remains after playback pauses;
- pausing all CC layers produces zero continuing CC refresh/redraw activity.

---

## Phase 3 — GPU fallback diagnostics and recovery

Ship diagnostics before changing renderer allocation.

### Step 3a — Structured visibility

Track per animator:

```ts
type ColorCycleRenderPath = 'gpu' | 'cpu';

type ColorCycleCpuFallbackReason =
  | 'explicit-force'
  | 'unsupported'
  | 'context-budget-unavailable'
  | 'context-lost'
  | 'renderer-init-failed'
  | 'def-cache-missing'
  | 'def-atlas-capacity'
  | 'def-upload-failed';
```

Record the current path, current reason, transition count, last transition time,
retry count, animator dimensions, content state, and active/max context count.
Warn once per transition, not once per frame.

Expose a narrow `getRenderDiagnostics(layerId)` brush/runtime contract. Do not
reach through the registry into private animator maps from `ccDebug.ts`.
Extend `__VESSEL_DUMP_CC_DIAGNOSTICS__()` with the structured result for every CC
layer.

After this lands, recapture the baseline. Only implement 3b or 3c when the dump
shows that reason on the real fixture.

### Step 3b — Lazy context allocation and retryable budget failure

- Move `RendererWebGL` construction out of `ColorCycleAnimator`'s constructor.
- Create it on the first render with known content. Use the canonical
  document/stroke `hasContent` signal or a maintained `IndexBuffer` content bit;
  do not scan the full paint plane every frame.
- Split explicit Canvas2D preference from temporary GPU availability. A context
  budget failure must not set the explicit `forceCanvas2D` flag.
- On budget exhaustion, render that frame on CPU and retry at a bounded cadence
  such as once per second while content is actively playing or on activation,
  resume, and explicit render. Do not retry every frame.
- On successful retry, upload all required index/palette/def state before the GPU
  frame becomes authoritative.
- Keep registry/brush cleanup as the lifecycle owner. Verify teardown releases
  the context reservation and lazy rendering can reacquire it; do not add a
  parallel hydration observer inside the animator.
- Define context-loss recovery separately from budget retry and preserve the
  existing breadcrumb/reporting behavior.

### Step 3c — Correct def-palette residency reporting

The current `syncDefPaletteAtlasToGPU` already allocates atlas rows and attempts
`setDefPaletteRow` uploads. Repair its result contract instead of adding a second
retry loop around it.

- Return a structured result distinguishing missing palette metadata, atlas
  capacity, texture allocation, row upload, and LUT upload failures.
- Mark a row signature resident only after `setDefPaletteRow` succeeds.
- Do not swallow upload exceptions and then report the row as resident.
- Clamp atlas capacity to both the configured cap and the renderer's
  `MAX_TEXTURE_SIZE`; report required rows and effective capacity.
- Keep successfully uploaded rows resident across frames.
- Fall back to CPU only for the current failed frame/reason, warn once per
  transition, and retry only after relevant cache/capacity/GPU state changes.

### Tests

- Empty lazy animators reserve no WebGL context.
- First content render creates one renderer and uploads complete state.
- Budget exhaustion uses CPU temporarily and later reacquires a released slot.
- Explicit Canvas2D never retries GPU.
- Cleanup releases exactly one context reservation.
- Def row/LUT upload failures remain non-resident and diagnostically distinct.
- Missing metadata is not mislabeled as atlas capacity.
- Successful def uploads do not repeat every frame.
- CPU/GPU pixel parity fixtures pass for speed, phase, flow, masks, and gradient
  definitions.

### Runtime gate

The four-layer dump reports `gpu` for every supported layer. Any CPU layer has an
exact reason and bounded retry behavior. Context counts return to baseline after
layer/runtime cleanup.

---

## Phase 4 — Optional playback cadence decision

Only consider cadence reduction if Phases 1–3 pass and the measured performance
target is still missed.

This is not a no-op optimization. Both renderers continuously interpolate
palette colors, so rendering less often intentionally reduces temporal fidelity.

If a 30 FPS default is chosen:

- change the actual brush-settings/preset default, not only the
  `ColorCycleBrushCanvas2D` constructor fallback;
- preserve persisted user FPS choices and export FPS;
- keep the change in a separate commit with side-by-side 30/60 FPS visual proof;
- verify fast speeds, slow speeds, reverse, ping-pong, scrubbing, and perfect-loop
  export;
- document the product trade-off and rollback independently of the correctness
  and GPU work.

Do not add `ccFrameSkip` based on a maximum-speed integer signature. If adaptive
cadence is pursued later, treat it as a quality policy with explicit visual
budgets, not as detection of unchanged output.

## Sequencing

1. Phase 0 baseline and counters.
2. Phase 1 playback/presentation ownership repair.
3. Recapture counters; stop if the target is already met.
4. Phase 2 selective coalesced presentation.
5. Phase 3a diagnostics.
6. Phase 3b and/or 3c only when diagnostics prove the trigger.
7. Phase 4 only as a separate product/performance decision.

## Implementation outcome

All four implementation phases landed together in the current uncommitted
worktree at the user's explicit request to implement every phase. The code now
has one automatic animator clock, one frame-ready presentation owner, one rAF
coalescer, structured GPU fallback diagnostics with bounded recovery, correct
def-atlas residency reporting, and a 30 FPS default for standard CC presets.

The implementation is not marked `complete` because the original same-machine
DevTools baseline traces and a one-layer baseline trace were not captured before
the work began. The deterministic ownership gates, final production-preview
counters, full regression suite, build, and browser parity checks pass. The two
trace-relative acceptance metrics remain open rather than being inferred from
call counts.

## Plan exit criteria — Definition of Done

Do not mark this plan complete until every required item below is checked and the
completion evidence is recorded in this document.

### Ownership and presentation

- [x] `ColorCyclePlaybackController` is the sole automatic animation clock.
- [x] Handling or presenting a completed frame causes zero `updateAnimation()`,
  `updateFrame()`, or forced animator-render calls.
- [x] One layer's publication never advances or renders another layer.
- [x] Explicit force-render, restore, commit, scrub, and export paths retain their
  current deterministic behavior.

### Frame scheduling

- [x] The four-layer fixture produces at most one CC presentation flush and one
  main redraw request per display frame.
- [x] Only published layer surfaces are copied; unrelated CC layers are not
  refreshed.
- [x] Pausing all CC layers leaves no continuing CC refresh/redraw rAF chain.
- [x] Dirty batches retain every disjoint dirty region and trigger at most one
  static-composite rebuild per flush.

### Performance

- [ ] On the same machine and fixture, the ten-second four-layer trace reduces
  p95 main-thread playback cost by at least 30% from baseline.
- [ ] The equivalent one-layer trace is no more than 10% slower than baseline.
- [x] Counter evidence shows at most one animator render per eligible layer per
  playback tick and zero presentation-induced animator renders.
- [ ] The optimized trace contains no new recurring long-task, React-commit, or
  canvas-blit regression that negates the measured improvement.

### GPU diagnostics and recovery

- [x] Every supported CC layer reports an exact current render path and, when on
  CPU, a structured fallback reason.
- [x] Explicit Canvas2D is distinguishable from unsupported WebGL, temporary
  context-budget exhaustion, context loss, renderer initialization failure,
  missing def metadata, atlas capacity, and upload failure.
- [x] Context and def-palette retries are bounded; no failed operation retries
  every frame.
- [x] Animator/runtime cleanup returns active context reservations to the
  pre-test baseline.
- [x] Phase 3b and 3c are each either implemented and through their runtime gate,
  or marked **not required** in the completion evidence with diagnostic dumps
  showing that the corresponding trigger did not occur in both the four-layer
  fixture and an eight-layer context-budget stress run.

### Correctness and parity

- [x] CPU/GPU pixel-parity fixtures pass for speed, phase, forward/reverse/
  ping-pong flow, masks, and gradient definitions.
- [ ] Live production-preview checks pass for play, pause, resume, layer
  switching, speed changes, drawing, restore, mask application, and cleanup.
- [x] Restore and export tests prove no saved-data, playback-timing, perfect-loop,
  or Goblet parity regression.
- [ ] No animation stepping or temporal-fidelity reduction is introduced by the
  required phases.

### Verification and evidence

- [x] Focused tests, type-check, focused lint, full test suite, build, and
  `git diff --check` pass using the verification workflow below.
- [ ] The exact production-preview interaction passes on the pinned four-layer
  fixture after the final build.
- [ ] The completion evidence records:
  - fixture path and canvas/layer description;
  - baseline and final commit ids;
  - machine, browser, viewport, device-pixel ratio, and preview URL;
  - baseline and final trace locations;
  - baseline and final diagnostics dumps;
  - before/after counter table and p95 measurements;
  - required/not-required decision for Phases 3b and 3c;
  - any separately approved Phase 4 decision.
- [ ] The plan status is changed from `proposed` to `complete` only after this
  checklist and the completion evidence are filled in.

Phase 4 is not required to complete this plan. If separately approved, its own
30/60 FPS visual, persistence, and export gates must pass before that follow-up
is marked complete; it cannot substitute for any required criterion above.

## Completion evidence

Fill this section during implementation. Paths may point to local diagnostic
artifacts when traces are too large to commit, but they must be stable and
specific enough for another reviewer to locate.

- Fixture: live deterministic browser fixture created from the default local
  document at `http://localhost:3001/vessel`; four visible, populated, animated
  CC Stroke layers at 2000 x 2000. This is an explicit deviation from the
  proposed 2048 x 2048 saved `.vessel` fixture, which was not available in the
  repository.
- Baseline commit: `8310456f5623d2213f020cad5eb38698773dd5f2`
  (`fix: harden color-cycle warm restoration`).
- Final commit: uncommitted worktree based on `8310456f5`; no commit was created
  because the user did not request one.
- Environment: Apple Silicon macOS (`arm64`), Headless Chrome 150.0.0.0,
  1920 x 1080 viewport, device-pixel ratio 1, DevTools closed, production preview
  at `http://localhost:3001/vessel`.
- Baseline trace: not captured before implementation; required for the two open
  trace-relative acceptance metrics.
- Final trace: counter/diagnostic capture through the opt-in
  `window.__VESSEL_CC_PERF__` and `window.__VESSEL_DUMP_CC_DIAGNOSTICS__()`
  surfaces; no DevTools Performance trace was saved.
- Baseline diagnostics: the pre-final legacy-presentation sample recorded 1,929
  playback ticks, 2,647 animator renders, 717 forced direct renders, 1,930
  frame-ready publications, 423 presentation flushes, 2,258 surface
  presentations, and 423 main redraw requests.
- Final diagnostics: four populated 2000 x 2000 layers each reported `gpu`, no
  fallback reason, active/max context count `4/8`, and no runtime incidents.
  The measured run recorded exactly 909 ticks, 909 GPU renders, and 909 surface
  presentations per layer. In a separate nine-populated-layer stress run, eight
  layers reported GPU and the ninth reported CPU with
  `context-budget-unavailable` at `8/8` active contexts.
- Counter comparison: final totals were 3,636 playback ticks, 3,636 animator
  renders, 3,636 frame-ready publications, 3,636 presented surfaces, 909
  presentation flushes, and 909 main redraw requests. Forced direct renders and
  CPU renders were both zero. After pause and a fresh counter reset, every
  playback, render, publication, presentation, flush, and redraw counter stayed
  at zero. p95 comparison remains pending because no baseline trace exists.
- Phase 3b decision and evidence: implemented. Empty animators allocate no
  context; content creates the renderer lazily; budget failure falls back with a
  bounded retry; explicit Canvas2D does not retry; cleanup releases exactly one
  reservation. Unit coverage passes and all four primary-fixture layers used
  GPU. In the nine-layer live stress run, the fallback layer retried at the
  bounded cadence, then transitioned from CPU back to GPU and cleared its reason
  after a GPU layer was deleted. Reloading the ephemeral document returned the
  context budget from `8/8` to `0/8`.
- Phase 3c decision and evidence: implemented. Def rows become resident only
  after successful upload, successful rows are reused, failures remain
  non-resident with an exact reason, and effective capacity is clamped to
  `MAX_TEXTURE_SIZE`. Focused renderer tests pass.
- Phase 4 decision: separately approved by the user's instruction to implement
  every phase. Standard CC presets now default to 30 FPS; persisted user FPS
  choices remain unchanged; Goblet export carries 30 FPS; real-Chromium CPU/GPU
  pixel parity passes. The intended trade-off is lower default temporal fidelity
  for lower playback cost. A side-by-side 30/60 visual capture remains open.
- Production-preview result: pass for four-layer creation, drawing, layer
  switching, play, pause, GPU diagnostics, ownership counters, selective
  presentation, and pause settling after the final build. Browser console had
  no errors; Canvas2D `willReadFrequently` advisories appeared during fixture
  paint readback. Restore, mask, and runtime-cleanup interactions are covered by
  tests but were not all repeated manually in the final browser session.
- Restored-file review closeout: loaded
  `/Users/jasonstrachan/+Projects/2026/Art/calibration/1.6.vs` through the real
  production-preview load modal. The 2048 x 2560 version-1.1.0 archive contains
  nine CC layers, eight visible. Before the review fix, a five-second run showed
  all eight visible runtimes rendering on GPU, but only the active layer was
  presented: the active layer had 257 presentations while each of the seven
  non-active layers had 300 GPU renders and zero presentations. After binding
  frame publication for every started runtime, a seven-second run showed every
  visible layer presenting (304-375 presentations each), all eight on GPU, no
  fallback reason, no runtime incidents, and no browser-console errors. Pausing
  then resetting counters produced zero ticks, renders, publications, flushes,
  presentations, and redraws over 2.5 seconds. The active layer speed multiplier
  was changed successfully from 1.00x to 1.50x.
- Review regression coverage: restored runtimes bind publication before start;
  a failed presenter cannot abort later layers; WebGL recreation reuploads
  gradient-definition atlas rows and LUT state; stamp edits keep exact content
  presence without full-buffer scans. The focused review suite passes 41 tests.
- Second review closeout: the legacy `colorCycleFrameUpdate` path now enters the
  same display-frame coalescer as layer frame-ready publications instead of
  drawing the main canvas directly. Bounded raw writes reconcile exact content
  presence by affected 64 x 64 occupancy tiles, and `endDirectFill()` no longer
  invalidates the full plane after a reported dirty region. Linear and
  concentric shape fills now call the GPU fill owner on first use so its lazy
  WebGL initialization path is reachable.
- Final restored-file production proof: after rebuilding the production preview,
  `1.6.vs` loaded through the real modal and all eight visible CC layers reached
  `gpu` with no context loss or fallback reason. The measured playback run
  recorded 317 presentation flushes and exactly 317 main redraw requests; every
  visible layer presented 260-324 surfaces. A sampled main-canvas hash changed
  from `2831120751` to `3038323983` during playback, proving a visible frame
  change. Pause settled after one final queued flush, with playback ticks then
  unchanged for 1.5 seconds. The browser console contained no errors.
- Verification: focused ownership/coalescer/renderer tests pass; TypeScript and
  ESLint pass; the full Jest run passes with 452 suites and 3,215 tests (one
  suite/test skipped); the pinned Node 22 production build passes; real-Chromium
  Goblet CPU/GPU parity passes; `git diff --check` passes.

## Verification before each runtime-fix commit

Run the smallest focused tests first, then:

- `npm run type-check`
- focused ESLint on touched files
- focused CC playback/presenter/redraw/renderer tests
- `npm test`
- `git diff --check`

For build and production-preview verification, use the pinned runtime:

```sh
mise exec node@22.22.0 -- npm run build
```

Do not run a separate build while `npm run preview:prod:watch` owns the build.
Exercise the exact four-layer fixture in the live production preview and save the
after trace and diagnostics beside the baseline evidence before claiming the
phase complete.

## Explicit non-goals

- Saved CC document or archive format changes.
- A single shared playback clock across all brushes in this plan.
- A single shared WebGL renderer/context across all layers.
- Removing continuous palette interpolation.
- Changing dither selection or injecting visual noise.
- Releasing full-resolution hidden-layer runtimes beyond existing registry
  lifecycle policy.
