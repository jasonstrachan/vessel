# WebGL Export Layout Plan

## Goal
Create a WebGL export option that ships TinyBrush projects as self-contained JavaScript + GLSL packages with predictable layout. The exporter must honor per-layer alignment choices and a configurable container layout so the generated bundle can adapt to any viewport while matching designer intent.

## Background
- Current exports (PNG/GIF/MP4) rasterize the already composed canvas; there is no WebGL bundle today.
- Runtime rendering picks Canvas2D by default. WebGL exists only for color-cycle animation and receives a single composite index buffer.
- Layer stack already stores order, opacity, blend mode, and framebuffer/image data but lacks layout metadata beyond document size.

## Requirements
- Works for all layer types (`normal`, `color-cycle`, future additions) without assuming color-cycle exclusive data.
- Each layer exposes alignment controls similar to CSS `object-fit`/`object-position` plus explicit pixel offsets.
- Exporter lets users define container-level flow (row / column / reversed), alignment, wrapping, gap, padding, and size (`hug` vs `fixed`).
- Export bundle includes:
  - Shader source (vertex + fragment) for WebGL2, fallback notes for WebGL1 if used.
  - Serialized assets per layer (bitmap textures, color-cycle palettes/index buffers, metadata for blend/opacity).
  - Layout metadata so a loader can reproduce transforms for arbitrary viewport sizes.
  - Animation cues (loop duration, ticks per frame) so color-cycle layers can render perfect loops just like the GIF exporter.
- UI updates surface alignment controls in the layer column and WebGL export modal.

## Data Model Updates
- `src/types/index.ts`
  - Add `LayerAlignmentSettings` with fields `fit`, `horizontal`, `vertical`, optional `offsetPx`.
  - Extend `Layer` interface with `alignment: LayerAlignmentSettings` (default values created at layer insert time).
  - Add `ExportContainerLayout` shape capturing flow, justify, align, wrap, gap, padding, size mode, optional fixed dimensions.
  - Extend `Project` with `exportLayout?: ExportContainerLayout`.
- `src/stores/useAppStore.ts`
  - Populate defaults when creating layers/projects.
  - Add actions `updateLayerAlignment(layerId, alignment)` and `setExportLayout(layout)`.
  - Ensure undo/redo snapshots include the new fields.
- Persistence
  - Update `src/utils/projectIO.ts` to read/write alignment and container layout data.

## Utilities & Math
- Add `src/utils/layerAlignment.ts`:
  - `computeLayerTransform(surface, viewport, alignment): { scaleX, scaleY, translateX, translateY }` implementing CSS-like `object-fit` semantics plus offsets.
  - `resolveContainerLayout(layers, layoutConfig, viewport): Array<{ layerId, frame: { x, y, width, height }, transform }>` handling flow, wrapping, justify, align, gap, padding, hug sizing.
- Add Jest tests under `src/utils/__tests__/layerAlignment.test.ts` covering:
  - Each `fit` option for square/rectangular viewports.
  - Container flow permutations, wrapping, gap accumulation, and padding.

## UI Changes
1. **Layer Column Panel** (`src/components/MinimalLayerList.tsx`)
   - Insert an alignment panel above the play/pause control.
   - Controls: fit dropdown, horizontal/vertical alignment buttons, numeric inputs for X/Y offset.
   - Reflect disabled state when no layer selected; display applied settings summary otherwise.
   - Use memoized selectors to limit re-renders.
2. **Container Layout Panel**
   - Either extend the same bottom area (above play button) or add a toggleable subsection that edits `exportLayout`.
   - Controls inspired by the provided screenshot: flow buttons (row, column, row-reverse, column-reverse), wrap toggle, gap input, padding inputs, size mode toggles (hug vs fixed), width/height fields, alignment matrix for justify/align.
   - Persist immediately to store so preview/export stay in sync.
3. **Export Modal** (`src/components/modals/ExportModal.tsx`)
   - Add `webgl` to `ExportKind` and adjust toggle UI.
   - When WebGL selected, include sections:
     - Container layout summary (editable, reusing the same control component if practical).
     - Layer alignment table with quick links to select a layer.
     - Viewport presets (current canvas, square, widescreen) and custom dimension inputs.
     - Options to include hidden layers, embed Canvas2D fallback, or minify output (future-friendly toggles can default off).
     - Perfect loop controls mirroring the GIF export (duration/FPS chooser, auto-calculated total frames) so exported WebGL bundles know when to wrap animation states.

## Export Pipeline
- New module `src/utils/export/webglExporter.ts` orchestrates the flow.
  1. Snapshot current project + layout from the store while respecting export modal overrides.
  2. Resolve container layout to compute each layer's transform relative to the chosen viewport.
  3. For each layer:
     - Capture framebuffer/image data; for `color-cycle`, serialize palette/index buffers plus animation parameters.
     - Produce transferable asset blobs (ArrayBuffers/Base64 strings depending on packaging decisions).
     - Quantize animation lengths to the least common multiple of layer cycles when "Perfect loop" is enabled so timelines wrap cleanly.
  4. Emit metadata JSON:
     ```json
     {
       "viewport": { "width": 1920, "height": 1080 },
       "container": { ...exportLayout },
       "layers": [
         {
           "id": "layer-1",
           "type": "normal",
           "blendMode": "source-over",
           "opacity": 0.85,
           "alignment": { "fit": "cover", "horizontal": "center", "vertical": "end", "offsetPx": { "x": 0, "y": -32 } },
           "transform": { "scaleX": 1.2, "scaleY": 1.2, "translateX": 0, "translateY": -32 },
           "assets": { "texture": "data:..." }
         }
       ],
       "shaders": { "vertex": "...", "fragment": "..." }
     }
     ```
  5. Provide a small loader script (ES module) that accepts a target canvas element, hydrates WebGL2 resources, applies transforms, and kicks off animation loops for color-cycle layers.
     - Loader respects the exported loop metadata: it advances animation offsets modulo the quantized period so playback is perfectly seamless.
  6. Package output as a zipped archive or folder written to `out/webgl-export/`.
- Consider optional Canvas2D fallback; if implemented, serialize raster composite alongside WebGL metadata.

## Implementation Phases
1. **Schema + Store groundwork**: add types, store actions, persistence updates, unit tests.
2. **Alignment utilities**: implement `computeLayerTransform` + `resolveContainerLayout` with full test coverage.
3. **UI controls**: layer panel alignment UI, container layout panel, WebGL export modal updates.
4. **Exporter core**: build `webglExporter.ts`, integrate with modal's `handleExport` path, write smoke tests (e.g., Jest verifying metadata structure with mocked layer data).
5. **Loader/runtime scaffold**: add lightweight runtime module under `public/export-runtime` or `src/exportRuntime` that consumers can import.
6. **Documentation & samples**: update README/export docs and add sample output (optional).

## Runtime & Packaging Decisions
- Define a concrete loader API, e.g. `initTinyBrushWebGL(canvas: HTMLCanvasElement, data: TinyBrushWebGLBundle, opts?: { autoplay?: boolean })`, and document pause/resume hooks. Include this in the exported metadata README.
- Decide on packaging: zipped archive vs folder vs ES module build. If zipped, specify library (e.g., `JSZip`) and integration point. Clarify where output lands (`out/webgl-export/` or similar) and whether `npm run build` should trigger it.
- Determine how to embed shader strings (inline vs separate `.glsl` files) and note any bundler requirements.

## Testing & QA Expectations
- Unit tests for alignment utilities (already listed) plus serialization functions that ensure loop metadata and transforms survive round-trips.
- Add an integration smoke test: export a small project, load it in headless WebGL (e.g., jsdom + mock or Playwright) to verify metadata shape and ensure the loader initializes without throwing.
- Manual QA checklist: verify perfect-loop playback, layer alignment fidelity across viewport sizes, and fallbacks when WebGL is unavailable.

## Dependencies & Deployment Notes
- If additional libs (compression, runtime helpers) are needed, document versions and any license implications here before implementation.
- Confirm output size stays friendly for GitHub Pages; consider optional compression or lazy asset loading if bundles are large.
- Note whether feature gating/flagging is required for rollout.

## Rollout & Documentation
- Update user-facing docs (export guide, README) once the feature lands.
- Provide sample exported bundle in `docs/examples/` or a demo link for QA/reference.
- Coordinate with release notes to highlight the new WebGL export workflow and requirements (WebGL2 support, perfect-loop options, etc.).

## Risks & Mitigations
- **Complex layout math**: rely on unit tests mirroring CSS behavior; reference Figma/auto-layout semantics.
- **Large payloads**: consider binary packing for textures, compress output, stream to zip.
- **WebGL compatibility**: keep shaders WebGL2-first but test WebGL1 fallback paths. Document requirements.
- **UI clutter**: keep controls collapsible or context-aware to avoid overwhelming layer panel.

## Open Questions
- Do we need animation timelines exported (beyond color-cycle) for other layer types?
- Should container layout be editable outside export (e.g., overall canvas layout tool)?
- Preferred packaging format: raw folder vs zipped bundle vs npm-ready module?
- Need for localization/labels for new controls?
- Should hug sizing follow Figma semantics exactly (min/max constraints)?
