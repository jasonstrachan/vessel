# Sequential Record Performance Sign-off

Date baseline: 2026-02-08  
Scope: `CC-Native Sequential Record Mode` manual Step 11 closure

## Purpose
This checklist is the manual, browser-side sign-off flow for sequential recording performance.

Automated guardrails already exist (`npm run perf:sequential`, sequential runtime/materializer tests).  
This document covers the final interactive validation only.

## Preconditions
1. Use a development build (`npm run dev`).
2. Enable feature flag:
   - `enableSequentialRecordMode = true`
3. Use a project with at least one `sequential` layer.
4. Keep browser devtools console open.

## Quick Automated Baseline
Run:

```bash
npm run perf:sequential
```

Expected:
1. Command passes.
2. Log includes `[SequentialPerfSmoke]`.
3. No budget assertion failures.

## Manual Browser Sign-off
### 1) Reset probe metrics
In console:

```js
window.vesselSequentialPerf.resetMetrics()
window.vesselSequentialPerf.clearSamples()
window.vesselSequentialPerf.printSnapshot()
```

Record the initial snapshot.

### 2) Baseline capture session (2 minutes)
1. Select a sequential layer.
2. Set representative controls:
   - `FPS`: 12
   - `Frames`: 24
   - `Time-smear`: 1.0x
3. Press `Play`.
4. Draw continuously/intermittently for ~2 minutes using:
   - normal brush
   - custom/resampler brush
   - color-cycle brush path routed to sequential

After 2 minutes, run:

```js
window.vesselSequentialPerf.recordSample()
window.vesselSequentialPerf.printSnapshot()
window.vesselSequentialPerf.summarizeSamples()
```

Record:
1. `metrics.avgTickMs`
2. `metrics.lastTickMs`
3. `metrics.frameCacheEntries`
4. `metrics.frameCacheHits`
5. `metrics.frameCacheMisses`
6. `sequentialPayloadBytes`
7. `currentFrame` / `frameCount`

### 3) Stress capture session
Repeat with:
1. `FPS`: 24
2. `Frames`: 32
3. `Time-smear`: 2.0x
4. Larger canvas / dense stroke input

Capture a second probe snapshot.

### 4) Optional sample-based summary loop
If you want periodic sampling without external tooling:

```js
window.vesselSequentialPerf.clearSamples()
const interval = setInterval(() => window.vesselSequentialPerf.recordSample(), 2000)
// ... run your capture session ...
clearInterval(interval)
window.vesselSequentialPerf.summarizeSamples()
```

## Pass/Fail Criteria
Pass requires all:
1. Perceived recording/playback remains smooth (target: 30 FPS-class feel, no persistent visible stutter).
2. No runtime lockups, crashes, or runaway frame jumps.
3. `sequentialPayloadBytes` remains below hard cap (`96 MB`) during test.
4. Cache metrics behave plausibly:
   - `frameCacheEntries` bounded (does not grow unbounded).
   - hits increase during playback loops.
5. Export and undo/redo still function for captured session.

Fail if any:
1. Reproducible jank that makes recording unusable.
2. Payload hard cap triggers unexpectedly under normal use.
3. Cache growth appears unbounded.
4. Deterministic behavior breaks (frame drift, undo/redo mismatch, export mismatch).

## Report Template (PR / plan notes)
Paste this block and fill values:

```md
### Sequential Perf Sign-off
- Build/date:
- Machine/browser:
- Scenario A (12fps / 24f / smear 1.0):
  - avgTickMs:
  - lastTickMs:
  - frameCacheEntries/hits/misses:
  - sequentialPayloadBytes:
  - notes:
- Scenario B (24fps / 32f / smear 2.0):
  - avgTickMs:
  - lastTickMs:
  - frameCacheEntries/hits/misses:
  - sequentialPayloadBytes:
  - notes:
- Result: PASS / FAIL
```
