# Module Size Guardrails (Canvas + Hooks)

Date: 2026-02-08  
Status: Active policy

## Why
We reduced `useDrawingHandlers.ts` and `DrawingCanvas.tsx` from multi-thousand-line hotspots to orchestration shells. This policy prevents regression into monolith files.

## Scope
- `src/hooks/useDrawingHandlers.ts`
- `src/components/canvas/DrawingCanvas.tsx`
- `src/hooks/canvas/useCanvasEventHandlers.ts`
- Any future orchestration-first canvas entrypoints
- `src/components/modals/LoadProjectModal.tsx` (applies for load-flow orchestration work)
- `src/hooks/canvas/handlers/sequential/sequentialCapture.ts`
- `src/lib/sequential/SequentialLayerRenderer.ts`
- `src/lib/sequential/materializer/SequentialCpuMaterializer.ts`

## Policy
1. Orchestration files compose; they do not implement deep workflow logic.
2. Extract non-trivial logic into:
   - `src/hooks/canvas/handlers/**` for side-effectful workflow logic
   - `src/hooks/canvas/utils/**` for pure helper logic
3. Budgets:
   - Soft budget: 400 LOC
   - Hard budget: 700 LOC
4. Any hard-budget exception must include:
   - reason,
   - exit plan to split,
   - link to a tracked refactor plan in `docs/refactor/`.

## PR Checklist (Required for Canvas/Hook Changes)
1. Is the touched orchestration file still under hard budget?
2. Did this PR add a new concern to an orchestration file?
3. If yes, was that concern extracted to `handlers/**` or `utils/**`?
4. Were targeted tests added/updated near extracted code?
5. Did `npm run type-check`, `npm run lint`, and `npm test` pass?

## Suggested CI Guardrail
Add a small check script that fails CI when scoped orchestration files exceed hard budgets. Start with warnings on soft budget and hard-fail on 700+ LOC.

Example command (manual check):

```bash
wc -l src/hooks/useDrawingHandlers.ts src/components/canvas/DrawingCanvas.tsx src/hooks/canvas/useCanvasEventHandlers.ts
```

The active blocking limits are executable in `scripts/check-file-budgets.mjs`.
Sequence capture's pure temporal distribution belongs in
`src/hooks/canvas/utils/sequentialTemporalDistribution.ts`, not in capture
orchestration.

Load modal check:

```bash
wc -l src/components/modals/LoadProjectModal.tsx
```

CC Gradient Click Line completion remains outside the orchestration shells:

- `src/hooks/canvas/handlers/shapes/ccGradientClickLineCompletion.ts` owns the
  explicit double-click/Enter completion contract.
- `src/hooks/canvas/handlers/colorCycle/ccGradientDirectionStage.ts` owns the
  shared multi-color direction-stage entry contract.
- `DrawingCanvas.tsx` and `DrawingCanvasViewport.tsx` only forward the native
  `dblclick` event.

Paint-bucket execution remains outside pointer orchestration:

- `src/hooks/canvas/handlers/fillTool.ts` owns normal raster Fill plus Color
  Cycle canonical Fill and erase-mask Fill Erase behavior.
- `src/hooks/canvas/handlers/pointerHandlersRuntime.ts` only routes the
  pointer-down event into that handler. Its existing hard-budget exception is
  tracked by `docs/refactor/plan-useDrawingHandlers-decomposition.md`; this
  extraction reduced it from 5,074 to 4,911 lines.

Eraser stroke-start acceptance remains in the existing handler boundary:

- `startDrawing.ts` returns whether the stroke was accepted; `startDrawingCallback.ts`
  preserves that result. Visibility, lock and brush compatibility decisions remain
  in `strokeStartLayerGuards.ts`.
- `pointerHandlersRuntime.ts` starts interaction state only after acceptance and
  uses one local cleanup function for rejected direct/bootstrap starts. It is
  4,939 lines after this audit change; the existing exception and split follow-up
  remain `docs/refactor/plan-useDrawingHandlers-decomposition.md`.
- `strokeCapture.ts` normalizes explicit capture bounds before taking the history
  snapshot. This keeps snapshot dimensions and history coordinates identical at
  project edges. Targeted tests exercise real bitmap undo/redo at all four corners.
- The active scope and remaining verification are tracked in
  `docs/refactor/app-functionality-audit-2026-10-10.md`.

Eraser pointer cancellation uses the existing stroke finalization boundary:

- `pointerHandlersRuntime.ts` routes interrupted erasers through `finalizeDrawing`
  regardless of inherited shape mode and preserves the overlay/session until
  finalization can capture pixels and commit history. Repeated cancellation during
  pending finalization preserves that ownership. Existing CC brush cancellation
  remains unchanged.
- Targeted pointer-owner tests cover raster, CC and sequence layers, inherited
  shape mode, deferred finalization and subsequent pointer release/cancellation.
  The pointer owner is 4,943 lines; its existing exception and split follow-up
  remain `docs/refactor/plan-useDrawingHandlers-decomposition.md`.

## Refactor Trigger Rules
- Third-concern rule: if a file now owns 3+ independent concerns, extract before merge.
- Repeated helper rule: if a helper pattern appears 3 times, extract.
- Testability rule: if logic cannot be unit-tested without mounting large UI state, extract into handler/util module.

Freehand selection lifecycle keeps policy in the selection handler:

- `selectionHandlers.ts` owns tool/mode cancellation, baseline restoration, overlay
  cleanup and stale-input suppression through the existing selection cancellation
  seam. It also owns invalid-mask policy and raw polygon closure before project clipping.
- `useCanvasEventHandlers.ts` only wires a layout effect to that owner. It is 70
  lines; `useDrawingHandlers.ts` is 79 and `DrawingCanvas.tsx` is 44 lines.
- Targeted selection tests and real pointer/composition-hook tests cover admission,
  invalid append/replacement, delivered vertices, tool/mode transitions and replay.
  The pointer scheduler uses the existing admitted path identity to reject queued
  pregesture input, including callbacks retained by an older React handler. The
  pointer owner is 4,974 lines and retains its existing decomposition exception.
  The active scope and production/full-gate evidence are recorded in
  `app-functionality-audit-2026-10-10.md`.

Pressure-linked eraser dithering keeps authored support and run state outside the
engine hook:

- `brushEngine/nativeShapeSupport.ts` emits the already-produced native rectangle,
  image or circle into a separate support surface without altering raw drawing.
- `brushEngine/alphaPressureDither.ts` owns current-run support, pending work,
  pressure transitions and the final buffered-tail flush. Full cumulative raw
  remains the sampling authority; only positive current-run support permits writes
  with Smoosh off. Preview publication consumes pending accepted input before
  reading the derived mask, so a later pressure transition cannot publish it late.
- `useBrushEngineSimplified.ts` composes that owner with the existing native facade,
  preview scheduling and finalization callback. Finalization explicitly accepts a
  prepared pressure mask instead of regenerating earlier runs at the last size.
- Direct regression tests cover saturated overlap, untouched islands, transparent
  holes, throttled pending work and tail finalization. Production evidence and
  remaining area scope stay in the functionality-audit ledger.

Completed freehand selection outlines remain in the rendering owner:

- `components/canvas/drawingCanvasSelection.ts` uses the existing cached mask
  contour for freehand holes and project-clipped edges. Stored vector paths remain
  unchanged. Click Line uses the same mask contour while retaining authored anchor circles.
- Its existing test exercises the real contour utility with recording Path2D at
  the rendering boundary, including hole loops and clipped top/right edges.

Click Line mouse admission uses the existing canvas input binding:

- `pointerHandlersRuntime.ts` retains real pointer capture and admits only mouse
  Click Line presses to the native `mousedown` listener. `selectionRuntimeRef`
  holds the admitted pointer ID across handler recreation; up, cancel and selection
  cancellation clear it. Native click count is consumed before mutation. Pen/touch
  remain direct pointer authors; compatibility mouse events cannot author twice.
- The input hook and existing native binding only forward/register the callback.
  Selection history, visible-mask validity, terminal Shift and lifecycle cancellation
  stay in `selectionHandlers.ts` and `keyboardHandlers.ts`. No second snapshot,
  input queue, timer or synthetic PointerEvent was added.
- Protected shells remain 79/44/70 lines. The pointer owner is 5,086 lines under
  its existing exception and split follow-up in
  `docs/refactor/plan-useDrawingHandlers-decomposition.md`. Direct integration
  tests cover native count, near-start tails, initial/active extraction, device
  compatibility, bounds and cancellation; exact production evidence is tracked in
  `docs/refactor/app-functionality-audit-2026-10-10.md`.

Magic Wand selection uses the established selection/history and image-source owners:

- `magicWandSelection.ts` captures the retained selection before a valid mask change
  and commits through the existing selection delta. Rejected samples preserve it.
- `selectionHandlers.ts` admission now only cancels stale gestures. All four
  selection modes capture their own baseline; the superseded preclear branch is removed.
- `selectionCapture.ts` resolves sequential layers from the displayed frame with
  the existing playback/empty-frame policy, before raster fallbacks. Its callers
  pass their existing state explicitly; the shared capture module does not import
  the store it helps construct.
- Composition shells remain 79/44/70 lines and pointer runtime remains 5,086 under
  its existing exception. No orchestration boundary or new workflow was added.
  Exact production and regression evidence is in the functionality-audit ledger.

## Temporary Sequential Baseline Exceptions — 2026-10-28

The audited sequential runtime currently exceeds its existing owner budgets by
24, 4, and 7 lines. To keep those verified runtime bytes unchanged during the
dependency security update, the blocking checker temporarily uses these exact
baseline ceilings, with zero headroom:

| Owner | Normal target | Temporary blocking ceiling | Overage |
| --- | ---: | ---: | ---: |
| `sequentialCapture.ts` | 1250 | 1274 | 24 |
| `SequentialLayerRenderer.ts` | 1100 | 1104 | 4 |
| `SequentialCpuMaterializer.ts` | 2600 | 2607 | 7 |

These are narrow baseline exceptions, not additional growth allowances. All
three entries remain blocking; the checker logic and other limits are unchanged.
On the next implementation change to each owner, perform its planned extraction
and restore its normal target in the same change. The concrete split and
verification exit criteria are tracked in
[Sequential Record and Playback Architecture](plan-sequential-record-mode.md#temporary-size-exception-exit).
No runtime extraction is part of this dependency update.
