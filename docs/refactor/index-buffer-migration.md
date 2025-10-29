# Index Buffer Numeric Paint Migration

## API Surface Audit (2025-10-29)

Search scope: `rg "indexBuffer\.paint"`, `rg "indexBuffer\.paintSquare"`, `rg "indexBuffer\.paintTriangle"`, `rg "indexBuffer\.paintLine"`, `rg "indexBuffer\.fill"`.

- `src/lib/ColorCycleAnimator.ts` – switched to `paint*WithIndex`/`fillWithIndex` (numeric path).
- `src/lib/ColorCycleRenderer.ts` – migrated to numeric painting via `paint*WithIndex` and palette span helpers.
- `src/hooks/brushEngine/ColorCycleBrushOptimized.ts` – uses numeric painting for Canvas2D fallback; WASM path already writes indices directly.
- `src/hooks/brushEngine/ColorCycleBrush2D.ts` – maintains raw `Uint8Array` buffers; no `IndexBuffer` usage, so no migration needed.
- Test suites (`src/lib/__tests__/IndexBuffer.test.ts`) exercise both legacy and numeric APIs.

No external module depends on `IndexBuffer.paint*` returning a string (all methods are void); palette string retrieval is confined to gradient/UI code paths.

### Next

After PaletteHandle exposes explicit index helpers, update the remaining modules above and deprecate the string-based painters.

## Benchmark Snapshot (2025-10-29)

`npm test -- IndexBuffer.benchmark`

- String path (`IndexBuffer.paint`): ~123.5 ms across 24×(128×128) strokes.
- Numeric path (`IndexBuffer.paintWithIndex`): ~93.2 ms for the same workload (~1.3× faster, ~25% CPU savings).

Test logs print the raw timings for future comparisons.
