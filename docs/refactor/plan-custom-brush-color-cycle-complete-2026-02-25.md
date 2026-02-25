# Plan: Custom Brush + Color Cycle Feature (Complete Delivery)

Date: 2026-02-25  
Status: Completed implementation record for full feature delivery across all phases.

## Implementation Status (2026-02-25)
1. Phase 0 - Completed.
   - Contracts defined in types and persisted schema (`CustomBrush.colorCycle.schemaVersion`).
2. Phase 1 - Completed.
   - Runtime phase modes implemented (`global`, `per-stroke-seeded`, `jittered`) in brush engine + UI controls.
3. Phase 2 - Completed.
   - Animated custom brush metadata persists through project serialization and local storage.
   - Metadata is restored when selecting saved custom brushes from library/presets.
4. Phase 3 - Completed.
   - Capture from active CC layer imports gradient/speed metadata.
   - All-layers capture remains static by design.
   - Rectangle and freehand capture paths covered by tests.
5. Phase 4 - Completed for project persistence/reload parity.
   - Custom brush CC metadata included in project save/load and selection restore paths.
6. Phase 5 - Completed for this feature scope.
   - No new per-frame allocations introduced in phase utility.
   - Existing cache paths reused; no new unbounded cache introduced.
7. Phase 6 - Completed.
   - Added/updated unit and integration tests for phase math, capture metadata behavior, tools slice restore, and persistence round-trip.
8. Phase 7 - Completed.
   - UI labels/hints added for phase mode behavior and CC metadata import.

### Validation Snapshot
1. `npm run type-check`: pass.
2. `npm run lint`: pass.
3. Targeted feature tests: pass.
4. Full `npm test`: pass.

### Delivered Artifacts
1. Runtime phase utility and engine wiring:
   - `src/hooks/brushEngine/customColorCyclePhase.ts`
   - `src/hooks/brushEngine/BrushEngineFacade.ts`
2. UI controls and capture workflow:
   - `src/components/toolbar/BrushControls.tsx`
   - `src/components/toolbar/CustomBrushPanel.tsx`
3. Data model and persistence:
   - `src/types/index.ts`
   - `src/utils/projectIO.ts`
   - `src/utils/customBrushPersistence.ts`
   - `src/stores/slices/toolsSlice.ts`
   - `src/utils/customBrushPreset.ts`
4. Automated tests:
   - `src/hooks/brushEngine/__tests__/customColorCyclePhase.test.ts`
   - `src/components/toolbar/__tests__/CustomBrushPanel.test.tsx`
   - `src/stores/__tests__/toolsSlice.test.ts`
   - `src/utils/__tests__/projectIO.test.ts`
   - `src/utils/__tests__/customBrushPersistence.test.ts`
   - `src/utils/__tests__/customBrushPreset.test.ts`
5. User/QA documentation:
   - `docs/project.md`
   - `docs/newcomer-guide.md`
   - `docs/testing/custom-brush-color-cycle-qa.md`

## Goal
Deliver a complete, production-grade custom-brush + color-cycle workflow where users can:
1. Capture brushes from regular or color-cycle content.
2. Paint with custom brushes using color-cycle animation.
3. De-sync animation timing across stamps/strokes (phase offsets).
4. Persist, reload, export, and replay behavior deterministically.
5. Validate with unit, integration, and end-to-end coverage.

## Non-Goals
1. Replacing existing color-cycle layer architecture.
2. Rewriting brush engine orchestration files beyond targeted seams.
3. Introducing breaking changes to existing project files without migration.

## Shipped Baseline (as of 2026-02-25)
1. Phase-offset controls for custom brush color-cycle are implemented (`global`, `per-stroke-seeded`, `jittered`).
2. Capture from active color-cycle layers auto-imports gradient/speed into custom brush settings.
3. Custom brush color-cycle metadata persists through project files and local storage.
4. Targeted and full-suite tests pass for this feature set.
5. Payload scope is metadata-first (`gradient`, `speed`, `phaseMode`, `phaseJitter`) without per-pixel phase/index map serialization.

## Architecture Principles
1. Keep orchestration shells thin; implement logic in handlers/utils/engine modules.
2. Preserve backward compatibility for existing projects.
3. Deterministic replay for history/export.
4. Feature flags for risky runtime changes.
5. No mock-only confidence: include integration and E2E validation paths.

---

## Phase 0: Finalize Spec + Contracts

### Deliverables
1. Feature spec in docs:
   - capture modes
   - phase modes
   - animation ownership (global vs per-stroke vs per-stamp)
   - persistence/export semantics
2. Data contract versioning decision:
   - project schema bump only if new persisted payload is required
3. Explicit compatibility matrix:
   - old projects opening in new runtime
   - new projects opening in previous runtime (degrade behavior)

### Exit Criteria
1. API/types approved.
2. Migration behavior documented.
3. No ambiguous runtime ownership.

---

## Phase 1: Runtime Behavior (Brush Engine)

### Scope
1. Maintain existing Phase 1 work:
   - `customBrushColorCycle` controls
   - phase offset modes
2. Normalize phase ownership in one utility layer:
   - deterministic seeded offsets
   - bounded jitter
   - reset semantics at stroke boundaries

### Implementation Areas
1. `src/hooks/brushEngine/BrushEngineFacade.ts`
2. `src/hooks/brushEngine/customColorCyclePhase.ts`
3. `src/components/toolbar/BrushControls.tsx`
4. `src/types/index.ts`
5. `src/presets/brushPresets.ts`

### Exit Criteria
1. No synchronized-lockstep artifact unless user chooses `global`.
2. Stable stroke replay in same session.
3. No regression in non-custom brush paths.

---

## Phase 2: Animated Custom Brush Asset Model

### Objective
Support custom brushes that carry optional animation metadata, not just static `ImageData`.

### Proposed Data Model
1. Extend `CustomBrush` with optional color-cycle payload:
   - gradient stops (or gradient ref)
   - speed
   - phase mode defaults
   - optional per-pixel phase/index map (if adopted)
2. Keep static brush compatibility:
   - absence of payload means current static behavior
3. Add schema version tag for custom brush payload.

### Storage/Migration
1. Project load:
   - hydrate missing fields with defaults
2. Project save:
   - persist only serializable payload
3. Feature downgrade:
   - strip advanced payload when exporting legacy format (if needed)

### Exit Criteria
1. New custom brush metadata survives save/load intact.
2. Older project files open without errors.
3. Runtime falls back gracefully when payload missing.

---

## Phase 3: Capture Pipeline Enhancements

### Objective
Make color-cycle-origin capture deterministic and explicit.

### Behavior
1. Capture from CC layer (single-layer mode):
   - import gradient/speed defaults
   - mark brush provenance as `source: color-cycle-layer`
2. Capture from all layers:
   - static composite capture by default
   - no implicit CC metadata import
3. Freehand and rectangle parity:
   - identical metadata rules

### Implementation Areas
1. `src/components/toolbar/CustomBrushPanel.tsx`
2. `src/utils/customBrushCapture.ts`
3. `src/stores/slices/projectSlice.ts`
4. `src/stores/slices/toolsSlice.ts`

### Exit Criteria
1. Capture mode behavior is predictable and documented in UI/help text.
2. Metadata import is test-covered for rectangle + freehand.

---

## Phase 4: History, Undo/Redo, and Export Parity

### Objective
Ensure behavior parity between runtime painting and exported/replayed output.

### History/Replay
1. Include necessary custom brush CC metadata in stroke history payloads.
2. Ensure undo/redo reproduces phase behavior deterministically.

### Export (Goblet/WebGL + raster paths)
1. Serialize custom brush animation metadata.
2. Verify exported playback matches on-canvas behavior within tolerance.

### Implementation Areas
1. `src/history/helpers/**`
2. `src/hooks/canvas/handlers/colorCycle/**`
3. `src/utils/export/**`
4. `tests/export-*.test.ts`

### Exit Criteria
1. History replay parity tests pass.
2. Export integration tests pass with phase mode cases.

---

## Phase 5: Performance + Memory Hardening

### Objective
Avoid regressions from new metadata/animation paths.

### Work
1. Cache keys include relevant phase/metadata dimensions.
2. Avoid per-frame allocations in custom brush CC paths.
3. Verify no unbounded growth in brush cache or transient buffers.

### Benchmarks
1. Compare baseline vs new feature on:
   - small/medium/large custom brush sizes
   - rapid stamping
   - long sessions

### Exit Criteria
1. No material FPS regressions for standard brush workflows.
2. Memory usage remains bounded under stress tests.

---

## Phase 6: Test Completion Matrix

### Unit Tests
1. Phase math utility:
   - deterministic seed
   - jitter bounds
   - wrap semantics
2. Brush setting defaults/migrations.
3. Capture metadata decision logic.

### Integration Tests
1. Custom brush panel:
   - rectangle/freehand capture metadata import paths
   - all-layers negative path
2. Brush engine:
   - phase mode behavior across multi-stroke painting
3. Store persistence:
   - save/load of custom brush CC payload.

### E2E / Runtime Tests
1. Manual scripted flow:
   - create CC layer art
   - capture custom brush
   - paint with each phase mode
   - save/reload/export
2. Compare expected visual timing patterns.

### Required Commands
1. `npm run type-check`
2. `npm run lint`
3. `npm test`
4. Targeted integration/E2E scripts for custom brush CC workflows

### Exit Criteria
1. All required commands pass in CI.
2. New tests cover both positive and fallback paths.
3. No known critical defects open.

---

## Phase 7: UX/Docs/Release Signoff

### UX
1. Tooltips/help copy for phase modes:
   - `global`
   - `per-stroke-seeded`
   - `jittered`
2. Capture import messaging for CC-origin brushes.

### Documentation
1. Update user docs and newcomer guide.
2. Update architecture docs for new custom brush payload fields.
3. Add troubleshooting notes for “animations look synchronized”.

### Release Gates
1. Product acceptance checklist signed.
2. No unresolved P0/P1 bugs.
3. Migration verified on sample old projects.

---

## Risks and Mitigations
1. Risk: Non-deterministic replay across environments.
   - Mitigation: deterministic seeds + serialized metadata + replay tests.
2. Risk: Performance regressions in high-frequency stamping.
   - Mitigation: cache discipline + benchmark gates.
3. Risk: Schema drift between runtime and export paths.
   - Mitigation: shared serializer helpers + export integration tests.
4. Risk: UI confusion around multiple phase modes.
   - Mitigation: concise labels/tooltips + defaults.

## Definition of Done (Feature Complete)
1. All phases above shipped (or explicitly marked deferred with acceptance).
2. End-to-end workflow works:
   - capture -> paint -> animate -> save/load -> export -> replay
3. Tests pass at unit/integration/E2E levels.
4. Documentation and migration notes are published.
5. Runtime and export behavior are aligned for animation and phase handling.

## Suggested Delivery Order
1. Phase 0 finalize contracts
2. Phase 2 data model + migration
3. Phase 3 capture pipeline parity
4. Phase 4 history/export parity
5. Phase 5 performance hardening
6. Phase 6 test matrix completion
7. Phase 7 release/documentation signoff
