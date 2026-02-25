# Front-End Panel Separation Plan

## Overview

Refactor the main application layout to isolate each major panel (layers, alignment, animation controls, color picker + sliders, brush library, brush settings) into dedicated components that can evolve independently while keeping shared state usage lean.

## Implementation Steps

1. **Audit Existing Panels**
   - Inspect `src/app/page.tsx`, `src/components/LayerPanel.tsx`, `src/components/BrushLibrary.tsx`, `src/components/ControlsPanel.tsx`, and current color picker/slider panels to map how each panel consumes `useAppStore` selectors and shared utilities.
   - Document overlapping responsibilities and any coupling that will affect extraction (e.g., alignment controls living inside `ControlsPanel`).

2. **Define Target Architecture**
   - Specify the set of dedicated components: `LayersPanel`, `AlignmentPanel`, `AnimationControlsPanel`, `ColorPickerPanel`, `ColorSlidersPanel`, `BrushLibraryPanel`, `BrushSettingsPanel`.
   - Decide file locations (prefer `src/components/panels/`) and determine which selectors/hooks each panel should own.
   - Identify shared helpers that might need to move into `src/hooks/` or `src/utils/` for reuse.

3. **Extract Panel Logic**
   - Move alignment- and animation-specific UI/logic out of `ControlsPanel.tsx` into `AlignmentPanel.tsx` and `AnimationControlsPanel.tsx` while preserving Zustand selector efficiency.
   - Ensure each panel exports a focused component with narrow props and minimal internal state, adding hook helpers if necessary.
   - Update or add unit tests covering any extracted hooks/utilities.

4. **Update Layout Composition**
   - Modify `src/app/page.tsx` (and related layout wrappers) to import the new panel components and render them in the existing layout regions without altering styling or base path behavior.
   - Adjust Tailwind classes or layout wrappers only as needed to maintain responsive design once panels are split.

5. **Quality Gates**
   - Run `npm run lint`, `npm run type-check`, and `npm test`, resolving any issues introduced by the refactor.
   - Perform a manual QA pass in the dev server to confirm that each panel renders, interacts, and updates shared state correctly (layers, alignment, animation playback, color picking, brush changes).

## Notes

- Keep new components client/server boundaries consistent with existing usage (add `'use client'` where required).
- Prefer existing selectors in `useAppStore`; when new selectors are needed, define them carefully to avoid excessive re-renders.
- Maintain adherence to the `@/*` import alias and project coding conventions.
