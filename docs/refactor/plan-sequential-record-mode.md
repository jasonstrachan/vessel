# Sequential Record and Playback Architecture

Date: 2026-09-04
Status: Implemented

## Outcome

Vessel records live drawing into deterministic sequence layers while one shared
transport drives preview, capture, compositing, and export. Sequence clips may
use different FPS and frame counts without borrowing the active layer's frame
number.

## Product Contract

- Play/Pause controls preview only.
- `Record while drawing` explicitly arms capture.
- Capture is active only while recording is armed, a sequence layer is active,
  and the pointer is down.
- Each sequence layer owns its FPS and frame count.
- Changing frame count requires an explicit policy:
  - Preserve hidden marks keeps out-of-range events so they return if the range grows.
  - Trim removes out-of-range events.
  - Retime maps events proportionally into the new range.
- Temporal placement is expressed as separate controls:
  - Temporal spread distributes existing stamps without creating new density.
  - Trail fade scales alpha across distributed buckets.
  - Burst and Gap define deterministic on/off frame windows.

## Time Authority

`src/runtime/playback/sequentialFrameCursor.ts` owns sequence transport time.
The shared animation runtime advances that time once per tick. Every sequence
layer maps it to a local frame using:

`floor(timeMs * clipFps / 1000) % clipFrameCount`

Paused scrubbing resets transport time from the selected frame. Capture reads
the same per-layer mapping; it does not maintain a second wall-clock cursor.

Export opens an isolated timeline override, sets exact time from the export
frame and export FPS, and clears that override on completion. Export never
mutates the live Zustand playback state.

## Canonical Data

- Persisted truth is an append-only `SequentialStrokeEvent[]` per layer.
- Each event stores an immutable frame index, resolved post-spacing stamps, and
  a normalized brush snapshot.
- Decoded events in the same stroke chunk share one normalized brush snapshot
  in memory.
- Rendered frames, presentations, worker results, and live overlays are derived
  and non-authoritative.
- Custom stamp capture remains single-frame because its raster payload cannot
  be split safely.

## Materialization

- CPU output is canonical.
- Current-frame cache misses go to the worker once a previous presentation is
  available; that presentation remains visible until the worker result arrives.
- Worker completion dispatches a sequence redraw event.
- Frame, presentation, and completed-worker caches are bounded by bytes as well
  as entry count.
- The GPU flag is reserved. `SequentialGpuMaterializer` fails closed until a
  real GPU implementation exists, so CPU work cannot be reported as GPU work.

## Bounds and Safety

- Stamp capture uses a deterministic 6,000 stamps/second token bucket.
- Project payload warning and hard-stop thresholds remain 32 MB and 96 MB.
- The hard stop disarms recording as well as ending active capture.
- Capture checkpoints flush buffered events without making frame caches canonical.
- Runtime metric writes are sampled at 250 ms rather than written every frame.

## Export

- Loop suggestions include each sequence clip's exact cycle rate
  (`clipFps / clipFrameCount`) alongside Color Cycle rates.
- Mixed sequence clips therefore export at the first shared exact loop within
  the existing search ceiling.
- Goblet continues to serialize every source sequence frame and its frame map
  from the canonical materializer.

## Module Boundaries

- Capture orchestration: `src/hooks/canvas/handlers/sequential/sequentialCapture.ts`
- Pure temporal placement: `src/hooks/canvas/utils/sequentialTemporalDistribution.ts`
- Transport: `src/runtime/playback/sequentialFrameCursor.ts`
- Materialization/cache: `src/lib/sequential/**`
- Panel composition: `src/components/panels/AnimationControlsPanel.tsx` and
  `SequentialControlsModule.tsx`

Blocking budgets in `scripts/check-file-budgets.mjs` cover the capture,
renderer, and CPU materializer hotspots.

## Verification Gate

- Store tests prove arm/capture and preserve/trim/retime behavior.
- Cursor and runtime tests prove one time authority and per-layer rates.
- Capture tests prove spread/fade/burst/gap without densification.
- Export tests prove exact mixed-clip loop periods.
- Renderer tests prove byte bounds, worker deferral, and CPU fallback.
- `npm run perf:sequential` enforces the deterministic 512x512 materialization
  smoke budget.
- Production preview must prove explicit arm, live drawing capture, playback,
  and frame advancement before the feature is considered signed off.

## Separate Follow-up

Pixel-identical regular dither capture still requires the versioned canonical
raster-patch migration described in
`plan-sequential-dither-canonical-kernel-2026-02-10.md`. Existing sequence dither
replay shares the stamp-dither kernel, but regular region-postprocess dither and
sequence vector replay do not yet share the same intermediate raster.
