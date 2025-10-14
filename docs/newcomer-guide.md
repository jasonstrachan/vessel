# Vessel Newcomer Guide

## 1. What this project is
Vessel is a professional-grade, browser-based drawing and animation environment built on Next.js 15 with a custom HTML Canvas rendering pipeline, Zustand state management, Tailwind CSS styling, and TypeScript throughout.【F:README.md†L1-L55】 It ships with rich drawing, animation, and export tooling intended to feel like a full desktop illustration suite.【F:README.md†L11-L38】

## 2. High-level architecture
- **App shell** – `src/app/layout.tsx` loads global styles, a password-manager sanitizing script, and wraps the React tree in an error boundary so every page shares common UX scaffolding.【F:src/app/layout.tsx†L1-L115】
- **Main page** – `src/app/page.tsx` composes the live workspace: toolbars on the left, the `DrawingCanvas` in the center, panel columns on the right, and root-level modals tied to the global store.【F:src/app/page.tsx†L1-L209】 It also boots autosave and project defaults through selectors and effects.【F:src/app/page.tsx†L21-L120】
- **Component families** – Canvas rendering lives in `src/components/canvas`, toolbars and panels under `src/components/{toolbar|panels}`, modals in `src/components/modals`, and shared UI helpers in `src/components/ui`. The canvas suite (e.g., `DrawingCanvas`, `BrushCursor`, `SimplifiedColorCycleManager`) is the core rendering surface.【F:AGENTS.md†L20-L29】
- **Brush & interaction systems** – `src/brushes` defines plugin interfaces plus concrete brush implementations, while `src/hooks` hosts the brush engine, interaction state machines, input handlers, and keyboard/panning utilities used by the canvas layer.【F:AGENTS.md†L30-L38】
- **State management** – `src/stores/useAppStore.ts` is a large Zustand store tracking project metadata, layers, history, active tools, autosave configuration, selections, and more; actions such as `setCurrentTool`, `saveCanvasState`, and layer mutations are exposed to components and hooks.【F:AGENTS.md†L40-L43】【F:src/stores/useAppStore.ts†L1-L188】
- **Supporting libraries & utilities** – Rendering logic, color-cycle animation, gradient helpers, caching, flood fill, autosave, and persistence live under `src/lib` and `src/utils`, while `src/workers/gradientWorker.ts` offloads gradient computation to keep the UI responsive.【F:AGENTS.md†L44-L59】 Presets, constants, and shared types sit in `src/presets`, `src/constants`, and `src/types`.【F:AGENTS.md†L60-L64】
- **Static assets & docs** – `public/` and `assets/` contain bundled imagery and fixtures. The `docs/` directory hosts architecture notes such as pixel-perfect rendering and brush testing guides, and now this newcomer guide.【F:AGENTS.md†L65-L71】

## 3. Directory map (quick reference)
At a glance, focus on the `src/` tree for product code and the adjacent `tests/`, `assets/`, and `docs/` folders for validation and documentation.【F:README.md†L152-L175】 The root-level scripts (`scripts/`, `proxy-server.js`, shell helpers) support development automation.【F:AGENTS.md†L72-L74】 Remember that imports should use the `@/*` alias configured in `tsconfig.json` to keep paths consistent.【F:AGENTS.md†L14-L17】【F:AGENTS.md†L95-L99】

## 4. Runtime data flow
Pointer/keyboard input is captured by hooks like `useDrawingHandlers`, `useCanvasInteraction`, `useComprehensiveKeyboard`, and related canvas helpers; these dispatch actions into `useAppStore` slices that update tools, layers, history, and selection state.【F:AGENTS.md†L75-L85】 The brush engine (`useBrushEngineSimplified`) resolves the active brush and hands stroke primitives to renderers, while heavy gradient work can be delegated to the gradient web worker for performance.【F:AGENTS.md†L75-L85】 Components such as `DrawingCanvas` consume store selectors and actions to drive rendering, undo/redo, floating selections, and crop workflows in response to those state updates.【F:src/components/canvas/DrawingCanvas.tsx†L1-L188】

## 5. Working with the codebase
- **Coding conventions** – Follow the 2-space, semicolon-inclusive style enforced by ESLint, prefer TypeScript-specific patterns (narrow types, selector-based store access), and avoid broad imports or deep relative paths.【F:AGENTS.md†L93-L199】 Client components should opt into `'use client'` only when necessary, and hooks must clean up their side effects.【F:AGENTS.md†L185-L198】
- **Core commands** – Primary scripts include `npm run dev`, `npm run build`, `npm start`, `npm test`, `npm run lint`, and `npm run type-check`. Cleaning caches is available via `npm run clean` and `npm run cache:clear`.【F:AGENTS.md†L150-L159】 The README also walks through setup (`npm install`, `npx next dev`) and WSL-friendly host binding if you are on Windows Subsystem for Linux.【F:README.md†L70-L118】
- **Base path awareness** – The Next.js configuration expects a `/vessel` base path and asset prefix, so asset URLs and links must account for it when referencing static files.【F:AGENTS.md†L14-L17】【F:AGENTS.md†L93-L99】

## 6. Suggested next steps for onboarding
1. **Run the app locally** to get a feel for the workspace layout and tool interactions (`npm install && npx next dev`).【F:README.md†L78-L97】
2. **Skim `useAppStore.ts`** to understand the available actions and state slices before touching UI components; most features wire through it.【F:AGENTS.md†L40-L43】【F:src/stores/useAppStore.ts†L1-L188】
3. **Explore the canvas hooks** (`src/hooks/**`) and `DrawingCanvas` implementation to see how input and rendering are orchestrated.【F:AGENTS.md†L35-L38】【F:src/components/canvas/DrawingCanvas.tsx†L1-L188】
4. **Review existing docs** in `docs/` for deeper dives on pixel-perfect rendering, brush testing, and architecture decisions before modifying those systems.【F:AGENTS.md†L65-L71】
5. **Read through linting/contribution guidance** (AGENTS.md and README) so your changes align with the established workflow and code style.【F:AGENTS.md†L93-L199】【F:README.md†L177-L184】

Armed with this overview, you can trace how a pointer event travels from hooks through the global store and into rendering, making it easier to diagnose issues or extend features in Vessel.
