# Color Cycling Recolor Feature Specification

## Overview

The Color Cycling Recolor feature adds a "Recolor & Animate" mode to the existing Color Cycle tool, converting any layer to an animated 256-color cycling effect with one-click color extraction from existing artwork.

### Core Features
- Layer animation through gradient cycling
- 256-color indexed format for performance
- Extract colors from layer → build gradient
- Bayer dithering to reduce banding
- 30 FPS at 4K resolution

## Technical Architecture

### 256-Color Strategy with Dithering

The core approach converts layers to indexed color once (including dithering), then remaps colors per frame for animation:

```javascript
class RecolorEngine {
  processLayer(layer, options = {}) {
    // Step 1: Quantize to 256 colors
    // Step 2: Apply dithering ONCE during quantization
    // Step 3: Store dithered indices (never recomputed)
  }
  
  renderFrame(layer, tick) {
    // Per frame: Just remap using LUT
    // Fast array lookups, no dithering needed
  }
}
```

### Quantization Methods

#### Fast Mode - RGB332
- Instant quantization using 3-3-2 bit distribution
- 3 bits red, 3 bits green, 2 bits blue = 256 colors
- Performance: <50ms at 1080p, <100ms at 4K

#### Quality Mode - OKLab Color Space
- Median cut algorithm for optimal palette extraction
- Perceptually uniform color operations
- Better gradient interpolation preventing color mud
- Performance: <200ms at 4K

### Animation System
- Integer ticks to avoid floating-point drift
- Gradient quantization: 8-256 colors (default 16) for visible cycling
- Multiple flow modes: forward, reverse, pingpong, bounce
- Frame decimation for FPS control (60/30/15)
- Tick-based animation for consistency

## User Interface

### Main Panel Layout
- Layer selector showing current layer name
- Mode toggle: Brush vs Recolor & Animate
- Gradient selector with presets (Rainbow, Sunset, Ocean, Fire)
- Extract Colors button for one-click palette extraction
- **Cycle Colors slider (8-256, default 16)** - controls visible color bands
- Speed slider (0.1x - 2.0x)
- Frame rate selector (60/30/15 FPS)
- Dithering options (Off/4×4/8×8)
- Flow direction controls
- Play/Pause/Reset animation controls

### Extract Colors Dialog
- Method selection: Fast vs Quality
- Gradient stops selector (4-32 colors)
- 256-color palette preview
- Build mode: Dominant colors vs Full range
- Sort options: Hue, Luminance, Saturation
- Live gradient preview
- Apply/Cancel buttons

## Performance Optimizations

### Hot Path Optimizations
- Precomputed index buffers (built once per layer)
- Gradient LUT updated once per tick
- Alpha extracted from original on-demand
- Packed 32-bit operations for fast memcpy

### Adaptive Level of Detail (LOD)
- Automatic quality adjustment based on frame time
- Three levels: Full, Half, Quarter resolution
- Precomputed mipmaps for instant switching
- Target: Maintain smooth animation even on slower devices

### Memory Management
- Buffer pooling for scratch memory reuse
- No alpha channel duplication
- Optional RLE compression for sparse sprites
- Target: <150MB for 3 layers at 4K

## Implementation Plan

### Phase 1: Core Foundation (Days 1-4)
- **Day 1**: Project setup & data model extension
- **Day 2**: RGB332 fast quantization implementation
- **Day 3**: Index buffer system & cache management
- **Day 4**: Basic animation loop with tick system

### Phase 2: Rendering Pipeline (Days 5-7)
- **Day 5**: Hot path optimization & fast remapping
- **Day 6**: Memory optimization & pooling
- **Day 7**: Performance monitoring & metrics

### Phase 3: UI Implementation (Days 8-10)
- **Day 8**: Panel UI with all controls
- **Day 9**: Event handling & state management
- **Day 10**: Polish, feedback, and error states

### Phase 4: Quality Mode & Dithering (Days 11-13)
- **Day 11**: Median cut algorithm implementation
- **Day 12**: Spatial hash for nearest color lookup
- **Day 13**: Bayer matrix dithering integration

### Phase 5: Color Extraction (Days 14-16)
- **Day 14**: OKLab color space conversions
- **Day 15**: Extract dialog implementation
- **Day 16**: Gradient building from extracted colors

### Phase 6: Advanced Features (Days 17-19)
- **Day 17**: Additional animation flow modes
- **Day 18**: Adaptive LOD implementation
- **Day 19**: Edge cases & robustness

### Phase 7: Testing & Optimization (Days 20-22)
- **Day 20**: Performance testing suite
- **Day 21**: Cross-browser compatibility
- **Day 22**: Final polish & documentation

### Phase 8: Integration & Release (Days 23-25)
- **Day 23**: Full app integration testing
- **Day 24**: Bug fixes & adjustments
- **Day 25**: Launch & monitoring

## Success Criteria

### Performance Targets
- ✅ 60 FPS at 1080p with single layer
- ✅ 30 FPS at 4K with single layer
- ✅ <50ms RGB332 quantization at 1080p
- ✅ <100ms median cut at 4K
- ✅ <16ms render time per frame at 1080p
- ✅ Memory usage <150MB for 3 layers at 4K

## Undo/Redo Integration

### Integration with Existing System

The recolor feature integrates with the existing undo/redo system by logging state changes at key points:

```javascript
class RecolorEngine {
  // Log state before any change that modifies the layer
  processLayer(layer, options = {}) {
    // Log current state before processing
    undoManager.pushState({
      type: 'recolor_process',
      layerId: layer.id,
      before: {
        mode: layer.colorCycleData.mode,
        indexBuffer: null, // Flag to rebuild from image
        options: {...layer.colorCycleData.recolorSettings.options}
      }
    });
    
    // Process the layer
    this.doProcessLayer(layer, options);
    
    // State is now logged, can be undone
  }
  
  // Log setting changes
  updateSettings(layer, settings) {
    undoManager.pushState({
      type: 'recolor_settings',
      layerId: layer.id,
      before: {...layer.colorCycleData.recolorSettings},
      after: settings
    });
    
    Object.assign(layer.colorCycleData.recolorSettings, settings);
  }
  
  // Log gradient changes
  applyGradient(layer, gradient) {
    undoManager.pushState({
      type: 'recolor_gradient',
      layerId: layer.id,
      before: layer.colorCycleData.gradient,
      after: gradient
    });
    
    layer.colorCycleData.gradient = gradient;
  }
}

// Restore handler in existing undo system
undoManager.registerHandler('recolor_process', (state) => {
  const layer = getLayer(state.layerId);
  if (state.before.indexBuffer === null) {
    // Need to reprocess from original image
    engine.clearBuffers(layer);
    layer.colorCycleData.mode = state.before.mode;
  }
});

undoManager.registerHandler('recolor_settings', (state) => {
  const layer = getLayer(state.layerId);
  layer.colorCycleData.recolorSettings = state.before;
  
  // Reprocess if necessary
  if (state.before.options.dithering !== state.after.options.dithering) {
    engine.processLayer(layer, state.before.options);
  }
});
```

### State Change Points to Log

**Must Log:**
- Initial processing (converting layer to indexed color)
- Gradient changes (extract colors or select preset)
- Dithering mode changes (requires reprocessing)
- Quantization mode changes (fast/quality)
- Cycle colors slider changes

**Don't Need to Log:**
- Animation play/pause (UI state only)
- Current tick position (ephemeral)
- FPS changes (performance setting)
- Speed changes during playback (can log on release)

### Efficient State Storage

```javascript
// For settings that change frequently (sliders), log on release
class UIControls {
  onCycleColorsSliderStart() {
    this.sliderStartValue = layer.colorCycleData.recolorSettings.cycleColors;
  }
  
  onCycleColorsSliderChange(value) {
    // Update live without logging
    layer.colorCycleData.recolorSettings.cycleColors = value;
    engine.updateGradientLUT(layer);
  }
  
  onCycleColorsSliderEnd(value) {
    // Log once on release
    if (value !== this.sliderStartValue) {
      undoManager.pushState({
        type: 'recolor_cycleColors',
        layerId: layer.id,
        before: this.sliderStartValue,
        after: value
      });
    }
  }
}
```

**Key Points:**
- Index buffers are rebuilt from the original image when needed
- Settings are stored as lightweight objects
- Batch rapid changes (like slider drags) into single undo states
- Animation state (tick, playing) is not part of undo history

### Quality Standards
- ✅ No visible banding with dithering
- ✅ OKLab gradients look smooth
- ✅ Alpha channel preserved correctly
- ✅ LOD transitions are seamless
- ✅ No memory leaks after 1 hour

### Browser Compatibility
- ✅ Chrome/Firefox/Safari support
- ✅ Fallbacks for Safari limitations
- ✅ Mobile browsers functional
- ✅ Save/load compatibility maintained

## Key Technical Decisions

### Why 256 Colors?
- Uint8Array indexing (1 byte per pixel)
- 75% memory reduction vs RGBA
- GIF export compatibility
- Sufficient quality for most artwork

### Why Canvas Over WebGL?
- Simpler integration with existing layers
- No context switching overhead
- Universal browser support
- Easier undo/redo integration

### Why Modular Architecture?
- Reusable components across features
- Isolated testing of components
- Clean separation of concerns
- Future extensibility

## Risk Mitigation

| Risk | Mitigation Strategy |
|------|-------------------|
| Can't achieve 30 FPS at 4K | Implement LOD earlier, add quality settings |
| Exceeds browser memory limits | Aggressive pooling, free inactive layers |
| Poor gradient extraction | Multiple extraction modes, manual editing |
| Timeline overrun | Core features first, polish can be deferred |

## Future Enhancements (Post-Launch)

### Export Features
- GIF export with perfect 256-color match
- APNG for better quality
- PNG sequence for game engines
- WebP animation support

### Advanced Controls
- Custom dither patterns
- Gradient editor integration
- Color curve adjustments
- Palette editing interface

## Multi-Layer Animation System

### Global Animation Controller

While color extraction and processing happens one layer at a time (on the selected layer), the animation system must support playing all recolor-enabled layers simultaneously:

```javascript
class GlobalAnimationController {
  constructor() {
    this.activeLayers = new Map(); // All layers with recolor enabled
    this.isPlaying = false;
    this.globalTick = 0;
    this.frameCount = 0;
    this.targetFPS = 30;
  }
  
  // Register any layer that has recolor enabled
  registerLayer(layer) {
    if (layer.colorCycleData.mode === 'recolor' && 
        layer.colorCycleData.recolorSettings.indexBuffer) {
      this.activeLayers.set(layer.id, {
        layer: layer,
        enabled: true,
        lastTick: -1
      });
    }
  }
  
  unregisterLayer(layerId) {
    this.activeLayers.delete(layerId);
  }
  
  // Global play - animates ALL registered layers
  playAll() {
    this.isPlaying = true;
    this.animate();
  }
  
  // Play specific layer only (for testing)
  playSingle(layerId) {
    // Temporarily disable other layers
    for (const [id, data] of this.activeLayers) {
      data.enabled = (id === layerId);
    }
    this.play();
  }
  
  animate = () => {
    if (!this.isPlaying) return;
    
    const startFrame = performance.now();
    
    // Update all active layers
    for (const [layerId, data] of this.activeLayers) {
      if (data.enabled && data.layer.visible) {
        this.updateLayer(data);
      }
    }
    
    // Composite all layers (existing canvas compositing)
    this.compositor.render();
    
    // Performance monitoring
    const frameTime = performance.now() - startFrame;
    this.adjustQuality(frameTime);
    
    requestAnimationFrame(this.animate);
  }
  
  updateLayer(layerData) {
    const layer = layerData.layer;
    const settings = layer.colorCycleData.recolorSettings;
    
    // Each layer can have different cycle speeds
    const tick = Math.floor(this.globalTick * settings.animation.ticksPerFrame) 
                  % settings.cycleColors;
    
    if (tick !== layerData.lastTick) {
      this.engine.updateGradientLUT(layer, tick);
      this.engine.renderFrame(layer);
      layerData.lastTick = tick;
    }
  }
  
  // Adaptive quality for multiple layers
  adjustQuality(frameTime) {
    const targetFrameTime = 1000 / this.targetFPS;
    
    if (frameTime > targetFrameTime * 1.5) {
      // Drop to lower LOD for all layers
      for (const [id, data] of this.activeLayers) {
        data.layer.colorCycleData.recolorSettings.currentLOD = 'half';
      }
    } else if (frameTime < targetFrameTime * 0.7) {
      // Can handle full quality
      for (const [id, data] of this.activeLayers) {
        data.layer.colorCycleData.recolorSettings.currentLOD = 'full';
      }
    }
  }
}
```

### Layer Processing Workflow

```javascript
class RecolorWorkflow {
  // Process selected layer only
  processSelectedLayer(selectedLayer, options) {
    // UI shows processing indicator
    ui.showProcessing(selectedLayer);
    
    // Process the single selected layer
    engine.processLayer(selectedLayer, options);
    
    // Auto-register for animation
    animationController.registerLayer(selectedLayer);
    
    // Update UI
    ui.updateLayerStatus(selectedLayer, 'ready');
  }
  
  // Batch process multiple layers (optional feature)
  async batchProcess(layers, options) {
    for (const layer of layers) {
      await this.processSelectedLayer(layer, options);
      // Allow UI updates between layers
      await new Promise(r => setTimeout(r, 0));
    }
  }
  
  // Export all animated layers
  exportAnimation() {
    const exportLayers = [];
    
    // Collect all layers with recolor enabled
    for (const layer of document.layers) {
      if (layer.colorCycleData.mode === 'recolor' && 
          layer.colorCycleData.recolorSettings.indexBuffer) {
        exportLayers.push(layer);
      }
    }
    
    // Export with all layers animating
    return this.exporter.export(exportLayers, {
      fps: 30,
      duration: 256 / 16 * 1000, // Full cycle
      format: 'gif'
    });
  }
}
```

### UI Indicators

```javascript
// Visual feedback for multi-layer status
class LayerPanel {
  renderLayerItem(layer) {
    return `
      <div class="layer-item">
        <span class="layer-name">${layer.name}</span>
        ${layer.colorCycleData.mode === 'recolor' ? `
          <span class="recolor-badge">
            ${layer.colorCycleData.recolorSettings.indexBuffer ? 
              '🎨 Ready' : '⏳ Process'}
          </span>
        ` : ''}
      </div>
    `;
  }
  
  renderGlobalControls() {
    return `
      <div class="global-animation-controls">
        <button onclick="animationController.playAll()">
          ▶ Play All Layers
        </button>
        <button onclick="animationController.playSingle(selectedLayer.id)">
          ▶ Play Selected Only
        </button>
        <span class="active-count">
          ${animationController.activeLayers.size} layers ready
        </span>
      </div>
    `;
  }
}
```

**Key Design Decisions:**
- **Process one, animate many**: Extraction/processing is per-layer, animation is global
- **Independent timing**: Each layer can have different speeds while sharing global tick
- **Smart registration**: Layers auto-register when processed, auto-unregister when mode changes
- **Performance scaling**: Adaptive LOD adjusts all layers together based on total frame time
- **Export ready**: All recolor-enabled layers can be exported as synchronized animation

### Integration Features
- Batch processing multiple layers
- Animation synchronization
- Preset sharing system
- Cloud gradient library

## Module Structure

```
modules/
├── colorCycle/
│   ├── core/
│   │   ├── ColorQuantizer.js
│   │   ├── ColorSpace.js
│   │   └── Dithering.js
│   ├── engine/
│   │   ├── RecolorEngine.js
│   │   ├── GradientExtractor.js
│   │   └── AnimationController.js
│   ├── ui/
│   │   ├── ColorCyclePanel.js
│   │   └── ExtractDialog.js
│   └── utils/
│       ├── MemoryPool.js
│       └── PerformanceMonitor.js
```

## Detailed Implementation Code Examples

### RGB332 Quantization Implementation
```javascript
// src/modules/colorCycle/core/ColorQuantizer.js
export class ColorQuantizer {
  static quantizeRGB332(imageData) {
    const { data, width, height } = imageData;
    const pixelCount = width * height;
    const indices = new Uint8Array(pixelCount);
    
    // Build RGB332 palette
    const palette = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      const r = ((i >> 5) & 0x07) * 36;  // 0-252 in steps of 36
      const g = ((i >> 2) & 0x07) * 36;
      const b = (i & 0x03) * 85;         // 0-255 in steps of 85
      
      // Pack as ABGR for little-endian systems
      palette[i] = (255 << 24) | (b << 16) | (g << 8) | r;
    }
    
    // Map each pixel to nearest RGB332 color
    for (let i = 0, idx = 0; i < data.length; i += 4, idx++) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      // Quantize to RGB332
      const r3 = r >> 5;  // Top 3 bits
      const g3 = g >> 5;  // Top 3 bits
      const b2 = b >> 6;  // Top 2 bits
      
      indices[idx] = (r3 << 5) | (g3 << 2) | b2;
    }
    
    return { indices, palette };
  }
}
```

### OKLab Color Space Implementation
```javascript
// src/modules/colorCycle/core/ColorSpace.js
export class OKLab {
  static fromRGB(r, g, b) {
    // sRGB → Linear → OKLab conversion
    const lr = sRGBToLinear(r / 255);
    const lg = sRGBToLinear(g / 255);
    const lb = sRGBToLinear(b / 255);
    
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
  
  static toRGB(lab) {
    // OKLab → Linear → sRGB conversion
    const l3 = lab.L + 0.3963 * lab.a + 0.2158 * lab.b;
    const m3 = lab.L - 0.1056 * lab.a - 0.0639 * lab.b;
    const s3 = lab.L - 0.0894 * lab.a - 1.2915 * lab.b;
    
    const l = l3 * l3 * l3;
    const m = m3 * m3 * m3;
    const s = s3 * s3 * s3;
    
    const lr = 4.0767 * l - 3.3077 * m + 0.2309 * s;
    const lg = -1.2684 * l + 2.6097 * m - 0.3413 * s;
    const lb = -0.0041 * l - 0.7034 * m + 1.7076 * s;
    
    return {
      r: Math.round(linearToSRGB(lr) * 255),
      g: Math.round(linearToSRGB(lg) * 255),
      b: Math.round(linearToSRGB(lb) * 255)
    };
  }
  
  static distance(lab1, lab2) {
    return Math.sqrt(
      (lab1.L - lab2.L) ** 2 +
      (lab1.a - lab2.a) ** 2 +
      (lab1.b - lab2.b) ** 2
    );
  }
}

function sRGBToLinear(val) {
  return val <= 0.04045 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
}

function linearToSRGB(val) {
  return val <= 0.0031308 ? val * 12.92 : 1.055 * Math.pow(val, 1/2.4) - 0.055;
}
```

### Bayer Dithering Implementation
```javascript
// src/modules/colorCycle/core/Dithering.js
export class Dithering {
  static BAYER_4x4 = [
    [ 0,  8,  2, 10],
    [12,  4, 14,  6],
    [ 3, 11,  1,  9],
    [15,  7, 13,  5]
  ].map(row => row.map(v => (v / 16) - 0.5));
  
  static BAYER_8x8 = [
    [ 0, 32,  8, 40,  2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44,  4, 36, 14, 46,  6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [ 3, 35, 11, 43,  1, 33,  9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47,  7, 39, 13, 45,  5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21]
  ].map(row => row.map(v => (v / 64) - 0.5));
  
  static applyDithering(indices, width, height, mode) {
    if (mode === 'off') return indices;
    
    const matrix = mode === 'bayer4' ? this.BAYER_4x4 : this.BAYER_8x8;
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
    
    return output;
  }
}
```

### Gradient Extraction Implementation
```javascript
// src/modules/colorCycle/engine/GradientExtractor.js
export class GradientExtractor {
  extractGradient(imageData, options = {}) {
    const {
      numStops = 8,
      mode = 'dominant',
      sortBy = 'hue'
    } = options;
    
    // Step 1: Extract 256 colors
    const palette256 = this.extractPalette(imageData);
    
    // Step 2: Select gradient stops
    const stops = mode === 'dominant' 
      ? this.selectDominantColors(palette256, numStops)
      : this.selectFullRange(palette256, numStops, sortBy);
    
    // Step 3: Build gradient
    return this.buildGradient(stops);
  }
  
  selectDominantColors(palette, numStops) {
    // Count pixel frequency for each palette color
    const frequency = this.countColorUsage(palette);
    
    // Sort by frequency and take top N
    const sorted = palette.sort((a, b) => frequency[b] - frequency[a]);
    const candidates = sorted.slice(0, numStops * 2);
    
    // Remove visually similar colors (ΔE < 10 in OKLab)
    const distinct = [];
    for (const color of candidates) {
      const lab = OKLab.fromRGB(color.r, color.g, color.b);
      if (!distinct.some(c => {
        const cLab = OKLab.fromRGB(c.r, c.g, c.b);
        return OKLab.distance(lab, cLab) < 10;
      })) {
        distinct.push(color);
        if (distinct.length === numStops) break;
      }
    }
    
    return distinct;
  }
  
  selectFullRange(palette, numStops, sortBy) {
    // Sort by chosen method
    const sorted = this.sortPalette(palette, sortBy);
    
    // Pick evenly spaced colors
    const step = Math.floor(256 / numStops);
    const stops = [];
    for (let i = 0; i < numStops; i++) {
      stops.push(sorted[i * step]);
    }
    
    return stops;
  }
  
  sortPalette(palette, method) {
    switch(method) {
      case 'hue':
        return palette.sort((a, b) => {
          const hslA = this.rgbToHsl(a);
          const hslB = this.rgbToHsl(b);
          return hslA.h - hslB.h;
        });
      
      case 'luminance':
        return palette.sort((a, b) => {
          const lumA = 0.299 * a.r + 0.587 * a.g + 0.114 * a.b;
          const lumB = 0.299 * b.r + 0.587 * b.g + 0.114 * b.b;
          return lumA - lumB;
        });
      
      case 'saturation':
        return palette.sort((a, b) => {
          const hslA = this.rgbToHsl(a);
          const hslB = this.rgbToHsl(b);
          return hslB.s - hslA.s;
        });
      
      default:
        return palette;
    }
  }
  
  buildGradient(stops) {
    // Create gradient with normalized positions
    const gradient = {
      stops: []
    };
    
    for (let i = 0; i < stops.length; i++) {
      gradient.stops.push({
        position: i / (stops.length - 1),
        color: stops[i]
      });
    }
    
    return gradient;
  }
}
```

## Conclusion

This feature transforms static artwork into animated color-cycling effects with minimal performance impact through intelligent use of indexed color, precomputation, and optimized rendering. The modular architecture ensures maintainability and reusability while meeting ambitious performance targets across all modern browsers.