# AGENTS.md - Vessel

Purpose

Motto:

> Every mission assigned is delivered with 100% quality and state-of-the-art execution - no hacks, no workarounds, no partial deliverables and no mock-driven confidence. Mocks/stubs may exist in unit tests for I/O boundaries, but final validation must rely on real integration and end-to-end tests.

You always:

- Deliver end-to-end, production-like solutions with clean, modular, and maintainable architecture.
- Take full ownership of the task: you do not abandon work because it is complex or tedious; you only pause when requirements are truly contradictory or when critical clarification is needed.
- Are proactive and efficient: you avoid repeatedly asking for confirmation like “Can I proceed?” and instead move logically to next steps, asking focused questions only when they unblock progress.
- Follow the full engineering cycle for significant tasks: **understand → design → implement → (conceptually) test → refine → document**, using all relevant tools and environment capabilities appropriately.
- Respect both functional and non-functional requirements and, when the user’s technical ideas are unclear or suboptimal, you propose better, modern, state-of-the-art alternatives that still satisfy their business goals.
- Manage context efficiently and avoid abrupt, low-value interruptions; when you must stop due to platform limits, you clearly summarize what was done and what remains.

Scope

- Applies to the entire repository unless a deeper, directory-local AGENTS.md overrides it.

Research and Discovery

- Read README.md and relevant docs/ before coding.
- Map the execution path you touch: start with src/app/page.tsx, then follow imports via @/*.
- Use rg to find existing implementations before adding new ones.
- Check nearby tests (tests/, src/**/__tests__/) and fixtures (assets/, public/).
- When reviving/pruning features, check refactor/, agents/, and docs/ for prior art.

Project Overview

- Tech: Next.js + TypeScript. Static export for GitHub Pages with basePath='/vessel'.
- Path alias: @/* (tsconfig.json).
- Structure: src/ (app/components/brushes/hooks/lib/stores/utils/styles/workers/presets/pages), tests/, public/, assets/, scripts/, docs/.

Structure and Architecture

Entrypoints
- src/app/layout.tsx - root layout, global styles, app router.
- src/app/page.tsx - main UI composition (toolbars, panels, modals, DrawingCanvas).
- src/pages/ - legacy/aux routes (PerformanceTest.tsx, TestRunner.tsx). App Router is primary.

UI Components (src/components/)
- Top-level: LeftToolbar.tsx, BrushLibrary.tsx, ControlsPanel.tsx, MinimalLayerList.tsx, FeedbackStrip.tsx, BrushEditorUI.tsx.
- Canvas suite: src/components/canvas/DrawingCanvas.tsx, BrushCursor.tsx, SimplifiedColorCycleManager.ts.
- Subfolders: brushes/, colorCycle/, toolbar/, ui/, icons/, modals/, panels/, retroui/.

Brushes System (src/brushes/)
- BrushPlugin.ts - plugin interface/types.
- BrushRegistry.ts - registration/discovery.
- plugins/, shapes/ - implementations.

Hooks (src/hooks/)
- Core engine: useBrushEngineSimplified.ts (+ backup), state machines: useCanvasStateMachine.ts, useToolStateMachine.ts.
- Input/interaction: useDrawingHandlers.ts, useCanvasInteraction.ts, useComprehensiveKeyboard.ts, useKeyboardScope.ts, useSimplePan.ts.
- Namespaced helpers in hooks/brushEngine/ and hooks/canvas/.

State (src/stores/)
- useAppStore.ts - Zustand store for project/layers/tools/presets/history/selection/UI/autosave.
- colorCycleBrushManager.ts - color-cycle brush lifecycle manager.

Core Libraries (src/lib/)
- Rendering: AnimationController.ts, ColorCycleAnimator.ts, ColorCycleRenderer.ts.
- Color/palettes: GradientPalette.ts, lib/colorCycle/**.
- index.ts re-exports library surface.

Utilities (src/utils/)
- Canvas/data: canvasPool.ts, canvasSnapshot.ts, floodFill.ts, imageProcessing.ts, pixelComparison.ts.
- Brush helpers: brushCache.ts, scaledBrushCache.ts, pressureCurve.ts, pressureOptimizer.ts, brushThumbnailGenerator.ts.
- Services: autosave.ts, crashRecovery.ts, projectIO.ts, fileBackupService.ts, performanceMonitor.ts, memoryCleanup.ts.
- Color/gradients: colorAnalysis.ts, colorAnalyzer.ts, colorCycleGradients.ts, gradientPresets.ts.
- UX/dev: gridSnap.ts, angleSnap.ts, detectWacom.ts, shapeMaker.ts, shapeUtils.ts, zoomUtils.ts, devLog.ts, debug.ts.

Workers (src/workers/)
- gradientWorker.ts - off-main-thread gradient computation.

Presets/Config/Types
- src/presets/brushPresets.ts - default/user-editable presets.
- src/constants/ - shared constants.
- src/types/ and src/types.ts - shared types/enums.

Styling
- src/app/globals.css + tailwind.config.ts + postcss.config.mjs.
- src/styles/gradient-editor.css for editor-specific CSS.

Runtime Data Flow (high level)
- Input -> Engine -> Render.
- Hooks capture input; store actions update state; brush engine computes strokes; renderers draw.
- Heavy gradient work can run in gradientWorker.

Key Conventions
- Respect basePath/assetPrefix (next.config.ts) for assets and links.
- Use @/* alias; avoid deep relative paths.
- Use Zustand selectors to minimize re-renders.
- Keep worker messages small and transferable.

Clean, Reusable Code

Principles
- Single responsibility.
- Rule of three: extract on the third repeat.
- Composition over inheritance.
- Pure by default.

Reuse and Decommission
- Extend existing modules (retroui/ui, BrushRegistry/BrushPlugin, utils/lib) before creating new abstractions.
- If replacing older code, delete or adapt the old path in the same change.
- Keep new modules small; import via @/*.
- If diverging from established patterns, document why and add a follow-up in DEBUG_PLAN.md.

Types First
- Model with explicit types and discriminated unions.
- Avoid any; use generics where helpful.
- Prefer options objects for many parameters.

React Patterns
- Extract shared logic into hooks.
- Keep presentational components stateless.
- Pass primitives/functions, not large objects; memoize when it reduces work.
- Avoid duplicating global state locally.

API Design
- Small signatures; return new values rather than mutating inputs.
- Use JSDoc for non-trivial exports.
- Prefer dependency injection over hidden singletons.

Side Effects
- Centralize side effects in effects or service modules; clean up.
- No side effects during render.

Performance
- Avoid per-frame allocations; reuse buffers/typed arrays/canvas pools.
- Offload heavy work to workers where needed.
- Memoize only with measured benefit.

Organization
- Shared logic in src/lib/<domain> or src/utils/<domain>.
- Keep files under ~500-800 LOC.
- Co-locate tests under __tests__/.

Brush Plugins
- Implement against BrushPlugin; do not reach into the store directly.
- Share helpers from utils/lib.

Primary Commands

- npm run dev
- npm run dev:raw
- npm run build
- npm start
- npm test (optional: -- --coverage)
- npm run lint
- npm run type-check
- npm run clean
- npm run cache:clear

Coding Conventions

Language
- TypeScript everywhere; avoid any.
- Use @/* alias; avoid ../../..
- Export types alongside implementations when useful.

Imports/Exports
- Order: stdlib -> third-party -> internal (@/*), with blank lines between groups.
- Prefer named exports; default only where Next requires.
- Avoid deep re-export barrels.

Formatting
- 2-space indent; semicolons; trailing commas where valid; single quotes in TS/TSX.
- Fix lint warnings you introduce.

Naming
- Components/React files: PascalCase; one component per file.
- Hooks/utilities: camelCase (hooks start with use).
- Booleans: is/has/can/should prefixes.
- Constants: UPPER_SNAKE_CASE.
- Types/Interfaces: PascalCase; props end with Props.

React/Next.js
- Add 'use client' only when needed.
- Functional components only; memoize heavy components with stable props.
- Use selectors with Zustand; avoid selecting large objects.
- useMemo/useCallback for derived values/handlers passed to children.
- Effects require full dependency arrays; document intentional stability.
- Respect basePath/assetPrefix for static links/assets.

Zustand Store (src/stores/useAppStore.ts)
- Keep state serializable unless documented as ephemeral; do not persist ephemeral fields.
- Action names are imperative verbs.
- Never mutate arrays/objects in place.
- Use selectors in components; avoid getState() except in utilities/effects.
- Slice checklist:
  - State/actions in src/stores/slices/*; compose in useAppStore.ts.
  - Prefer injected dependencies via createXSlice(options).
  - Export slice interface + factory only; helpers in src/stores/helpers/ if reused.
  - Initial state lives in the slice.
  - Update tests in src/stores/__tests__/ on behavior changes.

Utilities
- Pure/stateless by default; services/caches are explicit.
- Split large files before ~1000 LOC.
- Unit tests in src/utils/__tests__/.

Workers
- Define WorkerMessage/WorkerResponse types.
- Prefer transferable objects; avoid global mutable state.

Styling
- Tailwind for layout/utility; CSS only for complex editors.
- Prefer class names; inline styles only for dynamic/perf-critical sizing.

Logging and Errors
- Use debugLog/devLog for dev logs; keep console noise minimal.
- Fail fast on programmer errors; surface user-visible issues non-blockingly.

Comments and Docs
- JSDoc for non-obvious exports.
- Inline comments explain why, not what.
- TODO(username): reason.

Testing
- Filenames: *.test.ts / *.test.tsx in tests/ or src/**/__tests__/.
- Use Testing Library for React components.
- Mock canvas APIs only as needed; prefer real behavior for pure utilities.
- Deterministic tests; use jest.useFakeTimers() when needed.

Git Hygiene
- Conventional Commits: feat, fix, docs, refactor, chore, test.
- Keep patches focused; update docs/tests with behavior changes.

WebGPU Agents

Rules
- One space in buffers.
- Store XY in world/pixel; normalize in VS: uv=(pos-min)/size; ndc=uv*2-1; ndc.y*=-1.
- Match layouts. XY only => stride 8, attr float32x2 @location(0).
- Bring-up: no depth, no blend, FS a=1. Draw point-list (first 64), then line-list (even count).
- Bounds: never 0; default to render target; use max(size,1e-6).

Validate
- WebGPU: pushErrorScope('validation')/popErrorScope(), getCompilationInfo().
- naga: naga validate shader.wgsl (CI gate).
- Readback: bytesPerRow 256-aligned; repack rows.
- Compute: write XY only; reset/read counter buffers properly.
- Pipeline: cache by (shaders, layout, format, topology, depth, blend). Set viewport/scissor explicitly.

Footguns: layout != shader, bounds=0, odd line-list, depth/blend hiding, misaligned readback, mixed spaces.

Build and Config Notes

- next.config.ts sets basePath/assetPrefix for GH Pages; do not change /vessel without explicit scope.
- env.BUILD_TIMESTAMP is injected at build; preserve.
- Dev port defaults to 3000; dev scripts may kill stale processes.

Agent Directives

- Respect repo scope and conventions.
- Keep changes minimal and surgical; fix root causes.
- If a fix attempt is rejected or proven wrong, revert that attempt fully before starting the next approach; do not stack speculative patches.
- If a patch does not fix the issue and does not clearly improve code quality/clarity, back it out before trying a new approach. Do not stack ineffective patches.
- Update/add tests when altering logic; run npm test, npm run type-check, npm run lint before PRs.
- Match existing patterns; avoid reorganizing folders unless requested.
- Before new abstractions, confirm no existing hook/component/service can be extended; if created, remove old entry points in same change.
- Use small, focused patches; do not add licenses/headers.
- For ambiguous tasks, propose a short plan and confirm assumptions.
- When reading/searching code, prefer rg; read files in <=250-line chunks.
- For multi-step tasks, keep one active step and update the plan as steps complete.
- Keep Vessel runtime behavior and Goblet export behavior in sync for animation/playback changes; update both paths and tests in the same change.

Specialist Assignment Guide

- Frontend/Next.js: routes, metadata, basePath/assetPrefix, static export constraints.
- Canvas/Rendering: DrawingCanvas, brushes, workers.
- State/Hooks: stores, hooks, lib shared logic.
- Performance/Memory: profiling, pooling, workers.
- Build/Tooling: next.config.ts, tsconfig.json, eslint, scripts.
- Testing: Jest + Testing Library, canvas mocking, interaction tests.
- Accessibility/UX: keyboard nav, ARIA, focus, contrast.
- Documentation: docs/ updates for behavior/workflow changes.

Task Intake Template (orchestrators)

- Goal: one-sentence outcome.
- Scope: files/areas allowed, exclusions.
- Definition of Done: tests, behavior, performance, UI criteria.
- Constraints: API changes? basePath intact? browser support?
- Risks/Tradeoffs: perf vs complexity, bundle caps.
- Validation: commands to run and expected results.

Decision Heuristics

- Prefer simple, explicit solutions.
- Preserve public contracts; call out breaking changes.
- Consider SSR/SSG and basePath effects for assets/links.
- Optimize after correctness; measure before/after for perf work.

File-Specific Guardrails

- next.config.ts: keep basePath='/vessel' and assetPrefix unless requested.
- tsconfig.json: preserve @/* paths and compiler options unless justified.
- Next pages (src/pages/**): default exports required; other modules use named exports.

Orchestration File Guardrails

- Applies to all changes: refactors, bug fixes, and new feature development.
- Treat orchestration-first files as composition shells only; move heavy logic to `src/hooks/canvas/handlers/**` or `src/hooks/canvas/utils/**`.
- Scope:
  - `src/hooks/useDrawingHandlers.ts`
  - `src/components/canvas/DrawingCanvas.tsx`
  - `src/hooks/canvas/useCanvasEventHandlers.ts`
- Size budgets:
  - Soft warning: 400 LOC
  - Hard stop: 700 LOC (requires documented exception + split follow-up in `docs/refactor/`)
- Extraction triggers:
  - Third-concern rule: if a file owns 3+ independent concerns, extract before merge.
  - Repeat rule: if a helper/pattern repeats 3 times, extract.
  - Testability rule: if logic is hard to test without mounting large UI state, extract to handler/util.
- PR expectation for touched orchestration files:
  - verify line budget with `wc -l`
  - run `npm run type-check`, `npm run lint`, `npm test`
  - update docs when making boundary changes (`docs/refactor/module-size-guardrails.md` and active plan file)

Feature Architecture Rule

- New features must be added through existing architectural seams (components -> hooks -> handlers/utils -> store/lib), not by expanding orchestration shells with inline workflow logic.
- For any feature touching canvas input/render flows:
  - keep orchestration files focused on wiring/composition,
  - place workflow logic in `handlers/**`,
  - place pure computation in `utils/**`,
  - add targeted tests beside extracted modules.
- If a feature cannot fit current seams cleanly, define a small boundary module first, then implement the feature within that boundary.

Verification Checklist

- npm run type-check passes.
- npm run lint passes.
- npm test passes; new logic has test coverage where reasonable.
- Manual sanity for basePath URLs when touching routes/assets.
- Update docs/ when behavior/workflows change.

Troubleshooting

- If dev behaves oddly: npm run clean, then npm run cache:clear.
- Ensure no duplicate dev servers on port 3000.
