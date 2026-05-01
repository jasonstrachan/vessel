# Color-Cycle Architecture Slimming Plan - 2026-05-01

Status: implemented and verified

## Goal

Audit the color-cycle architecture end to end for strokes, manual CC gradients, sampled CC gradients, foreground-derived mode, and both 1-color and multi-color behavior. Then reduce bug-prone complexity across runtime, persistence, UI controls, rendering, Goblet export, and tests without changing intended artwork behavior.

## Current Audit

The highest-risk areas are concentrated in a few oversized files and repeated contracts:

- `src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts` is roughly 8k LOC and owns runtime state, brush painting, shape fills, dither/stamp behavior, animation, persistence snapshots, mutation auditing, and layer-store publication.
- `src/utils/projectIO.ts` is roughly 6.2k LOC and still hosts broad project serialization, archive hydration, legacy repair, diagnostics, save, and warmup behavior.
- `src/components/toolbar/BrushControls.tsx` is roughly 4.7k LOC and mixes generic brush controls, CC-gradient source controls, sampled/foreground/manual editor state, and unrelated preset branches.
- `src/utils/export/goblet/gobletColorCycleSerializer.ts` is roughly 2.9k LOC and reconstructs brush state from live brush properties, animator internals, document state, and saved snapshots.
- `src/hooks/canvas/handlers/colorCycle/colorCycleShapeFill.ts` repeats near-identical linear/concentric finalize logic, including manual/sample/FG binding, dither options, foreground refresh, transparency lock, runtime commit, and deferred save.

The recurring bug source is not one renderer. It is contract drift:

- Manual, sampled, and foreground-derived gradients each choose stops, slots, def ids, and dither runtime stops in slightly different places.
- 1-color sampled mode has special synthesis behavior that must not leak into multi-color sampled mode.
- Shape preview, shape finalize, stroke runtime, saved document state, and Goblet export each have paths that can reinterpret the same buffers.
- Persistence now has a stronger six-channel canonical state boundary, but callers still need to avoid recreating older fallback authority rules.

## Non-Negotiable Invariants

- No hidden fallback may turn preview pixels or RGBA snapshots into canonical animated CC data outside import repair.
- Save, autosave, history, runtime hydration, and Goblet export must consume the same canonical document contract rather than assembling CC payloads independently.
- Manual, sampled, and foreground-derived CC gradients must resolve through one explicit mark/source contract before render/finalize/export decisions.
- Sampled 1-color behavior must stay isolated from sampled multi-color behavior.
- Goblet playback/export parity must be updated whenever runtime timing, speed, flow, phase, slot, or def-id contracts change.
- Refactors must reduce branch duplication before changing algorithms.

## Implementation Checklist

1. [x] Audit current CC architecture and identify concentrated complexity.
   - Evidence: line-count and code-path scan completed for runtime, persistence, UI, Goblet export, sampled session, and shape finalize paths.

2. [x] Extract shared shape-finalize fill option resolution.
   - Add a small helper for the duplicated `ditherSampledStops`, `ditherBaseOffsetOverride`, `paintSlotOverride`, `paintDefIdOverride`, and `shapePhaseSeedMarkId` policy.
   - Use it from both linear and concentric shape finalize.
   - Add focused tests for manual, sampled, and fallback/null sessions.
   - Result: `resolveColorCycleShapeFillSourceOptions(...)` centralizes the policy and has focused coverage in `colorCycleShapeFillOptions.test.ts`.

3. [x] Extract shape-finalize foreground/runtime binding preparation.
   - Collapse the duplicated foreground slot refresh and `applyRuntimeToBrush(...)` setup used by linear and concentric finalize.
   - Preserve current behavior for FG mode, manual mode, and sampled mode.
   - Result: shared helpers now handle foreground palette refresh, resolved runtime binding application, and post-finalize foreground apply requests for both linear and concentric finalize.

4. [x] Split shape-fill geometry helpers from finalize workflow.
   - Move convex-hull/farthest-pair/direction math out of `colorCycleShapeFill.ts`.
   - Keep finalize orchestration focused on mode selection and commit flow.
   - Result: geometry math now lives in `colorCycleShapeGeometry.ts`; `colorCycleShapeFill.ts` re-exports `computeFallbackLinearDirection(...)` to keep current call sites stable.

5. [x] Define a single CC gradient source contract.
   - Add a typed resolver for `manual | sampled | fg` that returns frozen stops, runtime stops, binding, sampled metadata, and source-specific flags.
   - Make stroke start, shape preview, shape finalize, and UI sampling use the same terms.
   - Keep the sampled 1-color synthesis branch explicit and tested separately.
   - [x] Add the initial source behavior helper for sampled-only fill flags and deferred binding ownership.
   - [x] Route shape fallback session source selection and gradient-slot debug source labels through the shared source resolver.
   - [x] Extend the helper to return source, behavior, and resolved active/frozen stops for mark-session creation.
   - [x] Wire stroke start, shape pointer-down, and sampled session bootstrap to the shared source-state contract.
   - [x] Extend the helper to cover runtime/dither stop freezing.
   - [x] Wire UI sampled-preview stop resolution to the same source-state contract.
   - [x] Wire shape preview to the same contract terms.

6. [x] Make Goblet export consume canonical CC document/source contracts first.
   - Prefer `ColorCycleLayerDocumentState` and validated brush snapshots before live internals.
   - Move fallback extraction helpers into named modules with source priority tests.
   - Cover manual, sampled 1-color, sampled multi-color, and FG-derived export fixtures.
   - [x] Prefer validated document state before loose brush-property and animator fallback introspection.
   - [x] Move fallback extraction helpers into named modules.
   - [x] Add the full manual/sampled/FG export fixture matrix.

7. [x] Reduce runtime brush class ownership.
   - Move pure palette/def-cache, serialization/snapshot, mutation audit, and stamp mask helpers out of `ColorCycleBrushCanvas2D.ts`.
   - Keep the class as runtime orchestration plus canvas/animator integration.
   - Add regression coverage before each extraction.
   - [x] Move pure CC payload-presence guards out of `ColorCycleBrushCanvas2D.ts`.
   - [x] Extract palette/def-cache helpers.
   - [x] Extract serialization/snapshot helpers.
   - [x] Extract stamp mask helpers.

8. [x] Reduce UI control ownership.
   - Move CC-gradient source/editor controls out of `BrushControls.tsx` into a focused component.
   - Keep visible control names and behavior unchanged.
   - Add/update `BrushControls.colorCycle` tests for manual/sample/FG state transitions.
   - [x] Move the CC-gradient source mode selector into `CcGradientSourceModeControl`.
   - [x] Move the sampled/FG/manual preview/editor blocks into focused components.
   - [x] Add/update `BrushControls.colorCycle` coverage for source transitions.

9. [x] Consolidate test matrix.
   - Add a small source/mode matrix covering stroke, linear shape, concentric shape, persistence, and Goblet export:
     - manual 1 color
     - manual >1 color
     - sampled 1 color
     - sampled >1 color
     - FG 1 color
     - FG >1 color
   - Prefer focused unit tests for contracts and one or two integration/browser checks for runtime confidence.
   - [x] Add initial source-contract matrix coverage for manual and sampled 1-color / multi-color stop preservation.
   - [x] Extend matrix to stroke, linear shape, concentric shape, persistence, Goblet export, and FG 1-color / multi-color fixtures.
   - Note: FG source currently clamps requested one-stop mode to the existing minimum derived-gradient stop count; the matrix test documents that contract instead of inventing an unsupported one-stop FG runtime.

10. [x] Run review and verification.
    - Run focused tests for touched modules after each step.
    - Before completion, run `npm run type-check`, `npm run lint`, and `npm test`.
    - Do a code review pass for new abstractions, hidden fallbacks, branch leakage, and Goblet/runtime parity.
    - [x] Current validation pass: focused tests, `npm run type-check`, `npm run lint`, and full `npm test` pass after Steps 1-9 partial implementation.
    - [x] Current review pass: checked diff scope, import usage, Goblet fallback priority, source contract wiring, and untracked files.
    - [x] Final review after remaining Step 5-9 items are complete.
    - [x] Final verification: `npm run type-check`, `npm run lint`, `npm test`, and `git diff --check` pass.

## Risks

- Broad edits in `ColorCycleBrushCanvas2D.ts`, `projectIO.ts`, or `BrushControls.tsx` can accidentally mix unrelated fixes. Keep each step small and revert any non-fixing experiment.
- The refactor now incorporates the active CC shape-fill changes into smaller source-contract, geometry, and finalize helpers.
- Goblet generated runtime artifacts may need regeneration if export/runtime contracts change.

## Done Criteria

- The plan checklist is fully ticked with evidence.
- Manual/sample/FG source policy is explicit and shared instead of copied through render/finalize/export paths.
- Sampled 1-color behavior is isolated by tests and does not alter sampled >1-color behavior.
- Persistence and Goblet export use the canonical payload contract without hidden fallback authority.
- Final verification passes, or any remaining failure is documented with exact command output and blocker.
