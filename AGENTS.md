# AGENTS.md — Vessel

Purpose

- Guide Codex agents/orchestrators to assign the right specialists and execute changes safely and efficiently in this repo.
- Establish conventions, scope, and decision heuristics that all agents must follow.

Scope

- Applies to the entire repository unless a deeper, directory‑local AGENTS.md overrides specific guidance.

Project Overview

- Tech: Next.js + TypeScript. Static export for GitHub Pages with `basePath='/vessel'`.
- Path alias: `@/*` (see `tsconfig.json`).
- Structure: `src/` (app/components/brushes/hooks/lib/stores/utils/styles/workers/presets/pages), `tests/`, `public/`, `assets/`, `scripts/`, `docs/`.

Structure & Architecture

- Entrypoints
  - `src/app/layout.tsx` — root layout; imports global styles; wraps the App Router tree.
  - `src/app/page.tsx` — main UI composition (toolbars, panels, modals, `DrawingCanvas`). Uses `useAppStore` and utilities (`autosaveService`, `preloadRisographTexture`).
  - `src/pages/` — legacy/auxiliary routes for testing and performance (`PerformanceTest.tsx`, `TestRunner.tsx`). App Router is primary.

- UI Components (`src/components/`)
  - Top-level components: `LeftToolbar.tsx`, `BrushLibrary.tsx`, `ControlsPanel.tsx`, `MinimalLayerList.tsx`, `FeedbackStrip.tsx`, `BrushEditorUI.tsx`.
  - Canvas suite (`src/components/canvas/`): `DrawingCanvas.tsx` (core renderer and input surface), `BrushCursor.tsx`, `SimplifiedColorCycleManager.ts`.
  - Subfolders: `brushes/`, `colorCycle/`, `toolbar/`, `ui/`, `icons/`, `modals/`, `panels/`, `retroui/` (UI composition helpers).

- Brushes System (`src/brushes/`)
  - `BrushPlugin.ts` — plugin interface/types for brushes.
  - `BrushRegistry.ts` — registration/discovery of brush plugins.
  - `plugins/`, `shapes/` — concrete brush implementations and shape primitives.

- Hooks (`src/hooks/`)
  - High-level engine: `useBrushEngineSimplified.ts` (+ backup), state machines: `useCanvasStateMachine.ts`, `useToolStateMachine.ts`.
  - Input/interaction: `useDrawingHandlers.ts`, `useCanvasInteraction.ts`, keyboard: `useComprehensiveKeyboard.ts`, `useKeyboardScope.ts`, panning: `useSimplePan.ts`.
  - Namespaced helpers in `hooks/brushEngine/` and `hooks/canvas/` support decomposition of canvas logic.

- State Management (`src/stores/`)
  - `useAppStore.ts` — centralized app state implemented with Zustand; manages project, layers, tools, brush presets/settings, history, selection, shape/gradient states, UI panels/modals, autosave.
  - `colorCycleBrushManager.ts` — lifecycle/instance manager for color-cycle brush objects, coordinated with `useAppStore`.

- Core Libraries (`src/lib/`)
  - Rendering/animation: `AnimationController.ts`, `ColorCycleAnimator.ts`, `ColorCycleRenderer.ts`.
  - Color and palettes: `GradientPalette.ts`, `lib/colorCycle/**`.
  - Utilities and examples namespaces; `index.ts` re-exports library surface.

- Utilities (`src/utils/`)
  - Canvas/data ops: `canvasPool.ts`, `canvasSnapshot.ts`, `floodFill.ts`, `imageProcessing.ts`, `pixelComparison.ts`.
  - Brush helpers: `brushCache.ts`, `scaledBrushCache.ts`, `pressureCurve.ts`, `pressureOptimizer.ts`, `brushThumbnailGenerator.ts`.
  - App services: `autosave.ts`, `crashRecovery.ts`, `projectIO.ts`, `fileBackupService.ts`, `performanceMonitor.ts`, `memoryCleanup.ts`.
  - Color/gradients: `colorAnalysis.ts`, `colorAnalyzer.ts`, `colorCycleGradients.ts`, `gradientPresets.ts`.
  - UX/dev: `gridSnap.ts`, `angleSnap.ts`, `detectWacom.ts`, `shapeMaker.ts`, `shapeUtils.ts`, `zoomUtils.ts`, `devLog.ts`, `debug.ts`.
  - Tests live in `src/utils/__tests__/` for utility units.

- Workers (`src/workers/`)
  - `gradientWorker.ts` — off-main-thread gradient-related computation to keep UI responsive.

- Presets/Config/Types
  - `src/presets/brushPresets.ts` — default and user-editable brush preset definitions and helpers.
  - `src/constants/` — cross-module constants (e.g., canvas defaults).
  - `src/types/` and `src/types.ts` — shared TypeScript types and enums (e.g., `BrushShape`).

- Styling
  - `src/app/globals.css` + `tailwind.config.ts` and `postcss.config.mjs` provide the styling pipeline; `src/styles/gradient-editor.css` for specific editor styles.

- Public/Assets/Docs
  - `public/` — static assets bundled with the app; `assets/` — project media/examples and external fixtures.
  - `docs/` — architecture notes, troubleshooting guides (e.g., pixel-perfect rendering, testing brushes).

- Scripts/Dev
  - `scripts/` — monitored dev server and helpers; root `proxy-server.js` and shell scripts for local workflows.

Runtime Data Flow (High level)

- Input → Engine → Render
  - Pointer/keyboard input captured by hooks (`useDrawingHandlers`, `useCanvasInteraction`, `useComprehensiveKeyboard`).
  - Actions update `useAppStore` slices (tools, canvas, history, selection, layers).
  - Brush engine (`useBrushEngineSimplified`) resolves active brush/preset, computes stroke primitives, and delegates to renderers.
  - Rendering uses `ColorCycleRenderer`/`Animator` and canvas utilities; heavy gradient work may bounce to `gradientWorker`.

- State & Persistence
  - Global state in `useAppStore` drives UI and canvas; history (`undo/redo`) stores `CanvasSnapshot`s.
  - Persistence via `utils/projectIO.ts` (save/load/export), plus `autosaveService` and safe caches (`brushCache`, `scaledBrushCache`).

Component Relationships

- `app/page.tsx` lays out the shell: `LeftToolbar` (tools), central `DrawingCanvas` (render surface + handlers), right column with `ColorPickerPanel`, `BrushLibrary`, `ControlsPanel`.
- `BrushEditorUI`, `DocumentModal`, `SettingsModal` mount at root and bind to `useAppStore.ui.modals`.
- `MinimalLayerList` reflects `useAppStore.layers` and provides quick operations; composition triggers via `layersNeedRecomposition` flag.

Key Conventions & Couplings

- `basePath` and `assetPrefix` from `next.config.ts` must be respected when referencing images/fonts/links.
- All modules import via `@/*` alias; avoid relative path chains like `../../..`.
- Components should select minimal state from `useAppStore` to avoid re-renders; prefer selector functions over broad object picks.
- Brush plugins register through `BrushRegistry` and operate against public types from `src/types`.
- Worker messages should be small, transferable objects; avoid sending large `ImageData` repeatedly without consideration.

Clean, Reusable Code

- Principles
  - Single Responsibility: keep modules/functions focused; one reason to change.
  - Rule of Three: repeat twice is fine; on the third time, extract a helper.
  - Composition over inheritance: compose small components and hooks for reuse.
  - Pure by default: utilities should be side‑effect free and deterministic.

- Types First
  - Model domain with explicit types/interfaces and discriminated unions.
  - Prefer narrow, precise types; avoid `any`. Use generics where it improves reuse.
  - For many parameters, pass a typed options object (`opts`) to keep call sites clear.

- React Reuse Patterns
  - Extract cross‑cutting logic into hooks (`useX`) instead of HOCs or mixins.
  - Keep presentational components stateless; inject data/handlers via props.
  - Minimize prop surfaces; pass primitives/functions, not large objects. Stabilize with `useMemo/useCallback` when passed down.
  - Avoid duplicating global state locally; derive from `useAppStore` selectors.

- API Design
  - Keep function signatures small; return new values rather than mutating inputs.
  - Use clear names and document pre/post‑conditions in JSDoc for non‑trivial functions.
  - Prefer dependency injection (e.g., RNG/clock/services) over hidden singletons for testability.

- Side Effects & Services
  - Centralize side effects in React effects or service modules (e.g., `autosaveService`).
  - No side effects during render; effects must clean up.

- Performance‑Aware Reuse
  - Avoid per‑frame allocations in hot paths; reuse buffers/typed arrays and canvas pools.
  - Offload heavy work to `workers/` when it impacts responsiveness.
  - Memoize only when it reduces real work; measure before/after for complex cases.

- Organization
  - Place shared domain logic in `src/lib/<domain>` or `src/utils/<domain>`; avoid circular dependencies.
  - Keep files under ~500–800 LOC; split by responsibility when exceeding.
  - Co‑locate tests for reusable modules under `__tests__/` with meaningful cases.

- Brush Plugin Reuse
  - Implement against `BrushPlugin` interfaces; do not reach into the store directly.
  - Share color/geometry helpers from `utils/` and `lib/` rather than duplicating.

- Quick Checklist
  - Is this function/component doing one thing well?
  - Is the API minimal, typed, and documented?
  - Is there duplicated logic I can extract safely?
  - Are side effects isolated and cleaned up?
  - Will this be easy to test with small unit tests?

Primary Commands

- Dev server (monitored): `npm run dev`
- Dev server (raw Next): `npm run dev:raw`
- Build (production/static export): `npm run build`
- Start (production): `npm start`
- Tests: `npm test` (optionally `npm test -- --coverage`)
- Lint: `npm run lint`
- Type check: `npm run type-check`
- Clean caches: `npm run clean` and `npm run cache:clear`

Coding Conventions

- Language
  - TypeScript everywhere; avoid `any`. If unavoidable, wrap with a TODO and narrow ASAP.
  - Use `@/*` path alias; do not climb with `../../..`.
  - Export types alongside implementations when helpful: `export type Foo = ...`.

- Imports & Exports
  - Order imports: node/stdlib → third‑party → internal (`@/*`). Group with newlines.
  - Prefer named exports. Use default exports only where Next.js requires (pages, route handlers, top‑level page components).
  - Re‑export stable APIs via index files only when it reduces churn; avoid deep re‑export barrels that hide ownership.

- Formatting & Linting
  - Follow ESLint (`next/core-web-vitals`, `next/typescript`).
  - 2‑space indent; semicolons; trailing commas where valid; single quotes in TS/TSX.
  - Fix lint warnings you introduce; do not add disable comments unless justified in code review.

- Naming
  - Components and React files: PascalCase (`DrawingCanvas.tsx`). One component per file.
  - Hooks/utilities: camelCase (`useDrawingHandlers.ts`, `angleSnap.ts`). Hooks start with `use`.
  - Booleans: prefix with `is/has/can/should` (e.g., `isDrawing`, `hasFocus`).
  - Constants: UPPER_SNAKE_CASE in `constants/` or module‑local.
  - Types/Interfaces: PascalCase; props shape suffixed `Props`.

- React/Next.js
  - Client components: start files with `'use client'` when needed; avoid accidental client boundaries.
  - Functional components only; wrap with `memo` when props are stable and render is heavy.
  - Use selectors with Zustand to minimize re‑renders; avoid selecting large objects.
  - Derive memoized values with `useMemo`; event handlers `handleX` via `useCallback` when passed to children.
  - Effects must clean up; specify full dependency arrays (no ad‑hoc disabling). If intentionally stable, document why.
  - Respect `basePath`/`assetPrefix` for static links and asset URLs.

- Zustand Store (`src/stores/useAppStore.ts`)
  - Keep state serializable unless explicitly documented as ephemeral (e.g., `Path2D`). Do not persist ephemeral fields.
  - Action names are imperative verbs (`setBrushPreset`, `undo`, `redo`, `commitLayerHistory`).
  - Never mutate arrays/objects in place; return new references. Use helper utilities when updating nested state.
  - Use selectors in components; avoid accessing `getState()` directly except in utilities and effect glue code.

- Utilities
  - Pure, stateless by default; no hidden singletons unless clearly a cache/service (`brushCache`, `autosaveService`).
  - Keep modules focused; split large files by responsibility before exceeding ~1000 LOC.
  - Provide small, composable functions and unit tests in `src/utils/__tests__/`.

- Workers
  - Define `WorkerMessage`/`WorkerResponse` types; prefer transferable objects (ArrayBuffer) for large payloads.
  - Avoid capturing global mutable state; initialize from messages.

- Styling
  - Tailwind for layout/utility classes; module/global CSS only for complex editors (e.g., `gradient-editor.css`).
  - Prefer class names over inline styles; inline is acceptable for dynamic canvas sizing/perf‑critical styles.

- Logging & Errors
  - Use `debugLog`/`devLog` for development logs; keep `console.*` noise minimal. Remove stray logs before PRs.
  - Fail fast on programmer errors; surface user‑visible issues with non‑blocking UI where appropriate.

- Comments & Docs
  - JSDoc for exported functions/types that are non‑obvious.
  - Use concise inline comments to explain “why”, not “what”.
  - Mark follow‑ups as `TODO(username): reason`.

- Testing Conventions
  - Filenames: `*.test.ts`/`*.test.tsx` in `tests/` or `src/**/__tests__/`.
  - Use Testing Library for React components; avoid testing implementation details.
  - Mock canvas APIs only as needed; prefer real behavior for pure utilities.
  - Keep tests deterministic; avoid relying on timers without `jest.useFakeTimers()`.

- Git Hygiene
  - Conventional Commits (`feat`, `fix`, `docs`, `refactor`, `chore`, `test`).
  - Keep patches focused; no drive‑by refactors. Update docs/tests with code changes.

- WebGPU agents

  - One space in buffers. Store XY in world/pixel; normalize in VS: uv=(pos-min)/size; ndc=uv*2-1; ndc.y*=-1.
  - Match layouts. XY only ⇒ stride 8, attr float32x2 @location(0).
  - Bring-up. No depth, no blend, FS a=1. Draw point-list (first 64), then line-list (even count).
  - Bounds. Never 0; default to render target. Use max(size,1e-6).

  Validate.

  - WebGPU: pushErrorScope('validation')/popErrorScope(), getCompilationInfo().
  - naga: naga validate shader.wgsl (CI gate).
  - Readback. bytesPerRow 256-aligned; repack rows.
  - Compute. Write XY only; reset/read counter buffers properly.
  - Pipeline. Cache by (shaders, layout, format, topology, depth, blend). Set viewport/scissor explicitly.

Footguns. Layout≠shader • bounds=0 • odd line-list • depth/blend hiding • misaligned readback • mixed spaces. Build & Config Notes

- `next.config.ts` sets `basePath`/`assetPrefix` for GH Pages; do not remove or change `/vessel` without explicit task scope.
- `env.BUILD_TIMESTAMP` is injected at build; preserve this behavior.
- Dev port defaults to `3000`. Dev scripts may kill stale processes—avoid running duplicate dev servers.

Agent Directives

- Respect repo scope and conventions above for any file you touch.
- Keep changes minimal and surgical; fix root causes rather than adding workarounds.
- Update or add tests when altering logic; run `npm test`, `npm run type-check`, and `npm run lint` before proposing a PR.
- Match existing patterns; avoid reorganizing folders/files unless requested.
- When editing, use small, focused patches. Do not introduce licenses/headers.
- For ambiguous tasks, propose a short plan and confirm assumptions.
- When reading/searching code, prefer `rg`; read files in ≤250‑line chunks.
- For multi‑step tasks, keep one active step and update the plan as steps complete.

Specialist Assignment Guide

- Frontend/Next.js
  - Pages/routing, `_app`, `_document`, metadata, `basePath` handling, static export constraints.
  - When tasks involve navigation, SEO, build output, or asset paths.

- Canvas/Rendering
  - `src/components/DrawingCanvas.tsx`, `src/brushes/`, `src/workers/`.
  - Brush algorithms, pointer events, offscreen canvases, frame scheduling, pixel ops.

- State & Hooks
  - `src/stores/`, `src/hooks/`, `src/lib/` shared logic.
  - Consistent state shape, selectors, memoization, event batching.

- Performance/Memory
  - Profiling hot paths, avoiding re‑renders, pooling, typed arrays, workers.
  - Target tasks mentioning lag, jank, large canvases, or mobile perf.

- Build/Tooling
  - `next.config.ts`, `tsconfig.json`, `eslint` config, `scripts/`.
  - Base path/asset prefix correctness, static export, caching, dev monitors.

- Testing
  - Jest + Testing Library setup, canvas mocking, interaction tests.
  - Add regression tests for logic and UI behaviors.

- Accessibility/UX
  - Keyboard navigation, ARIA, contrast, focus management for UI components.

- Documentation
  - `docs/` architecture, troubleshooting, and usage examples; ensure changes are reflected.

Task Intake Template (for orchestrators)

- Goal: Desired outcome in one sentence.
- Scope: Files/areas allowed to change; exclusions.
- Definition of Done: Tests, behavior, performance thresholds, UI criteria.
- Constraints: No API changes? Keep basePath intact? Browser support?
- Risks/Tradeoffs: Perf vs. complexity, bundle size caps.
- Validation: Exact commands to run and what to observe.

Decision Heuristics

- Prefer simple, explicit solutions; avoid deep abstractions unless repeated patterns demand it.
- Preserve public contracts and exported APIs; call out any breaking change explicitly.
- Consider SSR/SSG and `basePath` effects when dealing with asset URLs and links.
- Optimize after correctness; measure before/after for perf tasks.

File‑Specific Guardrails

- `next.config.ts`: Keep `basePath='/vessel'` and related `assetPrefix` unless task requests changes.
- `tsconfig.json`: Preserve `paths` for `@/*` and compiler options unless justified.
- Next pages (`src/pages/**`): default exports required; other modules should use named exports.

Verification Checklist (before PRs/hand‑off)

- `npm run type-check` passes with no errors.
- `npm run lint` shows no new warnings of significance and no errors.
- `npm test` passes; new logic has test coverage where reasonable.
- Manual sanity for `basePath` URLs if touching routes/assets.
- Update `docs/` when behavior or workflows change.

Troubleshooting

- If dev behaves oddly, try `npm run clean` and `npm run cache:clear`.
- Ensure no duplicate dev servers are running on port `3000`.
