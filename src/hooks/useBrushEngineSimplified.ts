/**
 * Simplified Brush Engine Hook
 * Clean interface using the facade pattern
 */

import { useCallback, useMemo, useRef, useEffect } from 'react';
import { selectEffectiveColorCyclePlaying, useAppStore } from '../stores/useAppStore';
import { createBrushEngineFacade, type BrushEngineConfig, type BrushStrokeParams, type CustomBrushStrokeData } from './brushEngine/BrushEngineFacade';
import { BrushShape } from '../types';
import { getRisographPattern } from '../utils/risographTexture';
import { applyDithering as applyDitheringImport, applyDitheringWithFillResolution } from './brushEngine/dithering';
import { canvasPool } from '../utils/canvasPool';
// Use migration wrapper to switch between WebGL and Canvas2D implementations
import { type ColorCycleBrushImplementation } from './brushEngine/ColorCycleBrushMigration';

declare global {
  interface Window {
    transparencyLockEnabled?: boolean;
  }
}

/**
 * Simplified brush engine hook with facade pattern
 */
type DrawColorCycleOptions = {
  customStamp?: CustomBrushStrokeData;
};

type ShapeFillOptions = Record<string, unknown>;

const warnShapeFillRemoved = (() => {
  let hasWarned = false;
  return (feature: string) => {
    if (hasWarned || typeof console === 'undefined') {
      return;
    }
    hasWarned = true;
    console.warn(
      `[ShapeFill] ${feature} called after shape-fill system was removed. This operation is now a no-op.`
    );
  };
})();

const hasForceRender = (
  brush: ColorCycleBrushImplementation | null
): brush is ColorCycleBrushImplementation & { forceRender: () => void } => {
  return Boolean(brush && typeof (brush as { forceRender?: unknown }).forceRender === 'function');
};

const ALPHALOCK_STRATEGY: 'layer' | 'visible-if-empty' = 'visible-if-empty';

export const useBrushEngineSimplified = () => {
  const { tools, project, activeLayerId } = useAppStore();
  // Track per-layer CC brush speed for the active layer
  const activeLayerBrushSpeed = useAppStore((state) => {
    const layer = state.layers.find(l => l.id === state.activeLayerId);
    return layer?.colorCycleData?.brushSpeed;
  });
  const activeLayerTransparencyLock = useAppStore((state) => {
    const layer = state.layers.find(l => l.id === state.activeLayerId);
    return layer?.transparencyLocked === true;
  });

  const getActiveLayerBitmapCanvas = useCallback((): HTMLCanvasElement | OffscreenCanvas | null => {
    const state = useAppStore.getState();
    const layer = state.layers.find(l => l.id === state.activeLayerId);
    if (!layer) {
      return null;
    }

    if (layer.layerType === 'color-cycle') {
      const ccCanvas = layer.colorCycleData?.canvas;
      if (ccCanvas && typeof ccCanvas.getContext === 'function') {
        return ccCanvas as HTMLCanvasElement | OffscreenCanvas;
      }

      const brush = typeof state.getLayerColorCycleBrush === 'function'
        ? state.getLayerColorCycleBrush(layer.id)
        : null;

      const internalCanvas = brush?.getCanvas?.();
      if (internalCanvas && typeof (internalCanvas as HTMLCanvasElement | OffscreenCanvas).getContext === 'function') {
        return internalCanvas as HTMLCanvasElement | OffscreenCanvas;
      }

      const paintBuffer = (brush as { getPaintBuffer?: () => HTMLCanvasElement | OffscreenCanvas | null } | null)
        ?.getPaintBuffer?.();
      if (paintBuffer && typeof (paintBuffer as HTMLCanvasElement | OffscreenCanvas).getContext === 'function') {
        return paintBuffer as HTMLCanvasElement | OffscreenCanvas;
      }

      return null;
    }

    const framebuffer = layer.framebuffer;
    if (framebuffer && typeof framebuffer.getContext === 'function') {
      return framebuffer as HTMLCanvasElement | OffscreenCanvas;
    }

    return null;
  }, []);

  const withTransparencyLock = useCallback((
    ctx: CanvasRenderingContext2D,
    draw: () => void
  ) => {
    if (!activeLayerTransparencyLock) {
      draw();
      return;
    }

    const previousComposite = ctx.globalCompositeOperation;
    try {
      ctx.globalCompositeOperation = 'source-atop';
      draw();
    } finally {
      ctx.globalCompositeOperation = previousComposite;
    }
  }, [activeLayerTransparencyLock]);

  const setBlendIfUnlocked = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!activeLayerTransparencyLock) {
      ctx.globalCompositeOperation = tools.brushSettings.blendMode || 'source-over';
    }
  }, [activeLayerTransparencyLock, tools.brushSettings.blendMode]);

  const setMultiplyIfUnlocked = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!activeLayerTransparencyLock) {
      ctx.globalCompositeOperation = 'multiply';
    }
  }, [activeLayerTransparencyLock]);

  const layerHasAnyAlpha = useCallback(() => {
    const mask = getActiveLayerBitmapCanvas();
    if (!mask) {
      return true;
    }

    const width = ((mask as HTMLCanvasElement | OffscreenCanvas).width ?? 0) | 0;
    const height = ((mask as HTMLCanvasElement | OffscreenCanvas).height ?? 0) | 0;
    if (!width || !height) {
      return true;
    }

    const maskCtx = typeof (mask as HTMLCanvasElement | OffscreenCanvas).getContext === 'function'
      ? (mask as HTMLCanvasElement | OffscreenCanvas).getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings)
      : null;
    if (!maskCtx) {
      return true;
    }

    const samplesX = Math.min(8, width);
    const samplesY = Math.min(8, height);
    for (let iy = 0; iy < samplesY; iy++) {
      for (let ix = 0; ix < samplesX; ix++) {
        const x = Math.min(width - 1, Math.floor(((ix + 0.5) * width) / samplesX));
        const y = Math.min(height - 1, Math.floor(((iy + 0.5) * height) / samplesY));
        try {
          if (maskCtx.getImageData(x, y, 1, 1).data[3] > 0) {
            return true;
          }
        } catch {
          // Continue to next sample when a read fails.
        }
      }
    }

    return false;
  }, [getActiveLayerBitmapCanvas]);

  const alphaLockEmptyMaskWarnedRef = useRef(false);

  const withAlphaLock = useCallback((
    dstCtx: CanvasRenderingContext2D,
    paint: (targetCtx: CanvasRenderingContext2D) => void
  ) => {
    if (!activeLayerTransparencyLock) {
      alphaLockEmptyMaskWarnedRef.current = false;
      paint(dstCtx);
      return;
    }

    const hasLayerAlpha = layerHasAnyAlpha();
    const allowVisibleFallback = ALPHALOCK_STRATEGY === 'visible-if-empty';
    const warnOnEmpty = !allowVisibleFallback;
    if (!hasLayerAlpha && warnOnEmpty) {
      if (!alphaLockEmptyMaskWarnedRef.current && typeof console !== 'undefined') {
        console.warn('[AlphaLock] Active layer shows no visible alpha; lock prevents new pixels.');
        alphaLockEmptyMaskWarnedRef.current = true;
      }
    } else {
      alphaLockEmptyMaskWarnedRef.current = false;
    }

    const width = dstCtx.canvas.width | 0;
    const height = dstCtx.canvas.height | 0;
    if (!width || !height) {
      return;
    }

    const scratchCanvas = canvasPool.acquire(width, height);

    try {
      const scratchCtx = scratchCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
      if (!scratchCtx) {
        return;
      }

      scratchCtx.clearRect(0, 0, width, height);

      const layerMask = getActiveLayerBitmapCanvas();
      let restoreGetImageData: (() => void) | null = null;
      if (activeLayerTransparencyLock) {
        const maskCtx = layerMask && typeof (layerMask as HTMLCanvasElement | OffscreenCanvas).getContext === 'function'
          ? (layerMask as HTMLCanvasElement | OffscreenCanvas).getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings)
          : null;
        const maskCanvas = maskCtx?.canvas as HTMLCanvasElement | OffscreenCanvas | undefined;
        const sameSize = Boolean(
          maskCanvas &&
          'width' in maskCanvas &&
          'height' in maskCanvas &&
          (maskCanvas.width | 0) === width &&
          (maskCanvas.height | 0) === height
        );

        if (maskCtx && sameSize) {
          const originalGetImageData = scratchCtx.getImageData.bind(scratchCtx);
          const maskGetImageData = maskCtx.getImageData.bind(maskCtx);
          const targetGetImageData = dstCtx.getImageData.bind(dstCtx);

          scratchCtx.getImageData = ((...args: Parameters<typeof originalGetImageData>) => {
            try {
              return maskGetImageData(...args);
            } catch {
              try {
                return targetGetImageData(...args);
              } catch {
                return originalGetImageData(...args);
              }
            }
          }) as typeof scratchCtx.getImageData;

          restoreGetImageData = () => {
            scratchCtx.getImageData = originalGetImageData;
          };
        }
      }

      try {
        paint(scratchCtx);
      } finally {
        restoreGetImageData?.();
      }

      let maskSource: CanvasImageSource | null = (layerMask as unknown as CanvasImageSource) ?? null;

      if (!hasLayerAlpha && allowVisibleFallback) {
        maskSource = dstCtx.canvas;
      }

      if (!maskSource) {
        maskSource = dstCtx.canvas;
      }
      scratchCtx.globalCompositeOperation = 'destination-in';
      scratchCtx.drawImage(maskSource, 0, 0, width, height);
      scratchCtx.globalCompositeOperation = 'source-over';

      dstCtx.save();
      dstCtx.globalCompositeOperation = (tools.brushSettings.blendMode || 'source-over') as GlobalCompositeOperation;
      dstCtx.drawImage(scratchCanvas, 0, 0);
      dstCtx.restore();
    } finally {
      canvasPool.release(scratchCanvas);
    }
  }, [activeLayerTransparencyLock, tools.brushSettings.blendMode, getActiveLayerBitmapCanvas, layerHasAnyAlpha]);

  const renderCCWithBlendAndLock = useCallback((
    targetCtx: CanvasRenderingContext2D,
    sourceCanvas: HTMLCanvasElement | OffscreenCanvas,
    blendMode: GlobalCompositeOperation
  ) => {
    const width = targetCtx.canvas.width;
    const height = targetCtx.canvas.height;
    if (!width || !height) {
      return;
    }

    const tempCanvas = canvasPool.acquire(width, height);
    try {
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
      if (!tempCtx) {
        return;
      }

      tempCtx.clearRect(0, 0, width, height);
      tempCtx.drawImage(sourceCanvas as unknown as CanvasImageSource, 0, 0, width, height);

      if (activeLayerTransparencyLock) {
        const layerMask = getActiveLayerBitmapCanvas();
        const hasLayerAlpha = layerHasAnyAlpha();
        let maskCanvas: CanvasImageSource | null = (layerMask as unknown as CanvasImageSource) ?? null;

        const allowVisibleFallback = ALPHALOCK_STRATEGY === 'visible-if-empty';
        if (!hasLayerAlpha && allowVisibleFallback) {
          maskCanvas = targetCtx.canvas;
        }

        if (!maskCanvas) {
          maskCanvas = targetCtx.canvas;
        }
        tempCtx.globalCompositeOperation = 'destination-in';
        tempCtx.drawImage(maskCanvas, 0, 0, width, height);
        tempCtx.globalCompositeOperation = 'source-over';
      }

      targetCtx.save();
      targetCtx.globalCompositeOperation = blendMode;
      targetCtx.drawImage(tempCanvas, 0, 0);
      targetCtx.restore();
    } finally {
      canvasPool.release(tempCanvas);
    }
  }, [activeLayerTransparencyLock, getActiveLayerBitmapCanvas, layerHasAnyAlpha]);
  
  // Cache for brush stamps
  const brushStampCacheRef = useRef(new Map<string, HTMLCanvasElement>());
  const patternTempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rotationTempCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Get color cycle brush from active layer instead of single instance
  const getActiveLayerColorCycleBrush = useCallback((): ColorCycleBrushImplementation | null => {
    if (!activeLayerId) return null;
    return useAppStore.getState().getLayerColorCycleBrush(activeLayerId);
  }, [activeLayerId]);
  
  // Performance: Cache expensive computations
  const isPixelBrush = useMemo(() => 
    tools.brushSettings.brushShape === BrushShape.PIXEL_ROUND ||
    (tools.brushSettings.brushShape === BrushShape.SQUARE && 
     !tools.brushSettings.antialiasing),
    [tools.brushSettings.brushShape, tools.brushSettings.antialiasing]
  );
  
  // Pattern temp context getter - also returns the canvas
  const getPatternTempContext = useCallback((width: number, height: number) => {
    if (!patternTempCanvasRef.current) {
      patternTempCanvasRef.current = document.createElement('canvas');
    }
    
    const canvas = patternTempCanvasRef.current;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    
    const ctx = canvas.getContext('2d');
    // Store canvas on context for easy access
    if (ctx) {
      const contextWithCanvas = ctx as CanvasRenderingContext2D & { _canvas?: HTMLCanvasElement };
      contextWithCanvas._canvas = canvas;
    }
    return ctx;
  }, []);

  // Rotation temp context getter for pixel-perfect rotation
  const getRotationTempContext = useCallback((width: number, height: number) => {
    if (!rotationTempCanvasRef.current) {
      rotationTempCanvasRef.current = document.createElement('canvas');
    }
    
    const canvas = rotationTempCanvasRef.current;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    
    return canvas.getContext('2d');
  }, []);

  // Create pixel square stamp for non-antialiased squares
  const createPixelSquareStamp = useCallback((size: number) => {
    const cacheKey = `pixel_square_${size}`;
    let stamp = brushStampCacheRef.current.get(cacheKey);
    
    if (!stamp) {
      stamp = document.createElement('canvas');
      stamp.width = size;
      stamp.height = size;
      const ctx = stamp.getContext('2d', { colorSpace: 'srgb' });
      
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, size, size);
      }
      
      brushStampCacheRef.current.set(cacheKey, stamp);
    }
    
    return stamp;
  }, []);
  
  // Create pixel circle stamp (matching monolithic implementation exactly)
  
  const createPixelCircleStamp = useCallback((size: number) => {
    const cacheKey = `pixel_circle_${size}`;
    let stamp = brushStampCacheRef.current.get(cacheKey);
    
    if (!stamp) {
      // Define hardcoded patterns for small sizes (1-8) - EXACT COPY from monolithic
      const patterns: Record<number, Array<{x: number, y: number}>> = {
        1: [{x: 0, y: 0}],
        2: [{x: 0, y: 0}, {x: 1, y: 0}, {x: 0, y: 1}, {x: 1, y: 1}],
        3: [{x: 0, y: 1}, {x: 1, y: 0}, {x: 1, y: 1}, {x: 1, y: 2}, {x: 2, y: 1}],
        4: [
          {x: 0, y: 1}, {x: 0, y: 2},
          {x: 1, y: 0}, {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3},
          {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3},
          {x: 3, y: 1}, {x: 3, y: 2}
        ],
        5: [
          {x: 0, y: 2},
          {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3},
          {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4},
          {x: 3, y: 1}, {x: 3, y: 2}, {x: 3, y: 3},
          {x: 4, y: 2}
        ],
        6: [
          {x: 0, y: 2}, {x: 0, y: 3},
          {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4},
          {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4}, {x: 2, y: 5},
          {x: 3, y: 0}, {x: 3, y: 1}, {x: 3, y: 2}, {x: 3, y: 3}, {x: 3, y: 4}, {x: 3, y: 5},
          {x: 4, y: 1}, {x: 4, y: 2}, {x: 4, y: 3}, {x: 4, y: 4},
          {x: 5, y: 2}, {x: 5, y: 3}
        ],
        7: [
          {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4},
          {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4}, {x: 1, y: 5},
          {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4}, {x: 2, y: 5}, {x: 2, y: 6},
          {x: 3, y: 0}, {x: 3, y: 1}, {x: 3, y: 2}, {x: 3, y: 3}, {x: 3, y: 4}, {x: 3, y: 5}, {x: 3, y: 6},
          {x: 4, y: 0}, {x: 4, y: 1}, {x: 4, y: 2}, {x: 4, y: 3}, {x: 4, y: 4}, {x: 4, y: 5}, {x: 4, y: 6},
          {x: 5, y: 1}, {x: 5, y: 2}, {x: 5, y: 3}, {x: 5, y: 4}, {x: 5, y: 5},
          {x: 6, y: 2}, {x: 6, y: 3}, {x: 6, y: 4}
        ],
        8: [
          {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5},
          {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4}, {x: 1, y: 5}, {x: 1, y: 6},
          {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4}, {x: 2, y: 5}, {x: 2, y: 6}, {x: 2, y: 7},
          {x: 3, y: 0}, {x: 3, y: 1}, {x: 3, y: 2}, {x: 3, y: 3}, {x: 3, y: 4}, {x: 3, y: 5}, {x: 3, y: 6}, {x: 3, y: 7},
          {x: 4, y: 0}, {x: 4, y: 1}, {x: 4, y: 2}, {x: 4, y: 3}, {x: 4, y: 4}, {x: 4, y: 5}, {x: 4, y: 6}, {x: 4, y: 7},
          {x: 5, y: 0}, {x: 5, y: 1}, {x: 5, y: 2}, {x: 5, y: 3}, {x: 5, y: 4}, {x: 5, y: 5}, {x: 5, y: 6}, {x: 5, y: 7},
          {x: 6, y: 1}, {x: 6, y: 2}, {x: 6, y: 3}, {x: 6, y: 4}, {x: 6, y: 5}, {x: 6, y: 6},
          {x: 7, y: 2}, {x: 7, y: 3}, {x: 7, y: 4}, {x: 7, y: 5}
        ]
      };

      let pixels: Array<{x: number, y: number}>;

      if (patterns[size]) {
        pixels = patterns[size];
      } else {
        // Fallback to calculated circle for larger sizes (EXACT MATCH to monolithic)
        pixels = [];
        const radius = size / 2;
        const centerX = radius - 0.5;
        const centerY = radius - 0.5;
        
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const dx = x - centerX;
            const dy = y - centerY;
            if (dx * dx + dy * dy <= radius * radius) {
              pixels.push({x, y});
            }
          }
        }
      }

      // Create an offscreen canvas for the stamp - match monolithic implementation exactly
      stamp = document.createElement('canvas');
      stamp.width = size;
      stamp.height = size;
      const ctx = stamp.getContext('2d', { colorSpace: 'srgb' });
      
      if (ctx) {
        // Ensure pixel-perfect rendering from the start
        ctx.imageSmoothingEnabled = false;
        
        // Clear canvas first (defensive programming)
        ctx.clearRect(0, 0, size, size);
        
        // Draw the pixel pattern in white (color will be applied during drawing)
        ctx.fillStyle = 'white';
        pixels.forEach(pixel => {
          ctx.fillRect(pixel.x, pixel.y, 1, 1);
        });
      }
      
      brushStampCacheRef.current.set(cacheKey, stamp);
    }
    
    return stamp;
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.transparencyLockEnabled = activeLayerTransparencyLock;
    }
  }, [activeLayerTransparencyLock]);

  // Create brush engine facade - only recreate when structural dependencies change
  const brushEngine = useMemo(() => {
    const config: BrushEngineConfig = {
      brushSettings: tools.brushSettings,
      transparencyLockEnabled: activeLayerTransparencyLock,
      getPatternTempContext,
      brushStampCache: brushStampCacheRef.current,
      createPixelCircleStamp,
      createPixelSquareStamp,
      getRotationTempContext,
      customBrushes: project?.customBrushes || []
    };
    
    return createBrushEngineFacade(config);
  }, [tools.brushSettings, project?.customBrushes, getPatternTempContext, createPixelCircleStamp, createPixelSquareStamp, getRotationTempContext, activeLayerTransparencyLock]);

  // Update engine config when settings change
  useEffect(() => {
    brushEngine.updateConfig({
      brushSettings: tools.brushSettings,
      transparencyLockEnabled: activeLayerTransparencyLock,
      getPatternTempContext,
      brushStampCache: brushStampCacheRef.current,
      getRotationTempContext
    });

    // Initialize spam text when spam brush is selected
    if (tools.brushSettings.brushShape === BrushShape.SPAM_TEXT) {
      const contentType = tools.brushSettings.spamContentType || 'mixed';
      const customText = tools.brushSettings.spamCustomText;
      brushEngine.initializeSpamText(contentType, customText);
    }
  }, [brushEngine, tools.brushSettings, getPatternTempContext, getRotationTempContext, activeLayerTransparencyLock]);

  /**
   * Main drawing function - simplified interface
   */
  const drawBrush = useCallback((
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    cursor: { 
      pressure?: number;
      customBrushData?: { 
        imageData: ImageData; 
        width: number; 
        height: number; 
        isColorizable?: boolean 
      } 
    } = {}
  ) => {
    // Calculate velocity
    const distance = Math.sqrt(
      Math.pow(to.x - from.x, 2) + 
      Math.pow(to.y - from.y, 2)
    );
    const velocity = distance; // Simplified velocity calculation

    // Create stroke parameters
    const strokeParams: BrushStrokeParams = {
      from,
      to,
      pressure: cursor.pressure || 1.0,
      velocity,
      timestamp: Date.now(),
      customBrushData: cursor.customBrushData
    };

    // Render the stroke
    withAlphaLock(ctx, (targetCtx) => {
      brushEngine.renderBrushStroke(targetCtx, strokeParams);
    });
  }, [brushEngine, withAlphaLock]);

  /**
   * Draw a single stamp at a position
   */
  const drawStamp = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    pressure: number = 1.0
  ) => {
    const strokeParams: BrushStrokeParams = {
      from: { x, y },
      to: { x, y },
      pressure,
      velocity: 0,
      timestamp: Date.now()
    };

    withAlphaLock(ctx, (targetCtx) => {
      brushEngine.renderBrushStroke(targetCtx, strokeParams);
    });
  }, [brushEngine, withAlphaLock]);

  /**
   * Finalize the current stroke (draw any waiting pixels)
   */
  const finalizeStroke = useCallback((ctx: CanvasRenderingContext2D) => {
    withAlphaLock(ctx, (targetCtx) => {
      brushEngine.finalizeStroke(targetCtx);
    });
  }, [brushEngine, withAlphaLock]);

  /**
   * Reset for new stroke
   */
  const resetStroke = useCallback(() => {
    brushEngine.resetStroke();
  }, [brushEngine]);

  /**
   * Apply dithering effect
   */
  const applyDithering = useCallback((
    imageData: ImageData,
    numColors: number,
    algorithm?: string,
    patternStyle?: string,
    customPalette?: string[]
  ) => {
    return brushEngine.applyDithering(imageData, numColors, algorithm, patternStyle, customPalette);
  }, [brushEngine]);

  /**
   * Draw rectangle with gradient
   */
  const drawRectangleGradient = useCallback((
    ctx: CanvasRenderingContext2D,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    width: number,
    colors: string[],
    isPreview: boolean = false
  ) => {
    // Use cached isPixelBrush value for crisp edges
    // Calculate rectangle geometry (matching monolithic exactly)
    const dx = endX - startX;
    const dy = endY - startY;
    const length = Math.hypot(dx, dy);
    
    if (length === 0 || width === 0) return;
    
    // Calculate perpendicular vector for width
    const perpX = -dy / length * (width / 2);
    const perpY = dx / length * (width / 2);
    
    // Rectangle corners
    const corners = [
      { x: startX + perpX, y: startY + perpY },
      { x: startX - perpX, y: startY - perpY },
      { x: endX - perpX, y: endY - perpY },
      { x: endX + perpX, y: endY + perpY }
    ];

    withTransparencyLock(ctx, () => {
      // Save context state
      ctx.save();
    
    // Use pixel-perfect rendering for pixel brushes, antialiasing for others
    ctx.imageSmoothingEnabled = !isPixelBrush;
    
    // Apply opacity and blend mode
    ctx.globalAlpha = tools.brushSettings.opacity;
    setBlendIfUnlocked(ctx);

    // Create gradient - use actual start/end positions to respect direction
    const gradient = ctx.createLinearGradient(startX, startY, endX, endY);
    
    // Add all color stops (matching preview behavior exactly)
    if (colors.length > 0) {
      if (colors.length === 1) {
        // For single color, add it at both start and end
        gradient.addColorStop(0, colors[0]);
        gradient.addColorStop(1, colors[0]);
      } else {
        // Multiple colors - distribute them evenly
        colors.forEach((color, index) => {
          const position = index / (colors.length - 1);
          gradient.addColorStop(position, color);
        });
      }
    } else {
      // Fallback to default color
      const defaultColor = tools.brushSettings.color;
      gradient.addColorStop(0, defaultColor);
      gradient.addColorStop(1, defaultColor);
    }

    // First, always draw the clean rectangle with smooth edges
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    corners.slice(1).forEach(corner => ctx.lineTo(corner.x, corner.y));
    ctx.closePath();
    ctx.fill();
    
    // Apply dithering if enabled, using clipping to preserve clean edges
    if (tools.brushSettings.ditherEnabled && !isPreview) {
      const minX = Math.floor(Math.min(...corners.map(c => c.x)));
      const minY = Math.floor(Math.min(...corners.map(c => c.y)));
      const maxX = Math.ceil(Math.max(...corners.map(c => c.x)));
      const maxY = Math.ceil(Math.max(...corners.map(c => c.y)));
      const boundWidth = maxX - minX;
      const boundHeight = maxY - minY;
      
      if (boundWidth > 0 && boundHeight > 0) {
        // Create temp canvas for dithering
        const tempCanvas = canvasPool.acquire(boundWidth, boundHeight);
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
        
        if (tempCtx) {
          // Clear temp canvas
          tempCtx.clearRect(0, 0, boundWidth, boundHeight);
          
          // Create gradient in local space
          const localGradient = tempCtx.createLinearGradient(
            startX - minX, startY - minY,
            endX - minX, endY - minY
          );
          
          // Add color stops with banding effect if gradientBands is set
          if (colors.length > 0) {
            if (colors.length === 1) {
              // For single color, add it at both start and end
              localGradient.addColorStop(0, colors[0]);
              localGradient.addColorStop(1, colors[0]);
            } else if (tools.brushSettings.gradientBands && tools.brushSettings.gradientBands > 0) {
              // Create stepped gradient for visible bands
              const bandCount = Math.min(tools.brushSettings.gradientBands, colors.length);
              for (let i = 0; i < bandCount; i++) {
                const colorIndex = Math.floor((i / Math.max(1, bandCount - 1)) * (colors.length - 1));
                const color = colors[colorIndex];
                
                const startPos = i / bandCount;
                const endPos = (i + 1) / bandCount;
                
                // Add color at start of band
                if (i === 0) {
                  localGradient.addColorStop(0, color);
                } else {
                  localGradient.addColorStop(startPos, color);
                }
                
                // Add color at end of band (creates hard edge)
                if (i === bandCount - 1) {
                  localGradient.addColorStop(1, color);
                } else {
                  localGradient.addColorStop(endPos - 0.001, color);
                }
              }
            } else {
              // Multiple colors - distribute them evenly (smooth gradient)
              colors.forEach((color, index) => {
                const position = index / (colors.length - 1);
                localGradient.addColorStop(position, color);
              });
            }
          } else {
            const defaultColor = tools.brushSettings.color;
            localGradient.addColorStop(0, defaultColor);
            localGradient.addColorStop(1, defaultColor);
          }
          
          // Fill the ENTIRE temp canvas with gradient (no shape clipping)
          tempCtx.fillStyle = localGradient;
          tempCtx.fillRect(0, 0, boundWidth, boundHeight);
          
          // Get and dither the full gradient
          const imageData = tempCtx.getImageData(0, 0, boundWidth, boundHeight);
          
          const numColors = tools.brushSettings.gradientBands || tools.brushSettings.colors || 2;
          const fillResolution = tools.brushSettings.fillResolution || 1;
          const algorithm = tools.brushSettings.ditherAlgorithm || 'sierra-lite';
          const patternStyle = tools.brushSettings.patternStyle || 'dots';
          
          // Pass the gradient colors to dithering
          const paletteColors = colors.length > 0 ? colors : [tools.brushSettings.color];
          const ditheredData = fillResolution > 1 
            ? applyDitheringWithFillResolution(imageData, numColors, fillResolution, algorithm, patternStyle, paletteColors)
            : applyDitheringImport(imageData, numColors, algorithm, patternStyle, paletteColors);
          
          // Put dithered data back on temp canvas
          tempCtx.putImageData(ditheredData, 0, 0);
          
          // Save state and set up clipping
          ctx.save();
          ctx.imageSmoothingEnabled = !isPixelBrush; // Use pixel-perfect for pixel brushes
          ctx.beginPath();
          ctx.moveTo(corners[0].x, corners[0].y);
          corners.slice(1).forEach(corner => ctx.lineTo(corner.x, corner.y));
          ctx.closePath();
          ctx.clip();
          
          // Draw the dithered pattern (will be clipped to rectangle shape)
          ctx.imageSmoothingEnabled = false; // Don't smooth the dither pattern itself
          ctx.drawImage(tempCanvas, minX, minY);
          
          // Restore state
          ctx.restore();
          
          // Release temp canvas
          canvasPool.release(tempCanvas);
        }
      }
    }
    
    // Apply risograph effect if enabled (matching monolithic)
    const risographIntensity = tools.brushSettings.risographIntensity || 0;
    if (risographIntensity > 0 && !isPreview) {
      const pattern = getRisographPattern(ctx);
      
      if (pattern) {
        // Save current state
        ctx.save();
        
        // Add misregistration offset
        const effectStrength = risographIntensity / 100;
        const misregX = (Math.random() - 0.5) * effectStrength * 2;
        const misregY = (Math.random() - 0.5) * effectStrength * 2;
        ctx.translate(misregX, misregY);
        
        // Create clipping path for the rotated rectangle
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        corners.slice(1).forEach(corner => {
          ctx.lineTo(corner.x, corner.y);
        });
        ctx.closePath();
        ctx.clip();
        
        // Apply pattern with multiply blend mode
        setMultiplyIfUnlocked(ctx);
        ctx.fillStyle = pattern;
        ctx.globalAlpha = risographIntensity / 100 * 0.35;
        
        // Fill the clipped area with the pattern
        const minX = Math.floor(Math.min(...corners.map(c => c.x)));
        const minY = Math.floor(Math.min(...corners.map(c => c.y)));
        const maxX = Math.ceil(Math.max(...corners.map(c => c.x)));
        const maxY = Math.ceil(Math.max(...corners.map(c => c.y)));
        ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
        
        // Restore state
        ctx.restore();
      }
    }
    
    // Restore context state
      ctx.restore();
    });
  }, [withTransparencyLock, setBlendIfUnlocked, setMultiplyIfUnlocked, tools.brushSettings.color, tools.brushSettings.risographIntensity, tools.brushSettings.ditherEnabled, tools.brushSettings.colors, tools.brushSettings.gradientBands, tools.brushSettings.fillResolution, tools.brushSettings.ditherAlgorithm, tools.brushSettings.patternStyle, tools.brushSettings.opacity, isPixelBrush]);

  // Helper function to apply risograph effect
  const applyRisographEffect = useCallback((
    ctx: CanvasRenderingContext2D,
    vertices: Array<{ x: number; y: number }>,
    risographIntensity: number
  ) => {
    const pattern = getRisographPattern(ctx);
    
    if (pattern) {
      // Save current state
      ctx.save();
      
      // Add misregistration offset
      const effectStrength = risographIntensity / 100;
      const misregX = (Math.random() - 0.5) * effectStrength * 2;
      const misregY = (Math.random() - 0.5) * effectStrength * 2;
      ctx.translate(misregX, misregY);
      
      // Create clipping path for the polygon
      ctx.beginPath();
      ctx.moveTo(vertices[0].x, vertices[0].y);
      for (let i = 1; i < vertices.length; i++) {
        ctx.lineTo(vertices[i].x, vertices[i].y);
      }
      ctx.closePath();
      ctx.clip();
      
      // Apply texture with multiply blend mode
      setMultiplyIfUnlocked(ctx);
      ctx.fillStyle = pattern;
      ctx.globalAlpha = risographIntensity / 100 * 0.35; // Slightly stronger effect
      
      // Fill the clipped area with the pattern
      const minX = Math.floor(Math.min(...vertices.map(v => v.x)));
      const minY = Math.floor(Math.min(...vertices.map(v => v.y)));
      const maxX = Math.ceil(Math.max(...vertices.map(v => v.x)));
      const maxY = Math.ceil(Math.max(...vertices.map(v => v.y)));
      ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
      
      // Restore state
      ctx.restore();
    }
  }, [setMultiplyIfUnlocked]);

  /**
   * Draw polygon with gradient - DEBUG VERSION
   */
  const drawPolygonGradient = useCallback((
    ctx: CanvasRenderingContext2D,
    polygonData: { vertices: Array<{ x: number; y: number }>, colors: string[] },
    isPreview: boolean = false
  ) => {
    const { vertices, colors } = polygonData || {};
    
    // Early return if no polygon data
    if (!polygonData || !vertices || !Array.isArray(vertices) || vertices.length < 3) {
      console.warn('[drawPolygonGradient] Skipping - insufficient vertices:', vertices?.length || 0);
      return;
    }
    
    // Validate all vertices are defined
    const validVertices = vertices.filter(v => v && typeof v.x === 'number' && typeof v.y === 'number');
    if (validVertices.length < 3) return;

    // Calculate bounds for gradient
    const minX = Math.floor(Math.min(...validVertices.map(v => v.x)));
    const minY = Math.floor(Math.min(...validVertices.map(v => v.y)));
    const maxX = Math.ceil(Math.max(...validVertices.map(v => v.x)));
    const maxY = Math.ceil(Math.max(...validVertices.map(v => v.y)));
    const boundWidth = maxX - minX;
    const boundHeight = maxY - minY;
    
    // Find the two furthest points in the polygon for gradient direction
    let maxDistance = 0;
    let point1 = validVertices[0];
    let point2 = validVertices[1];
    
    for (let i = 0; i < validVertices.length; i++) {
      for (let j = i + 1; j < validVertices.length; j++) {
        const dist = Math.sqrt(
          Math.pow(validVertices[j].x - validVertices[i].x, 2) + 
          Math.pow(validVertices[j].y - validVertices[i].y, 2)
        );
        if (dist > maxDistance) {
          maxDistance = dist;
          point1 = validVertices[i];
          point2 = validVertices[j];
        }
      }
    }
    
    //   point1,
    //   point2,
    //   distance: maxDistance,
    //   bounds: { minX, minY, maxX, maxY },
    //   numVertices: validVertices.length
    // });
    
    // Create gradient between the two furthest points
    const gradient = ctx.createLinearGradient(point1.x, point1.y, point2.x, point2.y);
    
    // Add color stops - using unique colors that progress across the shape
    const validColors = colors?.filter(c => c !== undefined && c !== null && typeof c === 'string') || [];
    
    if (validColors.length === 0) {
      // Fallback to current brush color
      const defaultColor = tools.brushSettings.color || '#000000';
      gradient.addColorStop(0, defaultColor);
      gradient.addColorStop(1, defaultColor);
    } else if (validColors.length === validVertices.length) {
      // Project vertices onto gradient line to get their positions
      const gradientVector = { x: point2.x - point1.x, y: point2.y - point1.y };
      const gradientLength = Math.sqrt(gradientVector.x * gradientVector.x + gradientVector.y * gradientVector.y);
      const gradientDir = { x: gradientVector.x / gradientLength, y: gradientVector.y / gradientLength };
      
      // Map each vertex to its position along the gradient
      const colorPositions = validVertices.map((vertex, index) => {
        const toVertex = { x: vertex.x - point1.x, y: vertex.y - point1.y };
        const projectionDistance = toVertex.x * gradientDir.x + toVertex.y * gradientDir.y;
        const position = Math.max(0, Math.min(1, projectionDistance / gradientLength));
        return { position, color: validColors[index], index };
      });
      
      // Sort by position along gradient
      colorPositions.sort((a, b) => a.position - b.position);
      
      // Get unique colors while preserving order along gradient
      const uniqueColorsMap = new Map();
      const orderedUniqueColors = [];
      
      for (const item of colorPositions) {
        if (!uniqueColorsMap.has(item.color)) {
          uniqueColorsMap.set(item.color, item.position);
          orderedUniqueColors.push({ color: item.color, position: item.position });
        }
      }
      
      // Get the number of colors to use from brush settings
      // Use gradientBands if available, otherwise fall back to colors setting
      const numColors = tools.brushSettings.gradientBands || tools.brushSettings.colors || orderedUniqueColors.length;
      
      // Create stepped gradient for visible bands effect
      if (tools.brushSettings.gradientBands && tools.brushSettings.gradientBands > 0) {
        // Create hard-edged bands by duplicating color stops
        const bandCount = Math.min(numColors, orderedUniqueColors.length);
        for (let i = 0; i < bandCount; i++) {
          const sourceIndex = Math.floor((i / Math.max(1, bandCount - 1)) * (orderedUniqueColors.length - 1));
          const color = orderedUniqueColors[sourceIndex].color;
          
          const startPos = i / bandCount;
          const endPos = (i + 1) / bandCount;
          
          // Add color at start of band
          if (i === 0) {
            gradient.addColorStop(0, color);
          } else {
            gradient.addColorStop(startPos, color);
          }
          
          // Add color at end of band (creates hard edge)
          if (i === bandCount - 1) {
            gradient.addColorStop(1, color);
          } else {
            gradient.addColorStop(endPos - 0.001, color);
          }
        }
      } else {
        // Original smooth gradient code
        if (orderedUniqueColors.length <= numColors) {
          // Use all unique colors, distributed evenly
          orderedUniqueColors.forEach((item, index) => {
            const position = index / Math.max(1, orderedUniqueColors.length - 1);
            gradient.addColorStop(position, item.color);
          });
        } else {
          // Sample colors evenly from the unique set
          for (let i = 0; i < numColors; i++) {
            const sourceIndex = Math.floor((i / Math.max(1, numColors - 1)) * (orderedUniqueColors.length - 1));
            const position = i / Math.max(1, numColors - 1);
            gradient.addColorStop(position, orderedUniqueColors[sourceIndex].color);
          }
        }
      }
      
    } else {
      // Fallback: use first and last colors
      if (validColors.length === 1) {
        gradient.addColorStop(0, validColors[0]);
        gradient.addColorStop(1, validColors[0]);
      } else {
        gradient.addColorStop(0, validColors[0]);
        gradient.addColorStop(1, validColors[validColors.length - 1]);
      }
    }
    
    withTransparencyLock(ctx, () => {
    // Save context state
    ctx.save();
    
    // Apply opacity and blend mode
    ctx.globalAlpha = tools.brushSettings.opacity;
    setBlendIfUnlocked(ctx);
      
      // Check if we'll be applying dithering
      const willApplyDithering = tools.brushSettings.ditherEnabled && !isPreview;
      
      if (willApplyDithering && boundWidth > 0 && boundHeight > 0) {
        // Create temp canvas for dithering - add padding for antialiasing
        const padding = 2;
        const paddedWidth = boundWidth + padding * 2;
        const paddedHeight = boundHeight + padding * 2;
        const tempCanvas = canvasPool.acquire(paddedWidth, paddedHeight);
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
        
        if (tempCtx && tempCanvas.width > 0 && tempCanvas.height > 0) {
          // Clear the temp canvas
          tempCtx.clearRect(0, 0, paddedWidth, paddedHeight);
          
          // Create gradient in local space using the same two furthest points
          const localGradient = tempCtx.createLinearGradient(
            point1.x - minX + padding, point1.y - minY + padding,
            point2.x - minX + padding, point2.y - minY + padding
          );
          
          // Add color stops (same as main gradient) - use ordered unique colors
          if (validColors.length === 0) {
            const defaultColor = tools.brushSettings.color || '#000000';
            localGradient.addColorStop(0, defaultColor);
            localGradient.addColorStop(1, defaultColor);
          } else if (validColors.length === validVertices.length) {
            // Recreate the same logic for consistency
            const gradientVector = { x: point2.x - point1.x, y: point2.y - point1.y };
            const gradientLength = Math.sqrt(gradientVector.x * gradientVector.x + gradientVector.y * gradientVector.y);
            const gradientDir = { x: gradientVector.x / gradientLength, y: gradientVector.y / gradientLength };
            
            const colorPositions = validVertices.map((vertex, index) => {
              const toVertex = { x: vertex.x - point1.x, y: vertex.y - point1.y };
              const projectionDistance = toVertex.x * gradientDir.x + toVertex.y * gradientDir.y;
              const position = Math.max(0, Math.min(1, projectionDistance / gradientLength));
              return { position, color: validColors[index], index };
            });
            
            colorPositions.sort((a, b) => a.position - b.position);
            
            const uniqueColorsMap = new Map();
            const orderedUniqueColors = [];
            
            for (const item of colorPositions) {
              if (!uniqueColorsMap.has(item.color)) {
                uniqueColorsMap.set(item.color, item.position);
                orderedUniqueColors.push({ color: item.color, position: item.position });
              }
            }
            
            const numColors = tools.brushSettings.gradientBands || tools.brushSettings.colors || orderedUniqueColors.length;
            
            if (orderedUniqueColors.length <= numColors) {
              orderedUniqueColors.forEach((item, index) => {
                const position = index / Math.max(1, orderedUniqueColors.length - 1);
                localGradient.addColorStop(position, item.color);
              });
            } else {
              for (let i = 0; i < numColors; i++) {
                const sourceIndex = Math.floor((i / Math.max(1, numColors - 1)) * (orderedUniqueColors.length - 1));
                const position = i / Math.max(1, numColors - 1);
                localGradient.addColorStop(position, orderedUniqueColors[sourceIndex].color);
              }
            }
          } else {
            // Fallback: use first and last colors
            if (validColors.length === 1) {
              localGradient.addColorStop(0, validColors[0]);
              localGradient.addColorStop(1, validColors[0]);
            } else {
              localGradient.addColorStop(0, validColors[0]);
              localGradient.addColorStop(1, validColors[validColors.length - 1]);
            }
          }
          
          // Fill the ENTIRE temp canvas with gradient (no clipping)
          tempCtx.fillStyle = localGradient;
          tempCtx.fillRect(0, 0, paddedWidth, paddedHeight);
          
          // Get the full gradient data
          const gradientImageData = tempCtx.getImageData(0, 0, paddedWidth, paddedHeight);
          
          // Apply dithering
          const numColors = tools.brushSettings.gradientBands || tools.brushSettings.colors || 2;
          const fillResolution = tools.brushSettings.fillResolution || 1;
          const algorithm = tools.brushSettings.ditherAlgorithm || 'sierra-lite';
          const patternStyle = tools.brushSettings.patternStyle || 'dots';
          
          // Pass the gradient colors directly to the dithering function
          const ditheredData = fillResolution > 1 
            ? applyDitheringWithFillResolution(gradientImageData, numColors, fillResolution, algorithm, patternStyle, validColors)
            : applyDitheringImport(gradientImageData, numColors, algorithm, patternStyle, validColors);
          
          // Put the dithered result back
          tempCtx.putImageData(ditheredData, 0, 0);

          // Mask gradient to polygon locally so edges stay pixel sharp when drawn later
          const localVertices = validVertices.map(vertex => ({
            x: Math.round(vertex.x - minX + padding),
            y: Math.round(vertex.y - minY + padding),
          }));

          if (localVertices.length >= 3) {
            tempCtx.save();
            tempCtx.imageSmoothingEnabled = false;
            tempCtx.globalCompositeOperation = 'destination-in';
            tempCtx.lineJoin = 'miter';
            tempCtx.lineCap = 'butt';
            tempCtx.fillStyle = '#fff';
            tempCtx.beginPath();
            tempCtx.moveTo(localVertices[0].x, localVertices[0].y);
            for (let i = 1; i < localVertices.length; i++) {
              tempCtx.lineTo(localVertices[i].x, localVertices[i].y);
            }
            tempCtx.closePath();
            tempCtx.fill();
            tempCtx.restore();

            // Force binary alpha after masking so diagonal edges stay pixel-crisp
            const maskData = tempCtx.getImageData(0, 0, paddedWidth, paddedHeight);
            const pixels = maskData.data;
            for (let i = 3; i < pixels.length; i += 4) {
              pixels[i] = pixels[i] > 0 ? 255 : 0;
            }
            tempCtx.putImageData(maskData, 0, 0);
          }

          // Draw the already-masked dithered pattern without additional smoothing
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(tempCanvas, minX - padding, minY - padding);

          // Release temp canvas
          canvasPool.release(tempCanvas);

          // Apply risograph effect if enabled
          const risographIntensity = tools.brushSettings.risographIntensity || 0;
          if (risographIntensity > 0 && !isPreview) {
            applyRisographEffect(ctx, validVertices, risographIntensity);
          }
        } else {
          // Fallback if temp canvas creation fails
          canvasPool.release(tempCanvas);
          
          // Draw directly without dithering
          ctx.imageSmoothingEnabled = true;
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.moveTo(validVertices[0].x, validVertices[0].y);
          validVertices.slice(1).forEach(vertex => ctx.lineTo(vertex.x, vertex.y));
          ctx.closePath();
          ctx.fill();
        }
      } else {
        // No dithering - draw directly with antialiasing
        ctx.imageSmoothingEnabled = true;
        ctx.fillStyle = gradient;
        
        // quiet
        
        ctx.beginPath();
        ctx.moveTo(validVertices[0].x, validVertices[0].y);
        validVertices.slice(1).forEach(vertex => ctx.lineTo(vertex.x, vertex.y));
        ctx.closePath();
        ctx.fill();
        
        // quiet
        
        // Apply risograph effect if enabled
        const risographIntensity = tools.brushSettings.risographIntensity || 0;
        if (risographIntensity > 0 && !isPreview) {
          applyRisographEffect(ctx, validVertices, risographIntensity);
        }
      }
      
      // Restore context state
      ctx.restore();
    });
  }, [withTransparencyLock, setBlendIfUnlocked, tools.brushSettings.risographIntensity, tools.brushSettings.opacity, tools.brushSettings.ditherEnabled, tools.brushSettings.colors, tools.brushSettings.gradientBands, tools.brushSettings.fillResolution, tools.brushSettings.ditherAlgorithm, tools.brushSettings.patternStyle, tools.brushSettings.color, applyRisographEffect]);


  /**
   * Draw contour polygon - creates contour lines like a topographic map using distance fields
   */
  const drawContourPolygon = useCallback((
    _ctx: CanvasRenderingContext2D,
    _polygonData: { vertices: Array<{ x: number; y: number }>; fillColor?: string },
    _isPreview: boolean = false,
    _options?: ShapeFillOptions
  ) => {
    warnShapeFillRemoved('drawContourPolygon');
    void _ctx;
    void _polygonData;
    void _isPreview;
    void _options;
  }, []);

  /**
   * Draw cross-hatch polygon - fills with rough, hand-drawn cross-hatching pattern
   */
  const drawCrossHatchPolygon = useCallback((
    _ctx: CanvasRenderingContext2D,
    _polygonData: {
      vertices: Array<{ x: number; y: number }>;
      fillColor?: string;
      spacingOverride?: number;
      rotationOverride?: number;
      lineWidthOverride?: number;
    },
    _isPreview: boolean = false
  ) => {
    warnShapeFillRemoved('drawCrossHatchPolygon');
    void _ctx;
    void _polygonData;
    void _isPreview;
  }, []);

  /**
   * Draw Delaunay polygon - fills with triangulated network of lines
   */
  const drawDelaunayPolygon = useCallback((
    _ctx: CanvasRenderingContext2D,
    _polygonData: { vertices: Array<{ x: number; y: number }>; fillColor?: string },
    _isPreview: boolean = false,
    _options?: ShapeFillOptions
  ) => {
    warnShapeFillRemoved('drawDelaunayPolygon');
    void _ctx;
    void _polygonData;
    void _isPreview;
    void _options;
  }, []);

  /**
   * Initialize Color Cycle Brush for the active layer
   */
  const initializeColorCycleBrush = useCallback(() => {
    if (!activeLayerId) return null;
    
    // CRITICAL: Check if the active layer is a color-cycle layer
    const state = useAppStore.getState();
    const activeLayer = state.layers.find(l => l.id === activeLayerId);
    if (!activeLayer || activeLayer.layerType !== 'color-cycle') {
      // quiet
      return null;
    }
    // Do not initialize brush for recolor-mode layers
    if (activeLayer.colorCycleData?.mode === 'recolor') {
      return null;
    }
    
    try {
      // Check if layer already has a color cycle brush
      let colorCycleBrush = getActiveLayerColorCycleBrush();
      
      if (!colorCycleBrush) {
        // Initialize color cycle for the active layer
        const targetWidth = Math.max(project?.width || 1024, 1);
        const targetHeight = Math.max(project?.height || 1024, 1);
        
        // Initialize color cycle for this layer in the store
        useAppStore.getState().initColorCycleForLayer(activeLayerId, targetWidth, targetHeight);
        colorCycleBrush = getActiveLayerColorCycleBrush();
        
        if (!colorCycleBrush) {
          console.error('[ColorCycle] Failed to initialize brush for layer:', activeLayerId);
          return null;
        }
        
        // Set up frame callback for new brush
        colorCycleBrush.setOnFrameRendered(() => {
          // Dispatch event for main canvas to update
          window.dispatchEvent(new CustomEvent('colorCycleFrameReady'));
        });
      } else {
        // IMPORTANT: Reset the brush state when switching back to an existing CC layer
        // This ensures clean state after layer switches
        colorCycleBrush.endStroke(activeLayerId);
      }
      
      // Apply settings (for both new and existing brushes)
      colorCycleBrush.setBrushSize(tools.brushSettings.size || 20);
      if (tools.brushSettings.colorCycleFPS) {
        colorCycleBrush.setFPS(tools.brushSettings.colorCycleFPS);
      }
      // Prefer per-layer CC brush speed when available; fallback to global brush setting
      try {
        const state = useAppStore.getState();
        const activeLayer = state.layers.find(l => l.id === activeLayerId);
        const perLayerSpeed = activeLayer?.colorCycleData?.brushSpeed;
        const speed = perLayerSpeed ?? tools.brushSettings.colorCycleSpeed;
        if (speed) {
          colorCycleBrush.setSpeed(speed);
        }
      } catch {}
      if (tools.brushSettings.gradientBands) {
        colorCycleBrush.setGradientBands(tools.brushSettings.gradientBands);
      }
      if (tools.brushSettings.spacing) {
        colorCycleBrush.setBandSpacing(tools.brushSettings.spacing);
      }
      // Set pressure enabled state and min/max values
      // quiet
      try {
        // Force enable pressure for COLOR_CYCLE - the UI toggle isn't working correctly
        const isStrokeVariant =
          tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE ||
          tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE;
        const shouldEnablePressure = isStrokeVariant ? true : (tools.brushSettings.pressureEnabled || false);
        colorCycleBrush.setPressureEnabled(shouldEnablePressure);
        // quiet
        // Always set pressure values, using sensible defaults if not specified
        colorCycleBrush.setMinPressure(tools.brushSettings.minPressure || 50);
        colorCycleBrush.setMaxPressure(tools.brushSettings.maxPressure || 200);
      } catch (error) {
        console.error('[CC Init] Failed to set pressure settings:', error);
      }

      try {
        const stampShape = tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE
          ? 'triangle'
          : 'square';
        colorCycleBrush.setStampShape(stampShape);
      } catch (error) {
        console.error('[CC Init] Failed to set stamp shape:', error);
      }
      
      // Apply gradient - prioritize layer's stored gradient over brush settings
      const activeLayer = useAppStore.getState().layers.find(l => l.id === activeLayerId);
      const layerGradient = activeLayer?.colorCycleData?.gradient;
      const brushGradient = tools.brushSettings.colorCycleGradient;
      const defaultGradient = [
        { position: 0.0, color: '#ff0000' },
        { position: 0.17, color: '#ff7f00' },
        { position: 0.33, color: '#ffff00' },
        { position: 0.5, color: '#00ff00' },
        { position: 0.67, color: '#0000ff' },
        { position: 0.83, color: '#4b0082' },
        { position: 1.0, color: '#9400d3' }
      ];
      
      // Use layer gradient first, then brush gradient, then default
      const gradientToUse = layerGradient || brushGradient || defaultGradient;
      if (gradientToUse) {
        colorCycleBrush.setGradient(gradientToUse, activeLayerId);
      }
      
      return colorCycleBrush;
    } catch (error) {
      console.error('[ColorCycle] Error initializing brush:', error);
      return null;
    }
  }, [
    tools.brushSettings.size,
    tools.brushSettings.colorCycleFPS,
    tools.brushSettings.colorCycleSpeed,
    tools.brushSettings.colorCycleGradient,
    tools.brushSettings.gradientBands,
    tools.brushSettings.spacing,
    tools.brushSettings.pressureEnabled,
    tools.brushSettings.minPressure,
    tools.brushSettings.maxPressure,
    tools.brushSettings.brushShape,
    project?.width,
    project?.height,
    activeLayerId,
    getActiveLayerColorCycleBrush
  ]);

  const ensureColorCycleAnimation = useCallback((shouldPlay: boolean) => {
    let brush = getActiveLayerColorCycleBrush();

    if (!brush && shouldPlay) {
      brush = initializeColorCycleBrush();
    }

    if (!brush) {
      return;
    }

    const isPlaying = typeof brush.isPlaying === 'function' ? brush.isPlaying() : false;

    if (shouldPlay && !isPlaying) {
      if (typeof brush.startAnimation === 'function') {
        brush.startAnimation();
      }
      return;
    }

    if (!shouldPlay && isPlaying) {
      if (typeof brush.pause === 'function') {
        brush.pause();
      } else if (typeof brush.stopAnimation === 'function') {
        brush.stopAnimation();
      }
    }
  }, [getActiveLayerColorCycleBrush, initializeColorCycleBrush]);
  
  /**
   * Render Color Cycle output onto the provided context.
   * Applies opacity and optionally combines blend mode with transparency lock.
   */
  const renderColorCycle = useCallback((ctx: CanvasRenderingContext2D, applyOpacity: boolean = true) => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (!colorCycleBrush) return;

    const previousComposite = ctx.globalCompositeOperation;
    const previousAlpha = ctx.globalAlpha;

    try {
      colorCycleBrush.render(!applyOpacity);
      const internalCanvas = colorCycleBrush.getCanvas();
      if (!internalCanvas) return;

      const blendMode = (tools.brushSettings.blendMode || 'source-over') as GlobalCompositeOperation;
      ctx.globalAlpha = applyOpacity ? tools.brushSettings.opacity : 1.0;

      if (activeLayerTransparencyLock) {
        renderCCWithBlendAndLock(ctx, internalCanvas, blendMode);
      } else {
        ctx.globalCompositeOperation = blendMode;
        ctx.drawImage(internalCanvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
      }
    } finally {
      ctx.globalCompositeOperation = previousComposite;
      ctx.globalAlpha = previousAlpha;
    }
  }, [
    getActiveLayerColorCycleBrush,
    tools.brushSettings.opacity,
    tools.brushSettings.blendMode,
    activeLayerTransparencyLock,
    renderCCWithBlendAndLock
  ]);
  
  /**
   * Draw with Color Cycle Brush - only paints to Canvas2D buffer, no immediate rendering
   */
  const drawColorCycle = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    pressure: number = 1.0,
    rotation: number = 0,
    options?: DrawColorCycleOptions
  ) => {
    // Compute effective pressure settings (store may not reflect forced CC values)
    const storePressureEnabled = tools.brushSettings.pressureEnabled;
    const isStrokeVariant =
      tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE ||
      tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE;
    const effectivePressureEnabled = isStrokeVariant ? true : !!storePressureEnabled;
    const effectiveMin = tools.brushSettings.minPressure ?? 50;
    const effectiveMax = tools.brushSettings.maxPressure ?? 200;
    
    
    try {
      // DEFENSIVE GUARD: Check if color cycle brush should be used
      // This prevents crashes when incompatible layer types are used
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (!colorCycleBrush) {
        return;
      }
      
      // Ensure pressure settings are applied (might be a newly created brush)
      // Log current settings to debug - only once per stroke to avoid spam
      if (!ctx.canvas.dataset.loggedSettings) {
        ctx.canvas.dataset.loggedSettings = 'true';
        // Reset flag after a short delay
        setTimeout(() => {
          if (ctx.canvas.dataset) {
            delete ctx.canvas.dataset.loggedSettings;
          }
        }, 1000);
      }
      
      // Set pressure settings FIRST before painting
      try {
        // Force enable pressure for COLOR_CYCLE - the UI toggle isn't working correctly
        const shouldEnablePressure = effectivePressureEnabled;
        colorCycleBrush.setPressureEnabled(shouldEnablePressure);
        // quiet
        // Always set pressure values, using sensible defaults if not specified
        colorCycleBrush.setMinPressure(effectiveMin);
        colorCycleBrush.setMaxPressure(effectiveMax);
      } catch (error) {
        console.error('[CC DrawCycle] Error setting pressure:', error);
      }

      try {
        const stampShape = tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE
          ? 'triangle'
          : 'square';
        colorCycleBrush.setStampShape(stampShape);
      } catch (error) {
        console.error('[CC DrawCycle] Error setting stamp shape:', error);
      }
      
      let brushSizeSetting = tools.brushSettings.size || 1;
      if (options?.customStamp) {
        const stamp = options.customStamp;
        if (stamp.isResampler) {
          brushSizeSetting = tools.brushSettings.size || brushSizeSetting;
        } else {
          const maxDimension = Math.max(stamp.width, stamp.height) || 1;
          brushSizeSetting = (tools.brushSettings.size / 100) * maxDimension;
        }
      }

      if (!Number.isFinite(brushSizeSetting) || brushSizeSetting <= 0) {
        brushSizeSetting = 1;
      }

      colorCycleBrush.setBrushSize(brushSizeSetting);
      
      // Paint to the Canvas2D buffer only - AFTER setting pressure
      const layerId = activeLayerId;
      if (!layerId) {
        return;
      }

      if (activeLayerTransparencyLock) {
        const mask = getActiveLayerBitmapCanvas();
        if (mask) {
          const canvasWidth = ctx.canvas.width || 1;
          const canvasHeight = ctx.canvas.height || 1;
          const scaleToMaskX = mask.width / canvasWidth;
          const scaleToMaskY = mask.height / canvasHeight;
          const mx = Math.floor(x * scaleToMaskX);
          const my = Math.floor(y * scaleToMaskY);
          const brushSize = tools.brushSettings.size || 1;
          let radius = Math.max(
            1,
            Math.round(brushSize * Math.max(scaleToMaskX, scaleToMaskY) * 0.5)
          );

          if (options?.customStamp) {
            const { width = 0, height = 0 } = options.customStamp;
            const maxDimension = Math.max(width, height);
            if (maxDimension > 0) {
              const stampRadius = Math.round(
                maxDimension * Math.max(scaleToMaskX, scaleToMaskY) * 0.5
              );
              radius = Math.max(radius, stampRadius);
            }
          }

        }
      }

      // Convert canvas coordinates to internal canvas coordinates
      const internalCanvas = colorCycleBrush.getCanvas();
      if (!internalCanvas || !internalCanvas.width || !internalCanvas.height) {
        console.error('[ColorCycle] Invalid internal canvas');
        return;
      }
      
      const scaleX = internalCanvas.width / (ctx.canvas.width || 1);
      const scaleY = internalCanvas.height / (ctx.canvas.height || 1);
      
      // Pass the active layer ID to ensure proper stroke tracking
      const paintX = Math.floor(x * scaleX);
      const paintY = Math.floor(y * scaleY);
      
      // Bounds check
      if (paintX >= 0 && paintX < internalCanvas.width && 
          paintY >= 0 && paintY < internalCanvas.height) {
        // THEN paint with pressure and rotation
        if (options?.customStamp && typeof colorCycleBrush.paintCustomStamp === 'function') {
          colorCycleBrush.paintCustomStamp(
            options.customStamp,
            paintX,
            paintY,
            layerId,
            pressure,
            rotation
          );
        } else {
          colorCycleBrush.paint(paintX, paintY, layerId, pressure, rotation);
        }
      }

      // When playback is paused, immediately mirror the buffer so stamps stay visible.
      try {
        const isPlaying =
          typeof colorCycleBrush.isPlaying === 'function' ? colorCycleBrush.isPlaying() : false;
        const targetCanvas = ctx.canvas as HTMLCanvasElement | undefined;
        if (!isPlaying && targetCanvas) {
          renderColorCycle(ctx, true);
        }
      } catch {}
    } catch (error) {
      console.error('[ColorCycle] Error in drawColorCycle:', error);
    }
    
    // Don't composite here - let renderColorCycle handle all rendering
    // This prevents visible brush stamps and ensures only animated strokes show
  }, [
    tools.brushSettings.size,
    tools.brushSettings.pressureEnabled,
    tools.brushSettings.minPressure,
    tools.brushSettings.maxPressure,
    tools.brushSettings.brushShape,
    activeLayerId,
    getActiveLayerColorCycleBrush,
    getActiveLayerBitmapCanvas,
    renderColorCycle,
    activeLayerTransparencyLock
  ]);
  
  /**
   * Reset Color Cycle - starts a new stroke with the existing brush
   */
  const resetColorCycle = useCallback((clearBuffer: boolean = false) => {
    // quiet
    // DEFENSIVE GUARD: Add try-catch to prevent crashes during initialization
    try {
      // Reuse existing brush or create if needed
      const brush = initializeColorCycleBrush();
      
      if (brush) {
        const layerId = activeLayerId;
        if (!layerId) {
          return;
        }
        // If there is visible content on the internal canvas, proactively
        // separate it by committing to the layer and clearing buffers so
        // this new stroke is stored distinctly in history.
        try {
          const state = useAppStore.getState();
          const layer = state.layers.find(l => l.id === layerId);
          const layerCanvas = layer?.colorCycleData?.canvas || null;
          if (layer && layer.layerType === 'color-cycle' && layerCanvas) {
            const internal = brush.getCanvas();
            const ictx = internal.getContext?.('2d');
            let hasAlpha = false;
            try {
              const img = ictx?.getImageData(0, 0, Math.min(8, internal.width), Math.min(8, internal.height));
              const data = img?.data ?? null;
              if (data) {
                for (let i = 3; i < data.length; i += 4) {
                  if (data[i] > 0) { hasAlpha = true; break; }
                }
              }
            } catch {}
            if (hasAlpha) {
              // quiet
              brush.commitCurrentStroke?.(layerId);
              if (typeof brush.commitToLayer === 'function') {
                brush.commitToLayer(layerCanvas, layerId);
              } else {
                brush.renderDirectToCanvas?.(layerCanvas, layerId);
              }
              brush.clearPaintBuffer?.(layerId);
            }
          }
        } catch {
          // quiet
        }

        // Ensure any in-progress stroke is finalized before starting a new one
        try {
          if (typeof brush.finalizeCurrentStroke === 'function') {
            brush.finalizeCurrentStroke(layerId);
          } else if (typeof brush.endStroke === 'function') {
            brush.endStroke(layerId);
          }
        } catch {
          // quiet
        }

        // quiet
        // Start a new stroke with the existing brush, passing layer ID and clearBuffer flag
        brush.startStroke(layerId, clearBuffer);
      }
    } catch {
      // quiet
      // Fail gracefully - don't crash the app
    }
  }, [initializeColorCycleBrush, activeLayerId]);
  
  /**
   * End color cycle stroke
   */
  const endColorCycleStroke = useCallback(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    const layerId = activeLayerId;
    if (colorCycleBrush && layerId) {
      colorCycleBrush.endStroke(layerId);
    }
  }, [activeLayerId, getActiveLayerColorCycleBrush]);
  
  /**
   * Fill a shape with linear color cycle gradient in specified direction
   */
  const fillColorCycleShapeLinear = useCallback(async (
    vertices: Array<{ x: number; y: number }>,
    direction: { x: number; y: number }
  ) => {
    // quiet
    
    // Initialize brush if needed
    const brush = initializeColorCycleBrush();
    
    const layerId = activeLayerId;

    if (brush && layerId) {
      // Ensure brush routes subsequent writes to the active layer
      brush.setLayerId?.(layerId);
      brush.setActiveLayer?.(layerId);
      // Ensure we have a layer by setting the gradient if needed
      const currentBrushLayerId = brush.getLayerId();
      if (!currentBrushLayerId || currentBrushLayerId !== layerId) {
        // quiet
        const currentGradient = tools.brushSettings.colorCycleGradient || [
          { position: 0, color: '#ff0000' },
          { position: 0.5, color: '#00ff00' },
          { position: 1, color: '#0000ff' }
        ];
        brush.setGradient(currentGradient, layerId);
      }
      
      // Ensure bands are set before filling
      const bands = tools.brushSettings.gradientBands || 12;
      brush.setGradientBands(bands);
      
      // quiet
      // Fill the shape with linear gradient
      await Promise.resolve(brush.fillShapeLinear?.(vertices, direction, layerId));

      // quiet
      // End the stroke to ensure texture is updated
      brush.endStroke(layerId);

      // quiet
      // Force a render to ensure the shape is visible
      brush.render(true);
    }
  }, [initializeColorCycleBrush, activeLayerId, tools.brushSettings.colorCycleGradient, tools.brushSettings.gradientBands]);
  
  /**
   * Fill a shape with color cycle gradient from edges to center
   */
  const fillColorCycleShape = useCallback(async (vertices: Array<{ x: number; y: number }>) => {
    // quiet
    
    // Initialize brush if needed
    const brush = initializeColorCycleBrush();
    
    const layerId = activeLayerId;

    if (brush && layerId) {
      // Ensure brush routes subsequent writes to the active layer
      brush.setLayerId?.(layerId);
      brush.setActiveLayer?.(layerId);
      // quiet
      // DON'T call startStroke here - resetColorCycle() already called it
      // This was causing the double startStroke issue that accumulated shapes
      
      // Ensure we have a layer by setting the gradient if needed
      const currentBrushLayerId = brush.getLayerId();
      if (!currentBrushLayerId || currentBrushLayerId !== layerId) {
        // quiet
        // Set the gradient to create a layer
        const currentGradient = tools.brushSettings.colorCycleGradient || [
          { position: 0, color: '#ff0000' },
          { position: 0.5, color: '#00ff00' },
          { position: 1, color: '#0000ff' }
        ];
        brush.setGradient(currentGradient, layerId);
      }
      
      // Ensure bands are set before filling
      const bands = tools.brushSettings.gradientBands || 12;
      brush.setGradientBands(bands);
      
      // The vertices are already in the correct coordinate space
      // The ColorCycleBrush internal canvas should match the project dimensions
      // No scaling needed - just pass vertices directly
      
      // quiet
      // Fill the shape with layer ID and spacing
      await Promise.resolve(brush.fillShape?.(vertices, layerId, tools.brushSettings.spacing));

      // quiet
      // End the stroke to ensure texture is updated
      brush.endStroke(layerId);

      // quiet
      // Force a render to ensure the shape is visible
      brush.render(true);
    }
  }, [initializeColorCycleBrush, activeLayerId, tools.brushSettings.colorCycleGradient, tools.brushSettings.spacing, tools.brushSettings.gradientBands]);

  // Color cycle functions removed - now defined inline in return object to avoid stale closures
  
  // Update color cycle speed when it changes
  useEffect(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    const state = useAppStore.getState();
    const activeLayer = state.layers.find(l => l.id === activeLayerId);
    const perLayerSpeed = activeLayer?.colorCycleData?.brushSpeed;
    if (colorCycleBrush && perLayerSpeed) {
      colorCycleBrush.setSpeed(perLayerSpeed);
    }
  }, [activeLayerId, activeLayerBrushSpeed, getActiveLayerColorCycleBrush]);
  
  // Update color cycle FPS when it changes
  useEffect(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (colorCycleBrush && tools.brushSettings.colorCycleFPS) {
      colorCycleBrush.setFPS(tools.brushSettings.colorCycleFPS);
    }
  }, [tools.brushSettings.colorCycleFPS, activeLayerId, getActiveLayerColorCycleBrush]);
  
  // Update gradient bands when it changes
  useEffect(() => {
    // First check if we're actually using a color cycle brush/layer
    const state = useAppStore.getState();
    const activeLayer = state.layers.find(l => l.id === activeLayerId);
    
    // Only proceed if this is a color-cycle layer
    if (activeLayer?.layerType === 'color-cycle') {
      let colorCycleBrush = getActiveLayerColorCycleBrush();
      
      // Initialize the brush if it doesn't exist yet
      if (!colorCycleBrush) {
        colorCycleBrush = initializeColorCycleBrush();
      }
      
      if (colorCycleBrush) {
        const bands = tools.brushSettings.gradientBands || 12;
        colorCycleBrush.setGradientBands(bands);
        // quiet
        
        // Force a render to show the change immediately
        colorCycleBrush.render(true);
        
        // Dispatch event for canvas update
        window.dispatchEvent(new CustomEvent('colorCycleFrameReady'));
      }
    }
  }, [tools.brushSettings.gradientBands, getActiveLayerColorCycleBrush, activeLayerId, initializeColorCycleBrush]);
  
  // Update band spacing when it changes
  useEffect(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (colorCycleBrush && tools.brushSettings.spacing) {
      colorCycleBrush.setBandSpacing(tools.brushSettings.spacing);
    }
  }, [tools.brushSettings.spacing, activeLayerId, getActiveLayerColorCycleBrush]);

  // Update dithering toggle for color-cycle shape fills
  useEffect(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (colorCycleBrush) {
      try {
        colorCycleBrush.setDitherEnabled(!!tools.brushSettings.ditherEnabled);
      } catch (error) {
        void error;
        // Non-fatal; older brushes may not support dithering
      }
    }
  }, [tools.brushSettings.ditherEnabled, activeLayerId, getActiveLayerColorCycleBrush]);

  // Update dither pixel size (fillResolution) for color-cycle shape fills
  useEffect(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (colorCycleBrush && tools.brushSettings.fillResolution) {
      try {
        colorCycleBrush.setDitherPixelSize(Math.max(1, Math.floor(tools.brushSettings.fillResolution)));
      } catch {}
    }
  }, [tools.brushSettings.fillResolution, activeLayerId, getActiveLayerColorCycleBrush]);

  // Perceptual dithering removed
  
  // Update pressure enabled when it changes
  useEffect(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (colorCycleBrush) {
      try {
        colorCycleBrush.setPressureEnabled(tools.brushSettings.pressureEnabled || false);
      } catch (error) {
        console.error('[CC Effect] Failed to set pressure enabled:', error);
      }
    }
  }, [tools.brushSettings.pressureEnabled, activeLayerId, getActiveLayerColorCycleBrush]);
  
  // Update min pressure when it changes
  useEffect(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (colorCycleBrush && tools.brushSettings.minPressure) {
      try {
        colorCycleBrush.setMinPressure(tools.brushSettings.minPressure);
      } catch (error) {
        console.error('[CC Effect] Failed to set min pressure:', error);
      }
    }
  }, [tools.brushSettings.minPressure, activeLayerId, getActiveLayerColorCycleBrush]);
  
  // Update max pressure when it changes
  useEffect(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (colorCycleBrush && tools.brushSettings.maxPressure) {
      try {
        colorCycleBrush.setMaxPressure(tools.brushSettings.maxPressure);
      } catch (error) {
        console.error('[CC Effect] Failed to set max pressure:', error);
      }
    }
  }, [tools.brushSettings.maxPressure, activeLayerId, getActiveLayerColorCycleBrush]);

  useEffect(() => {
    let previous = selectEffectiveColorCyclePlaying(useAppStore.getState());
    ensureColorCycleAnimation(previous);

    const unsubscribe = useAppStore.subscribe((state) => {
      const next = selectEffectiveColorCyclePlaying(state);
      if (next === previous) {
        return;
      }
      previous = next;
      ensureColorCycleAnimation(next);
    });

    return () => {
      unsubscribe();
    };
  }, [ensureColorCycleAnimation, activeLayerId]);

  // Clean up resources
  useEffect(() => {
    const cache = brushStampCacheRef.current;
    return () => {
      // Clear brush stamp cache on unmount
      cache.clear();

      // DON'T cleanup color cycle brush when switching layers!
      // This was causing the crash - the brush was being destroyed
      // but the layer still thought it had a CC brush.
      // CC brushes should persist with their layers.
    };
  }, []); // Empty dependency array - only cleanup on unmount

  // Return simplified API - NO useMemo to avoid stale closures
  return {
    // Core drawing functions
    drawBrush,
    drawStamp,
    finalizeStroke,
    resetStroke,
    
    // Shape drawing
    drawRectangleGradient,
    drawPolygonGradient,
    drawContourPolygon,
    drawCrossHatchPolygon,
    drawDelaunayPolygon,
    
    // Color cycle brush
    drawColorCycle,
    renderColorCycle,
    resetColorCycle,
    endColorCycleStroke,
    fillColorCycleShape,
    fillColorCycleShapeLinear,
    
    // Force immediate texture update for color cycle brush
    updateColorCycleTexture: () => {
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (colorCycleBrush) {
        // Force a render to update the texture
        if (typeof colorCycleBrush.render === 'function') {
          colorCycleBrush.render(true); // Force full render
        }
      }
    },
    
    // These need fresh ref access, define inline:
    updateColorCycleGradient: (stops: Array<{ position: number; color: string }>) => {
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (!colorCycleBrush || !activeLayerId) {
        return;
      }

      colorCycleBrush.setGradient(stops, activeLayerId);

      // Force the brush to rebuild its palette caches immediately so the next render uses
      // the updated gradient without waiting for the animation loop.
      try {
        if (typeof colorCycleBrush.render === 'function') {
          colorCycleBrush.render(true);
        } else if (hasForceRender(colorCycleBrush)) {
          colorCycleBrush.forceRender();
        }
      } catch (error) {
        console.warn('[ColorCycle] Failed to force render after gradient update:', error);
      }

      const { layers, setLayersNeedRecomposition } = useAppStore.getState();
      const activeLayer = layers.find(layer => layer.id === activeLayerId);
      const layerCanvas = activeLayer?.colorCycleData?.canvas;

      if (layerCanvas && typeof colorCycleBrush.renderDirectToCanvas === 'function') {
        try {
          colorCycleBrush.renderDirectToCanvas?.(layerCanvas, activeLayerId);
        } catch (error) {
          console.warn('[ColorCycle] Failed to redraw layer canvas after gradient update:', error);
        }
      }

      try {
        setLayersNeedRecomposition(true);
      } catch {}
    },
    
    updateColorCycleSpeed: (speed: number) => {
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (colorCycleBrush) {
        colorCycleBrush.setSpeed(speed);
      }
    },
    
    setColorCycleFlowDirection: (direction: 'forward' | 'backward') => {
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (colorCycleBrush) {
        colorCycleBrush.setFlowDirection(direction);
      }
    },

    ensureColorCycleAnimation: (shouldPlay: boolean) => {
      ensureColorCycleAnimation(shouldPlay);
    },
    
    updateColorCycleAnimation: () => {
      // Manually update animation state for external render loops
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (colorCycleBrush) {
        colorCycleBrush.updateAnimation();
      }
    },
    
    isColorCycleAnimating: () => {
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (!colorCycleBrush) return false;
      return colorCycleBrush.isPlaying();
    },
    
    clearColorCycleStrokes: () => {
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (colorCycleBrush) {
        colorCycleBrush.clear();
      }
    },
    
    ensureColorCycleBrush: () => {
      // CRITICAL: Only ensure brush for color-cycle layers
      const state = useAppStore.getState();
      const activeLayer = state.layers.find(l => l.id === activeLayerId);
      if (!activeLayer || activeLayer.layerType !== 'color-cycle') {
        // Silently skip for non-CC layers
        return;
      }
      
      // Ensure brush exists without starting a stroke
      let colorCycleBrush = getActiveLayerColorCycleBrush();
      if (!colorCycleBrush) {
        initializeColorCycleBrush();
        colorCycleBrush = getActiveLayerColorCycleBrush();
      }
      // Make sure it's not in drawing mode for animation
      const layerId = activeLayerId;
      if (colorCycleBrush && layerId) {
        colorCycleBrush.endStroke(layerId);
      }
    },
    
    // Effects
    applyDithering,
    
    // Utilities
    canDrawAt: (ctx: CanvasRenderingContext2D, x: number, y: number) => 
      brushEngine.canDrawAt(ctx, x, y),
    
    // Direct access to engine for advanced use
    engine: brushEngine
  };
};

// Export type for the hook return value
export type BrushEngine = ReturnType<typeof useBrushEngineSimplified>;
