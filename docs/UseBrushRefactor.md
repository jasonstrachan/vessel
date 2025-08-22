# UseBrushEngine Refactoring Plan

## Problem
`useBrushEngine.ts` is a 5000+ line monolith that violates every principle of maintainable code. It needs to be broken into focused, testable modules.

## Proposed Module Structure

```
src/hooks/brushEngine/
├── constants.ts         # Brush sizes, palettes, configuration
├── types.ts             # All TypeScript interfaces
├── colorUtils.ts        # Color parsing, conversion, mixing
├── dithering.ts         # Dithering algorithms
├── shapeRenderer.ts     # Shape drawing functions
├── customBrush.ts       # Custom brush stamp logic
├── gradientBrushes.ts   # Gradient rendering
├── components.ts        # Brush component system
├── strokeProcessor.ts   # Stroke interpolation & smoothing
└── canvasUtils.ts       # Canvas helper utilities
```

## Implementation Plan

### Phase 1: Extract Pure Functions (Week 1)
**No risk - these have no dependencies**

#### 1.1 Color Utilities
```typescript
// hooks/brushEngine/colorUtils.ts
export const parseColor = (color: string): [number, number, number] => {...}
export const srgbToLinear = (c: number): number => {...}
export const linearToSrgb = (c: number): number => {...}
export const getAverageColor = (colors: string[]): string => {...}
export const snapColorToExtremes = (...) => {...}
```

#### 1.2 Constants & Types
```typescript
// hooks/brushEngine/constants.ts
export const BRUSH_BASE_SIZES = {...};
export const DITHER_PALETTE = [...];

// hooks/brushEngine/types.ts
export interface StrokeInput {...}
export interface RenderSettings {...}
export interface PixelQueue {...}
```

### Phase 2: Extract Algorithms (Week 1-2)
**Low risk - self-contained logic**

#### 2.1 Dithering Module
```typescript
// hooks/brushEngine/dithering.ts
export const applyDithering = (...) => {...}
export const applySierraLiteDither = (...) => {...}
export const selectDiversePalette = (...) => {...}
```

#### 2.2 Stroke Processing
```typescript
// hooks/brushEngine/strokeProcessor.ts
export const calculateSmoothDirection = (...) => {...}
export const calculateSmoothedVelocity = (...) => {...}
export const perfectPixels = (...) => {...}
```

### Phase 3: Factory Pattern for Stateful Operations (Week 2)
**Medium risk - needs careful testing**

```typescript
// strokeProcessor.ts
export const createStrokeProcessor = (tools: ToolsState) => {
  return {
    shouldDrawStamp: (brushSettings, queue, actualSize?) => {...},
    perfectPixels: (ctx, x, y, settings) => {...},
    resetQueue: () => {...}
  };
};
```

### Phase 4: Dependency Injection (Week 3)
**Transform tightly coupled functions**

```typescript
// Before (tightly coupled)
const drawShape = useCallback((ctx, x, y, size) => {
  const { brushSettings } = tools; // Direct access
  // ...
}, [tools]);

// After (loosely coupled)
export const drawShape = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  settings: DrawShapeSettings // Injected
) => {
  // Pure implementation
};
```

### Phase 5: Simplified Main Hook (Week 3-4)
**Final assembly with facade pattern**

```typescript
// useBrushEngine.ts - Now ~200 lines
export const useBrushEngine = () => {
  const { tools, activeBrushComponents } = useAppStore();
  
  // Create module instances
  const strokeProcessor = useMemo(() => 
    createStrokeProcessor(tools), [tools]
  );
  
  const shapeRenderer = useMemo(() => 
    createShapeRenderer(tools.brushSettings), [tools.brushSettings]
  );
  
  // Simplified main function
  const renderBrushStroke = useCallback((ctx, from, to, cursor) => {
    const settings = strokeProcessor.processStroke(from, to, cursor);
    shapeRenderer.render(ctx, settings);
  }, [strokeProcessor, shapeRenderer]);
  
  return {
    renderBrushStroke,
    resetPixelQueue: strokeProcessor.resetQueue,
    // ... other exports
  };
};
```

## Migration Strategy

### Step 1: Parallel Development
1. Create new module structure alongside existing code
2. Import and test each module individually
3. Keep old code as fallback

### Step 2: Feature Flag Testing
```typescript
const USE_MODULAR_BRUSH = process.env.NODE_ENV === 'development';

const brushEngine = USE_MODULAR_BRUSH 
  ? useModularBrushEngine() 
  : useBrushEngine();
```

### Step 3: Gradual Migration
1. Replace one function at a time
2. Run visual regression tests after each change
3. Performance benchmark each module

### Step 4: Cleanup
1. Remove old monolithic code
2. Update all imports
3. Final testing pass

## Testing Plan

### Unit Tests (Per Module)
```typescript
// colorUtils.test.ts
describe('Color Utilities', () => {
  test('parseColor handles hex values', () => {
    expect(parseColor('#FF0000')).toEqual([255, 0, 0]);
  });
  
  test('sRGB conversion is reversible', () => {
    const original = 128;
    const linear = srgbToLinear(original);
    const back = linearToSrgb(linear);
    expect(Math.round(back)).toBe(original);
  });
});
```

### Integration Tests
```typescript
// brushEngine.integration.test.ts
describe('Brush Engine Integration', () => {
  test('renders stroke correctly with all modules', () => {
    const engine = createTestBrushEngine();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    engine.renderBrushStroke(ctx, start, end, cursor);
    
    expect(getCanvasPixels(canvas)).toMatchSnapshot();
  });
});
```

### Performance Benchmarks
```typescript
// benchmarks/brushPerformance.ts
benchmark('Stroke Rendering', () => {
  const iterations = 1000;
  
  console.time('Old Implementation');
  for (let i = 0; i < iterations; i++) {
    oldBrushEngine.renderStroke(...);
  }
  console.timeEnd('Old Implementation');
  
  console.time('New Modular Implementation');
  for (let i = 0; i < iterations; i++) {
    modularBrushEngine.renderStroke(...);
  }
  console.timeEnd('New Modular Implementation');
});
```

## Success Metrics

1. **Code Reduction**: Main hook < 300 lines (from 5000+)
2. **Test Coverage**: > 80% for all modules
3. **Performance**: No regression (< 5% difference)
4. **Maintainability**: Each module < 200 lines
5. **Documentation**: All public functions documented

## Risk Mitigation

1. **Visual Regression**: Screenshot tests for all brush types
2. **Performance**: Benchmark before/after each phase
3. **Rollback Plan**: Feature flags allow instant revert
4. **User Testing**: Beta test with power users before full release

## Timeline

- **Week 1**: Extract pure functions (Phase 1-2)
- **Week 2**: Factory patterns & testing (Phase 3)
- **Week 3**: Dependency injection & main hook (Phase 4-5)
- **Week 4**: Testing, benchmarking, cleanup

## Benefits

1. **Testability**: Pure functions are trivial to test
2. **Maintainability**: Find and fix bugs in isolation
3. **Performance**: Optimize modules independently
4. **Onboarding**: New developers understand focused modules
5. **Reusability**: Share utilities across features