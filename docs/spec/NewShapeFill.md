# 🖌️ Shape Fill System — v1.4 (Final + UI Integration)

---

## 🎯 Overview
A deterministic, CPU-only modular system for procedural shape fills such as **Hatch**, **Contour**, and **Stipple**.  
This version adds full **UI integration**, registering *Shape Fill* as a brush type with its own parameter panel and interactive adjustment previews.

---

## 📁 Module Layout
src/shapeFill/
├─ index.ts ← orchestrator / state machine / keyboard controls
├─ shapeFactory.ts ← builds ShapeDefinition from drag points
├─ parameterAdjuster.ts ← maps cursor distance → parameter value
├─ paramPreview.ts ← lightweight guides for spacing / rotation / etc.
├─ fillStrategies/
│ ├─ hatch.ts ← main test fill (rotation + spacing)
│ ├─ contour.ts
│ ├─ stipple.ts
├─ renderers/
│ └─ cpuRenderer.ts ← pure Canvas 2D renderer
├─ types.ts ← shared types & enums
└─ utils/
├─ geometry.ts
├─ math.ts
└─ random.ts

yaml
Copy code

---

## 🧱 Core Types (`types.ts`)
```ts
export type Vec2 = { x: number; y: number };

export interface ShapeDefinition {
  id: string;
  points: Vec2[];
  centroid: Vec2;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface FillParams {
  spacing: number;
  rotation: number;
  thickness: number;
  variance?: number;
  seed?: number;
}

export interface FillResult {
  lines?: Vec2[][];
  dots?: Vec2[];
  polygons?: Vec2[][];
}

export enum FillStage { Drawing, AdjustingParam, Finalized }

export interface ShapeFillSession {
  stage: FillStage;
  points: Vec2[];
  params: Partial<FillParams>;
  paramQueue: (keyof FillParams)[];
  shape?: ShapeDefinition;
  currentParam?: keyof FillParams;
}

### Parameter Ownership & Defaults

- `hatch`  
  - Ignores `variance`.  
  - Uses `seed` only when `organic` is enabled; otherwise derives from `hashPoints(shape.points)` to keep outputs reproducible.  
- `contour`  
  - Consumes `variance` to modulate contour band spacing (`variance ?? 0`).  
  - Seeds its internal RNG with `seed ?? hashPoints(shape.points)`.  
- `stipple`  
  - Requires both `variance` (dot jitter/density) and `seed` (stable dot placement).  
- All strategies must declare their fallbacks so `ShapeFillSession.params` can omit unused keys without breaking determinism.
✏️ Shape Factory (shapeFactory.ts)
ts
Copy code
import { Vec2, ShapeDefinition } from './types';
import { computeCentroid, computeBounds } from './utils/geometry';

export function createShape(points: Vec2[]): ShapeDefinition {
  const centroid = computeCentroid(points);
  const bounds = computeBounds(points);
  return { id: crypto.randomUUID(), points, centroid, bounds };
}
Sampling rules

≥ 6 px movement between points

Max ≈ 2 000 points

Optional post-simplification

🎚️ Parameter Adjuster (parameterAdjuster.ts)
ts
Copy code
export function adjustParameterFromCursor(
  shape: ShapeDefinition,
  cursor: Vec2,
  param: keyof FillParams,
  base: number,
  scale = 1
): number {
  const dx = cursor.x - shape.centroid.x;
  const dy = cursor.y - shape.centroid.y;
  const distance = Math.hypot(dx, dy);
  return base + distance * scale;
}
// NOTE: Callers must clamp/wrap the returned value to the UI range for the active param.
Shared by preview + final render for pixel-perfect consistency.

👁️ Parameter Preview (paramPreview.ts)
ts
Copy code
export function drawAdjustmentPreview(
  ctx: CanvasRenderingContext2D,
  shape: ShapeDefinition,
  param: keyof FillParams,
  value: number
) {
  ctx.save();
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.strokeStyle = '#999';
  ctx.setLineDash([4, 4]);

  switch (param) {
    case 'spacing':
      ctx.beginPath();
      ctx.arc(shape.centroid.x, shape.centroid.y, value, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'rotation':
      const len = 80;
      const rad = (value * Math.PI) / 180;
      const { x, y } = shape.centroid;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(rad) * len, y + Math.sin(rad) * len);
      ctx.stroke();
      break;
  }
  ctx.restore();
}

### Fill-Specific Previews

- `hatch`: spacing ring + rotation arm (existing behavior).  
- `contour`: render lightweight concentric contour bands previewing current spacing/variance.  
- `stipple`: scatter a representative subset of dots, modulated by `variance`, inside the shape bounds.  
- Additional fills may register their own preview handlers; defaulting to spacing/rotation visuals should be an explicit choice, not an omission.
🪶 Hatch Fill (fillStrategies/hatch.ts)
Adjustable parameters: spacing (px) and rotation (deg)

ts
Copy code
import { ShapeDefinition, FillParams, FillResult, Vec2 } from '../types';
import { computeBounds, pointInPoly } from '../utils/geometry';

export function hatchFill(shape: ShapeDefinition, params: FillParams): FillResult {
  const { rotation, spacing, thickness = 1 } = params;
  const angle = (rotation * Math.PI) / 180;
  const bounds = computeBounds(shape.points);
  const pad = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const cx = shape.centroid.x;
  const cy = shape.centroid.y;

  const rng = createRng(hashPoints(shape.points));

  const main = buildLineSet({ angle, spacing, bounds, pad, cx, cy, rng, organic: 0.7 });
  const cross = buildLineSet({
    angle: angle + Math.PI / 2,
    spacing,
    bounds,
    pad,
    cx,
    cy,
    rng: createRng(hashPoints(shape.points) ^ 0x51633e2d),
    organic: 0.7,
  });

  const result: FillResult = { lines: [] };
  drawLineSet(result, main, bounds, shape.points);
  drawLineSet(result, cross, bounds, shape.points);
  return result;
}
(see project code for deterministic RNG + line generation helpers)

🖼️ CPU Renderer (renderers/cpuRenderer.ts)
ts
Copy code
export function renderFill(ctx: CanvasRenderingContext2D, result: FillResult) {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#000';
  result.lines?.forEach(line => {
    ctx.beginPath();
    ctx.moveTo(line[0].x, line[0].y);
    line.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.stroke();
  });
  ctx.restore();
}
🧠 Orchestrator (index.ts)
Handles drag sampling, parameter stages, commit/cancel, and performance limits.

Key constants
SAMPLE_DISTANCE = 6, MAX_POINTS = 2000, MOVE_INTERVAL_MS = 16

Pointer/keyboard handlers call advanceToNextParam() → preview → final render.
Enter = commit · Esc = cancel.

🪶 New Brush Type (UI Integration)
Add to brush selector:

ts
Copy code
{ id: 'shapeFill', label: 'Shape Fill' }
When active, top toolbar shows fill-type buttons and per-fill parameter sliders.
Each fill exports a UI schema, e.g.:

ts
Copy code
export const hatchUI = {
  label: 'Hatch',
  params: [
    { key: 'spacing', label: 'Spacing', type: 'number', min: 1, max: 200, step: 1, default: 10 },
    { key: 'rotation', label: 'Rotation', type: 'number', min: 0, max: 180, step: 1, default: 45 },
    { key: 'thickness', label: 'Line Width', type: 'number', min: 0.2, max: 10, step: 0.1, default: 1 },
    { key: 'cross', label: 'Crosshatch', type: 'boolean', default: false },
    { key: 'organic', label: 'Organic', type: 'number', min: 0, max: 1, step: 0.05, default: 0.7 },
  ],
};
UI reacts dynamically to activeFill.

🧭 User Workflow
Stage	Input	Visual
Draw Shape	Click + drag	Outline follows cursor
Adjust Spacing	Move cursor	Ring preview
Commit	Click	Lock spacing
Adjust Rotation	Move cursor	Angle line preview
Commit	Click	Render fill
Enter	Force commit	
Esc	Cancel/reset	

⚙️ Memory & Performance Policy
Concern	Mitigation
Point explosion	6 px sampling + 2 000 cap
Event spam	16 ms throttle
Idle sessions	optional auto-cancel (8 s)
Memory leak	explicit destroySession()
Ghost artifacts	clear overlay only
Determinism	seeded RNG per shape

✅ Design Outcome
Deterministic CPU-only rendering

Lightweight parameter previews

Extensible fill registry

Predictable UX (drag → adjust → commit)

Integrated UI with live controls

≤ 2 ms typical render · ≤ 100 KB session memory

## 🛠️ Implementation Plan

1. **Bootstrap Module Skeleton**
   - Create `src/shapeFill/` folder tree (or reuse if present) matching the layout above.
   - Add minimal stub implementations that compile (avoid TODO noise) for `index.ts`, `shapeFactory.ts`, `parameterAdjuster.ts`, `paramPreview.ts`, `fillStrategies/*`, `renderers/cpuRenderer.ts`, `types.ts`, and `utils/*`.
   - Wire `tsconfig.json` path alias (`@/shapeFill/*`) if needed and ensure barrel exports (`src/lib/index.ts`) point to the orchestrator once stable.

2. **Define Shared Types & Utilities**
   - Implement `types.ts` with `Vec2`, `ShapeDefinition`, `FillParams`, `FillResult`, `FillStage`, and `ShapeFillSession` plus the parameter ownership table.
   - Build deterministic helpers in `utils/` (`geometry.ts`, `math.ts`, `random.ts`) including `hashPoints`, `createRng`, bounds/centroid math, and any reusable numeric utilities.
   - Add unit tests under `src/shapeFill/__tests__/` for geometry and RNG determinism.

3. **Shape Sampling & Session State**
   - Implement `shapeFactory.ts` using sampling constraints (≥6 px, ≤2 000 points) and throttling constants.
   - Create session manager in `index.ts` handling stages, pointer/key events, parameter queue, and `destroySession`.
   - Integrate with `useAppStore` by adding a new slice (or extending existing tools slice) for `activeFill`, session params, and orchestration actions.
   - Extend `useBrushEngineSimplified` via a shape-fill adapter so the orchestrator plugs into the existing brush pipeline (activation, undo/redo, autosave).

4. **Parameter Adjustment Mechanics**
   - Complete `parameterAdjuster.ts` with clamping/wrapping per parameter, honoring UI ranges and defaults.
   - Implement fill-specific parameter default resolver so `ShapeFillSession.params` starts with strategy defaults (including `variance`/`seed` usage).
   - Cover with unit tests validating cursor-driven adjustments and clamping rules.

5. **Preview Overlay System**
   - Build `paramPreview.ts` with the shared ring/rotation visuals plus pluggable handlers.
   - Implement contour/stipple preview renderers (bands + dot scatter) and register them via strategy metadata.
   - Connect previews to the orchestrator so they update on pointer move during the AdjustingParam stage; ensure canvas overlay clears reliably.

6. **Fill Strategies**
   - Implement `fillStrategies/hatch.ts`, `contour.ts`, `stipple.ts` using deterministic RNG and shared helpers.
   - Honor parameter ownership defaults, including `organic`, `variance`, and `seed`.
   - Add integration tests (or golden snapshot comparisons) validating deterministic outputs for fixed seeds.

7. **CPU Renderer & Commit Path**
   - Implement `renderers/cpuRenderer.ts` with efficient Canvas2D drawing and minimal allocations.
   - Ensure renderer handles each `FillResult` primitive (`lines`, `dots`, `polygons`) gracefully.
   - Wire orchestrator commit/cancel pathways to produce final render calls and update undo/redo via `useAppStore`.

8. **UI Integration**
   - Extend brush selector to include `{ id: 'shapeFill', label: 'Shape Fill' }` and register iconography.
   - Build parameter panel section reading strategy metadata with sliders/toggles, including contour/stipple previews.
   - Hook panel interactions into the session state, ensuring live updates and deterministic replays.
   - Register shape-fill strategies with `BrushRegistry` so the engine can resolve them by brush id.

9. **Testing & Validation**
   - Update/add Jest tests for utilities, orchestrator state transitions, and renderer regressions (use deterministic fixtures).
   - Add Playwright/Jest DOM tests (if available) covering UI workflow (draw → adjust → commit → undo).
   - Run `npm run type-check`, `npm run lint`, `npm test`; document manual sanity steps (drawing, parameter previews, undo/redo).

10. **Documentation & Follow-up**
   - Update user-facing docs (e.g., `docs/` guides) with workflow instructions and known limitations.
   - Note future roadmap items: additional fills, GPU acceleration, offline export formats.
   - Prepare release notes summarizing new brush type, defaults, and preview behaviors.



Here are the key files that make up the new Shape
  Fill feature:

  - src/shapeFill/types.ts, parameters.ts,
    shapeFactory.ts, parameterAdjuster.ts,
    strategies.ts, renderers/cpuRenderer.ts, and
    the strategy files (fillStrategies/hatch.ts,
    contour.ts, stipple.ts), plus their helpers in
    utils/ – this core module defines shape/session
    types, parameter logic, deterministic fill
    strategies, and the Canvas2D renderer.
  - src/shapeFill/index.ts – the orchestrator that
    manages Shape Fill sessions (point capture,
    parameter stages, finalization payloads) and
    hooks into the store.
  - src/components/toolbar/ShapeFillControls.tsx
    and the additions to src/components/toolbar/
    BrushControls.tsx – the UI that surfaces the
    Shape Fill brush, lets you pick strategies, and
    exposes live parameter controls.
  - src/stores/useAppStore.ts – the Zustand slice
    for Shape Fill (active strategy, parameter
    persistence, session actions, orchestration
    wiring, finalize/cancel paths).
  - src/hooks/canvas/handlers/shapes/
    ShapeToolHandler.ts and src/components/canvas/
    DrawingCanvas.tsx – integrates the brush with
    pointer workflows: drawing polygons, showing
    clipped previews, rendering fills immediately,
    and feeding the result into undo/redo history
    and composite redraw.