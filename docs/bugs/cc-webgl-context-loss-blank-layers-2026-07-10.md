# Color-Cycle Layers Go Blank After WebGL Context Loss

Date: 2026-07-10

Status: fixed and verified; review findings resolved

## Problem

Multiple color-cycle layers appeared to clear at approximately 19:02 AEST while the app remained open. The layers still existed, and later diagnostics continued to report canonical CC content, but their visible presentation was blank.

This was a presentation failure, not a confirmed destructive paint-buffer clear.

## Original Incident Evidence

The diagnostic dump was captured at 19:10:28 AEST. Its shared 200-entry breadcrumb ring began at 19:03:55 AEST, so the event at approximately 19:02 and the action immediately preceding it had already been overwritten.

The surviving post-incident evidence showed:

- four affected CC layers still reported `hasContent: true`,
- runtime brushes still existed,
- the layers were still composited from warm or active runtime surfaces,
- no `cc-playback-canonical-mutated` event was recorded,
- no destructive CC mutation explained the visual disappearance.

The dump therefore established a presentation/runtime failure class, but it did not by itself prove the original trigger.

## Minimal Reproduction

The failure was reproduced in the production preview at `http://localhost:3001/` using a real CC layer and `WEBGL_lose_context`:

1. Paint visible CC content.
2. Confirm the layer presentation contains visible pixels.
3. Force loss of the animator's WebGL context.
4. Request another layer render/composite.

Before the fix:

- sampled opaque presentation pixels before loss: `62,500`,
- sampled opaque presentation pixels after loss: `0`,
- `colorCycleData.hasContent`: `true`,
- real `gl.isContextLost()`: `true`,
- Vessel `brush.isContextLost()`: `false`,
- `animator.getCanvas()` still returned the lost WebGL canvas.

This exactly reproduced the important state signature from the incident: canonical content remained while the presentation surface became blank.

## Root Cause

Three contracts were wrong together:

1. `ColorCycleCanvasLifecycleApiRuntime.isContextLost()` was hard-coded to return `false`.
2. `ColorCycleAnimator.hasWebGL()` treated the existence of a renderer object as proof that the GPU surface was usable.
3. `ColorCycleAnimator.getCanvas()` and `drawTo()` preferred `glCanvas` whenever the object existed, even after its context was lost.

After context loss, the presenter cleared the target 2D layer canvas and copied the dead GPU canvas into it. The canonical index buffers were never cleared, but the visible CC presentation became empty.

## Fix

### Context-aware renderer selection

- `WebGLColorCycleRenderer.isContextLost()` now reports the real GL state.
- `RendererWebGL` exposes that state to `ColorCycleAnimator`.
- `ColorCycleAnimator` treats a lost context as unusable.
- Rendering, `getCanvas()`, `drawTo()`, and GPU fill capability checks fall back to the existing Canvas2D renderer when the context is lost.
- The brush lifecycle now reports context loss truthfully across its animators.

The canonical CC buffers remain the source for both renderers, so the fallback does not reconstruct or mutate document state.

### Immediate high-signal incident capture

The original shared breadcrumb ring was not a sufficient black box because routine playback and composite events could evict the incident within minutes.

The replacement diagnostic contract is:

- `VESSEL_RUNTIME_INCIDENTS` is a separate localStorage journal for the latest 100 high-signal incidents.
- Routine breadcrumbs cannot evict incident entries.
- `webglcontextlost` is captured at the browser event, not later during a render poll.
- Each context-loss incident records:
  - exact epoch timestamp,
  - layer id,
  - canvas dimensions,
  - WebGL version,
  - WebGL1/WebGL2 context type,
  - unmasked GPU vendor/renderer when available,
  - context status message,
  - page URL.
- Destructive CC mutation events are mirrored into the same incident journal.
- The official CC dump now includes:
  - incident journal,
  - mutation log,
  - surrounding breadcrumbs,
  - last crash and hang reports,
  - live CC layer/runtime state,
  - context-loss and WebGL-use status,
  - a 64×64 whole-canvas presentation probe.

The journal is browser/profile/origin-local. Clearing site data or switching origins removes or separates the evidence.

When `localStorage` is unavailable or rejects a write, the current browser session's in-memory journal remains authoritative. Later incidents and diagnostic dumps retain those entries even though they cannot survive a page reload without browser storage.

## Post-fix Browser Proof

Forced context loss after the fix produced:

- opaque presentation pixels before loss: `62,500`,
- opaque presentation pixels after loss: `62,500`,
- `hasContent: true`,
- `runtimeContextLost: true`,
- `runtimeUsesWebGL: false`,
- Canvas2D selected as the render surface,
- incident persisted after 250 noisy breadcrumb writes.

The final production dump recorded:

```json
{
  "scope": "cc-render",
  "event": "webgl-context-lost",
  "severity": "error",
  "data": {
    "canvasSize": "2000x2000",
    "contextType": "webgl2",
    "vendor": "Google Inc. (Apple)",
    "renderer": "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, Unspecified Version)",
    "version": "WebGL 2.0 (OpenGL ES 3.0 Chromium)"
  }
}
```

The layer id and timestamps are intentionally omitted from this document example because they are per-session values; the persisted incident contains both.

## Regression Coverage

- `src/lib/__tests__/ColorCycleAnimator.directFill.test.ts`
  - proves a lost GPU context selects and renders the Canvas2D surface.
- `src/utils/__tests__/runtimeIncidentJournal.test.ts`
  - proves incidents persist independently from routine breadcrumbs,
  - proves retention is capped at the latest 100 incidents,
  - proves consecutive incidents remain available in memory when storage writes fail.
- `src/lib/colorCycle/rendering/__tests__/WebGLColorCycleRenderer.test.ts`
  - proves context loss releases the renderer reservation immediately,
  - proves later disposal does not release the shared reservation twice.
- `src/debug/__tests__/ccDebug.test.ts`
  - proves the official CC dump exposes incidents, breadcrumbs, and capture time.
- Existing WebGL upload tests remain green and prove normal dirty-rect GPU publication is unchanged.

## Verification

- `npm run type-check`
- `npm run lint`
- full Jest suite: 439 suites passed, 3,120 tests passed, 1 existing skip
- `mise exec node@22.22.0 -- npm run build`
- production-browser forced context-loss reproduction

## Next Incident Procedure

The incident journal is written automatically. After any future CC disappearance, keep the same browser origin and export the official dump:

```js
copy(JSON.stringify(window.__VESSEL_DUMP_CC_DIAGNOSTICS__(), null, 2))
```

Read `incidents` first:

- `cc-render / webgl-context-lost` proves a GPU context-loss event and identifies the affected layer/device.
- `cc-mutation` proves a covered destructive state transition and includes before/after snapshots.
- no matching incident, with canonical content still present, means a different presentation path must be investigated.

## Evidence Limitation

The fix is for a real, independently reproduced bug that matches the original failure signature. Because the original 19:02 event was absent from the dump, it is not possible to claim with absolute certainty that WebGL context loss caused that specific historical occurrence. A recurrence will now be captured at the context-loss event in the current session rather than inferred from later state; persistence across a reload still requires writable browser storage.

## Review Findings Resolved

1. The incident journal now initializes one canonical in-memory list from storage and appends to that list. Failed storage writes no longer cause later incidents or dumps to replace it with stale persisted data.
2. A spontaneous `webglcontextlost` event now releases the renderer's internal context reservation immediately. The same guarded release path is used by constructor failure and disposal, so loss followed by disposal cannot decrement the shared budget twice.

## Related Documents

- `docs/notes/cc-layer-disappearing-diagnostics-2026-04-29.md`
- `docs/bugs/color-cycle-layer-clear-animation-loop-2026-04-24.md`
