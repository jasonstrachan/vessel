# Refactor Plan: Color Cycle Speed Per Stroke

## Goal
Remove layer-based color cycle speed and make the Brush Settings slider affect **only new strokes**, while previously painted strokes keep their original speed.

## Rationale
- Current behavior mixes per-layer speed with brush settings, which is confusing.
- Per-stroke speed is clearer and matches user intent: “the slider sets the speed for what I paint next.”

## Plan

### 1) Define the new data model
- Add per-stroke speed as **per-pixel speed data** (Uint8Array) stored alongside index + gradient buffers.
- Encode speed bytes → cycles/sec using `[MIN_BRUSH_COLOR_CYCLE_SPEED, MAX_BRUSH_COLOR_CYCLE_SPEED]`.
- Treat `layer.colorCycleData.brushSpeed` as **legacy fallback** only.

### 2) Locate stroke creation + storage
- Identify where CC strokes are created/committed:
  - `src/hooks/useBrushEngineSimplified.ts`
  - `src/hooks/canvas/handlers/colorCycle/*`
  - `src/history/helpers/colorCycle.ts`
- Confirm the stroke structure used for history + playback.

### 3) Capture speed on stroke creation
- On stroke start, derive a speed byte from the **current brush speed** and stamp it into the paint buffers for new pixels.
- Do not write per-layer speed for new strokes.

### 4) Use per-stroke speed at render/playback
- Use the per-pixel speed buffer when animating or rendering.
- Fallback order for legacy data:
  1) `stroke.speed`
  2) legacy `layer.colorCycleData.brushSpeed`
  3) `brushSettings.colorCycleSpeed`

### 5) Retire layer-based speed
- Stop updating `layer.colorCycleData.brushSpeed` in and state transitions.
- Remove layer-speed controls from:
  - `src/components/panels/AnimationControlsPanel.tsx`
  - `src/components/MinimalLayerList.tsx`
  - any other layer-level speed setters

### 6) Update Brush Settings UI
- Keep the Brush Settings slider.
- Label it to clarify behavior: “Color Cycle Speed (new strokes)”.
- Optional tooltip: “Existing strokes keep their speed.”

### 7) Persistence + migration
- Include speed buffer in serialization/deserialization (index buffer + stroke snapshots).
- Migration on load:
  - If speed buffer is missing, fill using legacy layer speed (or brush settings fallback).

### 8) History + undo/redo
- Ensure speed buffer is included in snapshots.
- Undo/redo restores speed buffer correctly.

### 9) Tests
- New strokes store current brush speed.
- Legacy project without stroke speeds loads with correct speeds.
- Slider changes only affect new strokes.

## Definition of Done
- No layer-level speed editing remains in UI.
- Brush Settings slider affects only newly painted strokes.
- Existing strokes retain their original speed.
- Serialization + history fully preserves per-stroke speed.
- Tests pass for new behavior and migration.
