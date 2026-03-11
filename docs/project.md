# Vessel Consolidated Documentation

## Table of Contents

- [Recent Updates](#recent-updates)
  - [Canvas Shape Masks](#canvas-shape-masks-2026-01-03)
  - [2D Unified Rendering Pipeline](#2d-unified-rendering-pipeline-2025-08-28)
  - [Canvas2D Performance Enhancements](#canvas2d-performance-enhancements-2025-08-28)
  - [Wacom Stylus Pressure Sensitivity Support](#wacom-stylus-pressure-sensitivity-support-2025-08-21)
  - [Color Cycle Brush System](#color-cycle-brush-system-2025-08-27)
  - [Color Cycle + Recolor Workflow](#color-cycle-recolor-workflow-2025-12-31)
  - [Modular User Brush Plugin System](#modular-user-brush-plugin-system-2025-08-20)
  - [Preview Overlay Canvas Architecture](#preview-overlay-canvas-architecture-2025-08-20)
  - [Custom Brush Shape Tiling Fix](#custom-brush-shape-tiling-fix-2025-08-18)
  - [Canvas State Machine Architecture](#canvas-state-machine-architecture-2025-08-17)
  - [Tool-Aware State Machine for Shape Drawing](#tool-aware-state-machine-for-shape-drawing-2025-08-16)
  - [Drawing Implementation with State Machine Pattern](#drawing-implementation-with-state-machine-pattern-2025-01-16)
  - [Performance Optimization: Composite Canvas Caching](#performance-optimization-composite-canvas-caching-2025-01-15)
  - [Custom Brush Integration with New Rendering Pipeline](#custom-brush-integration-with-new-rendering-pipeline-2025-01-14)
  - [Dynamic Canvas Size](#dynamic-canvas-size-2025-01-13)
  - [Enhanced Dithering Algorithms](#enhanced-dithering-algorithms-2025-01-12)
  - [Dithering Palette Fix](#dithering-palette-fix-2025-01-08)
- [Workspace Shell Architecture](#workspace-shell-architecture)
  - [Layout and Composition](#layout-and-composition)
  - [Panels and Modals](#panels-and-modals)
  - [State and Services](#state-and-services)
- [Rendering Pipeline Architecture](#rendering-pipeline-architecture)
  - [Overview](#overview)
  - [Three-Canvas Architecture](#three-canvas-architecture)
  - [Rendering Flow](#rendering-flow)
  - [Performance Optimizations](#performance-optimizations)
  - [Layer Compositing Details](#layer-compositing-details)
  - [Real-time Feedback](#real-time-feedback)
  - [Coordinate Systems](#coordinate-systems)
  - [Brush Engine Integration](#brush-engine-integration)
  - [Future Considerations](#future-considerations)

## Recent Updates

## CC new-layer paste + Hue/Sat: dev note

### Status

Two CC paste bugs were real and fixed. One edge-case bug remains.

### Fixed

#### 1) Missing transferred slot palettes in floating paste

**Cause:** floating paste transferred CC ids/defs but not `colorCycleSlotPalettes`.

**Effect:** pasted CC on a new layer had incomplete slot/palette data for Hue/Sat.

**Fix:** include transferred slot palettes in the floating-paste CC payload.

**Result:** original missing-palette transfer bug solved.

#### 2) CC stroke paste disappearing on commit

**Cause:** commit relied on bitmap alpha, but CC stroke content can exist as CC paint/slot data without meaningful bitmap alpha.

**Fix:** synthesize opaque alpha from CC indices when bitmap alpha is absent.

**Result:** CC stroke paste now commits correctly.

#### 3) Paste commit needed explicit CC rebuild/apply

`mutateColorCycleLayer(...)` writes low-level CC state with `skipColorCycleSync: true`, so paste commit needed explicit post-write rebuild/apply.

**Added:**
- `scheduleColorCycleSlotRebuild?.('selection-paste-commit')`
- `requestGradientApply(targetLayer.id, 'selection-paste-commit')`

**Result:** paste commit path improved; not the remaining bug.

### Still broken

#### Remaining bug

Hue/Sat on CC content pasted into a different/new CC layer does not visibly update immediately.

**Observed behavior:**
The Hue/Sat result appears only after a later move / marquee transform / rematerialization-type action.

#### Not broken

- Hue/Sat on normal CC content
- Hue/Sat on pasted CC content pasted back into the same CC layer
- CC shape paste generally
- CC stroke paste commit

### Established facts

#### Hue/Sat preview path really does update state

`previewSelectedColorCycleRegion(...)` does all of this:
- restores runtime snapshot
- remaps slot palettes / gradient defs
- writes region via `writeColorCycleRegion(...)`
- calls:
- `requestGradientApply(...)`
- `refreshColorCycleGradientDefRuntime(...)`
- `rerenderColorCycleLayerSurface(...)`
- marks recomposition

So the bug is **not** “Hue/Sat path does nothing.”

#### Final rerender/invalidation is present

`rerenderColorCycleLayerSurface(...)`:
- gets brush + layer canvas
- calls `flushGradientApply(layerId)`
- calls `brush.renderDirectToCanvas(...)`
- invalidates composite bitmap
- marks recomposition
- dirties composite segments

So the bug is **not** simply “forgot final redraw/invalidate.”

#### Slot rebuild already runs on paste commit

Debug logs show:
- slot rebuild starts on `selection-paste-commit`
- runtime sync completes
- later move/transform rebuilds often produce no updates

So the theory “later move fixes it because slot GC finally repairs slots” is **not supported**.

#### Segment compositor mismatch was tested and not sufficient

The visible-segment stack originally drew CC layer canvas directly, unlike the full CC compositor path which rerendered from brush/runtime first.

That mismatch was tested. It did **not** solve the remaining bug.

So this is **not** just a simple compositor-path issue.

#### `mutateColorCycleLayer(...)` is the heavy materialization path

It:
- mutates working CC buffers
- `brush.applyLayerSnapshot(...)`
- `brush.renderDirectToCanvas(...)`
- captures `getImageData(...)`
- persists `imageData` / `canvasImageData` / buffers with `skipColorCycleSync: true`
- invalidates recomposition/composite

This is the strongest “full rematerialization” path identified.

### Ruled down / weak theories

#### Weak: missing final composite invalidation

Current code already invalidates via `rerenderColorCycleLayerSurface(...)`.

#### Weak: missing slot rebuild during preview

Paste commit already runs slot rebuild; logs do not support “later move finally fixes slots.”

#### Weak: simple early-render ordering bug

A final experiment based on that theory did **not** fix the bug.

### Best current conclusion

The remaining bug is a deeper CC preview/runtime/materialization edge case.

Most accurate description:

**Hue/Sat preview for CC content pasted into a different/new CC layer does not visually materialize the same way the later transform/rematerialization path does, even though the underlying data path appears mostly correct.**

So this is now:
- not a simple transfer bug
- not a simple slot-GC bug
- not a simple redraw/invalidate bug
- not a simple compositor bug

### Recommended stopping point

Leave this as a known bug for now.

#### Known bug note

**Hue/Sat preview for CC content pasted into a different/new CC layer does not visually update immediately; the change appears after a later transform/rematerialization action.**

#### Keep

- transferred slot palettes fix
- synthesized alpha for CC stroke paste commit
- explicit paste-commit rebuild/apply

#### Back out

- unsuccessful speculative experiments around the remaining bug
- any compositor/runtime hacks added only for this investigation

### Canvas Shape Masks (2026-01-03)
- **New canvas mask workflow**: documents can define non-rectangular bounds (rectangle, circle, freehand).
- **UX entry point**: `DocumentModal` now offers canvas shape tools; picking one closes the modal and enters a draw-to-define mode.
- **Rendering behavior**: active canvas shape is clipped during draw, selection, and floating paste; a visible outline indicates bounds.
- **Export behavior**: PNG export and project thumbnails apply the mask, preserving transparency outside the shape.
- **State/persistence**: shape definitions are serialized with the project and normalized on load/resize.

### 2D Unified Rendering Pipeline (2025-08-28)
- **Implemented unified Canvas2D rendering pipeline** replacing WebGL with an efficient indexed color system that maintains full API compatibility while improving performance and browser compatibility
- **Core Architecture Components**:
  - **IndexBuffer** (`src/lib/IndexBuffer.ts`)
    - Memory-efficient indexed color storage (1 byte per pixel vs 4 bytes RGBA)
    - Paint operations with brush support (circle, square shapes)
    - Direct ImageData conversion for Canvas2D rendering
    - Clear and resize operations for dynamic canvas management
  - **GradientPalette** (`src/lib/GradientPalette.ts`)
    - 256-color palette management with gradient interpolation
    - Real-time palette shifting for animation effects
    - Efficient color lookup and application to index buffers
    - Preset gradients: rainbow, fire, ocean, sunset
  - **AnimationController** (`src/lib/AnimationController.ts`)
    - Frame-rate controlled animation loop (configurable 10-60 FPS)
    - RequestAnimationFrame-based timing for smooth playback
    - Play/pause/stop controls with callback support
    - Automatic frame timing adjustment
  - **ColorCycleAnimator** (`src/lib/ColorCycleAnimator.ts`)
    - Integrates IndexBuffer + GradientPalette + AnimationController
    - Complete animated drawing system with indexed colors
    - Frame callback system for canvas updates
    - Export/import support for animations
- **Rendering Pipeline Flow**:
  1. **Drawing Phase**: User paints to IndexBuffer with color indices (0-255)
  2. **Palette Application**: GradientPalette maps indices to RGBA colors
  3. **Animation Phase**: AnimationController shifts palette offset each frame
  4. **Canvas Update**: ImageData generated and rendered to Canvas2D
- **Migration Strategy** (`src/hooks/brushEngine/ColorCycleBrushMigration.ts`):
  - Factory pattern for creating appropriate brush implementation
  - Feature flags for runtime switching between WebGL/Canvas2D
  - Automatic fallback if primary implementation fails
  - Zero-downtime migration with parallel implementations
- **API Compatibility Layer** (`src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts`):
  - Maintains exact same interface as WebGL version
  - Drop-in replacement with identical method signatures
  - Preserves all existing functionality: layers, gradients, animation
  - Seamless integration with existing UI and controls
- **Key Benefits**:
  - **75% Memory Reduction**: Indexed colors use 1 byte vs 4 bytes per pixel
  - **Better Compatibility**: Canvas2D works on all browsers, no WebGL required
  - **Simplified Architecture**: Pure JavaScript, easier to maintain and debug
  - **Performance Parity**: Achieves similar FPS with optimized algorithms
  - **Future-Proof**: Ready for WebGPU migration when widely supported

### Canvas2D Performance Enhancements (2025-08-28)
- **Implemented comprehensive performance optimizations** for Canvas2D color cycling system, achieving significant speed improvements through parallel processing and hardware acceleration
- **Architecture Components**:
  - **OffscreenCanvas** (`src/lib/performance/OffscreenRenderer.ts`)
    - Background rendering with automatic fallback to regular canvas
    - Batch operation support for multiple drawing commands
    - Efficient ImageBitmap transfers when available
  - **Web Workers** (`src/workers/gradientWorker.ts`, `src/lib/performance/GradientWorkerManager.ts`)
    - Offloaded gradient calculations to separate thread
    - Zero-copy ArrayBuffer transfers for palette data
    - Parallel processing of color cycling operations
  - **WebAssembly Integration** (`src/lib/performance/WASMAccelerator.ts`)
    - Critical path optimization for index mapping and palette application
    - High-performance paint operations (circle drawing)
    - Native-speed palette shifting
    - Graceful fallback to JavaScript when WASM unavailable
  - **ImageBitmap Transfers** (`src/lib/performance/ImageBitmapTransfer.ts`)
    - Hardware-accelerated canvas-to-canvas transfers
    - Bitmap caching for frequently used images
    - Batch transfer operations for multiple bitmaps
- **Performance configuration** (`src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts`)
  - Exposes optional perf flags (workers, perceptual dither) for targeted tuning
  - Keeps API compatibility with the primary brush implementation
  - Supports progressive enhancement when features are available
- **Performance Testing Suite** (`src/testing/PerformanceEnhancementsTest.ts`)
  - Benchmarks comparing default vs configured brush options
  - Tests: rendering speed, paint operations, animation FPS, memory usage, gradient updates
  - HTML report generation with detailed metrics
  - Visual performance comparison page (`src/pages/PerformanceTest.tsx`)
- **Key Performance Notes**:
  - Worker-based fills can reduce main-thread stalls on large shapes
  - Indexed buffers keep memory usage low compared to RGBA pixels
- **Technical Benefits**:
  - **Parallel Processing**: Web Workers handle calculations independently
  - **GPU Acceleration**: OffscreenCanvas with desynchronized rendering
  - **Native Performance**: WASM for critical loops and operations
  - **Efficient Transfers**: ImageBitmap for zero-copy operations
  - **Smart Fallbacks**: Graceful degradation for maximum compatibility

### Wacom Stylus Pressure Sensitivity Support (2025-08-21)
- **Implemented full pressure-sensitive drawing** for tablets and styluses
- **Pointer Events API Integration**:
  - Converted all mouse events to pointer events (`onPointerDown`, `onPointerMove`, `onPointerUp`)
  - Added `onPointerCancel` for handling stylus out-of-range scenarios
  - Pointer capture for consistent event tracking
  - Pressure values correctly read from `event.pressure` (0-1 range)
- **Pressure Sensitivity Features**:
  - **Pressure toggle** in UI with customizable min/max pressure ranges (1-1000 pixels)
  - **Pressure calculation** via `pressureOptimizer` utility with caching
  - **Dynamic brush sizing** based on stylus pressure
  - **Coalesced events** support for smoother drawing curves
- **Touch & Stylus Best Practices**:
  - Added `touch-action: none` CSS to prevent scrolling/zooming
  - Added `user-select: none` to prevent text selection
  - Implemented two-canvas optimization (temporary drawing canvas + main canvas)
  - RequestAnimationFrame throttling for optimal performance
- **Wacom-Specific Features**:
  - **Automatic detection** of Wacom driver issues
  - **Diagnostic utility** (`detectWacom.ts`) for troubleshooting
  - Platform-specific solutions for Windows/Mac/Linux
  - Fallback pressure simulation for mice (Shift=low, Ctrl=high pressure)
- **Browser Compatibility**:
  - Best support: Chrome, Edge (Chromium)
  - Good support: Firefox (with proper config)
  - Limited support: Safari
- **Key Files Modified**:
  - `src/components/canvas/DrawingCanvas.tsx` - Pointer events implementation
  - `src/hooks/useDrawingHandlers.ts` - Pressure parameter propagation
  - `src/utils/pressureOptimizer.ts` - Pressure calculation logic
  - `src/utils/detectWacom.ts` - Wacom detection and diagnostics

### Color Cycle Brush System (2025-08-27)
- **Canvas2D-first color cycling** backed by indexed buffers with optional WebGL acceleration
- **Core Components**:
  - **ColorCycleAnimator** (`src/lib/ColorCycleAnimator.ts`)
    - IndexBuffer + GradientPalette + AnimationController integration
    - Canvas2D rendering with optional WebGL renderer (`WebGLColorCycleRenderer`) fallback
    - Palette shifting and frame callbacks for animated layers
  - **Brush implementation** (`src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts`)
    - Canvas2D paint + animation surface
    - Configurable FPS/speed/banding and fill strategies
  - **Runtime shim** (`src/hooks/brushEngine/ColorCycleBrushMigration.ts`)
    - Feature-flagged Canvas2D/WebGL routing
    - Drop-in compatibility for the brush engine
- **Rendering Pipeline**:
  1. **Paint** into an indexed buffer (0-255 palette slots).
  2. **Apply palette** via GradientPalette (optionally animated).
  3. **Render** to Canvas2D, with optional WebGL acceleration for palette cycling.
- **Integration Points**:
  - **useBrushEngineSimplified** manages per-layer color-cycle brushes.
  - **colorCycleBrushManager.ts** caches per-layer instances.
  - **DrawingCanvas** composites animated frames with standard layers.
- **Shape Mode Support** (2025-08-27):
  - Color cycle brush now fully supports polygon shape drawing
  - Shapes filled with gradient from edges to center using `fillShape()` method
  - Animation continues playing while drawing shapes (doesn't interrupt playback)
  - Proper coordinate scaling between canvas and WebGL spaces
  - Key implementation in `finalizeShapeDrawing()` and `fillColorCycleShape()`

### Color Cycle + Recolor Workflow (2025-12-31)
- **Recolor mode for color-cycle layers** enables palette extraction and animated remapping
- **Core components**:
  - **RecolorManager** (`src/lib/colorCycle/RecolorManager.ts`) orchestrates recolor playback and layer updates
  - **Recolor UI** (`src/components/colorCycle/RecolorPanel.tsx`, `ExtractColorsDialog.tsx`)
  - **State + sampling** (`useAppStore.recolorSampling`, `useDrawingHandlers`)
- **Layer model**:
  - Recolor metadata stored in `layer.colorCycleData.recolorSettings`
  - Mode flag switches between `brush` and `recolor` paths
- **Export support**:
  - Export modal advances recolor layers deterministically for GIF/MP4/WebGL output
  - Clean separation of rendering and logic

### Modular User Brush Plugin System (2025-08-20)
- **Implemented plugin architecture** for user-created brushes without impacting default brush performance
- **Architecture Components**:
  - **BrushPlugin Interface** (`src/brushes/BrushPlugin.ts`)
    - Defines contract: `draw()`, `initialize()`, `onActivate()`, `onDeactivate()`, `cleanup()`
    - Optional `drawLine()` for optimized line rendering
    - Performance hints for engine optimization
    - Support for custom UI controls via `getControls()`
  - **BrushRegistry** (`src/brushes/BrushRegistry.ts`)
    - Singleton registry managing all user brushes
    - Event system for tracking brush lifecycle
    - Methods: `register()`, `unregister()`, `activate()`, `deactivate()`
    - Built-in brush loading via static imports (avoids webpack warnings)
  - **useUserBrushEngine Hook** (`src/hooks/useUserBrushEngine.ts`)
    - Separate rendering pipeline for plugin brushes
    - Handles stroke interpolation and pressure sensitivity
    - Methods: `startStroke()`, `continueStroke()`, `endStroke()`, `drawStroke()`
    - Completely isolated from default brush engine
- **Integration Strategy**:
  - **Dual-path architecture**: Default brushes use original `useBrushEngine`, plugins use `useUserBrushEngine`
  - **Zero performance impact**: Default brushes bypass plugin system entirely
  - **Smart routing** in `useDrawingHandlers`:
    ```typescript
    if (currentBrushId && userBrushEngine.isUserBrush(currentBrushId)) {
      userBrushEngine.startStroke(ctx, x, y, pressure);
    } else {
      brushEngine.renderBrushStroke(ctx, start, end, pressure);
    }
    ```
  - **Shape utilities** extracted to `src/brushes/shapes/` but remain as fast functions
- **Example Plugin Implementations**:
  - **DitherBrushPlugin** (`src/brushes/plugins/DitherBrushPlugin.ts`)
    - Multiple dithering algorithms: Floyd-Steinberg, Bayer matrix
    - Pressure-sensitive dithering intensity
    - Support for custom color palettes (Apple II, grayscale)
    - Uses temporary canvas for dither processing
  - **ParticleBrushPlugin** (`src/brushes/plugins/ParticleBrushPlugin.ts`)
    - Scatter-based particle system
    - Configurable particle density and scatter radius
    - Pressure-modulated particle count
    - Ideal for spray paint and texture effects
- **Plugin Loading System**:
  - Static imports for built-in plugins (avoids dynamic import warnings)
  - `BUILTIN_BRUSH_PLUGINS` map for known brushes
  - Future support for user-uploaded brush files
  - Registry methods: `loadBuiltinBrush()`, `loadAllBuiltinBrushes()`
- **API for Brush Developers**:
  ```typescript
  class MyBrush extends BaseBrushPlugin {
    draw(context: BrushDrawContext): void {
      // Custom drawing logic
    }
  }
  ```
- **Benefits**:
  - **Extensibility**: Easy to create new brush types
  - **Performance**: No regression for default brushes
  - **Modularity**: Clean separation of concerns
  - **Shareability**: Brushes can be packaged and distributed
  - **Future-proof**: Ready for brush marketplace/gallery

### Preview Overlay Canvas Architecture (2025-08-20)
- **Implemented separate overlay canvas** for shape and gradient previews to eliminate flickering
- **Problem**: Rectangle and polygon gradient tools had severe flickering during preview because the entire canvas (all layers, frames) was being redrawn on every mouse move
- **Solution**:
  - Added dedicated overlay canvas that sits on top of the main canvas
  - Preview rendering only clears and draws to the lightweight overlay
  - Main artwork canvas remains untouched during preview operations
  - Overlay is cleared on mouse up/leave when interaction completes
- **Technical details**:
  - overlayCanvasRef positioned absolutely over main canvas with pointer-events: none
  - Overlay canvas is resized alongside main canvas in resize observer
  - RAF throttling still applied to preview renders for smooth 60fps
  - Preview calculations use live mouse position instead of stored state for responsiveness
- **Performance optimizations**:
  - Rectangle gradient mouse move updates throttled to >2px movements
  - Temporary position stored in ref to avoid re-renders during dragging
  - Final position applied on mouse up for accurate placement
- **Benefits**:
  - Completely eliminates preview flickering for all shape tools
  - Dramatically improves performance (no full canvas redraws)
  - Maintains smooth, professional preview experience
  - Clean separation between preview layer and actual artwork

### Custom Brush Shape Tiling Fix (2025-08-18)
- **Fixed custom brush shape rendering**: Custom brush textures now properly tile inside shapes instead of filling with solid color
- **Problem**: When using custom brush toggle with shapes (square, circle, triangle), the shape was filled with a single color instead of tiling the custom brush pattern
- **Solution**:
  - Modified drawShape function in useBrushEngine.ts to use Canvas pattern API
  - Creates repeating pattern from custom brush texture using createPattern('repeat')
  - Pattern is used as fillStyle when drawing the shape
  - Preserves shape geometry while filling with tiled custom brush texture
- **Technical details**:
  - Works with all shape types: square, round, triangle
  - Respects antialiasing settings for shape edges
  - Falls back to direct pattern drawing for other brush shapes
  - Maintains original fill style for proper color/opacity handling
- **Benefits**:
  - Custom brushes can now create textured shapes
  - Enables stippling, hatching, and other texture effects within geometric shapes
  - Consistent behavior across all brush shape modes

### Canvas State Machine Architecture (2025-08-17)
- **Implemented robust state machine** for managing all canvas interactions with proper state transitions
- **Core states**:
  - IDLE: Default state, ready for any interaction
  - AWAITING_PAN: Spacebar held, shows "grab" cursor, ready to pan on mouse down
  - PANNING: Actively panning the canvas with "grabbing" cursor
  - DRAWING: Active drawing in progress
  - SELECTING: Making a selection
  - FINALIZING: Finalizing a drawing operation
  - BUSY: System busy, all interactions blocked
- **Key improvements**:
  - Eliminates race conditions with single source of truth for interaction states
  - Predictable behavior through clear state transitions
  - Proper panning UX matching Figma's spacebar+drag interaction
  - Easy debugging with logged state transitions
  - Simple to extend with new states and transitions
- **Integration approach**:
  - useCanvasStateMachine hook manages all state transitions via reducer pattern
  - Side effects (pan updates, drawing) handled in useEffect watching state changes
  - Event handlers dispatch actions instead of directly manipulating state
  - Cursor style derived from current state mode
- **Benefits**:
  - No more conflicting boolean flags (isSpacePressed, isBusy, isMouseDown)
  - Proper handling of complex interactions (e.g., spacebar+click pans, not draws)
  - Clean separation between state management and side effects
  - Maintainable architecture for adding new interaction modes

### Tool-Aware State Machine for Shape Drawing (2025-08-16)
- **Implemented tool-aware state machine** for handling different drawing tools (rectangle, ellipse, line, polygon)
- **Architecture improvements**:
  - Extended CanvasState to support generic activeShape object that can describe any drawing shape
  - Added ShapeType enum for different shape types (freehand, rectangle, ellipse, line, polygon)
  - State machine now tracks currentTool and adjusts behavior accordingly
- **Shape tools added**:
  - Rectangle: Click and drag to draw rectangles
  - Ellipse: Click and drag to draw ellipses  
  - Line: Click and drag to draw straight lines
  - Polygon: Click to add points, Enter to finalize, Escape to cancel
- **Technical details**:
  - Each tool has specific initialization and update logic in the reducer
  - Shape preview rendering during SHAPE_DEFINING mode
  - Polygon tool supports multi-click workflow with keyboard finalization
  - All shapes respect current brush settings (color, size, opacity)
- **Benefits**:
  - Unified state machine handles all drawing tools consistently
  - Easy to add new shape tools by extending ShapeType
  - Clean separation between tool logic and rendering
  - Predictable tool behavior through reducer pattern

### Drawing Implementation with State Machine Pattern (2025-01-16)
- **Implemented proper drawing functionality** following reducer pattern with side effects
- **Architecture improvements**:
  - State machine (useCanvasStateMachine) manages stroke data (arrays of points)
  - Separate strokeCanvas for rendering strokes without affecting main canvas
  - Clean separation between state management and rendering side effects
- **Drawing workflow**:
  1. MOUSE_DOWN transitions to DRAWING mode and initializes stroke array
  2. MOUSE_MOVE adds points to current stroke array
  3. useEffect watches stroke changes and renders to strokeCanvas
  4. MOUSE_UP finalizes stroke, merges with active layer, and clears stroke data
- **Technical details**:
  - World coordinates used for stroke points (not screen coordinates)
  - Stroke canvas composited onto main canvas during draw()
  - Proper cleanup and state reset after each stroke
  - Supports all brush settings (color, size, opacity, blend modes)
- **Benefits**:
  - Clean, predictable state machine for drawing modes
  - Efficient rendering with temporary canvas
  - Proper undo/redo support via structured history commits (`commitLayerHistory`)
  - No direct DOM manipulation during event handlers

### Performance Optimization: Composite Canvas Caching (2025-01-15)
- **Fixed major performance issue**: Composite canvas was being regenerated on every frame during panning
- **Solution implemented**:
  - Memoized layers hash calculation using useMemo to create efficient fingerprint of layers' content
  - Moved composite canvas generation from draw() function to dedicated useEffect hook
  - useEffect now depends on layersHash instead of layers array directly
  - Added needsRedraw state to trigger canvas updates when composite changes
  - Draw function simplified to only render the cached composite canvas
- **Technical details**:
  - layersHash tracks: layer id, visibility, opacity, and imageData size
  - Composite canvas only recreates when hash changes or dimensions change
  - Direct draw() call in composite useEffect ensures immediate visual update
- **Results**:
  - Smooth panning without performance drops
  - Composite canvas only regenerates when layers actually change (opacity, visibility, content)
  - Significant reduction in CPU usage during view transformations
  - No race conditions between composite generation and drawing

### Custom Brush Integration with New Rendering Pipeline (2025-01-14)
- **'C' Hotkey**: Press 'C' to quickly enter selection mode for creating custom brushes
- **Full Pipeline Compatibility**: Custom brushes work seamlessly with the new world/screen space separation
- **Composite Canvas Integration**: Automatically sets currentOffscreenCanvas for brush creation from selections
- **BrushEditorUI Panel**: Lives under Brush Settings and edits custom brushes with real-time preview
- **Features Preserved**:
  - Create brushes from selections
  - Test brushes before saving (temporaryCustomBrush)
  - Edit with HSL adjustments
  - Save to project library
  - Color tinting and pressure sensitivity
  - Grid snapping for pixel-perfect placement
- **Technical Details**:
  - drawCustomBrushStamp properly handles view transformations
  - Cached composite canvas only recreates when layers change
  - scaledBrushCache optimizes performance
  - Memory-efficient ImageData handling

### Custom Brush Color Cycle Workflow (2026-02-25)
- **Custom brushes can now carry Color Cycle metadata** when captured from an active Color Cycle layer.
- **Capture behavior**:
  - Capture from active Color Cycle layer imports gradient + speed into the temporary custom brush.
  - Capture from all layers remains static and does not auto-import Color Cycle metadata.
  - Rectangle and freehand capture follow the same metadata rules.
- **Phase offset controls for painting**:
  - `Global`: all stamps share the same animation phase.
  - `Per-stroke seeded`: each stroke starts from a deterministic seed phase.
  - `Jittered`: each stamp gets bounded phase jitter (with `Phase Jitter` amount).
- **Persistence**:
  - Custom brush Color Cycle metadata is saved in project files and local custom-brush storage.
  - Selecting a saved custom brush restores Color Cycle speed/gradient/phase defaults automatically.
- **Why this matters**:
  - Avoids lockstep animation when painting repeated custom-brush stamps.
  - Makes captured CC brushes reusable across sessions with consistent playback defaults.

### Dynamic Canvas Size (2025-01-13)
- **Removed hardcoded 2000x2000 canvas limit**: Canvas can now be any custom size
- **New default dimensions**: 1920x1080 (HD resolution) for better performance
- **Canvas size presets added to Document Modal**:
  - HD (1920×1080)
  - Full HD (1920×1200) 
  - 4K (3840×2160)
  - Square formats (1024×1024, 2048×2048)
  - A4 Portrait (2480×3508) and Landscape (3508×2480)
  - Mobile (1080×1920) and Tablet (1536×2048) sizes
- **Memory usage warnings**: Displays estimated memory usage and warns when >500MB
- **Resize existing canvas**: Maintains content centered when resizing
- **Custom dimensions**: Full support for any width/height via input fields

### Enhanced Dithering Algorithms (2025-01-12)
- **Added three new dithering algorithms** to expand artistic options beyond Floyd-Steinberg, Bayer, and Sierra Lite
- **Atkinson Dithering**: 
  - Classic Macintosh algorithm that only diffuses 75% of error for higher contrast
  - Creates distinctive vintage computer graphics look
  - Excellent for high-contrast artwork and text-heavy images
- **Blue Noise Dithering**:
  - Uses pre-computed 16x16 blue noise matrix for organic-looking patterns
  - No directional artifacts or visible patterns
  - Superior for smooth gradients and photographic content
- **Pattern Dithering**:
  - Six geometric styles: dots, diagonal lines, vertical lines, horizontal lines, crosshatch, diamond
  - Creates texture-like effects reminiscent of halftone printing
  - Each pattern style creates unique artistic effects
- **UI Updates**: Algorithm dropdown now includes all six algorithms with pattern style selector appearing for Pattern algorithm

### Dithering Palette Fix (2025-01-08)
- **Fixed dithering color selection and numColors slider**: Now intelligently selects the best N colors from palette based on image content
- **Problem**: Previous implementations either ignored numColors or selected wrong colors for the content
- **Solution**: 
  - Both dithering functions now sample the image to find which palette colors best represent the content
  - Scores each of the 20 palette colors based on how well they match the sampled pixels
  - Selects the top N colors based on numColors slider setting
  - These selected colors are then used for the dithering process

## Workspace Shell Architecture

### Layout and Composition
- **Root layout** (`src/app/layout.tsx`) loads global styles and wraps the App Router tree.
- **Main workspace** (`src/app/page.tsx`) composes the left toolbar, center `DrawingCanvas`, and right-side panel columns.
- **App Router** is the primary entrypoint; `src/pages/` hosts legacy/perf routes only.

### Panels and Modals
- **Panels** (`src/components/panels/`): Layers, alignment, animation controls, color picker, brush library/settings, crop, and color adjustment tooling.
- **Modals** (`src/components/modals/`): Document, export, settings, and load project flows.
- **Canvas suite** (`src/components/canvas/`): Core surface plus overlays (cursor, crop, selection, floating paste).

### State and Services
- **Zustand store** (`src/stores/useAppStore.ts`) centralizes project, tool, layer, history, and UI state.
- **Selectors** in `src/stores/selectors` minimize re-renders in UI components.
- **Services** such as `autosaveService` and `preloadRisographTexture` are initialized from `page.tsx`.

## Rendering Pipeline Architecture

### Overview
Vessel uses a **real-time compositing pipeline** with a multi-canvas architecture for optimal performance and flexibility. The system separates layer management, active drawing, and display rendering into distinct stages.

### Three-Canvas Architecture

1. **Composite Canvas** (Offscreen)
   - Holds the merged result of all visible layers
   - Created once and cached until layers change
   - Respects layer visibility and opacity settings
   - Updated via `compositeLayersToCanvas()` in useAppStore

2. **Drawing Canvas** (Temporary)
   - Used for active brush strokes before committing
   - Allows real-time preview without modifying layers
   - Cleared after each stroke is finalized
   - Managed by `useDrawingHandlers` hook

3. **Display Canvas** (Main)
   - The visible canvas element in the UI
   - Composites all elements in real-time
   - Handles view transformations (pan, zoom)
   - Renders UI overlays (selections, marching ants)

### Rendering Flow

The main draw function (`DrawingCanvas.tsx:143-264`) executes this pipeline:

1. **Background Setup**
   - Clear with dark background (#1a1a1a)
   - Draw checkerboard pattern for transparency

2. **Layer Compositing**
   - Draw the cached composite canvas
   - Only regenerated when layers change (via `layersHash` memoization)
   - Uses `globalAlpha` for layer opacity blending

3. **Active Drawing Overlay**
   - If drawing is in progress, overlay the temporary drawing canvas
   - Provides immediate visual feedback without layer modification

4. **UI Elements**
   - Floating paste selections with marching ants
   - Selection rectangles with animated borders
   - Canvas border outline

### Performance Optimizations

1. **Intelligent Caching**
   - Composite canvas only regenerates when layers actually change
   - Uses memoized `layersHash` to detect meaningful changes
   - Samples layer data at intervals for efficient checksumming

2. **Canvas Configuration**
   - `willReadFrequently: true` for frequent pixel operations
   - `imageSmoothingEnabled` toggled based on brush type and zoom level
   - Pixel-perfect rendering for pixel art brushes

3. **State Management**
   - Canvas state machine prevents conflicting operations
   - Atomic updates prevent partial renders
   - RequestAnimationFrame for smooth animations

4. **Memory Management**
   - Reuses canvas elements instead of creating new ones
   - Clears temporary canvases after use
   - Efficient ImageData handling for large canvases

### Layer Compositing Details

The `compositeLayersToCanvas` function (useAppStore.ts:2256-2300):
- Iterates through layers in order (bottom to top)
- Applies layer opacity with `globalAlpha`
- Respects layer visibility flags
- Maintains proper blend modes per layer
- Ensures canvas dimensions match project size

### Real-time Feedback

The system provides immediate visual feedback through:
- Temporary drawing canvas for active strokes
- Shape previews during definition
- Gradient previews while adjusting
- Cursor previews that respect zoom and brush settings
- Marching ants animation at 60fps

### Coordinate Systems

The pipeline manages two coordinate spaces:
- **World Space**: Canvas content coordinates (project dimensions)
- **Screen Space**: Display coordinates (viewport with pan/zoom)
- Transformation handled via `viewTransformRef` and `screenToWorld` functions
- Proper clipping for strokes extending beyond canvas bounds

### Brush Engine Integration

The rendering pipeline seamlessly integrates with the brush engine:
- Custom brushes use pattern API for tiling
- Pixel brushes disable antialiasing
- Pressure sensitivity affects opacity in real-time
- Grid snapping modifies coordinates before rendering
- Blend modes applied at composite stage

### Future Considerations

The current architecture supports potential enhancements:
- WebGL acceleration for complex brushes
- Multi-threaded compositing with Web Workers
- Incremental rendering for very large canvases
- Tile-based rendering for infinite canvas
- GPU-accelerated filters and effects
## Shape fill / lost-edge pipeline

Source of truth (code paths)
- Primary finalize path: `src/hooks/canvas/handlers/shapes/ShapeToolHandler.ts` (used in production flow).
- App Router mirror: `src/components/canvas/DrawingCanvas.tsx` (kept in sync).

What happens on finalize
1) Resolve `lostEdge` (0–100) from UI/session/per-fill.
2) Render the shape fill cleanly to `drawingCanvas` via `drawFillToContext` (includes primary/secondary colors and the active fill strategy result).
3) If `lostEdge <= 0`, commit as-is.
4) If `lostEdge > 0`:
   - Compute an ROI around the shape bounds with padding (thickness/spacing-aware).
   - Build a binary silhouette mask (polygon) in ROI coordinates on a temp canvas.
   - Run `applySierraLiteLostEdgeMask(maskAlpha, width, height, lostEdge, LOST_EDGE_TILE_SIZE)` with `LOST_EDGE_TILE_SIZE = 4` to get a dithered keep mask.
   - Modulate the rendered fill alpha in the ROI: `alpha = alpha * keep / 255` (keeps interior intact, breaks up edges).
   - Write the ROI back to `drawingCanvas`.
5) Commit `drawingCanvas` to the active raster layer via `commitRasterOverlay`; clear overlay, finalize state machine, and trigger recomposite/redraw.

Key files
- Erosion logic (authoritative): `src/hooks/canvas/handlers/shapes/ShapeToolHandler.ts`.
- Mirror for App Router: `src/components/canvas/DrawingCanvas.tsx`.
- Dither util: `src/utils/ditherAlgorithms.ts` (`applySierraLiteLostEdgeMask`).

Tuning knobs
- Coarser dithering: increase `LOST_EDGE_TILE_SIZE`.
- Stronger/weaker response: change mapping of `lostEdge` before calling the mask (currently passed 0–100 as-is).
- Wider band: inflate the silhouette mask before dithering (not currently done).

Gotchas avoided
- No band-heuristic edge scanning; erosion is mask-based (matches brush path semantics).
- ROI-scoped `get/putImageData` keeps work bounded.
- Only this finalize path should redraw shape fill; avoid duplicating erosion in other finalize hooks.
