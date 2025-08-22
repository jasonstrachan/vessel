/**
 * Brush Engine Adapter
 * Provides compatibility layer between old and new brush engine implementations
 * Allows feature flag switching without breaking existing code
 */

import { useMemo } from 'react';
import { useBrushEngine } from './useBrushEngine';
import { useBrushEngineSimplified } from './useBrushEngineSimplified';

/**
 * Feature flag to control which implementation to use
 * Can be controlled via environment variable or localStorage
 */
const getFeatureFlag = (): boolean => {
  // Check environment variable first
  if (process.env.NEXT_PUBLIC_USE_MODULAR_BRUSH === 'true') {
    return true;
  }
  
  // Check localStorage for runtime switching (development only)
  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
    const stored = localStorage.getItem('USE_MODULAR_BRUSH');
    if (stored !== null) {
      return stored === 'true';
    }
  }
  
  // Default: use old implementation in production, new in development
  return process.env.NODE_ENV === 'development';
};

/**
 * Adapter that wraps the old engine to accept the new API calls
 */
const adaptOldEngine = (oldEngine: ReturnType<typeof useBrushEngine>) => {
  const adapted = {
    // Copy all existing functions
    ...oldEngine,
    
    // Adapt drawRectangleGradient to accept new API format
    drawRectangleGradient: (
      ctx: CanvasRenderingContext2D,
      startX: number,
      startY: number, 
      endX: number,
      endY: number,
      width: number,
      colors: string[],
      isPreview: boolean = false
    ) => {
      // Convert new API to old RectangleState format
      const rectangleState = {
        startPos: { x: startX, y: startY },
        endPos: { x: endX, y: endY },
        width: width,
        startColor: colors[0] || '#000000',
        endColor: colors[colors.length - 1] || '#000000', 
        colors: colors
      };
      
      return oldEngine.drawRectangleGradient(ctx, rectangleState, isPreview);
    }
  };
  
  return adapted;
};

/**
 * Adapter that wraps the simplified engine to match the old API
 */
const adaptSimplifiedEngine = (simplified: ReturnType<typeof useBrushEngineSimplified>) => {
  const adapted = {
    // Core drawing functions (already compatible)
    drawBrush: simplified.drawBrush,
    drawRectangleGradient: simplified.drawRectangleGradient,
    drawPolygonGradient: simplified.drawPolygonGradient,
    
    // Map renderBrushStroke to drawBrush (old API compatibility)
    renderBrushStroke: (
      ctx: CanvasRenderingContext2D, 
      from: { x: number; y: number }, 
      to: { x: number; y: number }, 
      cursor: { pressure?: number },
      _components?: any
    ) => {
      return simplified.drawBrush(ctx, from, to, cursor);
    },
    
    // Stroke lifecycle functions
    finalizeStroke: simplified.finalizeStroke,
    resetStroke: simplified.resetStroke,
    
    // Adapt resetPixelQueue to match old name
    resetPixelQueue: simplified.resetStroke,
    
    // Effects
    applyDithering: simplified.applyDithering,
    applySierraLiteDither: (imageData: ImageData, numColors: number) => 
      simplified.applyDithering(imageData, numColors, 'sierra-lite'),
    
    // Stubs for functions not yet implemented in simplified version
    executeComponents: () => {
      console.warn('executeComponents not implemented in simplified engine');
      return {};
    },
    
    drawCustomBrushLine: () => {
      console.warn('drawCustomBrushLine not implemented in simplified engine');
    },
    
    drawCustomBrushStamp: () => {
      console.warn('drawCustomBrushStamp not implemented in simplified engine');
    },
    
    // Add any other missing functions as stubs
    // These will be implemented as we migrate more functionality
  };
  
  return adapted;
};

/**
 * Main hook that switches between implementations based on feature flag
 */
export const useBrushEngineAdapter = () => {
  const useModular = useMemo(() => getFeatureFlag(), []);
  
  // Log which implementation is being used (development only) - only once
  // Commented out to reduce console spam
  // if (process.env.NODE_ENV === 'development') {
  //   console.log(`[BrushEngine] Using ${useModular ? 'MODULAR' : 'MONOLITHIC'} implementation`);
  // }
  
  // Get the appropriate engine
  const oldEngine = useBrushEngine();
  const newEngine = useBrushEngineSimplified();
  
  // Return the selected implementation
  return useMemo(() => {
    if (useModular) {
      // Return adapted new engine that matches old API
      return adaptSimplifiedEngine(newEngine);
    } else {
      // Return old engine with adapter to handle new API calls
      return adaptOldEngine(oldEngine);
    }
  }, [useModular, oldEngine, newEngine]);
};

/**
 * Utility to toggle the feature flag at runtime (development only)
 */
export const toggleBrushEngineImplementation = () => {
  if (typeof window === 'undefined' || process.env.NODE_ENV !== 'development') {
    console.warn('Feature flag toggle only available in development');
    return;
  }
  
  const current = localStorage.getItem('USE_MODULAR_BRUSH') === 'true';
  const newValue = !current;
  
  localStorage.setItem('USE_MODULAR_BRUSH', String(newValue));
  console.log(`[BrushEngine] Switched to ${newValue ? 'MODULAR' : 'MONOLITHIC'} implementation`);
  console.log('Reload the page to apply changes');
  
  return newValue;
};

/**
 * Get current implementation status
 */
export const getBrushEngineStatus = () => {
  const useModular = getFeatureFlag();
  return {
    implementation: useModular ? 'modular' : 'monolithic',
    canToggle: process.env.NODE_ENV === 'development',
    environmentFlag: process.env.NEXT_PUBLIC_USE_MODULAR_BRUSH,
    localStorageFlag: typeof window !== 'undefined' 
      ? localStorage.getItem('USE_MODULAR_BRUSH')
      : null
  };
};