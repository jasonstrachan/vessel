# Canvas Performance Optimization Plan

Based on analysis of the Vessel codebase, implementing canvas performance optimizations using MDN best practices. Current implementation has bottlenecks limiting drawing performance to 15-25fps instead of target 60fps.

## Phase 1: Immediate Performance Improvements

### 1. Canvas Object Pooling
- **File**: Create `/src/utils/canvasPool.ts`
- **Purpose**: Eliminate excessive canvas creation/destruction during drawing
- **Impact**: Reduce garbage collection pressure and memory allocation overhead

### 2. Brush Calculation Caching
- **File**: Enhance `/src/hooks/useBrushEngine.ts`
- **Purpose**: Cache expensive brush calculations (pressure effects, scaling, grid positions)
- **Impact**: Reduce CPU overhead for repeated calculations

### 3. Memory Management Improvements
- **Files**: Update `DrawingCanvas.tsx` and `useBrushEngine.ts`
- **Purpose**: Proper cleanup of ImageData objects and temporary canvases
- **Impact**: Prevent memory leaks during extended drawing sessions

## Phase 2: Rendering Optimizations

### 4. Dirty Rectangle Rendering
- **File**: Enhance `/src/components/canvas/DrawingCanvas.tsx`
- **Purpose**: Only redraw changed canvas regions instead of full 2000x2000px redraws
- **Impact**: Dramatically reduce rendering overhead

### 5. RequestAnimationFrame Optimization
- **Files**: `DrawingCanvas.tsx` and `MiniCanvas.tsx`
- **Purpose**: Better frame scheduling and reduced redundant render calls
- **Impact**: Smoother 60fps drawing experience

## Phase 3: Advanced Optimizations

### 6. Layer Compositing Enhancement
- **File**: Update store layer compositing logic
- **Purpose**: Implement efficient layer blending with dirty flags
- **Impact**: Faster multi-layer operations

### 7. Performance Monitoring
- **File**: Create `/src/utils/performanceMonitor.ts`
- **Purpose**: Track FPS, memory usage, and render times
- **Impact**: Data-driven optimization validation

## Implementation Strategy

1. **Start with canvas pooling** - immediate wins with low risk
2. **Add brush caching** - significant performance boost for complex brushes  
3. **Implement dirty rectangle rendering** - major rendering performance improvement
4. **Add performance monitoring** - validate improvements and identify remaining bottlenecks

Expected improvements: 3-4x FPS increase, 50-70% memory usage reduction, and 2-3x faster custom brush rendering.