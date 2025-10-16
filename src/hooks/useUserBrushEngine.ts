'use client';

import { useCallback, useRef, useEffect } from 'react';
import { brushRegistry } from '../brushes/BrushRegistry';
import { BrushPlugin, BrushDrawContext } from '../brushes/BrushPlugin';
import { useAppStore } from '../stores/useAppStore';

/**
 * Hook for handling user-created brush plugins
 * Separate from main brush engine to avoid performance impact on default brushes
 */
export const useUserBrushEngine = () => {
  const activeBrushRef = useRef<BrushPlugin | null>(null);
  const lastPointRef = useRef<{ x: number; y: number; pressure: number } | null>(null);
  const strokeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokeCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  const brushSettings = useAppStore((state) => state.tools.brushSettings);

  // Initialize stroke canvas for plugin brushes
  useEffect(() => {
    if (!strokeCanvasRef.current) {
      strokeCanvasRef.current = document.createElement('canvas');
      strokeCtxRef.current = strokeCanvasRef.current.getContext('2d', {
        willReadFrequently: false,
        alpha: true,
      });
    }
  }, []);

  /**
   * Set the active user brush
   */
  const setActiveBrush = useCallback((brushId: string | null) => {
    if (!brushId) {
      activeBrushRef.current = null;
      lastPointRef.current = null;
      return;
    }

    const brush = brushRegistry.activate(brushId);
    activeBrushRef.current = brush;
    lastPointRef.current = null;
  }, []);

  /**
   * Check if a brush ID is a user brush
   */
  const isUserBrush = useCallback((brushId: string): boolean => {
    return brushRegistry.has(brushId);
  }, []);

  /**
   * Start a new stroke
   */
  const startStroke = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    pressure: number = 1
  ) => {
    const brush = activeBrushRef.current;
    if (!brush) return;

    // Validate settings if brush supports it
    if (brush.validateSettings && !brush.validateSettings(brushSettings)) {
      console.warn(`Brush ${brush.id} validation failed for current settings`);
      return;
    }

    // Create draw context
    const context: BrushDrawContext = {
      ctx,
      x,
      y,
      pressure,
      settings: brushSettings,
      lastPoint: null,
    };

    // Draw the first point
    brush.draw(context);
    
    // Store for next point
    lastPointRef.current = { x, y, pressure };
  }, [brushSettings]);

  /**
   * Continue a stroke
   */
  const continueStroke = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    pressure: number = 1
  ) => {
    const brush = activeBrushRef.current;
    const lastPoint = lastPointRef.current;
    if (!brush) return;

    // If brush has optimized line drawing, use it
    if (brush.drawLine && lastPoint) {
      brush.drawLine(ctx, lastPoint.x, lastPoint.y, x, y, brushSettings);
    } else {
      // Otherwise interpolate points
      if (lastPoint) {
        const distance = Math.hypot(x - lastPoint.x, y - lastPoint.y);
        const steps = Math.max(1, Math.floor(distance));
        
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const interpX = lastPoint.x + (x - lastPoint.x) * t;
          const interpY = lastPoint.y + (y - lastPoint.y) * t;
          const interpPressure = lastPoint.pressure + (pressure - lastPoint.pressure) * t;

          const context: BrushDrawContext = {
            ctx,
            x: interpX,
            y: interpY,
            pressure: interpPressure,
            settings: brushSettings,
            lastPoint: i === 0 ? null : { 
              x: lastPoint.x + (x - lastPoint.x) * ((i - 1) / steps),
              y: lastPoint.y + (y - lastPoint.y) * ((i - 1) / steps),
              pressure: lastPoint.pressure + (pressure - lastPoint.pressure) * ((i - 1) / steps)
            },
          };

          brush.draw(context);
        }
      } else {
        // No last point, just draw current
        const context: BrushDrawContext = {
          ctx,
          x,
          y,
          pressure,
          settings: brushSettings,
          lastPoint: null,
        };
        brush.draw(context);
      }
    }

    // Store for next point
    lastPointRef.current = { x, y, pressure };
  }, [brushSettings]);

  /**
   * End a stroke
   */
  const endStroke = useCallback(() => {
    lastPointRef.current = null;
  }, []);

  /**
   * Draw a complete stroke path
   */
  const drawStroke = useCallback((
    ctx: CanvasRenderingContext2D,
    points: Array<{ x: number; y: number; pressure?: number }>
  ) => {
    const brush = activeBrushRef.current;
    if (!brush || points.length === 0) return;

    // Start with first point
    startStroke(ctx, points[0].x, points[0].y, points[0].pressure || 1);

    // Continue with remaining points
    for (let i = 1; i < points.length; i++) {
      continueStroke(ctx, points[i].x, points[i].y, points[i].pressure || 1);
    }

    // End stroke
    endStroke();
  }, [startStroke, continueStroke, endStroke]);

  /**
   * Get the active brush's custom controls
   */
  const getBrushControls = useCallback((): React.ComponentType | null => {
    const brush = activeBrushRef.current;
    if (!brush || !brush.getControls) return null;
    return brush.getControls();
  }, []);

  /**
   * Get performance hints from active brush
   */
  const getPerformanceHints = useCallback(() => {
    const brush = activeBrushRef.current;
    return brush?.performanceHints || null;
  }, []);

  /**
   * Register a new brush
   */
  const registerBrush = useCallback(async (brush: BrushPlugin) => {
    await brushRegistry.register(brush);
  }, []);

  /**
   * Unregister a brush
   */
  const unregisterBrush = useCallback((brushId: string) => {
    return brushRegistry.unregister(brushId);
  }, []);

  /**
   * Get all registered user brushes
   */
  const getAllUserBrushes = useCallback(() => {
    return brushRegistry.getAllMetadata();
  }, []);

  /**
   * Check if current active brush is a user brush
   */
  const hasActiveUserBrush = useCallback((): boolean => {
    return activeBrushRef.current !== null;
  }, []);

  return {
    // Core drawing methods
    startStroke,
    continueStroke,
    endStroke,
    drawStroke,
    
    // Brush management
    setActiveBrush,
    isUserBrush,
    hasActiveUserBrush,
    registerBrush,
    unregisterBrush,
    getAllUserBrushes,
    
    // UI and performance
    getBrushControls,
    getPerformanceHints,
    
    // Direct access to registry (for advanced use)
    registry: brushRegistry,
  };
};
