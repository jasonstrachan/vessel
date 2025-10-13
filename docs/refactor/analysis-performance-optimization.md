# Vessel Performance Optimization

## Overview
This document details performance bottlenecks identified in Vessel and the optimization strategies implemented to address them.

## Key Performance Issues

### 1. Mouse Up Event Latency
**Problem**: When users release the mouse/stylus, the brush continues painting briefly due to async operations blocking the event handler.

**Root Causes**:
- `captureCanvasToLayer` runs synchronously in the pointer up handler
- `saveCanvasStateDeduped` performs immediate state capture
- Multiple cleanup operations run sequentially

**Impact**: Creates a laggy feel where strokes appear to "stick" after release.

### 2. Custom Brush Performance
**Problem**: Custom brushes feel laggy compared to basic brushes.

**Root Causes**:
- Brush scaling operations are expensive without cache hits
- Memory pressure from ImageData allocations
- Complex pressure calculations on every frame
- Cache key generation overhead

**Impact**: Reduced frame rate and responsiveness when using custom brushes.

## Optimization Strategies

### Mouse Up Event Optimization
1. **Defer Non-Critical Operations**
   - Move `captureCanvasToLayer` to `requestIdleCallback`
   - Defer state saving until after UI updates
   - Use microtasks for cleanup operations

2. **Performance Timing**
   - Add timing measurements to track actual latency
   - Monitor time between pointer up and drawing state change
   - Log slow operations in development mode

### Custom Brush Optimization
1. **Improve Cache Hit Rate**
   - Pre-cache common brush sizes (25%, 50%, 75%, 100%, 150%, 200%)
   - Optimize cache key generation
   - Increase cache size for frequently used brushes

2. **Reduce Memory Pressure**
   - Pool ImageData objects
   - Reuse canvas elements where possible
   - Implement aggressive cleanup for unused brushes

3. **Optimize Rendering Path**
   - Skip unnecessary transformations
   - Use integer coordinates when possible
   - Batch similar operations

## Performance Monitoring

### Metrics to Track
- Mouse up event latency (target: <16ms)
- Custom brush frame time (target: <8ms)
- Cache hit rate (target: >90%)
- Memory usage per brush stroke

### Development Tools
- Performance timing in development mode
- Brush cache statistics
- Memory pressure indicators
- Frame time visualization

## Implementation Details

### Deferred Operations Pattern
```typescript
// Instead of blocking operations in event handlers:
async handlePointerUp() {
  // Immediate UI update
  setIsDrawing(false);
  
  // Defer heavy operations
  requestIdleCallback(() => {
    captureCanvasToLayer();
    saveCanvasState();
  });
}
```

### Cache Optimization
```typescript
// Pre-cache common sizes on brush load
const commonSizes = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0];
commonSizes.forEach(scale => {
  cacheScaledBrush(brush, scale);
});
```

## Future Optimizations

1. **WebGL Acceleration**
   - Move brush rendering to GPU
   - Use texture atlases for custom brushes
   - Implement GPU-based blending

2. **Worker Thread Processing**
   - Offload brush scaling to web workers
   - Parallel brush cache generation
   - Background state serialization

3. **Predictive Caching**
   - Anticipate brush size changes
   - Pre-render based on stroke velocity
   - Adaptive cache sizing

## Testing Performance

### Manual Testing
1. Draw rapid strokes and check for lag on release
2. Use large custom brushes at various sizes
3. Monitor DevTools Performance tab
4. Check memory usage over time

### Automated Testing
- Performance regression tests
- Cache hit rate monitoring
- Memory leak detection
- Frame time assertions