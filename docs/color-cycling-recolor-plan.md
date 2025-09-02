# Color Cycling: Recolor Existing Pixels (Plan)

## Summary
- Goal: Add a fast, non-destructive “Color Cycle Existing Pixels” mode that recolors any pixels on a layer according to a gradient and animates them over time. Also add a one-click “Extract Colors from Layer” to build a gradient from current layer colors.
- Modes:
  - Gradient Remap: Map each existing color to a position along a chosen gradient and animate through it.
  - Extract + Animate: Quantize and extract dominant colors from the layer to auto-generate a gradient; map pixels to those stops and animate.
- UI: A control very similar to the current Color Cycle brush gradient dropdown with: preset gradients, Add New (+), and Extract From Layer.

## Objectives
- Non-destructive recolor effect per layer (works on all existing pixels).
- High performance on large canvases (>= 4K) with smooth 24–60 FPS animation.
- Deterministic mapping so undo/redo is consistent.
- Integrate with existing color-cycle system, reusing gradient/animation semantics.

## Scope
- Target layers: normal raster layers and color-cycle layers.
- New layer mode: a post-process “Color Cycle Recolor” effect stored in layer `colorCycleData`.
- Persist gradient, palette, and mapping state in project save data.
- Respect layer visibility, opacity, and blend mode during composition.

## User Experience
- Entry point: New “Recolor” tab/section inside Color Cycle controls (or a toggle within the existing panel).
- Controls:
  - Preset gradient selector (same component) + “+ Add New”.
  - Extract From Layer button.
  - Mapping options: 
    - Mapping Basis: Hue | Lightness | Luminance | Index (extracted palette order)
    - Quantization level (if Extracted): Low/Medium/High (e.g., 8/16/32 colors)
    - Dithering: Off | Ordered | Blue-noise (optional, stretch goal)
  - Playback: Play/Pause, Speed, Direction (reuse color cycle animation controls)
- Behavior:
  - When enabled, the active layer recolors live on the drawing canvas and in final composition.
  - Undo/Redo: Changing gradient, toggling effect, or Extract creates history entries.

## Data Model
- Layer: `layer.colorCycleData` extended for recolor mode
  - `isRecolorEnabled: boolean`
  - `recolorMode: 'gradient' | 'extracted'`
  - `gradient: GradientSpec` (reuse existing)
  - `palette: { colors: RGBA[], method: 'extracted'|'none', quantization: number }`
  - `mapping: Uint16Array | Uint32Array` (palette-index to gradient-position or LUT key)
  - `seed?: number` (for deterministic animations/noise)
  - `isAnimating: boolean` (already used)
  - `speed, direction` (reuse existing animator fields)

## Rendering Approaches
1) CPU ImageData + LUT (Canvas2D)
   - Precompute a lookup table mapping from a color metric (e.g., hue bucket or palette index) to a gradient color at the current animation phase.
   - For each frame: iterate pixels, read metric, write mapped color. Optimize by:
     - Using `Uint8ClampedArray` views and tight loops.
     - Using a precomputed index buffer per layer (e.g., store metric index per pixel once, then only remap colors each frame via a small LUT update). This turns per-frame work into O(pixels) simple table lookups.
     - Use `OffscreenCanvas` when available and `desynchronized` contexts.
   - Pros: Portable, no WebGL dependency. Cons: CPU heavy at 4K unless we cache indices.

2) WebGL/WebGPU Shader (Fragment shader palette remap)
   - Upload the layer as a texture; upload a 1D palette/gradient texture; shader remaps per-fragment.
   - Extracted palette mode uses an index map or color-quantization in a preprocessing step; subsequent frames only update the gradient texture/phase uniform.
   - Pros: Very fast, perfect for animation. Cons: Additional complexity; need a GL path beside Canvas2D.

Recommended Path: Phase 1 implement CPU LUT with a cached per-pixel index buffer for acceptable performance; Phase 2 add WebGL path for large canvases/smoother animation.

## Mapping Strategies
- Gradient Remap (no extraction):
  - Choose a basis: hue (HSV), lightness (HSL), or luminance (Y’). Compute per-pixel scalar s ∈ [0,1].
  - Cache index buffer I[x,y] = quantize(s, N). Per-frame: color = gradientLUT[I[x,y] + phaseOffset] (wrap).

- Extracted Palette:
  - Quantize the layer (K-means or median-cut; use simple median-cut for determinism + speed). Result: palette P = [c0..cK].
  - Build gradient from P (ordered by hue or frequency). Map each pixel to nearest palette color index (or keep index from quantization pass).
  - Cache index buffer as palette indices. Per-frame: remap index → gradient color at phase.

## Performance Strategy
- Do one-time preprocessing:
  - Build and store `indexBuffer: Uint16Array` sized width*height (2 bytes/pixel). For hue/lightness (N=256) or palette index (K<=256).
  - On gradient/phase change, rebuild only the small gradientLUT (256 or K entries), not the indexBuffer.
- Minimize copies:
  - Keep an offscreen working canvas per recolor-enabled layer.
  - Write final composited frame to drawing canvas; reuse existing composition flow.
- Throttle to target FPS (24–30) if CPU-bound; prefer GL path for 60 FPS.

## Integration Points
- Store: `useAppStore.updateLayer` to toggle recolor, set gradient, set palette, store indexBuffer metadata (kept in memory, persisted only as palette + method to rebuild on load).
- Animator: Reuse `ColorCycleAnimator` for phase progression; add hooks to update gradientLUT and trigger frame.
- ColorCycleBrush Manager: May host shared gradient and animator utilities; add a `RecolorEngine` alongside to avoid conflating with brush strokes.
- DrawingCanvas: Include recolor pass in `renderAllColorCycleLayers` or a new pass that composites recolor-enabled layers.

## APIs (Proposed)
- `ColorCycleRecolorEngine`
  - `enable(layerId, gradient)`
  - `disable(layerId)`
  - `setGradient(layerId, gradient)`
  - `extractPalette(layerId, {k, order}) → palette`
  - `buildIndexBuffer(layerId, basis | palette)`
  - `updatePhase(dt)`
  - `renderToCanvas(layerId, targetCanvas)`

## UI Spec (First Pass)
- Component: `ColorCycleRecolorPanel`
  - `GradientPicker` (existing) with presets + Add New.
  - `Extract From Layer` button.
  - `Mapping Basis` dropdown: Hue | Lightness | Luminance | Extracted Palette.
  - If Extracted:
    - `Colors:` 8 | 16 | 32; `Order:` Hue | Frequency | Luminance
  - `Playback:` Play/Pause, Speed slider, Direction toggle.
  - `Apply to Layer` toggle (enables/disables effect).

## Persistence
- Persist:
  - `isRecolorEnabled`, `recolorMode`, `gradient`, `paletteSpec` (colors + method + quantization), animator params.
- Rebuild on load:
  - Recompute `indexBuffer` from persisted spec to avoid large save size.

## Undo/Redo
- Create entries for: enable/disable recolor, set gradient, extract palette, change mapping options. Animator phase changes are not persisted as separate steps unless user changes speed/direction.

## Phased Implementation
1) Foundations
   - Data model updates in store.
   - RecolorEngine (CPU LUT path) with index buffer + gradient LUT.
   - Minimal UI: toggle, gradient picker, play/pause.

2) Extracted Palette
   - Add quantization + palette extraction.
   - Build palette-based index buffer and mapping.
   - UI controls for Extract + options.

3) Performance + Polish
   - OffscreenCanvas pipeline, throttling, and partial updates.
   - Optional dithering.
   - Large-canvas optimizations; profile and document thresholds.

4) Optional GL Path
   - WebGL fragment shader remap (1D LUT + index texture).
   - Feature flag and fallback to CPU.

## Risks & Mitigations
- CPU cost on very large canvases: cache index buffer; throttle FPS; add GL path.
- Banding/quantization artifacts: allow dithering; adjustable quantization.
- Memory: index buffer adds ~2 bytes/pixel; for 4K (~8.3M px) ≈ ~16 MB per recolor-enabled layer. Mitigate by rebuilding on demand; disable when not animating.

## Test Plan
- Visual: Known gradients on test images (rainbow bars, grayscale ramps).
- Performance: 1080p and 4K canvases at 24/30/60 FPS targets.
- Correctness: Extracted palette orderings; mapping stability across undo/redo.
- Persistence: Save/load projects; reconstruction of index buffers.

## Acceptance Criteria
- User can enable recolor on a layer and see pixels cycle through a chosen gradient smoothly.
- “Extract From Layer” creates a gradient from dominant colors and animates them.
- Undo/redo works for enabling, extracting, and editing gradients.
- Performance is smooth at 1080p (>=30 FPS CPU path) and acceptable at 4K (>=24 FPS or throttled);
  optional GL path documented as future optimization.

