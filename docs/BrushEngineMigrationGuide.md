# Brush Engine Migration Guide

## Overview
This guide explains how to safely migrate from the monolithic brush engine to the new modular implementation.

## Migration Strategy

### Step 1: Parallel Development ✅
- ✅ New module structure created alongside existing code
- ✅ Each module individually tested
- ✅ Old code remains as fallback

### Step 2: Feature Flag Testing 🚧
The system now supports feature flag switching between implementations.

#### Environment Variable Control
Set in `.env.development`:
```bash
# Use new modular implementation
NEXT_PUBLIC_USE_MODULAR_BRUSH=true

# Use old monolithic implementation (default)
NEXT_PUBLIC_USE_MODULAR_BRUSH=false
```

#### Runtime Switching (Development Only)
```javascript
// In browser console
toggleBrushEngineImplementation();
// Then reload the page
```

#### Using the Adapter
```typescript
import { useBrushEngineAdapter } from '@/hooks/useBrushEngineAdapter';

// Automatically uses the right implementation based on feature flag
const brushEngine = useBrushEngineAdapter();
```

### Step 3: Gradual Migration

#### Phase 3.1: Update Import Statements
```typescript
// Old
import { useBrushEngine } from '@/hooks/useBrushEngine';

// New (with adapter)
import { useBrushEngineAdapter } from '@/hooks/useBrushEngineAdapter';
const brushEngine = useBrushEngineAdapter();
```

#### Phase 3.2: Test Each Component
1. Enable modular implementation for one component
2. Run visual regression tests
3. Performance benchmark
4. If issues found, revert and fix

#### Phase 3.3: Performance Comparison
Monitor metrics with the development UI:
- Stroke rendering time
- Memory usage
- Stamp count per stroke

### Step 4: Cleanup
Once all components are migrated and tested:

1. **Remove old code**:
   ```bash
   # Delete old implementation
   rm src/hooks/useBrushEngine.ts
   
   # Rename simplified to main
   mv src/hooks/useBrushEngineSimplified.ts src/hooks/useBrushEngine.ts
   ```

2. **Update all imports**:
   ```typescript
   // Final state - direct import
   import { useBrushEngine } from '@/hooks/useBrushEngine';
   ```

3. **Remove adapter and feature flags**:
   - Delete `useBrushEngineAdapter.ts`
   - Remove environment variables
   - Remove toggle UI component

## Testing Checklist

### Visual Tests
- [ ] Basic brush strokes match
- [ ] Pressure sensitivity works
- [ ] Grid snapping functions
- [ ] Custom brushes render correctly
- [ ] Dithering effects match
- [ ] Shape tools work

### Performance Tests
- [ ] Stroke latency ≤ old implementation
- [ ] Memory usage stable
- [ ] No frame drops during fast strokes
- [ ] Large canvas performance maintained

### Functionality Tests
- [ ] All brush shapes work
- [ ] Color jitter functions
- [ ] Transparency lock works
- [ ] Undo/redo compatible
- [ ] Export/import works

## Development UI

### Toggle Component
Add to your main layout (development only):
```tsx
import { BrushEngineToggle } from '@/components/dev/BrushEngineToggle';

// In your layout
{process.env.NODE_ENV === 'development' && <BrushEngineToggle />}
```

### Performance Monitor
```tsx
import { BrushEnginePerformance } from '@/components/dev/BrushEngineToggle';

// In your layout
{process.env.NODE_ENV === 'development' && <BrushEnginePerformance />}
```

## Rollback Plan

If issues are discovered:

1. **Immediate rollback**:
   ```bash
   NEXT_PUBLIC_USE_MODULAR_BRUSH=false
   ```

2. **Component-specific rollback**:
   ```typescript
   // Force old implementation for specific component
   import { useBrushEngine } from '@/hooks/useBrushEngine';
   // Instead of adapter
   ```

3. **Debug mode**:
   ```typescript
   // Enable detailed logging
   localStorage.setItem('DEBUG_BRUSH_ENGINE', 'true');
   ```

## API Compatibility

The adapter ensures full API compatibility:

| Method | Old Engine | New Engine | Status |
|--------|------------|------------|--------|
| drawBrush | ✅ | ✅ | Compatible |
| resetPixelQueue | ✅ | ✅ | Adapted |
| drawRectangleGradient | ✅ | ✅ | Compatible |
| drawPolygonGradient | ✅ | ✅ | Compatible |
| applyDithering | ✅ | ✅ | Compatible |
| drawCustomBrushLine | ✅ | 🚧 | Stub (needs implementation) |
| drawCustomBrushStamp | ✅ | 🚧 | Stub (needs implementation) |

## Known Differences

### Performance Characteristics
- New engine has slightly lower memory footprint
- Old engine may be faster for very small brushes
- New engine better for large brushes

### Behavioral Differences
- Color jitter may produce slightly different results
- Stroke smoothing algorithm improved in new engine

## Support

### Debugging
```javascript
// Get current implementation status
getBrushEngineStatus();

// Enable verbose logging
localStorage.setItem('BRUSH_ENGINE_DEBUG', 'true');
```

### Common Issues

**Issue**: Page doesn't reflect feature flag change
**Solution**: Always reload after changing flags

**Issue**: Some functions not working in new engine
**Solution**: Check adapter for stub implementations

**Issue**: Performance regression
**Solution**: Use performance monitor to identify bottlenecks

## Timeline

### Week 1 ✅
- Create parallel implementation
- Set up feature flags
- Create adapter layer

### Week 2 (Current)
- Test with feature flags
- Fix any issues found
- Performance optimization

### Week 3
- Migrate first components
- Visual regression testing
- Performance benchmarking

### Week 4
- Complete migration
- Remove old code
- Final testing pass

## Conclusion

The migration path is designed to be:
- **Safe**: Feature flags allow instant rollback
- **Gradual**: Migrate one component at a time
- **Measurable**: Performance metrics for comparison
- **Reversible**: Keep old code until fully validated

Follow this guide to migrate with confidence!