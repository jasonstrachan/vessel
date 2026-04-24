# Architecture Stabilization Plan

Date: 2026-04-24

## Implementation Status

Last updated: 2026-04-24.

- [x] Phase 0 baseline recorded.
- [x] Phase 0 dependency map recorded.
- [x] Phase 5 report-mode guardrail scripts added.
- [x] Phase 5 worker and test type-check scripts added.
- [x] Phase 5 CI wiring added for report-mode architecture checks, app
  type-check, worker type-check, and test type-check.
- [x] Phase 1 `layersSlice` domain extraction. Clone, group, CRUD/order,
  color-cycle gradient/slot/buffer, composite invalidation, composite render
  segment, and sequential append helpers are extracted under
  `src/stores/layers/`; the public slice entrypoint is now a facade over the
  layer-domain coordinator.
- [x] Phase 1 `layersSlice` and extracted coordinator budgets made blocking
  after extraction.
- [x] Phase 2 Goblet/WebGL export extraction.
- [x] Phase 2 `webglExporter.ts` budget made blocking after extraction.
- [x] Phase 3 single playback runtime owner.
- [x] Phase 4 canvas runtime consolidation.
- [x] Phase 4 canvas hotspot budgets made blocking after extraction.
- [x] Phase 5 raw logging and store-access guards made strict after cleanup.
- [x] Phase 5 stricter lint warning rules made errors after cleanup.

## Goal

Reduce the main architectural risk areas that remain after the first round of
store, canvas, and export decomposition.

This plan focuses on:

1. Splitting `layersSlice` and Goblet/export into real domain services.
2. Creating one color-cycle/sequential playback runtime owner.
3. Replacing canvas bridge sprawl with fewer, stronger runtime modules.
4. Adding CI guardrails for size, logging, store access, worker type-checking,
   and stricter lint.

## Current Snapshot

Known hotspots from the architecture review:

- `src/stores/slices/layersSlice.ts`: 4639 LOC.
- `src/utils/export/webglExporter.ts`: 5219 LOC.
- `src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts`: 7514 LOC.
- `src/hooks/canvas/handlers/pointerHandlers.ts`: 4472 LOC.
- `src/hooks/canvas/handlers/shapes/ShapeToolHandler.ts`: 4349 LOC.
- `src/stores/slices/toolsSlice.ts`: 2625 LOC.
- `src/hooks/useBrushEngineSimplified.ts`: 2013 LOC.
- Production `src` still has many direct `useAppStore.getState()` and
  `console.*` usages outside test-only paths.

## Baseline Snapshot

Recorded on 2026-04-24 before implementation work in this plan.

### File Size Baseline

| File | Current LOC | Target | Current guard status |
| --- | ---: | ---: | --- |
| `src/components/canvas/DrawingCanvas.tsx` | 42 | 700 | blocking |
| `src/hooks/useDrawingHandlers.ts` | 79 | 700 | blocking |
| `src/hooks/canvas/useCanvasEventHandlers.ts` | 43 | 700 | blocking |
| `src/stores/slices/layersSlice.ts` | 4639 | 900 | report until Phase 1 |
| `src/utils/export/webglExporter.ts` | 5219 | 600 | report until Phase 2 |
| `src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts` | 7514 | TBD by separate CC brush plan | report only |
| `src/hooks/canvas/handlers/pointerHandlers.ts` | 1 | 900 | blocking |
| `src/hooks/canvas/handlers/shapes/ShapeToolHandler.ts` | 1 | 900 | blocking |
| `src/stores/slices/toolsSlice.ts` | 2625 | TBD by later tools slice plan | report only |
| `src/hooks/useBrushEngineSimplified.ts` | 2013 | TBD by brush engine cleanup plan | report only |

### Raw Access Baseline

The first report-mode guardrail run found:

- `440` raw `console.*` calls in production `src` after excluding tests,
  dev-only routes, debug helpers, and approved error boundary/debug utilities.
- `217` direct `useAppStore.getState()` calls in the React/canvas scan after
  excluding tests and known store/history/service boundaries.

These counts are intentionally non-blocking at the start of this plan. They
become blocking only after the relevant cleanup phase removes or centralizes the
existing debt.

### Dependency Map

Layer operations:

- Current owner: `src/stores/slices/layersSlice.ts`.
- Direct collaborators: `src/stores/helpers/*`, history helpers/deltas under
  `src/history/**`, canvas compositing hooks under `src/components/canvas/**`,
  color-cycle brush/runtime helpers under `src/stores/colorCycleBrushManager.ts`
  and `src/stores/ccRuntime.ts`.
- Refactor target: keep Zustand action names stable while moving clone,
  grouping, color-cycle state, compositing, and sequential event logic into
  domain services.

Layer compositing:

- Current owners: `layersSlice`, `src/components/canvas/drawingCanvasCompositeStack.ts`,
  `src/components/canvas/useDrawingCanvasCompositeBuffers.ts`, and related
  canvas rendering hooks.
- Refactor target: separate dirty-region/invalidation decisions from actual
  render coordination.

Color-cycle slot and gradient layer mutation:

- Current owners: `layersSlice`, `src/utils/colorCycleGradientDefs.ts`,
  `src/utils/colorCycleGradients.ts`, `src/stores/helpers/colorCycleSelection.ts`,
  and color-cycle canvas handlers.
- Refactor target: a layer color-cycle state service owns slot/def
  normalization and buffer guards; callers request mutations through typed
  service functions.

Goblet metadata export:

- Current owner: `src/utils/export/webglExporter.ts`.
- Direct collaborators: `src/utils/export/types.ts`, layer/project state,
  color-cycle brush state, sequential state, and export modal call sites.
- Refactor target: explicit Goblet snapshot and serializers, with no direct
  global store reads inside export internals.

Goblet runtime asset/template export:

- Current owner: `src/utils/export/webglExporter.ts`.
- Direct collaborators: generated Goblet runtime assets in `public/` and build
  scripts such as `scripts/build-goblet-runtime.mjs`.
- Refactor target: runtime asset resolution, HTML building, zip building, and
  download triggering live in separate services.

Playback start/stop synchronization:

- Current owners: global store playback state, `src/stores/ccRuntime.ts`,
  `src/utils/colorCyclePlayback.ts`, color-cycle canvas handlers, sequential
  runtime hooks, and brush-local animation loops.
- Refactor target: one playback runtime controller schedules global RAF work
  and participants expose only capabilities and tick hooks.

Canvas pointer/shape orchestration:

- Current owners: `src/hooks/canvas/handlers/pointerHandlers.ts`,
  `src/hooks/canvas/handlers/shapes/ShapeToolHandler.ts`, and many build/bridge
  helper files under `src/hooks/canvas/**`.
- Refactor target: feature runtimes for input, stroke, shape, selection, and
  render scheduling, with compatibility shells left thin.

The earlier docs remain useful, but they describe first-pass extraction:

- `docs/refactor/plan-zustand-store-slicing.md`
- `docs/refactor/plan-export-service-extraction.md`
- `docs/refactor/module-size-guardrails.md`

This plan is the follow-up pass: move from "split into files" to enforceable
domain ownership.

## Non-Goals

- Do not redesign the persisted project format in this plan. That belongs to
  `docs/refactor/plan-project-persistence-architecture-2026-04-23.md`.
- Do not change user-facing behavior while extracting modules.
- Do not introduce feature flags for purely internal refactors unless rollback
  cannot be handled by reverting a focused patch.
- Do not broaden UI redesign or panel layout work.

## Principles

- Store slices should coordinate state updates, not implement heavy rendering,
  serialization, migration, or canvas algorithms.
- Export code should consume explicit snapshots/contracts, not read directly
  from global app state.
- Playback should have one runtime owner that decides whether animation is
  active. Layers and brushes can expose capabilities and content state, but
  should not independently start global loops.
- Canvas runtime modules should be named by responsibility, not by bridge/build
  plumbing.
- CI should fail on architectural regression before files become multi-thousand
  line hotspots again.

## Phase 0: Baseline and Safety Net

### Tasks

- Record current line-count baseline for known hotspots.
- Record current `useAppStore.getState()` and `console.*` counts excluding tests,
  generated artifacts, and dev-only pages.
- Add a short dependency map for:
  - layer operations,
  - layer compositing,
  - color-cycle slot/gradient layer mutation,
  - Goblet metadata export,
  - Goblet runtime asset/template export,
  - playback start/stop synchronization,
  - canvas pointer/shape orchestration.

### Deliverables

- A baseline section appended to this document or a linked snapshot under
  `docs/refactor/`.
- A short list of modules that each phase is allowed to touch.

### Validation

- `npm run type-check`
- `npm run lint`
- Targeted tests for any touched files.

## Phase 1: Split `layersSlice` into Domain Services

### Problem

`layersSlice` currently owns too many concerns:

- layer CRUD and order,
- group management,
- color-cycle gradient and slot normalization,
- layer duplication and migration,
- framebuffer/canvas cloning,
- compositing segment state,
- composite invalidation,
- sequential append routing.

This makes layer changes risky because a small layer operation can accidentally
affect rendering caches, color-cycle state, history, or project persistence.

### Target Boundaries

Create focused modules under `src/stores/layers/` or `src/layers/`:

- `layerCrudService.ts`
  - add, duplicate, remove, reorder, select active layer.
- `layerGroupService.ts`
  - group creation, visibility, group cleanup, hidden group ids.
- `layerCloneService.ts`
  - clone `ImageData`, `HTMLCanvasElement`, `OffscreenCanvas`, framebuffer data.
- `layerColorCycleState.ts`
  - color-cycle layer normalization, gradient defs, slot palettes, buffer guards.
- `layerCompositeInvalidation.ts`
  - mark dirty segments, all-segment invalidation, recomposition flags.
- `layerCompositeRenderer.ts`
  - static composite render and color-cycle overlay render coordination.
- `sequentialLayerEvents.ts`
  - append single/batch sequential events and metadata updates.

`layersSlice` should become the coordinator that wires these services into
Zustand actions.

### Migration Steps

1. Extract pure helpers first without changing call order.
2. Move canvas/framebuffer clone utilities into `layerCloneService`.
3. Move group helpers into `layerGroupService`.
4. Move color-cycle gradient/slot normalization into `layerColorCycleState`.
5. Move composite segment invalidation/render helpers into dedicated modules.
6. Keep exported `LayersSlice` action names stable.
7. Add tests beside each extracted service.

### Definition of Done

- `src/stores/slices/layersSlice.ts` is under 900 LOC.
- `src/stores/layers/createLayersSlice.ts` is covered by a blocking
  no-growth budget until its remaining action orchestration can be split into
  smaller coordinator modules.
- No extracted service exceeds 800 LOC without a follow-up split note.
- Existing layer, history, color-cycle, and composite split tests pass.
- No new direct component imports from layer internals.

### Validation

- `npm run type-check`
- `npm run lint`
- `npm test -- src/stores/__tests__/layersSlice.unit.test.ts src/stores/__tests__/layersSlice.integration.test.ts src/stores/__tests__/layersSlice.compositeSplit.test.ts src/stores/__tests__/historyIntegration.test.ts`
- Add or update targeted tests for each new service.

## Phase 2: Split Goblet/WebGL Export into Domain Services

### Problem

`webglExporter.ts` combines too many responsibilities:

- layer texture capture,
- Goblet metadata serialization,
- color-cycle serialization,
- sequential serialization,
- runtime asset fetch and inlining,
- HTML template mutation,
- zip packaging,
- download triggering,
- diagnostic logging,
- direct store access.

This makes export changes hard to reason about and keeps Goblet tightly coupled
to live editor state.

### Target Boundaries

Create modules under `src/utils/export/goblet/`:

- `gobletTypes.ts`
  - public request, metadata, layer, animation, and asset contracts.
- `gobletSnapshot.ts`
  - builds an explicit export snapshot from app state at the call site.
- `gobletLayerSerializer.ts`
  - normal/raster layer metadata and placement.
- `gobletColorCycleSerializer.ts`
  - CC gradients, slots, masks, buffers, brush-state serialization.
- `gobletSequentialSerializer.ts`
  - sequential frame/event metadata and frame texture capture.
- `gobletTextureEncoder.ts`
  - canvas/ImageData/ImageBitmap to data URL or packed asset.
- `gobletRuntimeAssets.ts`
  - resolves, fetches, caches, and validates Goblet runtime assets.
- `gobletHtmlBuilder.ts`
  - title/background sanitization, runtime injection, single-file HTML.
- `gobletZipBuilder.ts`
  - zip package creation and asset naming.
- `downloadBlob.ts`
  - browser-only download helper.

`webglExporter.ts` should become a compatibility facade around these services.

### Migration Steps

1. Extract type definitions without behavior change.
2. Extract runtime asset fetching and HTML building.
3. Extract texture encoding.
4. Extract normal layer serialization.
5. Extract color-cycle serialization with parity tests.
6. Extract sequential serialization with parity tests.
7. Move `useAppStore` reads out of export internals.
8. Keep `exportProjectAsWebGL(...)` as the public API until consumers migrate.

### Definition of Done

- `src/utils/export/webglExporter.ts` is under 600 LOC and acts as a facade.
- Export internals do not import `useAppStore`.
- Goblet and Goblet2 tests pass.
- Single-file and zip export paths share serializers where possible.

### Validation

- `npm run type-check`
- `npm run lint`
- `npm run verify:goblet2-inline`
- `npm test -- tests/goblet2-runtime-regression.test.ts tests/goblet2-bundle.test.ts tests/goblet-runtime-embed-sizing.test.ts tests/export-webgl-viewport.test.ts src/utils/export/__tests__/webglExporter.test.ts src/utils/export/__tests__/webglExporter.helpers.test.ts`
- `npm run test:goblet2:single-file-smoke`

## Phase 3: Create One Playback Runtime Owner

### Problem

Recent color-cycle bugs showed multiple animation owners:

- global playback store state,
- layer-level `colorCycleData.isAnimating`,
- brush-local animation loops,
- shared `cc-runtime`,
- sequential capture/playback state,
- UI play/pause derivations.

This allows stale layer flags or brush-local state to restart work while global
playback is paused.

### Target Design

Create a single playback owner under `src/runtime/playback/`:

- `PlaybackRuntimeController.ts`
  - sole owner of global RAF start/stop decisions.
- `playbackState.ts`
  - discriminated state model: `idle`, `playing`, `suspended`, `capturing`,
    `scrubbing`.
- `playbackParticipants.ts`
  - registry for color-cycle and sequential participants.
- `colorCyclePlaybackParticipant.ts`
  - adapts color-cycle layer/render runtime to the controller.
- `sequentialPlaybackParticipant.ts`
  - adapts sequential layer runtime to the controller.
- `playbackSelectors.ts`
  - UI-safe selectors for button labels and actions.

### Ownership Rules

- Only `PlaybackRuntimeController` schedules global playback RAF loops.
- Layers expose `hasAnimatedContent`, speed metadata, and desired eligibility.
- Brush instances may render ticks when asked, but do not own app-global RAF
  scheduling.
- UI consumers use shared selectors/helpers only.
- `colorCycleData.isAnimating` is not an authoritative runtime-start source.
  If retained, it is derived or migration-only.

### Migration Steps

1. Wrap existing `colorCycleRuntimeHandlers` behind the new controller.
2. Move play/pause/suspend/resume semantics into `PlaybackRuntimeController`.
3. Register color-cycle layers as participants.
4. Register sequential layers as participants.
5. Replace direct `syncCCRuntimes()` calls with controller sync calls.
6. Replace UI-local playback derivations with shared selectors.
7. Remove or demote stale layer animation flags.

### Definition of Done

- One module owns global animation start/stop scheduling.
- No playback UI consumer open-codes play/pause/resume state.
- Existing color-cycle and sequential playback behavior is unchanged.
- Known stale-layer paused-runtime regression remains covered.

### Validation

- `npm run type-check`
- `npm run lint`
- `npm test -- src/stores/__tests__/ccRuntime.test.ts src/utils/__tests__/colorCyclePlayback.test.ts src/components/panels/__tests__/AnimationControlsPanel.test.tsx src/hooks/canvas/__tests__/createDrawingPlaybackSync.test.ts src/hooks/canvas/__tests__/useSequentialAnimationRuntimeEffect.test.ts`
- Manual sanity:
  - play/pause color-cycle layer,
  - suspend during drawing and resume correctly,
  - pause while sampled shape commits,
  - sequential playback/capture still behaves correctly.

## Phase 4: Consolidate Canvas Bridge Sprawl into Runtime Modules

### Problem

The top-level canvas shells are small, but the extracted canvas area has many
`build*`, `bridge*`, `runtime*`, and handler files. Some core files remain
multi-thousand-line hotspots. The result is hard to navigate and easy to wire
incorrectly.

### Target Runtime Modules

Create or consolidate around these responsibilities:

- `src/canvas/runtime/InputRuntime`
  - pointer, keyboard, wheel, clipboard routing.
- `src/canvas/runtime/StrokeRuntime`
  - brush stroke start/continue/finalize orchestration.
- `src/canvas/runtime/ShapeRuntime`
  - shape drag, preview, finalize, sampled CC shape flow.
- `src/canvas/runtime/SelectionRuntime`
  - marquee, mask, floating paste, transform.
- `src/canvas/runtime/RenderRuntime`
  - composite redraw, overlay redraw, RAF redraw queue.
- `src/canvas/runtime/CanvasRuntime`
  - top-level composition of the above runtimes.

Existing `src/hooks/canvas/**` modules can migrate gradually, but new work
should target these stronger boundaries.

### Migration Steps

1. Build a dependency map for current canvas bridge modules.
2. Identify bridge files that only pass arguments through; collapse them into
   runtime constructors.
3. Extract `pointerHandlers.ts` into input routing plus feature runtimes.
4. Extract `ShapeToolHandler.ts` into shape preview, commit, and CC sampled
   shape services.
5. Move redraw queue/composite scheduling into `RenderRuntime`.
6. Keep `DrawingCanvas.tsx`, `useDrawingHandlers.ts`, and
   `useCanvasEventHandlers.ts` as thin compatibility shells until imports
   stabilize.

### Definition of Done

- New canvas feature work lands in runtime modules, not bridge/build files.
- `pointerHandlers.ts` is under 900 LOC.
- `ShapeToolHandler.ts` is under 900 LOC.
- Runtime modules expose small typed interfaces and have focused tests.
- The number of pass-through `build*`/`bridge*` files stops growing.

### Dependency Map - 2026-04-24

Current canvas composition has three layers:

- `src/components/canvas/DrawingCanvas.tsx` is already a thin shell over
  `useDrawingCanvasRuntime.ts`, `DrawingCanvasViewport.tsx`, and overlay
  components.
- `src/components/canvas/useDrawingCanvasRuntime.ts` fans into runtime state,
  visual setup, render setup, interaction setup, input handlers, and effects.
  Most `buildDrawingCanvas*` files are pass-through option builders around
  those hooks.
- `src/hooks/useDrawingHandlers.ts` is already thin, but
  `useDrawingHandlersRuntimeStages.ts` fans into engine/store refs, tool
  runtimes, color-cycle runtime setup, and runtime handler bridges. Most
  `buildDrawingHandlers*` files are pass-through option builders around that
  fan-out.

Primary hotspots and owners:

- Input/runtime bridge:
  `src/hooks/canvas/useCanvasEventHandlers.ts` ->
  `createCanvasEventHandlerModules.ts` ->
  `handlers/pointerHandlers.ts`, `keyboardHandlers.ts`,
  `wheelHandlers.ts`, and `clipboardHandlers.ts`.
- Stroke runtime:
  `useDrawingStrokeRuntime.ts`, `useDrawingStartRuntime.ts`,
  `useStrokeInputHandlers.ts`, and stroke helpers under
  `src/hooks/canvas/handlers/stroke*` and `start*`.
- Shape runtime:
  `useDrawingShapeRuntime.ts`, `useDrawingShapeAuxRuntime.ts`,
  `useShapeDrawingHandlers.ts`, `handlers/shapes/ShapeToolHandler.ts`,
  `ShapeFinalizeHandler.ts`, and shape preview helpers.
- Selection runtime:
  `handlers/selectionHandlers.ts`, `selectionApply.ts`,
  `magicWandSelection.ts`, selection ROI helpers, and floating paste
  overlays/effects.
- Render runtime:
  `useDrawingCanvasRenderRuntimeSetup.ts`, `useDrawingCanvasBaseRenderer.ts`,
  `drawingCanvasCompositeStack.ts`, composite buffers/rebuild hooks, overlay
  canvas utilities, and redraw effects.

Reduction approach:

- Introduce `src/canvas/runtime/*` compatibility modules first, delegating to
  existing hooks/handlers without behavior changes.
- Move pointer handler subflows by domain into `InputRuntime`, `StrokeRuntime`,
  `ShapeRuntime`, and `SelectionRuntime` wrappers before deleting bridge files.
- Move render/composite setup into `RenderRuntime`, then compose them through
  `CanvasRuntime`.
- Only make hotspot budgets blocking after `pointerHandlers.ts` and
  `ShapeToolHandler.ts` are actually below 900 LOC.

### Validation

- `npm run type-check`
- `npm run lint`
- `npm test -- src/components/canvas/__tests__/DrawingCanvas.smoke.test.tsx src/components/canvas/__tests__/DrawingCanvas.accessibility.test.tsx src/hooks/canvas/handlers/__tests__/pointerHandlers.main.test.ts src/hooks/canvas/handlers/shapes/__tests__/ShapeToolHandler.flush.test.tsx`
- Manual sanity:
  - brush draw,
  - eraser,
  - selection drag,
  - floating paste transform,
  - sampled color-cycle shape drag/finalize.

## Phase 5: Add CI Architecture Guardrails

### Problem

CI currently runs lint, type-check, tests, load-project guardrails, Goblet
verification, audit, and build. It does not prevent architecture regression:
large files, raw logging, component-level `getState()`, missing worker
type-checking, and lint warnings can persist.

### Guardrails to Add

#### File Size Budget

Add `scripts/check-file-budgets.mjs`.

Initial hard budgets:

- `src/components/canvas/DrawingCanvas.tsx`: 700 LOC.
- `src/hooks/useDrawingHandlers.ts`: 700 LOC.
- `src/hooks/canvas/useCanvasEventHandlers.ts`: 700 LOC.
- `src/stores/slices/layersSlice.ts`: 900 LOC after Phase 1.
- `src/utils/export/webglExporter.ts`: 600 LOC after Phase 2.
- `src/hooks/canvas/handlers/pointerHandlers.ts`: 900 LOC after Phase 4.
- `src/hooks/canvas/handlers/shapes/ShapeToolHandler.ts`: 900 LOC after Phase 4.

Before each phase lands, set budgets to warning-only for not-yet-migrated files.
After the phase lands, make the budget blocking.

#### Raw Logging Guard

Add `scripts/check-raw-console.mjs`.

Rules:

- Disallow `console.*` in production `src` code.
- Allow tests, dev-only pages, scripts, and approved debug utilities.
- Prefer `debugLog`, `devLog`, or the on-screen debug overlay for diagnostics.

#### Store Access Guard

Add `scripts/check-store-access.mjs`.

Rules:

- Disallow `useAppStore.getState()` in React components and canvas UI files.
- Allow store helpers, runtime services, history helpers, tests, and documented
  integration boundaries.
- Require new imperative store access to live behind an injected dependency or
  explicit runtime/service adapter.

#### Worker Type-Checking

Add `tsconfig.worker.json`.

Include:

- `src/workers/**/*.ts`
- worker client message types
- no React JSX assumptions
- webworker libs where needed

Add script:

```json
"type-check:workers": "tsc --noEmit -p tsconfig.worker.json"
```

#### Test Type-Checking

Keep `tsconfig.jest.json`, but add a CI script:

```json
"type-check:tests": "tsc --noEmit -p tsconfig.jest.json"
```

If this is too noisy initially, add it as non-blocking first and track a cleanup
list.

#### Stricter Lint

Change these rules from warnings to errors after existing warnings are fixed:

- `@typescript-eslint/no-unused-vars`
- `@typescript-eslint/no-explicit-any`

Add targeted overrides for tests if needed.

### CI Integration

Update `.github/workflows/deploy.yml`:

1. Run architecture guardrails after lint.
2. Run app type-check.
3. Run worker type-check.
4. Run test type-check once clean enough to block.
5. Run tests and build as today.

### Definition of Done

- CI fails on raw production `console.*`.
- CI fails on budget regressions for completed refactor areas.
- CI fails on new component-level direct store reads.
- Workers are type-checked separately.
- Lint warnings introduced by touched production code fail the build.

## Suggested Execution Order

1. Phase 5 guardrails in warning/report mode.
2. Phase 1 `layersSlice` extraction.
3. Turn `layersSlice` budget blocking.
4. Phase 2 Goblet/export extraction.
5. Turn `webglExporter` budget blocking.
6. Phase 3 playback runtime owner.
7. Phase 4 canvas runtime consolidation.
8. Turn canvas hotspot budgets blocking.
9. Tighten lint warnings to errors.

## Detailed Implementation Checklist

Use this checklist as the step-by-step execution tracker. Mark each item only
after code, tests, and docs for that item are complete.

### Step 0: Baseline and Scope Lock

- [x] Record line counts for current hotspots.
- [x] Record raw `console.*` baseline.
- [x] Record direct `useAppStore.getState()` baseline.
- [x] Record dependency map for layers, Goblet/export, playback, and canvas
  orchestration.
- [x] Identify allowed touch areas for the first implementation slice:
  - `scripts/check-file-budgets.mjs`
  - `scripts/check-raw-console.mjs`
  - `scripts/check-store-access.mjs`
  - `tsconfig.worker.json`
  - `tsconfig.jest.json`
  - `tsconfig.test-types.json`
  - `package.json`
  - `.github/workflows/deploy.yml`
  - `src/hooks/brushEngine/engineShared.ts`
  - `src/workers/colorCycleFill.worker.ts`
  - `src/workers/__tests__/workerHarness.ts`
  - this plan document

### Step 1: Report-Mode Guardrails

- [x] Add `scripts/check-file-budgets.mjs`.
- [x] Set already-compliant orchestration shells to blocking:
  `DrawingCanvas.tsx`, `useDrawingHandlers.ts`,
  `useCanvasEventHandlers.ts`.
- [x] Set not-yet-migrated hotspots to report mode:
  `layersSlice.ts`, `webglExporter.ts`, `pointerHandlers.ts`,
  `ShapeToolHandler.ts`.
- [x] Add `scripts/check-raw-console.mjs`.
- [x] Add `scripts/check-store-access.mjs`.
- [x] Add package scripts:
  `architecture:budgets`, `architecture:console`,
  `architecture:store-access`, and `architecture:check`.
- [x] Validate `npm run architecture:check`.

### Step 2: Type-Check Boundaries

- [x] Add `tsconfig.worker.json`.
- [x] Add `type-check:workers`.
- [x] Add `type-check:tests`.
- [x] Fix narrow type gaps exposed by worker/test type-checking.
- [x] Validate `npm run type-check`.
- [x] Validate `npm run type-check:workers`.
- [x] Validate `npm run type-check:tests`.

### Step 3: CI Integration

- [x] Run architecture guardrails after lint.
- [x] Run app type-check.
- [x] Run worker type-check.
- [x] Run test type-check.
- [x] Keep raw logging, direct store access, and incomplete hotspot budgets in
  report mode until their cleanup phases complete.

### Step 4: `layersSlice` Extraction

- [x] Add characterization tests around layer CRUD, duplication, removal,
  reorder, active-layer selection, grouping, color-cycle slot normalization,
  compositing invalidation, and sequential event append behavior.
- [x] Extract canvas/framebuffer clone helpers into
  `src/stores/layers/layerCloneService.ts`.
- [x] Extract group helpers into `src/stores/layers/layerGroupService.ts`.
- [x] Extract CRUD/order helpers into `src/stores/layers/layerCrudService.ts`.
- [x] Extract color-cycle gradient/slot normalization into
  `src/stores/layers/layerColorCycleState.ts`.
- [x] Extract composite invalidation into
  `src/stores/layers/layerCompositeInvalidation.ts`.
- [x] Extract composite render coordination into
  `src/stores/layers/layerCompositeRenderer.ts`.
- [x] Extract sequential append routing into
  `src/stores/layers/sequentialLayerEvents.ts`.
- [x] Reduce `layersSlice.ts` below 900 LOC.
- [x] Make `layersSlice.ts` and extracted coordinator file budgets blocking.
- [x] Run Phase 1 targeted tests and full type/lint gates.

### Step 5: Goblet/WebGL Export Extraction

- [x] Add parity tests for existing single-file and zip export output contracts.
- [x] Extract Goblet contracts into `src/utils/export/goblet/gobletTypes.ts`.
- [x] Extract explicit export snapshot building into
  `src/utils/export/goblet/gobletSnapshot.ts`.
- [x] Extract runtime asset resolution into
  `src/utils/export/goblet/gobletRuntimeAssets.ts`.
- [x] Extract HTML building into
  `src/utils/export/goblet/gobletHtmlBuilder.ts`.
- [x] Extract texture encoding into
  `src/utils/export/goblet/gobletTextureEncoder.ts`.
- [x] Extract normal layer serialization into
  `src/utils/export/goblet/gobletLayerSerializer.ts`.
- [x] Extract color-cycle serialization into
  `src/utils/export/goblet/gobletColorCycleSerializer.ts`.
- [x] Extract sequential serialization into
  `src/utils/export/goblet/gobletSequentialSerializer.ts`.
- [x] Extract zip packaging into
  `src/utils/export/goblet/gobletZipBuilder.ts`.
- [x] Extract browser download helper into
  `src/utils/export/goblet/downloadBlob.ts`.
- [x] Remove direct `useAppStore` imports from export internals.
- [x] Reduce `webglExporter.ts` below 600 LOC as a compatibility facade.
- [x] Make `webglExporter.ts` file budget blocking.
- [x] Run Phase 2 Goblet/export verification.

### Step 6: Playback Runtime Owner

- [x] Add `src/runtime/playback/playbackState.ts`.
- [x] Add `src/runtime/playback/playbackParticipants.ts`.
- [x] Add `src/runtime/playback/PlaybackRuntimeController.ts`.
- [x] Adapt color-cycle runtime through
  `src/runtime/playback/colorCyclePlaybackParticipant.ts`.
- [x] Adapt sequential runtime through
  `src/runtime/playback/sequentialPlaybackParticipant.ts`.
- [x] Add `src/runtime/playback/playbackSelectors.ts` for UI-safe labels and
  actions.
- [x] Replace direct `syncCCRuntimes()` calls with controller sync calls.
- [x] Remove UI-local open-coded playback derivations.
- [x] Demote `colorCycleData.isAnimating` to derived/migration-only state.
- [x] Run Phase 3 targeted tests and manual playback sanity checks.

### Step 7: Canvas Runtime Consolidation

- [x] Build dependency map for current canvas bridge/build modules.
- [x] Create `src/canvas/runtime/InputRuntime`.
- [x] Create `src/canvas/runtime/StrokeRuntime`.
- [x] Create `src/canvas/runtime/ShapeRuntime`.
- [x] Create `src/canvas/runtime/SelectionRuntime`.
- [x] Create `src/canvas/runtime/RenderRuntime`.
- [x] Create `src/canvas/runtime/CanvasRuntime` as the compatibility
  composition boundary.
- [x] Collapse pass-through bridge/build modules into runtime constructors.
- [x] Reduce `pointerHandlers.ts` below 900 LOC.
- [x] Reduce `ShapeToolHandler.ts` below 900 LOC.
- [x] Make canvas hotspot budgets blocking.
- [x] Run Phase 4 targeted tests and manual drawing/selection/shape sanity.

### Step 8: Strict Cleanup Gates

- [x] Replace remaining raw production `console.*` calls with `debugLog`,
  `devLog`, visible diagnostics, or explicit user-facing error handling.
- [x] Run `node scripts/check-raw-console.mjs --strict`.
- [x] Move remaining component/canvas direct store reads behind selectors,
  hooks, injected dependencies, or runtime/service adapters.
- [x] Run `node scripts/check-store-access.mjs --strict`.
- [x] Tighten `@typescript-eslint/no-unused-vars` from warning to error.
- [x] Tighten `@typescript-eslint/no-explicit-any` from warning to error.
- [ ] Run full verification checklist.

## Risk Review

### Main Risks

- Extraction changes accidentally alter render ordering.
- Export snapshot boundaries miss live runtime data that Goblet currently reads.
- Playback owner migration changes pause/resume timing.
- Guardrails initially fail because existing code has known debt.

### Mitigations

- Keep each extraction slice behavior-preserving.
- Add tests beside each extracted service before deleting old paths.
- Use compatibility facades during migration.
- Run focused tests after each slice, then broader tests after each phase.
- Start new CI checks in report mode for existing debt, then make them blocking
  per completed phase.

### Rollback Criteria

Revert a slice before continuing if it causes:

- type-check failure,
- lint failure,
- targeted test regression,
- visible behavior regression in drawing, playback, or export,
- increased coupling, such as a new UI import into export internals or runtime
  service importing React components.

## Phase-Level Definition of Done

This plan is complete when:

- `layersSlice` is a coordinator over focused services.
- `webglExporter.ts` is a facade over Goblet/export services.
- one playback runtime owner controls color-cycle and sequential animation
  scheduling.
- canvas runtime work is organized by feature/runtime ownership instead of
  bridge/build pass-through modules.
- CI enforces file-size, logging, store-access, worker type-checking, and stricter
  lint guardrails for completed areas.
