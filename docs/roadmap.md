# TinyBrush Roadmap

## Table of Contents

### Brushes
- [Resampler](#resampler)
- [Datamosh Brush](#datamosh-brush)
- [Quantum Superposition Brush](#the-quantum-superposition-brush)
- [Consensus Reality Brush](#the-consensus-reality-brush)
- [Semantic Web Brush](#the-semantic-web-brush)
- [Data Erosion Brush](#data-erosion-brush)
- [Contour Map Polygon Brush](#contour-map-polygon-brush)
- [Grain/Noise Slider](#grainnoise-slider)
- [Layered Paint Thickness](#layered-paint-thickness)
- [Image Hose](#image-hose)
- [Chaotic Brush System](#chaotic-brush-system)
- [Brush Spacing Jitter](#brush-spacing-jitter)
- [ASCII Brush](#ascii-brush-pressure-sensitive)
- [Color Jitter](#color-jitter)
- [Dithering Brush](#dithering-brush-pressure-sensitive)
- [Texturizer Brush](#texturizer-brush)
- [Haywire Brush](#haywire-brush)
- [Time Capsule Brush](#time-capsule-brush)
- [Spam Brush](#spam-brush)

### Tools & Features
- [Shape Tools](#shape-tools)
- [Input & Interaction](#input--interaction)
- [Canvas & Performance](#canvas--performance)
- [Color Cycler Tool](#color-cycler-tool)

---

## Brushes

#### CC shape sampler colors below
All cc brushes buoild a gradienbt by sanmpling colors while drawing the stroke / gadient (8 colores by default) thwy autmatically apply this gradienbt to the shape / sttoke

#### CC All brushes dither bands
for all color cycles brushes add a toggle below banbds sldier called Dither so gradeiotn are diothered instead of getting bands. Use the Sierra lite dithering algo. bands are still relvent bescuase it dithers between the bands 

#### CC any custom brush
add color cycling to the custom bruishes. Each stamp of the cistom brush is a new col cycling color in the sequence. can we apply this thingking to any custom brush. a toggle in brush optopns that sets the bush as a CC brush, toggled on brings up the gradeiont dtop down, speed and bands slider. must also be on itd own cc layer  

#### Resampler
Dynamically samples canvas content for each new stroke.

**Implementation:**
- current brush size = sampled area
- Capture on each new stroke start
- All the default brush options
- Reuse aleady build custom brush capture - temp brush code, but do this on every new stroke

### Datamosh Brush
**Concept:** A glitch art brush that corrupts and "moshes" pixel data from the existing image, creating digital artifacts similar to video compression errors.

**Implementation Details:**
- Samples pixel data from the area under the brush
- Applies datamoshing algorithms to corrupt/shift the data
- Different mosh modes:
  - Pixel displacement (shift pixels by random amounts)
  - Color channel separation (RGB channels offset)
  - Compression artifacts (simulate JPEG/MPEG errors)
  - Temporal shifting (simulate frame bleeding)
- Pressure controls intensity of corruption
- Brush size determines affected area

**Potential Features:**
- Directional moshing (follow stroke direction)
- Feedback loops (repeatedly mosh the same area for escalating effects)
- Blend with original pixels for partial corruption
- Preset glitch patterns (VHS, digital TV, corrupted file)
- Animation support (animated glitch effects)

## The Quantum Superposition Brush
This brush exists in multiple probable states until "observed." As you paint, your strokes remain in superposition - flickering between different possible colors, textures, and positions based on quantum probability distributions. Only when you stop and "observe" (by clicking a collapse button or waiting a certain time) do the strokes resolve into their final state. You can adjust the probability waves, entangle different strokes so their collapses are correlated, or create "measurement zones" where everything collapses differently. The final painting emerges from probability clouds, and you could export alternate timeline versions showing different collapse outcomes.
Each brush treats the digital canvas as a space where painting becomes entangled with systems, economies, uncertainties, and the hidden dynamics of our networked world.

## The Consensus Reality Brush
This brush only paints what it can "verify" exists across multiple online sources. Try to paint something fictional or counterfactual, and the brush resistance increases or the stroke becomes transparent. The more references the brush finds across different platforms (Wikipedia, news sites, social media, academic papers), the more solid and vibrant your stroke becomes. You could even have different "verification modes" - scientific consensus, popular belief, historical record - each creating different resistances and possibilities for what can be painted into existence.
Each of these brushes treats the canvas not as a static surface but as a dynamic interface between human intention, algorithmic processing, and networked information systems.

## The Semantic Web Brush
Instead of painting with colors, this brush paints with live-scraped imagery from the internet based on what you write or draw. Sketch a rough circle and write "sunset" - it fills with real sunset images pulled from current web searches, blended algorithmically. The brush interprets your gestures semantically, using image recognition to understand what you're trying to draw, then replaces your strokes with relevant found imagery. Each painting becomes a collage of the internet's current visual culture around your concepts.

### Data Erosion Brush
**Concept:** A variation of the datamosh brush that progressively removes pixel data in interesting patterns, creating a digital decay effect.

**Implementation Details:**
- Iteratively removes pixel information with each stroke
- Removal patterns:
  - Alternating pixels (checkerboard erosion)
  - Spiral patterns from center of brush
  - Random pixel dropout with increasing probability
  - Bit-depth reduction (progressively reduce color information)
- Creates "holes" in the data that reveal background or transparency
- Pattern can be time-based (erosion continues after stroke ends)

**Potential Features:**
- Erosion speed control (how fast pixels disappear)
- Pattern selection (geometric, organic, random)
- Selective erosion (only erode certain colors/brightness levels)
- Restoration mode (bring back eroded pixels)
- Erosion masks (protect certain areas from erosion)
- Export erosion pattern as animated sequence

#### Contour Map Polygon Brush
Creates contour lines like what yuo see o a countour map.

**Implementation:**
- Generate contours based on the shape of the polygon
- uses similar preview shape making as the polygon tool
- only once the shape is complete does it calclate all the contours
- slider for countour spacing 1-10 
- add heights markers for each contour going into the centre - heighest
- make lines pixelated crisp edges

#### Grain/Noise Slider
Add texture to brush strokes for traditional media feel.

**Implementation:**
- Perlin noise generation for smooth grain
- Intensity slider (0-100%)
- Grain size parameter
- Options: Uniform noise, Gaussian, Perlin
- Blend mode selection for grain application
- Performance: Generate noise textures on brush selection, not per-stamp

#### Layered Paint Thickness
Simulate paint buildup with multiple stroke passes.

**Implementation:**
- Virtual height map tracking paint thickness
- Bump mapping or normal mapping for 3D effect
- Color mixing based on paint layer interaction
- Impasto effect with lighting simulation
- Opacity increases with thickness
- Performance: Use WebGL shaders if available

#### Image Hose
Spray images from a dynamic collection.

**Implementation:**
- Image source: Search API, local folder, predefined sets
- Caching strategy for loaded images
- Spray patterns: Random, sequential, pressure-based
- Size/rotation variation
- Blend mode per image
- Performance: Preload and resize images, limit concurrent sprites
#### Chaotic Brush System
Unpredictable, generative brush behaviors.

**Implementation:**
- Strange attractors (Lorenz, Rössler)
- Fractal generation (Julia sets, Mandelbrot)
- Rule-based cellular automata
- Particle systems with physics
- Parameters: Chaos level, seed value, evolution rate

#### Brush Spacing Jitter
Dynamic randomization of brush stamp spacing for more organic, natural-looking strokes.

**Implementation:**
- Add jitter parameter (0-100%) to brush configuration
- Modify stamp placement algorithm in `useBrushEngine.ts`
- Formula: `actualSpacing = baseSpacing * (1 + jitter * (Math.random() * 2 - 1))`
- UI: Slider control in brush settings panel
- Store jitter value per brush preset

#### ASCII Brush (Pressure Sensitive)
Text-based drawing brush that renders ASCII characters with pressure-mapped density.

**Implementation:**
- Character set: [' ', '.', ':', '-', '=', '+', '*', '#', '%', '@']
- Map pressure (0-1) to character index
- Render characters to canvas using fillText()
- Settings: Font size, character set selection, rotation based on stroke direction
- Integration point: New brush type in `BrushType` enum

#### Color Jitter
Randomize color within HSL ranges for each stamp.

**Implementation:**
- Three sliders: Hue jitter (0-180°), Saturation jitter (0-100%), Lightness jitter (0-100%)
- Visual preview showing jitter range on color wheel
- Apply per stamp: `newColor = baseColor + random(-jitter, +jitter)`
- Option to link to pressure/velocity
- Presets for common effects (watercolor, spray paint)
 
#### Dithering Brush (Pressure Sensitive)
Applies dithering patterns with pressure controlling pattern density.

**Implementation:**
- Dither patterns: Floyd-Steinberg, Ordered (Bayer matrix), Random
- Pressure maps to threshold level (lighter pressure = more dithering)
- Real-time pattern generation based on underlying colors
- Option to use current colors or force black/white
- Performance: Pre-calculate dither matrices, cache patterns

#### Texturizer Brush
Adds texture while respecting underlying pixels.

**Implementation:**
- Analyze pixels under brush area
- Generate complementary texture
- Blend modes: Multiply, overlay, soft light
- Texture library: Paper, canvas, wood, stone
- Pressure affects texture intensity
- Smart edge detection to preserve details

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


### Time Capsule Brush
**Concept:** Paint with words from history - select a date and the brush retrieves news headlines/articles from that specific day in time. As you paint, the brush applies sequential words from the retrieved text at the brush tip, literally painting the day's events in words one after another.

**Implementation Details:**
- Date picker interface to select any historical date
- Fetches news articles/headlines from that specific date via news archives API
- Extracts and queues text content sequentially
- Each brush stroke applies the next word(s) in sequence at the cursor position
- Words flow naturally following the brush movement direction
- Font size/style adjustable based on brush size settings

**Potential Features:**
- Multiple source options (newspapers, magazines, historical documents)
- Language selection for international news sources
- Word density control (how many words per brush stroke)
- Typography effects (fade in/out, size variation based on word importance)
- Color coding by news category (politics, sports, culture, etc.)
- Save/replay specific date's text stream
- Mix multiple dates to create temporal collages

### Spam Brush
**Concept:** Paint with fixed-spacing letters extracted from spam emails, creating chaotic text-based artwork from digital detritus.

**Implementation Details:**
- Pre-loaded corpus of classic spam email phrases and keywords
- Characters placed at fixed pixel intervals along stroke path
- Random selection from spam vocabulary:
  - "CONGRATULATIONS", "WINNER", "ACT NOW", "LIMITED TIME"
  - Nigerian prince phrases, crypto scams, fake pharma ads
  - Randomized special characters and numbers ($$$, !!!, 100% FREE)
- Fixed character spacing regardless of stroke speed
- Pressure controls character size/opacity

**Potential Features:**
- Different spam categories (financial, romance, pharma, crypto)
- Glitch mode where characters corrupt/overlap
- Rainbow color cycling through spam text
- Import custom spam folder via text file
- Character degradation effect (text gets more garbled over time)
- Mixed language spam for international chaos