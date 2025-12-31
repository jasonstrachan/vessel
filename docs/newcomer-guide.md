# Vessel Newcomer Guide

## 1. What this project is
Vessel is a browser-based drawing and animation environment built on Next.js (App Router) with a custom Canvas2D rendering pipeline. It combines advanced brush tooling, color-cycle animation, recolor workflows, and layered compositing with a panel-based UI.

## 2. High-level architecture
- **App shell** – `src/app/layout.tsx` loads global styles and wraps the App Router tree with global scaffolding.
- **Main page** – `src/app/page.tsx` composes the workspace: left toolbar, center `DrawingCanvas`, right-side panels, and root-level modals wired to the global store.
- **Component families** – Canvas rendering lives in `src/components/canvas`, panels in `src/components/panels`, modals in `src/components/modals`, and shared UI in `src/components/ui`.
- **Brush & interaction systems** – `src/brushes` defines plugin interfaces and implementations. `src/hooks` contains the brush engine, interaction state machines, input handlers, and keyboard/panning utilities.
- **State management** – `src/stores/useAppStore.ts` is the central Zustand store for project data, layers, tools, history, autosave, and UI state.
- **Rendering & color cycle** – `src/lib` hosts IndexBuffer/GradientPalette/ColorCycleAnimator and related rendering helpers. Optional WebGL acceleration sits under `src/lib/colorCycle/rendering`.
- **Utilities & workers** – `src/utils` covers autosave, export, canvas ops, and caching. `src/workers/gradientWorker.ts` offloads gradient calculations when needed.

## 3. Directory map (quick reference)
Focus on `src/` for product code, `tests/` for validation, and `docs/` for architecture notes. Imports should use the `@/*` alias from `tsconfig.json` to keep paths consistent.

## 4. Runtime data flow
Pointer/keyboard input is captured by hooks like `useDrawingHandlers`, `useCanvasInteraction`, and `useComprehensiveKeyboard`. These update `useAppStore` slices for tools, layers, selection, and history. The brush engine (`useBrushEngineSimplified`) resolves the active brush and delegates rendering to the canvas pipeline, while color-cycle layers rely on `ColorCycleAnimator` plus optional WebGL acceleration. The `DrawingCanvas` surface composites layers, overlays, and animation frames.

## 5. Working with the codebase
- **Coding conventions** – Follow the TypeScript-first style, selector-based Zustand access, and App Router patterns laid out in `AGENTS.md`.
- **Core commands** – `npm run dev`, `npm run build`, `npm start`, `npm test`, `npm run lint`, `npm run type-check`.
- **Base path awareness** – The production build uses `/vessel` as basePath/assetPrefix, so ensure asset URLs respect it.

## 6. Suggested next steps for onboarding
1. Run the app locally to get a feel for the workspace layout and tool interactions.
2. Read `src/stores/useAppStore.ts` to understand available actions and state slices.
3. Review `src/components/canvas/DrawingCanvas.tsx` and `src/hooks/**` to see how input flows into rendering.
4. Browse `docs/` for deep dives on pixel-perfect rendering, color-cycle internals, and performance notes.
