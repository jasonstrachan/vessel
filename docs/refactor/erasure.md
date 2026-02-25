Here’s a tight, actionable implementation plan that turns the eraser spec into shippable code—minimizing churn, maximizing reuse of your brush pipeline, and staying friendly to CC (Color Cycle) layers, history, and performance.

# Plan: Modular Eraser (mirrors active brush; supports CC erase)

## 0) Feature flag & guardrails

* [x] Add `FF.ERASER_V2` (default: off).
* [x] Toggle paths in `useDrawingHandlers` to new tool only when the flag is on.
* [x] Add a one-line console banner on first use: `[EraserV2] enabled`.

## 1) Layer plumbing: CC erase mask

**Files:** `stores/useAppStore.ts`, `layer init helpers`

* [x] Extend `Layer['colorCycleData']`:

  * `eraseMask: HTMLCanvasElement`
  * `eraseMaskVersion: number` (default 0)
* [x] In `ensureCustomColorCycleLayer` / `initColorCycleForLayer`:

  * Create `eraseMask` size = project size.
* [x] On project resize or layer resize, re-wrap via helper (see §4).
* Rendering hook (after `renderDirectToCanvas` in your CC render loop):

  ```ts
  cctx.save();
  cctx.globalCompositeOperation = 'destination-out';
  cctx.drawImage(layer.colorCycleData.eraseMask, 0, 0);
  cctx.restore();
  ```

## 2) Utilities (small modules)

**New:** `util/ROITracker.ts`

* [x] Minimal class: `addPoint(p)`, `addSegment(a,b, pad)`, `rect(): {x,y,w,h}|null`, `reset()`.
* [x] Use brush half-size + 2px padding.

**New:** `layers/MaskManager.ts`

* [x] `getMask(layerId)`, `clear(layerId)`, `resize(layerId,w,h)`; internal `updateLayer` on swaps.
* [x] Optional `bumpVersion(layerId)`.

## 3) Stamp source wrapper (reuses brush pipeline)

**New:** `tools/stamps/BrushStampSource.ts`

* [x] Wraps your `brushEngine` + `userBrushEngine` + `resolveActiveCustomBrushData`.
* API:

  ```ts
  class BrushStampSource {
    constructor(deps: { brushEngine, userBrushEngine, resolveCustomTip })
    begin(ctx, p, pressure)
    draw(ctx, a, b, { pressure })
    end()
  }
  ```
* Internally chooses user brush vs engine and handles custom tip resolution once.

## 4) Erase strategies (targets)

**New:** `tools/strategies/RasterEraseStrategy.ts`

* [x] For non-CC layers: draws to overlay with `destination-out`, alpha = eraser opacity.

**New:** `tools/strategies/CCMaskEraseStrategy.ts`

* [x] For CC layers: draws to the per-layer `eraseMask` with `source-over` (alpha = eraser opacity).
* [x] On `end()`: `maskManager.bumpVersion(layerId)`.

Common signature:

```ts
interface EraseStrategy {
  begin(target: CanvasRenderingContext2D | Layer, opts: { opacity: number }): void;
  stamp(a, b, pressure: number, stampSource: BrushStampSource): void;
  end(): void;
}
```

## 5) Orchestrator: `EraserTool`

**New:** `tools/EraserTool.ts`

* [x] Implements:

  ```ts
  interface StrokeTool {
    begin(p, pressure?): void;
    move(p, pressure?): void;
    end(): Promise<void>|void;
    cancel(): void;
    getROI(): Rect|null;
  }
  ```
* Chooses strategy based on active layer type (CC → mask strategy, else raster strategy).
* Holds `ROITracker` and `BrushStampSource`.
* All stamping paths go through the same `stampSource.draw(...)` (so eraser always mirrors the active brush).

## 6) Integrate in `useDrawingHandlers`

**Files:** `hooks/useDrawingHandlers.ts`

* [x] Under `FF.ERASER_V2`:

  * [x] Replace bespoke `currentTool === 'eraser'` branches with thin calls:

    * `eraserRef.current = new EraserTool(layer, {opacity: eraserOpacity}, deps)`
    * `eraserRef.current.begin(p, pressure)`
    * `eraserRef.current.move(p, pressure)` in batched loop
    * `await eraserRef.current.end()` in finalize
    * ROI: `eraserRef.current.getROI()` → pass to `scheduleRecompose` & history bitmap delta.
* [x] Keep old fallback path intact when flag is off (safe rollback).

**Finalize logic (eraser):**

* [x] Non-CC layer: same overlay→capture→commit you already do.
* [x] CC layer:

  * No extra draw needed—the mask is applied every frame.
  * Commit a **bitmap delta** of the layer canvas (ROI) for visual history:

    ```ts
    await captureCanvasToActiveLayer(layerCanvas, roi)
    await commitLayerHistory({ layerId, actionType: 'eraser', description: 'Erase CC layer', bitmapRoi: roi, ... })
    ```
  * (Optional, later) Serialize mask (see §8).

**Recompose on move:**

* [x] Query ROI from tool, schedule small recomposes (matches your current CC dirty-rect route).

## 7) UI wiring (size + options)

**Files:** `components/BrushControls.tsx`

* [x] **Size source of truth:** use `globalBrushSize`.

  * [x] `value={globalBrushSize}`
  * [x] `onChange`: always `setGlobalBrushSize(next)`; if tool==='eraser' also mirror `setEraserSettings({size: next})` for UI parity.
* [x] Add small toggle in eraser panel: **“Link size to brush”** (default ON). If OFF, read/write `eraserSettings.size` and pass it to `BrushStampSource` as an override scale.
* [x] Keep `opacity` distinct in `eraserSettings.opacity`.

## 8) (Optional) Full undo/redo fidelity for masks

* **Capture:** extend `captureColorCycleBrushState(layerId)`:

  * Attach `eraseMaskPNG` (lossless) or RLE bytes + `eraseMaskVersion`.
* **Restore:** on history apply:

  * Recreate `eraseMask` canvas from blob and set version.
* This can land as Phase 2 after visual-history MVP ships.

## 9) Testing & acceptance

**Unit (new):**

* [x] `ROITracker` expands correctly for segments and padding.
* [x] `MaskManager.resize` preserves content.
* `CCMaskEraseStrategy` stamps into mask; mask pixels increase alpha as expected.

**Integration (manual & automated harness):**

1. [ ] **Brush parity:** select Square/Custom/Resampler; erase → the hole silhouette matches the brush.
2. [ ] **Size/opacity live:** move sliders while erasing → immediate effect.
3. [ ] **CC animation:** CC playing; erase while playing → holes persist and animate underneath.
4. [ ] **History:** multiple short erases coalesce (as per your coalesce rules). Undo/redo restores before/after visuals.
5. [ ] **Resize project:** mask resizes with preserved holes.
6. [ ] **Performance:** 4K canvas, 30–60fps while erasing; no long `requestIdleCallback` violations.

**Acceptance criteria:**

* Erasing **always** uses the active brush’s geometry (except when “Link size” OFF).
* CC layers show holes immediately; animation continues smoothly.
* No regression to non-CC erasing or brush drawing.
* Memory steady (no unbounded mask canvases).

## 10) Perf & telemetry

**Perf marks (consistent with your scheme):**

* [x] `perfMark('eraser:begin') / :move / :end`
* [x] `perfMark('cc:mask:apply')` around the destination-out composite in the CC renderer
* [x] `perfMeasure('eraser:roi-build')` per stroke

**Telemetry events (debuggable):**

* [ ] `eraser_v2_used` { layerType, brushShape, linkedSize: bool }
* [ ] `cc_mask_erase_roi` { w, h, area }
* Sample to 5% in prod.

**Budgets:**

* 4K canvas: ≤ 2ms per stamp batch (median) on M1/M2; ≤ 8ms p95 for large custom tips.

## 11) Rollout

* Ship behind `FF.ERASER_V2`.
* Dogfood on non-production builds; enable per-user param in store for quick toggle.
* Once stable, default ON; retain flag for 1–2 versions.

---

## Minimal code sketches (copy/paste starters)

**`util/ROITracker.ts`**

```ts
export class ROITracker {
  private minX = Infinity; private minY = Infinity;
  private maxX = -Infinity; private maxY = -Infinity;
  private last: {x:number;y:number}|null = null;

  addPoint(p:{x:number;y:number}, pad=0) {
    this.minX = Math.min(this.minX, p.x - pad);
    this.minY = Math.min(this.minY, p.y - pad);
    this.maxX = Math.max(this.maxX, p.x + pad);
    this.maxY = Math.max(this.maxY, p.y + pad);
    this.last = p;
  }
  addSegment(a:{x:number;y:number}, b:{x:number;y:number}, pad=0) {
    this.addPoint(a, pad); this.addPoint(b, pad);
    this.last = b;
  }
  lastPoint(){ return this.last; }
  rect(){ if(!isFinite(this.minX)) return null;
    const x = Math.floor(this.minX), y = Math.floor(this.minY);
    const w = Math.ceil(this.maxX) - x, h = Math.ceil(this.maxY) - y;
    return {x,y,width:w,height:h};
  }
  reset(){ this.minX=this.minY=Infinity; this.maxX=this.maxY=-Infinity; this.last=null; }
}
```

**`tools/strategies/CCMaskEraseStrategy.ts` (core)**

```ts
export class CCMaskEraseStrategy implements EraseStrategy {
  private ctx!: CanvasRenderingContext2D;
  constructor(private maskManager: MaskManager, private layerId: string) {}
  begin(_layer: Layer, opts: {opacity:number}) {
    const mask = this.maskManager.getMask(this.layerId);
    this.ctx = mask.getContext('2d', { willReadFrequently: true })!;
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.globalAlpha = opts.opacity ?? 1;
  }
  stamp(a, b, pressure, stampSource: BrushStampSource) {
    stampSource.draw(this.ctx, a, b, { pressure });
  }
  end(){ this.maskManager.bumpVersion?.(this.layerId); }
}
```

**`tools/strategies/RasterEraseStrategy.ts` (core)**

```ts
export class RasterEraseStrategy implements EraseStrategy {
  constructor(private overlayCtx: CanvasRenderingContext2D) {}
  begin(_ctx, opts:{opacity:number}) {
    this.overlayCtx.globalCompositeOperation = 'destination-out';
    this.overlayCtx.globalAlpha = opts.opacity ?? 1;
  }
  stamp(a, b, pressure, stampSource: BrushStampSource) {
    stampSource.draw(this.overlayCtx, a, b, { pressure });
  }
  end() {}
}
```

**`tools/EraserTool.ts` (skeleton)**

```ts
export class EraserTool implements StrokeTool {
  private roi = new ROITracker();
  constructor(
    private layer: Layer,
    private opts: {opacity:number},
    private deps: {
      overlayCtx: CanvasRenderingContext2D,
      maskManager: MaskManager,
      brushStampFactory: ()=>BrushStampSource,
      brushHalfSize: ()=>number
    }
  ){
    const isCC = layer.layerType === 'color-cycle';
    this.strategy = isCC
      ? new CCMaskEraseStrategy(deps.maskManager, layer.id)
      : new RasterEraseStrategy(deps.overlayCtx);
    this.stamp = deps.brushStampFactory();
    this.strategy.begin(isCC ? layer : deps.overlayCtx, opts);
  }
  private strategy: EraseStrategy;
  private stamp: BrushStampSource;

  begin(p, pressure=0.5) { this.stampSegment(p,p,pressure); }
  move(p, pressure=0.5)  { this.stampSegment(this.roi.lastPoint() ?? p, p, pressure); }
  end() { this.strategy.end(); }
  cancel() {}
  getROI(){ return this.roi.rect(); }

  private stampSegment(a,b,pressure){
    this.strategy.stamp(a,b,pressure,this.stamp);
    const pad = Math.ceil(this.deps.brushHalfSize()) + 2;
    this.roi.addSegment(a,b,pad);
  }
}
```

---

## Scope & risks

**In scope:** parity erasing with any brush; CC-compatible erasing via mask; ROI-based recomposition; visual-history deltas; perf/telemetry.

**Deferred:** mask serialization; multi-layer erasing; vector CC fills eraser preview; special CC modes (recolor) interaction (should still “just work” visually).

**Risks / mitigations:**

* **Mask growth in memory:** one canvas per CC layer—same footprint as layer canvas. Mitigate with lazy creation (only when eraser first hits CC layer).
* **Brush size linkage confusion:** default “link size = ON”; add small toggle to avoid surprises.
* **History mismatch (pre-serialization):** visual bitmap deltas are captured; if users rapidly scrub undo while CC animates, frames remain correct (mask reapplied). Full fidelity comes with mask serialization (Phase 2).

---

## Rollout sequence

1. Land utilities + strategies + tool (dead code, behind flag).
2. Wire CC render loop to apply mask (harmless if mask empty).
3. Integrate in `useDrawingHandlers` behind `FF.ERASER_V2`.
4. UI: link size toggle + slider unification.
5. Tests + perf marks.
6. Enable for dev builds; then default ON.

If you want, I can generate the exact diffs for `useDrawingHandlers` (start/move/finalize) with the new `EraserTool` calls next.
