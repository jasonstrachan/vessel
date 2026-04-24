'use client';

import { debugWarn } from '@/utils/debug';
import { useCallback, useRef, useEffect } from 'react';
import { BrushRegistry } from '../brushes/BrushRegistry';
import { BrushPlugin, BrushDrawContext } from '../brushes/BrushPlugin';
import { useAppStore } from '../stores/useAppStore';

const resolveRuntimeBrushSettings = (
  settings: ReturnType<typeof useAppStore.getState>['tools']['brushSettings'],
  ctx: CanvasRenderingContext2D
) => ({
  ...settings,
  blendMode: ctx.globalCompositeOperation,
});

/**
 * Hook for handling user-created brush plugins
 * Separate from main brush engine to avoid performance impact on default brushes
 */
export const useUserBrushEngine = () => {
  const registryRef = useRef<BrushRegistry>(new BrushRegistry());
  const activeBrushRef = useRef<BrushPlugin | null>(null);
  const lastPointRef = useRef<{ x: number; y: number; pressure: number } | null>(null);
  const strokePointCountRef = useRef(0);
  const lastDrawAtRef = useRef(0);
  const strokeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokeCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  const { tools } = useAppStore();
  const brushSettings = tools.brushSettings;

  const syncActiveBrushSettings = useCallback((ctx: CanvasRenderingContext2D): void => {
    const brush = activeBrushRef.current;
    if (!brush?.applySettings) {
      return;
    }
    brush.applySettings(resolveRuntimeBrushSettings(brushSettings, ctx));
  }, [brushSettings]);

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
    const registry = registryRef.current;
    const activeBrush = activeBrushRef.current;
    if (!brushId) {
      registry.deactivate();
      activeBrushRef.current = null;
      lastPointRef.current = null;
      return;
    }

    if (activeBrush?.id === brushId) {
      return;
    }

    const brush = registry.activate(brushId);
    if (!brush) {
      return;
    }
    activeBrushRef.current = brush;
    lastPointRef.current = null;
  }, []);

  /**
   * Check if a brush ID is a user brush
   */
  const isUserBrush = useCallback((brushId: string): boolean => {
    return registryRef.current.has(brushId);
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
    syncActiveBrushSettings(ctx);

    strokePointCountRef.current = 0;
    lastDrawAtRef.current = 0;

    // Validate settings if brush supports it
    if (brush.validateSettings && !brush.validateSettings(brushSettings)) {
      debugWarn('raw-console', `Brush ${brush.id} validation failed for current settings`);
      return;
    }

    // Create draw context
    const context: BrushDrawContext = {
      ctx,
      x,
      y,
      pressure,
      settings: resolveRuntimeBrushSettings(brushSettings, ctx),
      lastPoint: null,
    };

    // Draw the first point
    brush.draw(context);
    strokePointCountRef.current += 1;
    
    // Store for next point
    lastPointRef.current = { x, y, pressure };
  }, [brushSettings, syncActiveBrushSettings]);

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
    syncActiveBrushSettings(ctx);

    const now = performance.now();
    const preferredFPS = brush.performanceHints?.preferredFPS;
    if (preferredFPS && preferredFPS > 0) {
      const minIntervalMs = 1000 / preferredFPS;
      if (lastDrawAtRef.current && now - lastDrawAtRef.current < minIntervalMs) {
        return;
      }
    }
    const maxStrokePoints = brush.performanceHints?.maxStrokePoints;

    // If brush has optimized line drawing, use it
    if (brush.drawLine && lastPoint) {
      const distance = Math.hypot(x - lastPoint.x, y - lastPoint.y);
      const requestedSteps = Math.max(1, Math.floor(distance));
      const remaining = typeof maxStrokePoints === 'number'
        ? Math.max(0, maxStrokePoints - strokePointCountRef.current)
        : requestedSteps;
      if (remaining <= 0) {
        return;
      }
      const steps = Math.min(requestedSteps, remaining);

      if (steps === requestedSteps) {
        brush.drawLine(
          ctx,
          lastPoint.x,
          lastPoint.y,
          lastPoint.pressure,
          x,
          y,
          pressure,
          resolveRuntimeBrushSettings(brushSettings, ctx)
        );
        strokePointCountRef.current += requestedSteps;
      } else {
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
            settings: resolveRuntimeBrushSettings(brushSettings, ctx),
            lastPoint: i === 0 ? null : {
              x: lastPoint.x + (x - lastPoint.x) * ((i - 1) / steps),
              y: lastPoint.y + (y - lastPoint.y) * ((i - 1) / steps),
              pressure: lastPoint.pressure + (pressure - lastPoint.pressure) * ((i - 1) / steps)
            },
          };
          brush.draw(context);
        }
        strokePointCountRef.current += steps + 1;
      }
    } else {
      // Otherwise interpolate points
      if (lastPoint) {
        const distance = Math.hypot(x - lastPoint.x, y - lastPoint.y);
        const requestedSteps = Math.max(1, Math.floor(distance));
        const remaining = typeof maxStrokePoints === 'number'
          ? Math.max(0, maxStrokePoints - strokePointCountRef.current)
          : requestedSteps;
        if (remaining <= 0) {
          return;
        }
        const steps = Math.min(requestedSteps, remaining);
        
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
            settings: resolveRuntimeBrushSettings(brushSettings, ctx),
            lastPoint: i === 0 ? null : {
              x: lastPoint.x + (x - lastPoint.x) * ((i - 1) / steps),
              y: lastPoint.y + (y - lastPoint.y) * ((i - 1) / steps),
              pressure: lastPoint.pressure + (pressure - lastPoint.pressure) * ((i - 1) / steps)
            },
          };

          brush.draw(context);
        }
        strokePointCountRef.current += steps + 1;
      } else {
        // No last point, just draw current
        const context: BrushDrawContext = {
          ctx,
          x,
          y,
          pressure,
          settings: resolveRuntimeBrushSettings(brushSettings, ctx),
          lastPoint: null,
        };
        brush.draw(context);
        strokePointCountRef.current += 1;
      }
    }
    lastDrawAtRef.current = now;

    // Store for next point
    lastPointRef.current = { x, y, pressure };
  }, [brushSettings, syncActiveBrushSettings]);

  /**
   * End a stroke
   */
  const endStroke = useCallback(() => {
    lastPointRef.current = null;
    strokePointCountRef.current = 0;
    lastDrawAtRef.current = 0;
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
    startStroke(ctx, points[0].x, points[0].y, points[0].pressure ?? 1);

    // Continue with remaining points
    for (let i = 1; i < points.length; i++) {
      continueStroke(ctx, points[i].x, points[i].y, points[i].pressure ?? 1);
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
    await registryRef.current.register(brush);
  }, []);

  /**
   * Unregister a brush
   */
  const unregisterBrush = useCallback((brushId: string) => {
    const unregistered = registryRef.current.unregister(brushId);
    if (unregistered && activeBrushRef.current?.id === brushId) {
      activeBrushRef.current = null;
      lastPointRef.current = null;
    }
    return unregistered;
  }, []);

  /**
   * Get all registered user brushes
   */
  const getAllUserBrushes = useCallback(() => {
    return registryRef.current.getAllMetadata();
  }, []);

  /**
   * Check if current active brush is a user brush
   */
  const hasActiveUserBrush = useCallback((): boolean => {
    return activeBrushRef.current !== null;
  }, []);

  useEffect(() => {
    const registry = registryRef.current;
    return () => {
      activeBrushRef.current = null;
      registry.clear();
    };
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
    registry: registryRef.current,
  };
};
