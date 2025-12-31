# Plan: Consolidate Color Cycle Brush Implementations

Date: 2025-12-31

## Goal
Reduce multiple overlapping ColorCycle brush implementations into a single primary implementation with a clear configuration surface, while preserving behavior.

## Scope
- **In**: `src/hooks/brushEngine/ColorCycleBrush*`, `ColorCycleBrushMigration.ts`, tests under `src/testing/` and `src/hooks/brushEngine/__tests__`.
- **Out**: Changes to user-facing behavior or data formats.

## Current Problem
Multiple implementations (`ColorCycleBrushCanvas2D`, `ColorCycleBrushOptimized`, `ColorCycleBrush2D`, `ColorCycleBrushSimple`, `ColorCycleBrushPath2D`) create divergence and duplicated fixes. It’s unclear which path is authoritative.

## Proposed Target
- **Single primary brush**: `ColorCycleBrushCanvas2D` (or renamed `ColorCycleBrush`).
- **Optional optimization flags** passed via config to enable performance features.
- **Migration shim** remains, but only routes to the primary implementation.

## Feature Parity Checklist
- Gradient bands + slot management
- Flow modes and stroke order behavior
- Fill strategies (shape + flood)
- Eraser/clear paths
- Serialization/deserialization parity

## Migration Steps

1. **Inventory call sites**
   - Identify where each class is instantiated (prod vs testing).

2. **Choose primary implementation**
   - Keep `ColorCycleBrushCanvas2D` as canonical unless benchmarks dictate otherwise.

3. **Fold optimized path**
   - Move `ColorCycleBrushOptimized` settings into the primary brush via config.

4. **Deprecate/remove legacy classes**
   - Delete or mark as deprecated after re‑routing.
   - Update tests/benchmarks to use primary brush.

5. **Update migration shim**
   - `createColorCycleBrush` returns only the primary implementation.

---

## Testing Strategy
- Run performance benchmarks to confirm no regressions.
- Update tests referencing removed implementations.
- Add parity tests for feature checklist above.

---

## Definition of Done
- Only one ColorCycle brush implementation remains in production paths.
- All tests and benchmarks pass.
- Documentation updated in `docs/project.md` if needed.

## Risk + Rollback
- **Risk**: Feature regressions due to missing parity between implementations.
- **Mitigation**: Use the feature parity checklist + focused regression tests.
- **Rollback**: Restore removed implementations and re-enable via `ColorCycleBrushMigration`.
