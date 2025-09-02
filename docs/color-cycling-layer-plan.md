# Color Cycling Recolor Feature

## Overview

Add "Recolor & Animate" mode to Color Cycle tool - converts any layer to animated 256-color cycling with one-click color extraction from existing artwork.

**Core Features:**

-   Layer animation through gradient cycling
-   256-color indexed format for performance
-   Extract colors from layer → build gradient
-   Bayer dithering to reduce banding
-   30 FPS at 4K resolution

## Technical Approach

### 256-Color Strategy with Dithering

javascript

    // Convert layer to indexed color once (including dithering), then just remap per frame
    class RecolorEngine {
      processLayer(layer, options = {}) {
        const { mode = 'fast', dithering = 'off' } = options;
        
        // Step 1: Quantize to 256 colors
        let indices;
        if (mode === 'fast') {
          indices = this.quantizeRGB332(layer.imageData);
        } else {
          const palette = this.medianCut(layer.imageData, 256);
          indices = this.mapToPalette(layer.imageData, palette);
        }
        
        // Step 2: Apply dithering ONCE during quantization (not per frame!)
        if (dithering !== 'off') {
          indices = this.applyDithering(indices, layer.width, layer.height, dithering);
        }
        
        // Step 3: Store dithered indices (never recomputed)
        this.indexBuffers.set(layer.id, indices);
        this.gradientLUTs.set(layer.id, new Uint32Array(256));
      }
      
      applyDithering(indices, width, height, mode) {
        const matrix = mode === 'bayer4' ? BAYER_4x4 : BAYER_8x8;
        const size = mode === 'bayer4' ? 4 : 8;
        const output = new Uint8Array(indices.length);
        
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const threshold = matrix[y % size][x % size];
            
            // Add dither noise to index selection
            const ditheredIndex = Math.min(255, 
              Math.max(0, indices[i] + threshold * 16)
            );
            output[i] = Math.round(ditheredIndex);
          }
        }
        
        return output; // Dithered indices stored permanently
      }
      
      // Per frame: Just remap using LUT (dithering already baked in)
      renderFrame(layer, tick) {
        const indices = this.indexBuffers.get(layer.id); // Pre-dithered
        const lut = this.gradientLUTs.get(layer.id);
        
        // Update LUT only when tick changes
        if (tick !== this.lastTick) {
          this.updateLUT(lut, tick);
          this.lastTick = tick;
        }
        
        // Fast remapping - just array lookups, no dithering needed
        const out32 = new Uint32Array(output.data.buffer);
        const originalAlpha = layer.originalImageData.data;
        
        for (let i = 0; i < indices.length; i++) {
          const color = lut[indices[i]];
          const alpha = originalAlpha[i * 4 + 3];
          out32[i] = (color & 0x00FFFFFF) | (alpha << 24);
        }
      }
    }

### Quantization Methods

**Fast Mode - RGB332 (Instant)**

javascript

    function rgbToIndex256(r, g, b) {
      return ((r >> 5) << 5) | ((g >> 5) << 2) | (b >> 6);
    }

**Quality Mode - OKLab Color Space**

javascript

    // Extract optimal palette using perceptual color distance
    const palette = medianCut(imageData, 256, 'oklab');
    
    // OKLab for perceptually uniform color operations
    class OKLab {
      static fromRGB(r, g, b) {
        // sRGB → Linear → OKLab conversion
        const lr = sRGBToLinear(r);
        const lg = sRGBToLinear(g);
        const lb = sRGBToLinear(b);
        
        // Matrix transform to OKLab
        const l = 0.4122 * lr + 0.5363 * lg + 0.0514 * lb;
        const m = 0.2119 * lr + 0.6807 * lg + 0.1074 * lb;
        const s = 0.0883 * lr + 0.2817 * lg + 0.6300 * lb;
        
        return {
          L: 0.2105 * Math.cbrt(l) + 0.7936 * Math.cbrt(m) - 0.0041 * Math.cbrt(s),
          a: 1.9780 * Math.cbrt(l) - 2.4286 * Math.cbrt(m) + 0.4506 * Math.cbrt(s),
          b: 0.0259 * Math.cbrt(l) + 0.7828 * Math.cbrt(m) - 0.8087 * Math.cbrt(s)
        };
      }
      
      static distance(lab1, lab2) {
        // Perceptual distance in OKLab space
        return Math.sqrt(
          (lab1.L - lab2.L) ** 2 +
          (lab1.a - lab2.a) ** 2 +
          (lab1.b - lab2.b) ** 2
        );
      }
    }
    
    // Gradient interpolation in OKLab prevents color mud
    function interpolateGradient(stop1, stop2, t) {
      const lab1 = OKLab.fromRGB(stop1.r, stop1.g, stop1.b);
      const lab2 = OKLab.fromRGB(stop2.r, stop2.g, stop2.b);
      
      // Interpolate in perceptual space
      const labMix = {
        L: lab1.L + (lab2.L - lab1.L) * t,
        a: lab1.a + (lab2.a - lab1.a) * t,
        b: lab1.b + (lab2.b - lab1.b) * t
      };
      
      return OKLab.toRGB(labMix);
    }

    
    ### Animation System
    ```javascript
    // Integer ticks avoid floating-point drift
    const animation = {
      tick: 0,              // 0-255
      ticksPerCycle: 256,   
      ticksPerFrame: 1,     // Speed control
      flow: 'forward'       // forward/reverse/pingpong/bounce
    };
    
    function advanceTick(anim) {
      switch(anim.flow) {
        case 'forward':
          anim.tick = (anim.tick + anim.ticksPerFrame) % 256;
          break;
        case 'reverse':
          anim.tick = (anim.tick - anim.ticksPerFrame + 256) % 256;
          break;
        case 'pingpong':
          // Reverse at ends
          break;
      }
    }

## UI Design

### Main Panel

    ┌─ Color Cycle ─────────────────────────┐
    │ Layer: "Character Sprite"             │
    │                                        │
    │ Mode: [Brush] [Recolor & Animate]     │
    │                                        │
    │ [Gradient selector with presets    ▼] │
    │ [████████████████████████████████]    │
    │                                        │
    │ [🎨 Extract Colors from This Layer]   │
    │                                        │
    │ Speed      [████░░░░] 1.0             │
    │ Frame Rate: [60] [30] [15] fps        │
    │ Dithering:  [Off] [4×4] [8×8]         │
    │ Flow:       [→] [←] [↔] [Bounce]      │
    │ □ Show Original                       │
    │                                        │
    │ [▶ Play] [⏸ Pause] [⏹ Reset]         │
    └────────────────────────────────────────┘

### Extract Colors Dialog

    ┌─ Extract Colors ──────────────────────┐
    │                                       │
    │ Method: ● Fast ○ Quality             │
    │ Gradient Stops: [8 ▼]                │
    │                                       │
    │ [Extracted palette preview - 256]     │
    │                                       │
    │ Build From: ● Dominant ○ Full Range  │
    │ Sort By: [Hue ▼]                     │
    │                                       │
    │ [Preview gradient bar]                │
    │                                       │
    │ [Cancel] [Apply as Gradient]         │
    └────────────────────────────────────────┘

**Gradient Building Process:**

1.  **Extract 256 colors** from layer (always 256 for remapping)
2.  **Select gradient stops** (4-32 colors):
    -   **Dominant mode**: Choose most frequently used colors
        
        javascript
        
            function selectDominant(palette256, numStops) {
              // Count pixel frequency for each palette color
              const frequency = countColorUsage(palette256, indexBuffer);
              
              // Sort by frequency and take top N
              const sorted = palette256.sort((a, b) => frequency[b] - frequency[a]);
              const candidates = sorted.slice(0, numStops * 2);
              
              // Remove visually similar colors (ΔE < 10 in OKLab)
              const distinct = [];
              for (const color of candidates) {
                if (!distinct.some(c => OKLab.distance(c, color) < 10)) {
                  distinct.push(color);
                  if (distinct.length === numStops) break;
                }
              }
              return distinct;
            }
        
    -   **Full Range mode**: Sample evenly across sorted palette
        
        javascript
        
            function selectFullRange(palette256, numStops) {
              // Sort by chosen method (hue/luminance)
              const sorted = sortPalette(palette256);
              
              // Pick evenly spaced colors
              const step = Math.floor(256 / numStops);
              const stops = [];
              for (let i = 0; i < numStops; i++) {
                stops.push(sorted[i * step]);
              }
              return stops;
            }
        
3.  **Build gradient** from selected stops with proper interpolation
4.  **Animation** cycles all 256 colors through this gradient

## Performance Optimizations

### Hot Path

javascript

    // Precompute everything possible
    const optimizations = {
      indexBuffer: 'Built once per layer',      // 8MB for 4K
      gradientLUT: 'Updated once per tick',     // 1KB
      alphaExtract: 'From original on-demand',  // No duplicate storage
      packed32bit: 'Single write per pixel'     // Fast memcpy
    };

### Adaptive LOD

javascript

    class AdaptiveLOD {
      selectLOD(frameTime) {
        // Performance-based quality
        if (frameTime > 40) return 'quarter';  // >40ms = quarter res
        if (frameTime > 20) return 'half';     // >20ms = half res
        return 'full';                         // <20ms = full res
      }
      
      // Precomputed mipmaps
      buildMipmaps(indices, width, height) {
        return {
          full: indices,
          half: this.downsample(indices, 2),
          quarter: this.downsample(indices, 4)
        };
      }
    }

### Memory Management

javascript

    // No alpha buffer duplication
    remapPixels(layer) {
      const indices = layer.recolorSettings.indexBuffer;
      const originalData = layer.originalImageData.data;
      
      for (let i = 0; i < indices.length; i++) {
        const color = lut[indices[i]];
        const alpha = originalData[i * 4 + 3]; // Extract on-demand
        out32[i] = (color & 0x00FFFFFF) | (alpha << 24);
      }
    }
    
    // Optional RLE for sparse sprites
    if (countTransparent(layer) > 50%) {
      useRLECompression(alphas); // Compress runs of 0/255
    }

## Modular Architecture

### Core Modules (Reusable)

javascript

    modules/
      colorQuantizer.js    // RGB332, median cut, spatial hash
      colorSpace.js        // sRGB↔Linear, RGB↔OKLab
      dithering.js         // Bayer matrices, ordered dither
      animation.js         // Frame timing, RAF control
      memoryPool.js        // Scratch buffer reuse

### Feature Modules

javascript

    features/colorCycle/
      recolorEngine.js     // Main processing
      gradientExtractor.js // Palette → gradient
      adaptiveLOD.js       // Performance scaling

### Controller

javascript

    class ColorCycleController {
      constructor(store) {
        this.engine = new RecolorEngine();
        this.extractor = new GradientExtractor();
        this.animator = new AnimationController(30);
      }
      
      ensureLayerProcessed(layer) {
        if (!layer.recolorSettings.indexBuffer) {
          this.engine.processLayer(layer);
        }
      }
      
      onFrame() {
        if (layer.animation.playing) {
          advanceTick(layer.animation);
          this.engine.renderFrame(layer, layer.animation.tick);
        }
      }
    }

## Data Flow

    User Action → Controller → Engine → Canvas
         ↓            ↓          ↓        ↑
       Store    →   Model   → Renderer ───┘

## Performance Targets

Resolution

Layers

FPS

Memory

Quality

1080p

3

60

25MB

Full

4K

1

30

42MB

Full

4K

3

30

125MB

Adaptive LOD

## Implementation Phases

**Week 1: Core**

-   RGB332 quantization
-   Index buffer system
-   Basic animation loop
-   UI integration

**Week 2: Quality**

-   Median cut palette extraction
-   Gradient builder from colors
-   Dithering support
-   Extract dialog

**Week 3: Polish**

-   Adaptive LOD
-   Performance monitoring
-   Memory optimizations
-   Testing

## Key Decisions

**Why 256 colors?**

-   Uint8Array indexing (1 byte/pixel)
-   75% memory reduction vs RGBA
-   GIF export compatibility
-   Good enough for most art

**Why not WebGL?**

-   Simpler integration with existing canvas layers
-   No context switching overhead
-   Works everywhere
-   Easier undo/redo

**Why modular?**

-   Reuse quantization in other features
-   Testable components
-   Clean separation of concerns

## Edge Cases Handled

-   **Transparency**: Preserved from original
-   **Single color images**: Still animates through gradient
-   **Large canvases**: Adaptive LOD kicks in
-   **Rapid edits**: Cache invalidation on pixel changes
-   **Memory pressure**: Free non-visible layer indices

## Browser Compatibility

Feature

Chrome

Firefox

Safari

Core

✅

✅

✅

Workers

✅

✅

Palette only

OffscreenCanvas

✅

✅

❌

## Export (Future)

javascript

    // 256 colors = perfect for these formats
    exportFormats = {
      'gif': 'Native 256 color support',
      'apng': 'Better quality than GIF',
      'png8': 'Sequence with shared palette'
    };

## Success Metrics

-   30 FPS on 4K canvas (single layer)
-   <100ms palette extraction
-   <200ms initial processing
-   Zero memory leaks
-   50% feature adoption







