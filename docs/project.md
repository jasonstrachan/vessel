# TinyBrush Consolidated Documentation

## Recent Updates

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
- **Implemented GPU-accelerated color cycling** with WebGL for smooth, animated gradients
- **Architecture Components**:
  - **ColorCycleBrush Class** (`src/hooks/brushEngine/ColorCycleBrush.ts`)
    - WebGL-based rendering engine for animated color cycling
    - Multi-layer architecture where each gradient change creates a new layer
    - Preserves previous gradients when palette changes
    - 30 FPS animation loop with requestAnimationFrame
  - **Dual-Canvas System**:
    - WebGL canvas for GPU-accelerated gradient animation
    - Main 2D canvas for compositing with other tools
    - Real-time compositing during both drawing and animation playback
  - **Animation Control**:
    - Play/pause button for controlling animation state
    - Speed control (0.01x to 10x) for animation rate
    - FPS control (10-60 FPS) for performance tuning
    - Animation continues during drawing for live preview
- **Rendering Pipeline**:
  1. **Drawing Phase**: 
     - Strokes painted to index texture (0-255 gradient positions)
     - Palette texture holds current gradient colors
     - WebGL shader cycles through gradient in real-time
  2. **Animation Phase**:
     - `animate()` loop updates cycle offset continuously
     - Calls `onFrameRendered` callback to notify main canvas
     - Dispatches 'colorCycleFrameReady' event for canvas updates
  3. **Compositing Phase**:
     - Main canvas listens for frame events
     - Calls `renderColorCycle()` to composite WebGL frames
     - Integrated into main draw loop for flicker-free animation
- **WebGL Implementation**:
  - **Vertex Shader**: Simple pass-through for full-screen quad
  - **Fragment Shader**: 
    ```glsl
    vec4 indexColor = texture2D(indexTexture, texCoord);
    float paletteIndex = (indexColor.r + cycleOffset);
    vec4 color = texture2D(paletteTexture, vec2(paletteIndex, 0.5));
    ```
  - **Texture Management**:
    - Index texture: RGBA storing gradient positions per pixel
    - Palette texture: 256x1 gradient lookup table
    - Efficient GPU-based color cycling without CPU overhead
- **Multi-Layer Support**:
  - Each gradient change creates a new layer
  - Layers preserve their original gradients
  - All layers animate together at same rate
  - Supports up to 50 layers before oldest are merged
- **Integration Points**:
  - **useBrushEngineSimplified**: Manages ColorCycleBrush lifecycle
  - **DrawingCanvas**: Handles frame event listener and compositing
  - **BrushControls**: UI for animation controls (play/pause/speed/FPS)
- **Performance Optimizations**:
  - WebGL rendering offloads animation to GPU
  - Batched texture updates reduce upload overhead
  - Frame rate limiting prevents unnecessary renders
  - Preserves drawing buffer for efficient compositing
  - Only updates visible portions during animation
- **User Experience**:
  - Smooth, flicker-free animation playback
  - Real-time gradient preview while drawing
  - Instant gradient switching with preserved history
  - Professional color cycling for psychedelic art
- **Technical Benefits**:
  - GPU acceleration for complex animations
  - No CPU overhead during playback
  - Scalable to large canvas sizes
  - Frame-perfect synchronization
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

## Recent Updates

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
  - Proper undo/redo support via saveCanvasState
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
- **BrushEditorUI Modal**: Added to main page for editing custom brushes with real-time preview
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

## Rendering Pipeline Architecture

### Overview
TinyBrush uses a **real-time compositing pipeline** with a multi-canvas architecture for optimal performance and flexibility. The system separates layer management, active drawing, and display rendering into distinct stages.

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