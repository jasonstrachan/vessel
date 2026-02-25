# Custom Brush + Color Cycle QA Checklist

Date: 2026-02-25  
Scope: end-to-end validation for custom brushes created from color-cycle pixels.

## Preconditions
1. Open Vessel and create a project with at least one Color Cycle layer.
2. Ensure the active tool can paint on the Color Cycle layer.

## Scenario A: Capture From Active CC Layer
1. Draw visible animated content on a Color Cycle layer.
2. Open custom brush capture panel.
3. Set capture source to active layer (not all layers).
4. Capture a brush (rectangle mode).
5. Confirm UI indicates CC settings were imported.
6. Switch to custom brush and confirm:
   - `customBrushColorCycle` is enabled.
   - imported gradient matches the source layer gradient.
   - imported speed matches the source layer speed.

## Scenario B: Capture From All Layers
1. Enable capture from all layers.
2. Capture a custom brush (rectangle mode).
3. Confirm resulting brush is static by default:
   - no auto-imported CC gradient/speed metadata.
   - `customBrushColorCycle` remains off unless manually enabled.

## Scenario C: Freehand Capture Parity
1. Switch capture mode to freehand.
2. Capture from active CC layer.
3. Confirm behavior matches rectangle mode:
   - metadata imports only when source is active CC layer.

## Scenario D: Phase Mode Behavior While Painting
1. Select a CC-enabled custom brush.
2. Paint a multi-stamp stroke for each phase mode:
   - `global`
   - `per-stroke-seeded`
   - `jittered` (set non-zero jitter)
3. Expected behavior:
   - `global`: synchronized animation phase.
   - `per-stroke-seeded`: each stroke gets deterministic phase offset.
   - `jittered`: stamps are visibly de-synced within stroke bounds.

## Scenario E: Save/Reload Persistence
1. Save project with at least one CC-enabled custom brush.
2. Reload project.
3. Re-select saved custom brush from library.
4. Confirm these values restore:
   - gradient
   - speed
   - phase mode
   - phase jitter

## Scenario F: Local Storage Recovery
1. Create/save a CC-enabled custom brush.
2. Reload app session.
3. Confirm brush still appears with correct CC defaults.

## Regression Checks
1. Non-custom brushes still behave unchanged.
2. Standard custom brushes without CC metadata still work.
3. No runtime errors when switching tools/layers while using CC-enabled custom brush.
