import { 
  BrushPreset, 
  BrushComponent, 
  StrokeInput, 
  StrokeResult,
  PerformanceMetrics,
  ComponentType
} from '@/types/brush';

import { SizeModifierComponent } from './components/SizeModifierComponent';
import { AntiAliasingComponent, RenderSettings } from './components/AntiAliasingComponent';
import { PressureHandlerComponent } from './components/PressureHandlerComponent';
import { OpacityModifierComponent } from './components/OpacityModifierComponent';
import { PatternRendererComponent } from './components/PatternRendererComponent';
import { ColorBlendingComponent } from './components/ColorBlendingComponent';
import { SpacingComponent } from './components/SpacingComponent';

/**
 * BrushExecutionEngine - Core engine for processing brush components in priority order
 * Maintains 60fps performance through optimized component execution
 */
export class BrushExecutionEngine {
  private componentCache = new Map<string, any>();
  private performanceMetrics: PerformanceMetrics = {
    componentExecutionTime: 0,
    totalExecutionTime: 0,
    cacheHitRate: 0,
    memoryUsage: 0,
    fps: 60
  };
  
  /**
   * Execute brush preset components for a single stroke input
   */
  execute(preset: BrushPreset, input: StrokeInput, baseColor: string = '#000000'): StrokeResult {
    const startTime = performance.now();
    
    // Sort components by priority for optimal execution order
    const sortedComponents = preset.components
      .filter(c => c.enabled)
      .sort((a, b) => a.priority - b.priority);

    // Initialize result with defaults
    const result: StrokeResult = {
      size: 10,
      opacity: 1,
      color: baseColor, // Use actual brush color instead of hardcoded black
      rotation: 0,
      blendMode: 'normal',
      antialiased: true,
      shouldDraw: true // Default to drawing
    };

    // Execute components in pipeline order
    let processedInput = input;
    
    for (const componentData of sortedComponents) {
      const componentStartTime = performance.now();
      
      try {
        // Get or create component instance
        // Include parameters hash in cache key to handle parameter changes
        const paramsHash = JSON.stringify(componentData.parameters);
        const cacheKey = `${componentData.id}-${componentData.type}-${paramsHash}`;
        let componentInstance = this.componentCache.get(cacheKey);
        
        if (!componentInstance) {
          componentInstance = this.createComponentInstance(componentData);
          this.componentCache.set(cacheKey, componentInstance);
        }
        
        // Execute component based on type
        switch (componentData.type) {
          case ComponentType.PRESSURE_HANDLER:
            if (componentInstance instanceof PressureHandlerComponent) {
              processedInput = { ...processedInput, pressure: componentInstance.execute(input) };
            }
            break;
            
          case ComponentType.SIZE_MODIFIER:
            if (componentInstance instanceof SizeModifierComponent) {
              result.size = componentInstance.execute(processedInput);
            }
            break;
            
          case ComponentType.OPACITY_MODIFIER:
            if (componentInstance instanceof OpacityModifierComponent) {
              result.opacity = componentInstance.execute(processedInput);
            }
            break;
            
          case ComponentType.ANTI_ALIASING:
            if (componentInstance instanceof AntiAliasingComponent) {
              const renderSettings = componentInstance.execute(processedInput);
              result.antialiased = renderSettings.antiAliasing;
            }
            break;
            
          case ComponentType.COLOR_BLENDING:
            if (componentInstance instanceof ColorBlendingComponent) {
              // Set base color and execute color processing
              componentInstance.setBaseColor(baseColor);
              result.color = componentInstance.execute(processedInput);
              result.blendMode = componentInstance.getBlendMode();
            }
            break;
            
          case ComponentType.SPACING:
            if (componentInstance instanceof SpacingComponent) {
              const spacingResult = componentInstance.execute(processedInput);
              result.shouldDraw = spacingResult.shouldDraw;
            }
            break;
            
          default:
            console.warn(`Component type ${componentData.type} not yet implemented`);
        }
      } catch (error) {
        console.error(`Error executing component ${componentData.id}:`, error);
      }
      
      // Track component performance
      const componentTime = performance.now() - componentStartTime;
      if (componentTime > 1) { // >1ms is concerning for 60fps
        console.warn(`Component ${componentData.type} took ${componentTime.toFixed(2)}ms`);
      }
    }

    // Update performance metrics
    this.performanceMetrics.totalExecutionTime = performance.now() - startTime;
    
    return result;
  }

  /**
   * Create component instance from component data
   */
  private createComponentInstance(component: BrushComponent): any {
    switch (component.type) {
      case ComponentType.PRESSURE_HANDLER:
        return new PressureHandlerComponent(component.id, component.parameters as any);
      case ComponentType.SIZE_MODIFIER:
        return new SizeModifierComponent(component.id, component.parameters as any);
      case ComponentType.OPACITY_MODIFIER:
        return new OpacityModifierComponent(component.id, component.parameters as any);
      case ComponentType.ANTI_ALIASING:
        return new AntiAliasingComponent(component.id, component.parameters as any);
      case ComponentType.PATTERN_RENDERER:
        return new PatternRendererComponent(component.id, component.parameters as any);
      case ComponentType.COLOR_BLENDING:
        return new ColorBlendingComponent(component.id, component.parameters as any);
      case ComponentType.SPACING:
        return new SpacingComponent(component);
      // Unsupported component types
      case ComponentType.ROTATION_TRANSFORM:
        console.warn(`Component type ${component.type} not yet implemented`);
        return null;
      default:
        throw new Error(`Unknown component type: ${component.type}`);
    }
  }

  /**
   * Get current performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics {
    return { ...this.performanceMetrics };
  }

  /**
   * Clear component cache (for memory management)
   */
  clearCache(): void {
    this.componentCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hitRate: number } {
    return {
      size: this.componentCache.size,
      hitRate: this.performanceMetrics.cacheHitRate
    };
  }

  /**
   * Validate brush preset for execution
   */
  validatePreset(preset: BrushPreset): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!preset.components || preset.components.length === 0) {
      errors.push('Preset must have at least one component');
    }

    // Check for required component types
    const hasSize = preset.components.some(c => c.type === ComponentType.SIZE_MODIFIER);
    if (!hasSize) {
      errors.push('Preset must have a size component');
    }

    // Validate component priorities
    const priorities = preset.components.map(c => c.priority);
    const duplicatePriorities = priorities.filter((p, i) => priorities.indexOf(p) !== i);
    if (duplicatePriorities.length > 0) {
      errors.push(`Duplicate component priorities: ${duplicatePriorities.join(', ')}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Reset engine state (for new strokes)
   */
  reset(): void {
    // Reset any stateful components
    this.componentCache.forEach(component => {
      if (component && typeof component.reset === 'function') {
        component.reset();
      }
    });
  }
}