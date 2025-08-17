# TinyBrush Consolidated Documentation

## Recent Updates

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