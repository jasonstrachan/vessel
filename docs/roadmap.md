# TinyBrush Roadmap

## Brushes

### Core Brush Features

#### Brush Spacing Jitter
Dynamic randomization of brush stamp spacing for more organic, natural-looking strokes.

**Implementation:**
- Add jitter parameter (0-100%) to brush configuration
- Modify stamp placement algorithm in `useBrushEngine.ts`
- Formula: `actualSpacing = baseSpacing * (1 + jitter * (Math.random() * 2 - 1))`
- UI: Slider control in brush settings panel
- Store jitter value per brush preset

#### Eraser Fix
Ensure eraser properly removes pixels without color bleeding or opacity issues.

**Current Issue:**
- Eraser may not fully clear pixels or leaves artifacts
- Pressure sensitivity not working correctly

**Solution:**
- Use `globalCompositeOperation = 'destination-out'`
- Ensure alpha channel properly zeroed
- Test with all brush types
- Verify pressure mapping for eraser mode

#### Mini Canvas Brush Size
Always start with 1px brush when editing custom brushes, with clear size adjustment.

**Implementation:**
- Default to 1px on mini canvas open
- Add visible size indicator overlay
- Keyboard shortcuts: [ and ] for size adjustment
- Mouse wheel + modifier for size control
- Visual feedback showing current brush size

### Advanced Brush Features

#### Color Jitter
Randomize color within HSL ranges for each stamp.

**Implementation:**
- Three sliders: Hue jitter (0-180°), Saturation jitter (0-100%), Lightness jitter (0-100%)
- Visual preview showing jitter range on color wheel
- Apply per stamp: `newColor = baseColor + random(-jitter, +jitter)`
- Option to link to pressure/velocity
- Presets for common effects (watercolor, spray paint)

#### Grain/Noise Slider
Add texture to brush strokes for traditional media feel.

**Implementation:**
- Perlin noise generation for smooth grain
- Intensity slider (0-100%)
- Grain size parameter
- Options: Uniform noise, Gaussian, Perlin
- Blend mode selection for grain application
- Performance: Generate noise textures on brush selection, not per-stamp

### Creative Brush Types

#### ASCII Brush (Pressure Sensitive)
Text-based drawing brush that renders ASCII characters with pressure-mapped density.

**Implementation:**
- Character set: [' ', '.', ':', '-', '=', '+', '*', '#', '%', '@']
- Map pressure (0-1) to character index
- Render characters to canvas using fillText()
- Settings: Font size, character set selection, rotation based on stroke direction
- Integration point: New brush type in `BrushType` enum

#### Dithering Brush (Pressure Sensitive)
Applies dithering patterns with pressure controlling pattern density.

**Implementation:**
- Dither patterns: Floyd-Steinberg, Ordered (Bayer matrix), Random
- Pressure maps to threshold level (lighter pressure = more dithering)
- Real-time pattern generation based on underlying colors
- Option to use current colors or force black/white
- Performance: Pre-calculate dither matrices, cache patterns

#### Contour Map Polygon Brush
Creates topographic-style polygonal patterns.

**Implementation:**
- Generate Voronoi cells or Delaunay triangulation
- Map pressure to polygon density
- Color based on "elevation" (pressure history)
- Line thickness variation
- Real-time tessellation with adjustable complexity
- Cache polygon meshes for performance

#### Layered Paint Thickness
Simulate paint buildup with multiple stroke passes.

**Implementation:**
- Virtual height map tracking paint thickness
- Bump mapping or normal mapping for 3D effect
- Color mixing based on paint layer interaction
- Impasto effect with lighting simulation
- Opacity increases with thickness
- Performance: Use WebGL shaders if available

#### Chaotic Brush System
Unpredictable, generative brush behaviors.

**Implementation:**
- Strange attractors (Lorenz, Rössler)
- Fractal generation (Julia sets, Mandelbrot)
- Rule-based cellular automata
- Particle systems with physics
- Parameters: Chaos level, seed value, evolution rate

#### Sampler Brush
Dynamically samples canvas content for each stroke.

**Implementation:**
- Sample area = current brush size
- Capture on stroke start
- Clone sampled pixels with each stamp
- Options: Blend mode, opacity, rotation
- Performance: Limit sampling frequency to maintain speed

#### Texturizer Brush
Adds texture while respecting underlying pixels.

**Implementation:**
- Analyze pixels under brush area
- Generate complementary texture
- Blend modes: Multiply, overlay, soft light
- Texture library: Paper, canvas, wood, stone
- Pressure affects texture intensity
- Smart edge detection to preserve details

#### Image Hose
Spray images from a dynamic collection.

**Implementation:**
- Image source: Search API, local folder, predefined sets
- Caching strategy for loaded images
- Spray patterns: Random, sequential, pressure-based
- Size/rotation variation
- Blend mode per image
- Performance: Preload and resize images, limit concurrent sprites

#### Haywire Brush
Inverted control mappings for experimental effects.

**Implementation:**
- Velocity → Color (faster = different hue)
- Pressure → Position offset (harder = more displacement)
- Position → Brush size (edges = larger, center = smaller)
- Configurable mapping curves
- Visual feedback showing active mappings
- Preset chaos modes

## Input & Interaction

### Rectangle Tool Stylus Support
Optimize rectangle drawing for pressure-sensitive stylus.

**Testing Required:**
- Pressure affects rectangle border thickness
- Tilt affects rectangle skew/perspective
- Corner radius based on initial pressure
- Fill opacity from average pressure

### Rectangle Gradient with Dither Fallback
Smart gradient generation for rectangle tool with automatic dithering when gradient not possible.

**Implementation:**
- Sample colors from both ends of rectangle drag
- If sampled colors are identical (no gradient possible):
  - When color slider is set to 2 colors
  - Find the two closest colors in the palette
  - Generate dither pattern to represent the sampled color
  - Apply dither pattern as rectangle fill
- If colors differ: Apply standard gradient
- Dither patterns: Ordered (Bayer), Floyd-Steinberg simulation
- Visual preview during drag

### Data Input Visualizer
Convert any data into pixel patterns.

**Implementation:**
- Text input field accepting various formats (CSV, JSON, plain text)
- Data mapping modes: ASCII values, frequency analysis, pattern generation
- Real-time preview of data visualization
- Encoding options: Color mapping, size mapping, position mapping
- Export as brush or direct canvas drawing

## Canvas & Performance

### Dynamic Canvas Size
Remove hardcoded 2000x2000 limit, make responsive to user needs.

**Implementation:**
- User-defined canvas dimensions in settings
- Dynamic memory allocation based on available RAM
- Canvas size presets (A4, screen size, square, custom)
- Efficient canvas resizing without data loss
- Virtual canvas for sizes exceeding viewport
- Tile-based rendering for very large canvases
- Performance monitoring and warnings

## Color Cycler Tool
A creative tool that applies progressive color shifts while drawing, creating rainbow/gradient effects.

**Technical Implementation Notes:**
- Discovered during brush editor development when hue adjustments were applied to already-adjusted pixels
- Effect occurs when drawing pixels are captured from canvas that already has HSL adjustments applied
- Each stroke compounds the color transformation, creating a rainbow/prismatic effect
- Implementation approach:
  1. Maintain cumulative HSL adjustment state
  2. On each draw operation, get current canvas pixels (with existing adjustments)
  3. Apply additional HSL transformation
  4. Result creates progressive color cycling effect
  
**Code Reference:**
The effect was originally observed in `BrushEditorUI.tsx` when:
```javascript
// Drawing captures adjusted pixels from canvas
const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
setBrushPixels(imageData);

// Then adjustments are reapplied to already-adjusted pixels
const [h, s, l] = rgbToHsl(r, g, b);
const newH = (h + brushEditor.hueShift + 360) % 360;
// This compounds the hue shift on each draw operation
```

**Potential Features:**
- Adjustable cycle speed/intensity
- Different cycling modes (hue, saturation, lightness)
- Preset patterns (rainbow, sunset, ocean, etc.)
- Could be used for both brush drawing and fill operations