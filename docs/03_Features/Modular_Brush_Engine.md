# Modular Brush Engine

## Purpose
The Modular Brush Engine provides a sophisticated, performance-optimized system for creating, managing, and applying brush effects. The engine separates brush behavior into modular components that can be mixed, matched, and reused across different brush types while maintaining 60fps performance.

## Engine Architecture

### Brush Component System
**Purpose**: Break down brush behavior into independent, reusable modules.

```typescript
interface BrushComponent {
  id: string;                    // Unique component identifier
  type: ComponentType;           // Size, opacity, pattern, spacing, etc.
  parameters: ComponentParams;   // Component-specific settings
  priority: number;              // Execution order (0-100)
  enabled: boolean;              // Component active state
}

enum ComponentType {
  SIZE_MODIFIER = 'size',        // Size calculation and variation
  OPACITY_MODIFIER = 'opacity',  // Opacity and transparency effects
  PATTERN_RENDERER = 'pattern',  // Brush pattern and texture
  SPACING_CONTROLLER = 'spacing', // Stroke spacing and distribution
  PRESSURE_HANDLER = 'pressure', // Pressure sensitivity simulation
  ANTI_ALIASING = 'antialiasing', // Pixel vs antialiased rendering
  COLOR_BLENDING = 'blending',   // Color mixing and blend modes
  ROTATION_TRANSFORM = 'rotation' // Brush rotation and orientation
}
```

### Component Composition Pipeline
**Execution Flow**: Components execute in priority order to build final brush behavior.

```
Input (Mouse/Tablet) → Component Pipeline → Final Brush Stroke
                           ↓
┌─────────────────────────────────────────────────────────┐
│  Component Execution Pipeline (Priority Order)          │
├─────────────────────────────────────────────────────────┤
│  1. Pressure Handler (Read tablet/mouse input)          │
│  2. Size Modifier (Calculate final brush size)          │
│  3. Opacity Modifier (Apply transparency effects)       │
│  4. Spacing Controller (Determine stroke distribution)  │
│  5. Anti-aliasing (Set pixel/smooth rendering mode)     │
│  6. Pattern Renderer (Apply brush texture/pattern)      │
│  7. Rotation Transform (Apply brush orientation)        │
│  8. Color Blending (Final color mixing and output)      │
└─────────────────────────────────────────────────────────┘
                           ↓
                   Rendered Stroke
```

## Core Brush Components

### Size Modifier Component
**Purpose**: Calculate final brush size with pressure sensitivity and variation.

```typescript
interface SizeModifierParams {
  baseSize: number;              // Base brush size (1-1000px)
  pressureInfluence: number;     // Pressure effect on size (0-1)
  minSize: number;               // Minimum size limit
  maxSize: number;               // Maximum size limit
  variationAmount: number;       // Random size variation (0-1)
  variationSeed: number;         // Random seed for consistency
}

class SizeModifierComponent implements BrushComponent {
  execute(input: StrokeInput): number {
    const pressure = input.pressure || 0.5;
    const variation = this.calculateVariation(input.position);
    
    return Math.max(
      this.params.minSize,
      Math.min(
        this.params.maxSize,
        this.params.baseSize * 
        (1 + (pressure - 0.5) * this.params.pressureInfluence) *
        (1 + variation * this.params.variationAmount)
      )
    );
  }
}
```

### Anti-aliasing Component
**Purpose**: Control pixel-perfect vs antialiased rendering per brush.

```typescript
interface AntiAliasingParams {
  mode: 'pixel' | 'antialiased'; // Rendering mode
  pixelAlignment: boolean;        // Snap to pixel grid
  edgeSharpness: number;         // Edge sharpness control (0-1)
  subpixelPrecision: boolean;    // Subpixel positioning
}

class AntiAliasingComponent implements BrushComponent {
  execute(input: StrokeInput): RenderSettings {
    if (this.params.mode === 'pixel') {
      return {
        antiAliasing: false,
        pixelAlignment: true,
        smoothing: false,
        snapToGrid: true
      };
    } else {
      return {
        antiAliasing: true,
        pixelAlignment: false,
        smoothing: true,
        edgeSharpness: this.params.edgeSharpness
      };
    }
  }
}
```

### Pressure Handler Component
**Purpose**: Process tablet/mouse input and simulate natural pressure curves.

```typescript
interface PressureHandlerParams {
  inputSource: 'mouse' | 'tablet'; // Input device type
  pressureCurve: number[];          // Pressure response curve
  velocityInfluence: number;        // Mouse velocity to pressure (0-1)
  smoothing: number;                // Pressure smoothing factor (0-1)
  minimumPressure: number;          // Minimum pressure value
}

class PressureHandlerComponent implements BrushComponent {
  private pressureHistory: number[] = [];
  
  execute(input: StrokeInput): number {
    let pressure = input.pressure;
    
    if (this.params.inputSource === 'mouse') {
      // Simulate pressure from mouse velocity
      pressure = this.calculateVelocityPressure(input.velocity);
    }
    
    // Apply pressure curve
    pressure = this.applyPressureCurve(pressure);
    
    // Smooth pressure changes
    pressure = this.smoothPressure(pressure);
    
    return Math.max(this.params.minimumPressure, pressure);
  }
}
```

### Pattern Renderer Component
**Purpose**: Apply brush textures, patterns, and custom brush stamps.

```typescript
interface PatternRendererParams {
  patternType: 'solid' | 'texture' | 'custom'; // Pattern type
  patternData: ImageData | null;               // Custom pattern data
  patternScale: number;                        // Pattern scale factor
  patternRotation: number;                     // Pattern rotation angle
  patternOpacity: number;                      // Pattern opacity
  blendMode: string;                           // Pattern blend mode
}

class PatternRendererComponent implements BrushComponent {
  private patternCache: Map<string, HTMLCanvasElement> = new Map();
  
  execute(input: StrokeInput): PatternResult {
    if (this.params.patternType === 'custom' && this.params.patternData) {
      const cachedPattern = this.getCachedPattern(
        this.params.patternData,
        this.params.patternScale,
        this.params.patternRotation
      );
      
      return {
        pattern: cachedPattern,
        opacity: this.params.patternOpacity,
        blendMode: this.params.blendMode
      };
    }
    
    return { pattern: null, opacity: 1, blendMode: 'normal' };
  }
}
```

## Brush Preset System

### Preset Management
**Purpose**: Organize and manage collections of brush components as reusable presets.

```typescript
interface BrushPreset {
  id: string;                    // Unique preset identifier
  name: string;                  // Display name
  category: string;              // Preset category (Pixel, Digital, Traditional)
  components: BrushComponent[];  // Component configuration
  thumbnail: string;             // Base64 thumbnail preview
  tags: string[];                // Search tags
  isDefault: boolean;            // System default preset
  createdAt: Date;               // Creation timestamp
  modifiedAt: Date;              // Last modification
}

// Example brush presets
const PRESET_PIXEL_1PX: BrushPreset = {
  id: 'pixel-1px',
  name: '1px Pixel Brush',
  category: 'Pixel Art',
  components: [
    { type: 'size', params: { baseSize: 1, pressureInfluence: 0 } },
    { type: 'antialiasing', params: { mode: 'pixel', pixelAlignment: true } },
    { type: 'spacing', params: { spacingMode: 'pixel-perfect' } },
    { type: 'opacity', params: { baseOpacity: 1, pressureInfluence: 0 } }
  ],
  tags: ['pixel', 'precise', '1px'],
  isDefault: true
};

const PRESET_SOFT_ROUND: BrushPreset = {
  id: 'soft-round',
  name: 'Soft Round Brush',
  category: 'Digital Painting',
  components: [
    { type: 'size', params: { baseSize: 20, pressureInfluence: 0.8 } },
    { type: 'antialiasing', params: { mode: 'antialiased', edgeSharpness: 0.3 } },
    { type: 'pressure', params: { pressureCurve: [0, 0.2, 0.8, 1] } },
    { type: 'opacity', params: { baseOpacity: 0.8, pressureInfluence: 0.6 } }
  ],
  tags: ['soft', 'painting', 'pressure'],
  isDefault: true
};
```

### Component Transfer System
**Purpose**: Allow users to copy components between brushes for rapid customization.

```typescript
class ComponentTransferSystem {
  // Copy specific components from one brush to another
  transferComponents(
    sourceBrush: BrushPreset,
    targetBrush: BrushPreset,
    componentTypes: ComponentType[]
  ): BrushPreset {
    const newComponents = [...targetBrush.components];
    
    componentTypes.forEach(type => {
      const sourceComponent = sourceBrush.components.find(c => c.type === type);
      if (sourceComponent) {
        // Remove existing component of same type
        const existingIndex = newComponents.findIndex(c => c.type === type);
        if (existingIndex >= 0) {
          newComponents[existingIndex] = { ...sourceComponent };
        } else {
          newComponents.push({ ...sourceComponent });
        }
      }
    });
    
    return {
      ...targetBrush,
      components: newComponents,
      modifiedAt: new Date()
    };
  }
  
  // Create brush template from component selection
  createTemplate(components: BrushComponent[]): BrushTemplate {
    return {
      id: generateId(),
      name: 'Custom Template',
      components: components.map(c => ({ ...c })),
      isTemplate: true
    };
  }
}
```

## Performance Optimization

### Component Caching
**Purpose**: Cache expensive component calculations for 60fps performance.

```typescript
class ComponentCache {
  private cache: Map<string, any> = new Map();
  private maxCacheSize = 1000;
  
  getCached<T>(key: string, calculator: () => T): T {
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }
    
    const result = calculator();
    
    // Manage cache size
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, result);
    return result;
  }
  
  // Cache pattern rotations for performance
  getCachedRotation(pattern: ImageData, angle: number): HTMLCanvasElement {
    const key = `rotation-${pattern.width}x${pattern.height}-${angle}`;
    return this.getCached(key, () => this.rotatePattern(pattern, angle));
  }
}
```

### Execution Pipeline Optimization
**Purpose**: Optimize component execution order for maximum performance.

```typescript
class BrushExecutionEngine {
  private componentCache = new ComponentCache();
  
  execute(brush: BrushPreset, input: StrokeInput): BrushStroke {
    // Sort components by priority for optimal execution order
    const sortedComponents = brush.components
      .filter(c => c.enabled)
      .sort((a, b) => a.priority - b.priority);
    
    let strokeData: any = { input };
    
    // Execute components in pipeline
    for (const component of sortedComponents) {
      const startTime = performance.now();
      
      strokeData = this.executeComponent(component, strokeData);
      
      // Monitor component performance
      const executionTime = performance.now() - startTime;
      if (executionTime > 1) { // >1ms is concerning for 60fps
        console.warn(`Component ${component.type} took ${executionTime}ms`);
      }
    }
    
    return strokeData;
  }
  
  private executeComponent(component: BrushComponent, data: any): any {
    // Use caching for expensive operations
    const cacheKey = `${component.type}-${JSON.stringify(component.parameters)}`;
    
    if (component.type === 'pattern' || component.type === 'rotation') {
      return this.componentCache.getCached(cacheKey, () => 
        component.execute(data)
      );
    }
    
    return component.execute(data);
  }
}
```

## Custom Brush Creation

### Canvas Selection to Brush
**Purpose**: Create custom brushes from canvas selections with layer options.

```typescript
interface CustomBrushCreation {
  sourceSelection: SelectionArea;     // Canvas selection area
  layerSource: 'selected' | 'all';   // Layer inclusion mode
  brushSize: number;                  // Final brush size
  centerPoint: { x: number; y: number }; // Brush center point
  autoTrim: boolean;                  // Remove transparent edges
}

class CustomBrushFactory {
  createFromSelection(params: CustomBrushCreation): BrushPreset {
    // Extract pixel data from selection
    const pixelData = this.extractSelectionData(
      params.sourceSelection,
      params.layerSource
    );
    
    // Process brush pattern
    const processedPattern = this.processBrushPattern(pixelData, {
      autoTrim: params.autoTrim,
      centerPoint: params.centerPoint,
      targetSize: params.brushSize
    });
    
    // Create brush components
    const components: BrushComponent[] = [
      {
        type: 'pattern',
        params: {
          patternType: 'custom',
          patternData: processedPattern,
          patternScale: 1,
          patternRotation: 0
        },
        priority: 60,
        enabled: true
      },
      {
        type: 'size',
        params: {
          baseSize: params.brushSize,
          pressureInfluence: 0.5
        },
        priority: 20,
        enabled: true
      }
    ];
    
    return {
      id: generateId(),
      name: 'Custom Brush',
      category: 'Custom',
      components,
      thumbnail: this.generateThumbnail(processedPattern),
      tags: ['custom'],
      isDefault: false,
      createdAt: new Date(),
      modifiedAt: new Date()
    };
  }
}
```

## Brush Library Management

### Organization System
**Purpose**: Efficiently organize and search extensive brush collections.

```typescript
interface BrushLibrary {
  categories: BrushCategory[];       // Organized categories
  searchIndex: Map<string, string[]>; // Tag-based search
  recentBrushes: string[];          // Recently used brush IDs
  favorites: string[];              // Favorite brush IDs
  customBrushes: string[];          // User-created brushes
}

class BrushLibraryManager {
  private library: BrushLibrary;
  
  // Organize brushes into categories
  organizeByCategory(): BrushCategory[] {
    return [
      { name: 'Pixel Art', brushes: this.getPixelBrushes() },
      { name: 'Digital Painting', brushes: this.getDigitalBrushes() },
      { name: 'Traditional Media', brushes: this.getTraditionalBrushes() },
      { name: 'Custom', brushes: this.getCustomBrushes() },
      { name: 'Recent', brushes: this.getRecentBrushes() },
      { name: 'Favorites', brushes: this.getFavoriteBrushes() }
    ];
  }
  
  // Search brushes by tags and properties
  searchBrushes(query: string): BrushPreset[] {
    const searchTerms = query.toLowerCase().split(' ');
    const results: Set<string> = new Set();
    
    searchTerms.forEach(term => {
      const matches = this.library.searchIndex.get(term) || [];
      matches.forEach(id => results.add(id));
    });
    
    return Array.from(results).map(id => this.getBrushById(id));
  }
  
  // Performance monitoring for brush operations
  measureBrushPerformance(brushId: string): PerformanceMetrics {
    const brush = this.getBrushById(brushId);
    const metrics = {
      componentCount: brush.components.length,
      estimatedExecutionTime: this.estimateExecutionTime(brush),
      memoryUsage: this.estimateMemoryUsage(brush),
      cacheHitRate: this.getCacheHitRate(brushId)
    };
    
    return metrics;
  }
}
```

## Integration with Drawing System

### Real-time Brush Application
**Purpose**: Apply modular brush effects during drawing with 60fps performance.

```typescript
class DrawingIntegration {
  private brushEngine = new BrushExecutionEngine();
  private activePreset: BrushPreset;
  
  // Apply brush during stroke
  applyBrushStroke(points: StrokePoint[]): void {
    const batchSize = 10; // Process points in batches for 60fps
    
    for (let i = 0; i < points.length; i += batchSize) {
      const batch = points.slice(i, i + batchSize);
      
      requestAnimationFrame(() => {
        batch.forEach(point => {
          const strokeResult = this.brushEngine.execute(
            this.activePreset,
            point
          );
          this.renderStrokePoint(strokeResult);
        });
      });
    }
  }
  
  // Switch brush presets without affecting existing strokes
  switchBrush(newPreset: BrushPreset): void {
    this.activePreset = newPreset;
    // No effect on already-drawn pixels
    this.updateBrushCursor(newPreset);
  }
}
```

---

*The Modular Brush Engine provides a sophisticated foundation for TinyBrush's extensive brush system while maintaining 60fps performance through optimized component architecture and intelligent caching strategies.*