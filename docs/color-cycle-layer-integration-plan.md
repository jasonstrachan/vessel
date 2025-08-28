# Color Cycle Layer Integration Plan

## Problem Summary
The color cycle brush currently operates outside the layer system, rendering on top of all layers during animation. This violates layer ordering and breaks undo/redo functionality.

## Current Architecture Issues

### 1. Separate Rendering Pipeline
- **WebGL Canvas**: Persistent, holds all color cycle data
- **Drawing Canvas**: Temporary overlay for current stroke  
- **Main Canvas**: Final composite of all layers
- Color cycle hijacks the drawing canvas for persistent animated content

### 2. Layer System Bypass
- Color cycle renders to a global overlay instead of the active layer
- Animation loop composites color cycle **after** all layers
- No per-layer WebGL context or state management

### 3. Undo System Incompatibility
- WebGL canvas state not captured in undo snapshots
- Only final rasterized result saved via `captureCanvasToActiveLayer()`
- Animation state lost when undoing/redoing

## Proposed Solution Architecture

### Phase 1: Layer-Aware WebGL Rendering
**Goal**: Make the WebGL canvas understand and respect the layer system

#### Implementation Steps:
1. **Extend ColorCycleBrush class**
   - Add `layerId` property to track which layer owns each stroke
   - Modify paint buffer to include layer information
   - Create separate stroke collections per layer

2. **Layer-specific rendering**
   ```typescript
   class ColorCycleBrush {
     private layerStrokes: Map<string, LayerStrokeData> = new Map();
     
     renderForLayer(layerId: string, targetCanvas: HTMLCanvasElement) {
       // Render only strokes belonging to this layer
     }
   }
   ```

3. **Update paint() method**
   - Accept `layerId` parameter
   - Store strokes with layer association
   - Maintain separate gradient layers per canvas layer

### Phase 2: Per-Layer WebGL Management
**Goal**: Each layer gets its own color cycle state

#### Option A: Single WebGL Context, Multiple Render Targets
**Pros**: Memory efficient, single animation loop
**Cons**: Complex state management

1. **Implement render target switching**
   ```typescript
   interface LayerRenderTarget {
     layerId: string;
     frameBuffer: WebGLFramebuffer;
     texture: WebGLTexture;
     strokeData: Uint8Array;
   }
   ```

2. **Modify render() method**
   - Accept target layer ID
   - Bind appropriate framebuffer
   - Render only that layer's strokes

#### Option B: WebGL Context Per Layer (Recommended)
**Pros**: Clean separation, easier state management
**Cons**: Higher memory usage

1. **Create ColorCycleBrush instance per layer**
   ```typescript
   class Layer {
     colorCycleBrush?: ColorCycleBrush;
     
     initColorCycle(width: number, height: number) {
       this.colorCycleBrush = new ColorCycleBrush(canvas, options);
     }
   }
   ```

2. **Lifecycle management**
   - Create brush when layer uses color cycle
   - Destroy when layer deleted
   - Preserve state for undo/redo

### Phase 3: Direct Layer Canvas Updates
**Goal**: Eliminate the drawing canvas overlay for color cycle

#### Implementation Steps:

1. **Remove drawing canvas dependency**
   - Color cycle renders directly to layer canvas
   - No intermediate compositing step

2. **Modify animation loop**
   ```typescript
   function animateColorCycle() {
     layers.forEach(layer => {
       if (layer.hasColorCycle && layer.visible) {
         // Render to layer's canvas directly
         layer.colorCycleBrush.render();
         const ctx = layer.canvas.getContext('2d');
         ctx.drawImage(layer.colorCycleBrush.getCanvas(), 0, 0);
       }
     });
   }
   ```

3. **Update composite function**
   - Layers composite in correct order
   - Color cycle content treated as part of layer, not overlay

### Phase 4: Undo/Redo Support
**Goal**: Full history support for color cycle operations

1. **Serialize WebGL state**
   ```typescript
   interface ColorCycleSnapshot {
     layerId: string;
     strokeData: ArrayBuffer;
     gradients: GradientData[];
     animationState: {
       cycleOffset: number;
       speed: number;
       fps: number;
     };
   }
   ```

2. **Implement save/restore**
   - Save: Extract paint buffers and settings
   - Restore: Recreate WebGL state from snapshot

3. **Optimize storage**
   - Delta compression for stroke data
   - Share gradient data across snapshots
   - Limit history depth for memory

## Implementation Plan

### Week 1: Foundation
- [ ] Create layer-aware stroke storage in ColorCycleBrush
- [ ] Implement layerId tracking for paint operations
- [ ] Add renderForLayer() method

### Week 2: Layer Integration  
- [ ] Implement per-layer ColorCycleBrush instances
- [ ] Update layer creation/deletion logic
- [ ] Modify paint operations to use active layer's brush

### Week 3: Rendering Pipeline
- [ ] Remove drawing canvas usage for color cycle
- [ ] Implement direct layer canvas rendering
- [ ] Update animation loop for per-layer updates

### Week 4: Undo/Redo
- [ ] Design serialization format
- [ ] Implement save/restore methods
- [ ] Integrate with existing undo system

### Week 5: Testing & Optimization
- [ ] Performance profiling
- [ ] Memory usage optimization  
- [ ] Edge case testing
- [ ] User testing

## Technical Considerations

### Performance
- **Memory**: ~4MB per layer with WebGL context
- **CPU**: Negligible overhead for multiple contexts
- **GPU**: Modern GPUs handle multiple contexts well

### Compatibility
- Maintain backward compatibility with existing drawings
- Migration path for old color cycle data
- Graceful degradation for WebGL unsupported

### API Changes
```typescript
// Before
brushEngine.drawColorCycle(ctx, x, y, pressure);

// After  
layer.drawColorCycle(x, y, pressure);
layer.renderColorCycle(); // Per-layer render
```

## Success Metrics
1. Color cycle respects layer ordering
2. Undo/redo fully functional with color cycle
3. No performance regression
4. Clean separation of concerns
5. Maintainable codebase

## Risk Mitigation
- **Risk**: Multiple WebGL contexts exhaust GPU resources
  - **Mitigation**: Implement context pooling, limit to 8 active contexts
  
- **Risk**: Serialization creates large undo snapshots  
  - **Mitigation**: Implement incremental snapshots, compress data

- **Risk**: Breaking changes to existing code
  - **Mitigation**: Feature flag for gradual rollout, maintain legacy path

## Alternative Approach (Simpler)
If the full solution proves too complex:

1. **Single WebGL, Layer Masks**
   - Keep single WebGL context
   - Use stencil buffer or alpha masks for layer separation
   - Render each layer's portion separately

2. **Rasterize on Layer Switch**
   - When switching layers, rasterize color cycle to current layer
   - Start fresh WebGL state for new layer
   - Simpler but loses some animation continuity

## Next Steps
1. Review plan with team
2. Create proof of concept for Option B (WebGL per layer)
3. Benchmark performance impact
4. Begin Phase 1 implementation