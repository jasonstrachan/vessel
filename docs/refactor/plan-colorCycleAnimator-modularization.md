# Plan: Modularize `ColorCycleAnimator`

Date: 2025-12-31

## Goal
Split `src/lib/ColorCycleAnimator.ts` into focused, testable modules without changing behavior. Improve maintainability, isolate rendering paths, and reduce cross‑cutting state.

## Scope
- **In**: `src/lib/ColorCycleAnimator.ts`, `src/lib/colorCycle/rendering/*`, `src/lib/colorCycle/*`.
- **Out**: Behavioral changes to animation, palette math, or export compatibility.

## Constraints
- API compatibility with existing callers and tests.
- Preserve Canvas2D + optional WebGL rendering fallback.
- Keep serialized data formats stable.

## Proposed Decomposition

### 1) Palette Controller
**Module**: `src/lib/colorCycle/PaletteController.ts`
- Owns gradient stops, signatures, palette slots, and palette updates.
- Public API:
  - `setGradientStops`, `setActiveSlot`, `getPaletteRGBA`, `computeSignature`.

### 2) Renderer2D
**Module**: `src/lib/colorCycle/Renderer2D.ts`
- Owns ImageData generation + Canvas2D draw.
- Public API:
  - `render(indexBuffer, palette, offset)`
  - `resize(width, height)`

### 3) RendererWebGL
**Module**: `src/lib/colorCycle/rendering/RendererWebGL.ts`
- Wraps `WebGLColorCycleRenderer` with a small stable interface.
- Public API:
  - `isSupported`, `initialize`, `uploadPalette`, `uploadIndexBuffer`, `render`.

### 4) Stroke Order Tracker
**Module**: `src/lib/colorCycle/StrokeOrderTracker.ts`
- Owns strokeOrder buffer and flow mode logic.
- Public API:
  - `markPaint`, `reset`, `updateFlowPhase`, `serialize`.

### 5) Coordinator
**Module**: `src/lib/ColorCycleAnimator.ts`
- Becomes orchestration glue, not a monolith.
- Wires palette + renderer(s) + stroke tracker.

### Serialization Boundary
- Keep serialization/deserialization logic in the coordinator or a dedicated `Serializer` module.
- Must preserve byte‑for‑byte compatibility with existing exports and history snapshots.

---

## Migration Steps

1. **Extract palette logic** into `PaletteController`.
2. **Extract 2D rendering** into `Renderer2D`.
3. **Wrap WebGL renderer** with a minimal adapter.
4. **Extract stroke tracking** into `StrokeOrderTracker`.
5. **Define serialization boundary** and lock existing formats with tests.
6. **Refactor ColorCycleAnimator** to delegate and slim down.
7. **Run existing tests** + targeted new tests for palette and renderer modules.

---

## Testing Strategy
- Keep existing tests under `src/lib/__tests__` and `src/lib/colorCycle/__tests__`.
- Add unit tests for:
  - Palette slot selection
  - Signature stability
  - Stroke order serialization
- Add a parity test that renders a known IndexBuffer and compares output frames.

---

## Definition of Done
- `ColorCycleAnimator.ts` < 600 LOC and mostly orchestration.
- Renderer and palette modules are independently testable.
- Serialization format unchanged and covered by tests.
- All tests pass: `npm test`, `npm run type-check`, `npm run lint`.

## Risk + Rollback
- **Risk**: Rendering regressions or serialization incompatibility.
- **Mitigation**: Add parity tests and keep serialization under test before refactor.
- **Rollback**: Restore prior `ColorCycleAnimator.ts` and reapply changes incrementally.
