# Canvas Integration Plan - Modular Brush Engine

## Overview
Integration plan for connecting the completed modular brush engine with TinyBrush's P5.js canvas drawing system, maintaining 60fps performance requirements.

## Research Summary

### Current System Analysis
- **P5.js-React Hybrid**: Uses custom `useP5` hook with DOM event override
- **Frame-based Rendering**: 16.67ms frame budget with `requestAnimationFrame` batching
- **Performance Optimizations**: Canvas pooling, rotation cache, context property cache
- **Integration Point**: `performDrawAction` function (Line 1808 in DrawingCanvas.tsx)

### Performance Requirements
- **Frame Budget**: 16.67ms total (60fps)
- **Component Budget**: <1ms per component execution
- **Memory Constraints**: Avoid allocations during drawing operations
- **Caching Strategy**: Leverage existing rotation cache and context property cache

## Integration Strategy

### Phase 1: Foundation Integration ⚡ LOW RISK
**Objective**: Replace basic brush calculations with modular components while maintaining 60fps

#### 1.1 Component Pipeline Integration
**Target**: `DrawingCanvas.tsx` Line 1808 `performDrawAction`
```typescript
// Current implementation
const performDrawAction = (p5Instance: any, isDragging: boolean, x: number, y: number) => {
  // Replace brush calculations with modular engine
  const strokeInput = createStrokeInput(x, y, pressure, velocity);
  const strokeResult = brushEngine.execute(selectedPreset, strokeInput);
  applyStrokeResult(strokeResult, p5Instance);
}
```

#### 1.2 Basic Component Implementation
**Priority Order** (based on performance impact):
1. **SizeModifierComponent** - Simple math, existing size logic
2. **OpacityModifierComponent** - Existing opacity handling
3. **PressureHandlerComponent** - Existing pressure sensitivity
4. **AntiAliasingComponent** - Existing pixel-perfect mode

#### 1.3 State Bridge Implementation
**Target**: Connect `useAppStore` brush settings to modular presets
```typescript
const createBrushPresetFromSettings = (settings: BrushSettings): BrushPreset => {
  return {
    id: 'current',
    name: 'Current Brush',
    components: [
      { type: ComponentType.SIZE_MODIFIER, parameters: { baseSize: settings.size } },
      { type: ComponentType.OPACITY_MODIFIER, parameters: { baseOpacity: settings.opacity } },
      // ... map other settings
    ]
  };
};
```

### Phase 2: Advanced Components 🎨 MEDIUM RISK
**Objective**: Integrate pattern and spacing components with performance validation

#### 2.1 Pattern Rendering Integration
**Challenge**: Custom brush integration with `PatternRendererComponent`
**Strategy**: Leverage existing custom brush canvas pool
```typescript
// Map existing custom brushes to pattern components
const customBrushToPattern = (customBrush: any): PatternParams => {
  return {
    patternType: 'texture',
    textureImage: customBrush.canvas,
    patternScale: 1.0
  };
};
```

#### 2.2 Spacing Controller Integration  
**Challenge**: Replace existing distance-based spacing
**Strategy**: Preserve frame-based queuing, enhance spacing logic
```typescript
// Integrate with existing drawing queue
const processDrawingFrame = () => {
  operations.forEach(op => {
    const spacingResult = spacingComponent.execute(createStrokeInput(op));
    if (spacingResult.shouldDraw) {
      performBrushOperation(op);
    }
  });
};
```

### Phase 3: Performance Optimization 🚀 HIGH RISK
**Objective**: Implement caching and performance monitoring

#### 3.1 Component Result Caching
**Implementation**: `ComponentCache.ts`
```typescript
class ComponentCache {
  private cache = new Map<string, Map<string, any>>();
  
  getCachedResult(componentType: ComponentType, input: StrokeInput): any | null {
    const typeCache = this.cache.get(componentType);
    if (!typeCache) return null;
    
    const key = this.createCacheKey(input);
    return typeCache.get(key) || null;
  }
}
```

#### 3.2 Performance Monitoring
**Implementation**: `PerformanceMonitor.ts`
```typescript
class PerformanceMonitor {
  private frameStartTime = 0;
  private componentTimes = new Map<ComponentType, number[]>();
  
  startFrame(): void {
    this.frameStartTime = performance.now();
  }
  
  trackComponentExecution(component: ComponentType, executionTime: number): void {
    if (executionTime > 1.0) { // >1ms warning
      console.warn(`Component ${component} exceeded budget: ${executionTime.toFixed(2)}ms`);
    }
  }
}
```

## Implementation Plan

### Step 1: Create Integration Foundation
```bash
# Files to create/modify
src/engine/CanvasIntegration.ts        # Bridge between engine and canvas
src/utils/StrokeInputFactory.ts       # Convert canvas events to StrokeInput
src/utils/StrokeResultRenderer.ts     # Apply StrokeResult to P5.js canvas
```

### Step 2: Modify DrawingCanvas.tsx
```typescript
// Integration points (specific line numbers)
Line 1808: performDrawAction()        # Main integration point
Line 1831: Brush property calculation # Replace with component pipeline
Line 1849: Drawing operation         # Apply component results
Line 244:  Drawing queue processing  # Maintain frame-based batching
```

### Step 3: State Management Bridge
```typescript
// Files to modify
src/stores/useAppStore.ts             # Add modular preset state
src/hooks/useBrushEngine.ts           # New hook for engine management
```

### Step 4: Performance Integration
```typescript
// Files to create
src/engine/ComponentCache.ts          # Component result caching
src/engine/PerformanceMonitor.ts      # 60fps monitoring
src/engine/BrushEnginePool.ts         # Engine instance pooling
```

## Risk Assessment & Mitigation

### Low Risk ✅
- **Size/Opacity/Pressure components**: Direct replacement of existing logic
- **Basic component pipeline**: Single component execution path
- **State bridge**: Mapping existing settings to component parameters

### Medium Risk ⚠️  
- **Pattern component integration**: Complex custom brush handling
- **Spacing component**: Distance calculation performance
- **Component caching**: Memory management overhead

### High Risk ❌
- **Frame budget violations**: Component pipeline taking >16ms
- **Memory allocations**: Object creation during drawing operations  
- **Cache invalidation**: Stale cache causing visual artifacts

### Mitigation Strategies
1. **Incremental Integration**: Add components one at a time with validation
2. **Performance Checkpoints**: Measure frame times at each step
3. **Fallback Implementation**: Keep existing brush system as backup
4. **Component Budget Limits**: Hard limits on component execution time

## Success Criteria

### Phase 1 ✅
- [ ] Basic components (Size, Opacity, Pressure) integrated
- [ ] 60fps maintained during basic brush operations
- [ ] No regression in existing brush functionality
- [ ] Build passes without errors

### Phase 2 ✅
- [ ] Pattern and Spacing components integrated
- [ ] Custom brushes work with pattern renderer
- [ ] Advanced brush features (dotted, rotation) preserved
- [ ] Performance monitoring implemented

### Phase 3 ✅
- [ ] Component caching operational
- [ ] Frame budget monitoring active
- [ ] Performance metrics show <1ms component execution
- [ ] All existing brushes work with modular system

## Timeline

### Week 1: Foundation (Phase 1)
- Days 1-2: Create integration bridge files
- Days 3-4: Integrate basic components (Size, Opacity, Pressure)
- Day 5: Validation and performance testing

### Week 2: Advanced Features (Phase 2)  
- Days 1-2: Pattern component integration
- Days 3-4: Spacing component integration
- Day 5: Custom brush compatibility testing

### Week 3: Optimization (Phase 3)
- Days 1-2: Component caching implementation
- Days 3-4: Performance monitoring and optimization
- Day 5: Full system validation and documentation

## Validation Checkpoints

### After Each Component Integration
```bash
# Performance validation commands
npm run build                    # Ensure no TypeScript errors
npm run dev                      # Manual testing with drawing
# Test drawing performance with different brush sizes
# Monitor browser DevTools Performance tab
# Verify 60fps during intensive drawing operations
```

### Frame Rate Validation
```typescript
// Add to DrawingCanvas.tsx for testing
const measureFrameRate = () => {
  const startTime = performance.now();
  requestAnimationFrame(() => {
    const frameTime = performance.now() - startTime;
    if (frameTime > 16.67) {
      console.warn(`Frame exceeded budget: ${frameTime.toFixed(2)}ms`);
    }
  });
};
```

---
**Following CLAUDE.md Protocol**: Research ✅ → Plan ✅ → **Seek Approval** → Implement