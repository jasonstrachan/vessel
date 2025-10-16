# Vessel Brush Performance Optimization Plan

## Performance Analysis Summary

The brush system has excellent features but suffers from critical performance bottlenecks:

- **Canvas Creation Storm**: 100-500 new canvases created per minute during drawing
- **Full Canvas Rerendering**: Entire 2000x2000px canvas redrawn every mouse move 
- **FPS Issues**: Currently 15-25fps, targeting 60fps
- **Memory Leaks**: Temporary objects accumulating without cleanup

**All features will be preserved**: pressure sensitivity, rotation, custom brushes, grid snapping, etc.

## Critical Performance Fixes (Immediate Implementation)

### Step 1: Canvas Pool Implementation
**Target**: Eliminate canvas creation storm (100-500 creations/min → ~10 reused canvases)

#### 1.1 Create Canvas Pool Class
**File**: `src/utils/canvasPool.ts`
```typescript
class CanvasPool {
  private pool: HTMLCanvasElement[] = [];
  private maxSize = 10;
  
  acquire(width: number, height: number): HTMLCanvasElement {
    const canvas = this.pool.pop() || document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  
  release(canvas: HTMLCanvasElement) {
    if (this.pool.length < this.maxSize) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      this.pool.push(canvas);
    }
  }
}

export const canvasPool = new CanvasPool();
```

#### 1.2 Update useBrushEngine.ts
**Lines to modify**: 741-782 (custom brush rendering)
- Replace `document.createElement('canvas')` with `canvasPool.acquire()`
- Add `canvasPool.release()` after canvas usage
- Preserve all existing brush logic

#### 1.3 Update DrawingCanvas.tsx  
**Lines to modify**: 425-434 (selection operations)
- Replace canvas creation with pool usage
- Add proper cleanup after operations

**Verification**:
- Monitor canvas creation count (should drop to ~10 total)
- Check memory usage during extended drawing sessions
- Ensure custom brushes still work perfectly

### Step 2: Brush Calculation Caching
**Target**: Eliminate redundant pressure/rotation/scaling calculations

#### 2.1 Create Brush Cache System
**File**: `src/utils/brushCache.ts`
```typescript
interface CachedBrushData {
  scaleFactor: number;
  gridDimensions: { width: number; height: number };
  actualSize: number;
  rotation: number;
  timestamp: number;
}

class BrushCache {
  private cache = new Map<string, CachedBrushData>();
  private maxAge = 5000; // 5 seconds
  
  getCacheKey(pressure: number, rotation: number, size: number, gridSpacing: number): string {
    return `${pressure.toFixed(2)}_${rotation.toFixed(1)}_${size}_${gridSpacing}`;
  }
  
  get(key: string): CachedBrushData | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.maxAge) {
      return cached;
    }
    if (cached) this.cache.delete(key);
    return null;
  }
  
  set(key: string, data: Omit<CachedBrushData, 'timestamp'>) {
    this.cache.set(key, { ...data, timestamp: Date.now() });
  }
}

export const brushCache = new BrushCache();
```

#### 2.2 Update useBrushEngine.ts Calculations
**Lines to modify**: 797-1165 (brush calculation functions)
- Add cache lookup before expensive calculations
- Cache results for identical input parameters
- Preserve all calculation accuracy

**Verification**:
- CPU usage should drop during continuous drawing
- Identical brush strokes should render faster
- All pressure/rotation effects preserved

### Step 3: Memory Cleanup Implementation
**Target**: Prevent memory accumulation during long sessions

#### 3.1 Add ImageData Cleanup
**File**: `src/hooks/useBrushEngine.ts`
- Track temporary ImageData objects
- Add cleanup on component unmount
- Implement periodic cleanup during idle periods

#### 3.2 Add Canvas Context Cleanup
- Clear contexts after temporary operations
- Reset transform matrices to identity
- Release context references properly

**Verification**:
- Memory usage stays stable over 30+ minute sessions
- No memory leaks in DevTools profiler
- Drawing performance doesn't degrade over time

### Step 4: Dirty Rectangle Rendering
**Target**: 60fps stable performance (currently 15-25fps)

#### 4.1 Track Changed Regions
**File**: `src/components/DrawingCanvas.tsx`
```typescript
interface DirtyRect {
  x: number;
  y: number; 
  width: number;
  height: number;
}

const trackDirtyRegion = (x: number, y: number, brushSize: number) => {
  const margin = brushSize * 2;
  return {
    x: x - margin,
    y: y - margin,
    width: brushSize + margin * 2,
    height: brushSize + margin * 2
  };
};
```

#### 4.2 Optimize Canvas Rendering
**Lines to modify**: 361-491 (renderView function)
- Only clear and redraw changed regions
- Skip unchanged background elements
- Preserve layer compositing accuracy

**Verification**:
- Achieve stable 60fps during drawing
- Background elements don't flicker
- All visual effects remain pixel-perfect

## Implementation Order & Testing

### Phase 1 (Day 1): Canvas Pool
1. Create canvasPool.ts
2. Update useBrushEngine.ts custom brush code
3. Test custom brush performance and functionality
4. Verify memory usage improvement

### Phase 2 (Day 2): Brush Caching  
1. Create brushCache.ts
2. Update calculation functions in useBrushEngine.ts
3. Test pressure/rotation accuracy
4. Verify CPU usage reduction

### Phase 3 (Day 3): Memory Cleanup
1. Add cleanup functions to useBrushEngine.ts
2. Implement periodic cleanup
3. Test long-duration drawing sessions
4. Verify stable memory usage

### Phase 4 (Day 4): Dirty Rectangle Rendering
1. Add dirty region tracking
2. Update renderView function in DrawingCanvas.tsx
3. Test frame rate improvements
4. Verify visual accuracy

## Success Metrics

- **FPS**: 15-25fps → 60fps sustained
- **Memory**: 50-70% reduction in temporary allocations  
- **Custom Brushes**: 2-3x faster rendering
- **CPU Usage**: Significant reduction during drawing
- **All Features Preserved**: Pressure, rotation, custom brushes, grid snapping

## Risk Mitigation

- Implement each step independently
- Test thoroughly before proceeding
- Maintain pixel-perfect drawing accuracy
- Preserve all existing brush behaviors
- Add performance monitoring for regressions