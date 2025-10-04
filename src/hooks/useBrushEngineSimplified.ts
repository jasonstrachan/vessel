/**
 * Simplified Brush Engine Hook
 * Clean interface using the facade pattern
 */

import { useCallback, useMemo, useRef, useEffect } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { createBrushEngineFacade, type BrushEngineConfig, type BrushStrokeParams, type CustomBrushStrokeData } from './brushEngine/BrushEngineFacade';
import { BrushShape } from '../types';
import { getRisographPattern } from '../utils/risographTexture';
import { applyDithering as applyDitheringImport, applyDitheringWithFillResolution } from './brushEngine/dithering';
import { canvasPool } from '../utils/canvasPool';
import {
  drawContourPolygon as drawContourPolygonFill,
  type ContourLineOptions,
} from '@/brushes/shapes/fills/contourPolygon';
import { drawCrossHatchPolygon as drawCrossHatchPolygonFill } from '@/brushes/shapes/fills/hatch';
// Use migration wrapper to switch between WebGL and Canvas2D implementations
import { type ColorCycleBrushImplementation } from './brushEngine/ColorCycleBrushMigration';
import { ShapeFillScheduler } from '@/lib/shapeFill/ShapeFillScheduler';
import { getShapeFillScheduler } from '@/lib/shapeFill/runtime';
import { debugLog } from '@/utils/debug';

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

type SignedDistanceFieldResult = {
  field: number[][];
  cols: number;
  rows: number;
  resolution: number;
  peakX: number;
  peakY: number;
  extension: number;
};

const isTransparencyLockEnabled = () =>
  typeof window !== 'undefined' && window.transparencyLockEnabled === true;

const hasForceRender = (
  brush: ColorCycleBrushImplementation | null
): brush is ColorCycleBrushImplementation & { forceRender: () => void } => {
  return Boolean(brush && typeof (brush as { forceRender?: unknown }).forceRender === 'function');
};

export const useBrushEngineSimplified = () => {
  const { tools, project, activeLayerId } = useAppStore();
  // Track per-layer CC brush speed for the active layer
  const activeLayerBrushSpeed = useAppStore((state) => {
    const layer = state.layers.find(l => l.id === state.activeLayerId);
    return layer?.colorCycleData?.brushSpeed;
  });
  
  // Cache for brush stamps
  const brushStampCacheRef = useRef(new Map<string, HTMLCanvasElement>());
  const patternTempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rotationTempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const contourFieldCacheRef = useRef<{ key: string; field: SignedDistanceFieldResult } | null>(null);
  const shapeFillSchedulerRef = useRef<ShapeFillScheduler | null>(null);
  
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

  // Create brush engine facade - only recreate when structural dependencies change
  const brushEngine = useMemo(() => {
    const config: BrushEngineConfig = {
      brushSettings: tools.brushSettings,
      transparencyLockEnabled: isTransparencyLockEnabled(),
      getPatternTempContext,
      brushStampCache: brushStampCacheRef.current,
      createPixelCircleStamp,
      createPixelSquareStamp,
      getRotationTempContext,
      customBrushes: project?.customBrushes || []
    };
    
    return createBrushEngineFacade(config);
  }, [tools.brushSettings, project?.customBrushes, getPatternTempContext, createPixelCircleStamp, createPixelSquareStamp, getRotationTempContext]);

  // Update engine config when settings change
  useEffect(() => {
    brushEngine.updateConfig({
      brushSettings: tools.brushSettings,
      transparencyLockEnabled: isTransparencyLockEnabled(),
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
  }, [brushEngine, tools.brushSettings, getPatternTempContext, getRotationTempContext]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const scheduler = getShapeFillScheduler();
    shapeFillSchedulerRef.current = scheduler;

    const unsubscribe = scheduler && process.env.NODE_ENV !== 'production'
      ? scheduler.subscribe(event => {
          if (event.type === 'completed') {
            debugLog('shape-fill', `GPU job ${event.jobId} (${event.priority})`, {
              diagnostics: event.diagnostics,
              metrics: event.metrics,
            });
          }
        })
      : undefined;

    return () => {
      unsubscribe?.();
      if (shapeFillSchedulerRef.current === scheduler) {
        shapeFillSchedulerRef.current = null;
      }
    };
  }, []);

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
    brushEngine.renderBrushStroke(ctx, strokeParams);
  }, [brushEngine]);

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

    brushEngine.renderBrushStroke(ctx, strokeParams);
  }, [brushEngine]);

  /**
   * Finalize the current stroke (draw any waiting pixels)
   */
  const finalizeStroke = useCallback((ctx: CanvasRenderingContext2D) => {
    brushEngine.finalizeStroke(ctx);
  }, [brushEngine]);

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

    // Save context state
    ctx.save();
    
    // Use pixel-perfect rendering for pixel brushes, antialiasing for others
    ctx.imageSmoothingEnabled = !isPixelBrush;
    
    // Apply opacity and blend mode
    ctx.globalAlpha = tools.brushSettings.opacity;
    ctx.globalCompositeOperation = tools.brushSettings.blendMode || 'source-over';

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
        ctx.globalCompositeOperation = 'multiply';
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
  }, [tools.brushSettings.color, tools.brushSettings.risographIntensity, tools.brushSettings.ditherEnabled, tools.brushSettings.colors, tools.brushSettings.gradientBands, tools.brushSettings.fillResolution, tools.brushSettings.ditherAlgorithm, tools.brushSettings.patternStyle, tools.brushSettings.opacity, tools.brushSettings.blendMode, isPixelBrush]);

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
      ctx.globalCompositeOperation = 'multiply';
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
  }, []);

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
    
    // Save context state
    ctx.save();
    
    // Apply opacity and blend mode
    ctx.globalAlpha = tools.brushSettings.opacity;
    ctx.globalCompositeOperation = tools.brushSettings.blendMode || 'source-over';
    
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
  }, [tools.brushSettings.risographIntensity, tools.brushSettings.opacity, tools.brushSettings.blendMode, tools.brushSettings.ditherEnabled, tools.brushSettings.colors, tools.brushSettings.gradientBands, tools.brushSettings.fillResolution, tools.brushSettings.ditherAlgorithm, tools.brushSettings.patternStyle, tools.brushSettings.color, applyRisographEffect]);


  /**
   * Helper functions for signed distance field contours
   */
  const distanceToPolygonSDF = useCallback((
    point: { x: number; y: number },
    vertices: Array<{ x: number; y: number }>
  ): number => {
    let minDist = Infinity;
    const n = vertices.length;
    
    for (let i = 0; i < n; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % n];
      
      const dx = v2.x - v1.x;
      const dy = v2.y - v1.y;
      const lenSq = dx * dx + dy * dy;
      
      let t = 0;
      if (lenSq > 0) {
        t = Math.max(0, Math.min(1, ((point.x - v1.x) * dx + (point.y - v1.y) * dy) / lenSq));
      }
      
      const projX = v1.x + t * dx;
      const projY = v1.y + t * dy;
      const dist = Math.sqrt(Math.pow(point.x - projX, 2) + Math.pow(point.y - projY, 2));
      
      minDist = Math.min(minDist, dist);
    }
    
    return minDist;
  }, []);
  
  const isPointInPolygonSDF = useCallback((
    point: { x: number; y: number },
    vertices: Array<{ x: number; y: number }>
  ): boolean => {
    let inside = false;
    const n = vertices.length;
    
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = vertices[i].x, yi = vertices[i].y;
      const xj = vertices[j].x, yj = vertices[j].y;
      
      if (((yi > point.y) !== (yj > point.y)) &&
          (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    
    return inside;
  }, []);
  
  /**
   * Create signed distance field for contour generation
   */
  const createSignedDistanceField = useCallback((
    vertices: Array<{ x: number; y: number }>,
    canvasWidth: number,
    canvasHeight: number,
    resolution: number = 2
  ): SignedDistanceFieldResult => {
    const roundedKey = vertices
      .map(v => `${Math.round(v.x)}:${Math.round(v.y)}`)
      .join('|');
    const cacheKey = `${canvasWidth}x${canvasHeight}@${resolution}:${roundedKey}`;

    if (contourFieldCacheRef.current?.key === cacheKey) {
      return contourFieldCacheRef.current.field;
    }

    const cachedFromScheduler = shapeFillSchedulerRef.current?.getCpuField<SignedDistanceFieldResult>(cacheKey);
    if (cachedFromScheduler) {
      contourFieldCacheRef.current = { key: cacheKey, field: cachedFromScheduler };
      return cachedFromScheduler;
    }

    // Extend field beyond canvas boundaries to allow contours to go off-screen
    const extension = 300; // Pixels to extend beyond each edge
    const extendedWidth = canvasWidth + extension * 2;
    const extendedHeight = canvasHeight + extension * 2;
    const cols = Math.ceil(extendedWidth / resolution);
    const rows = Math.ceil(extendedHeight / resolution);
    const distanceField: number[][] = [];
    
    // Calculate polygon center and bounds
    let sumX = 0, sumY = 0;
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    
    vertices.forEach(v => {
      sumX += v.x;
      sumY += v.y;
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    });
    
    const centerX = sumX / vertices.length;
    const centerY = sumY / vertices.length;
    const polyWidth = maxX - minX;
    const polyHeight = maxY - minY;
    
    // Create random offset for peak - very extreme offset from center
    const offsetX = (Math.random() - 0.5) * polyWidth * 1.2;  // Can go beyond polygon bounds
    const offsetY = (Math.random() - 0.5) * polyHeight * 1.2;  // Can go beyond polygon bounds
    const peakX = centerX + offsetX;
    const peakY = centerY + offsetY;
    
    // Build field with offset peak (accounting for extension)
    for (let y = 0; y < rows; y++) {
      distanceField[y] = [];
      for (let x = 0; x < cols; x++) {
        // Adjust coordinates to account for extension
        const px = x * resolution - extension;
        const py = y * resolution - extension;
        const point = { x: px, y: py };
        
        const inside = isPointInPolygonSDF(point, vertices);
        
        if (inside) {
          const edgeDist = distanceToPolygonSDF(point, vertices);
          const peakDist = Math.sqrt(Math.pow(px - peakX, 2) + Math.pow(py - peakY, 2));
          const maxPossibleDist = Math.max(polyWidth, polyHeight);
          const normalizedPeakDist = peakDist / maxPossibleDist;
          
          // Create a clearer peak by using a Gaussian-like falloff from the peak position
          // Peak influence decreases more dramatically with distance
          const peakInfluence = Math.exp(-normalizedPeakDist * normalizedPeakDist * 8);
          const baseElevation = edgeDist;
          const peakBoost = baseElevation * peakInfluence * 0.8;
          const elevation = baseElevation + peakBoost;
          
          distanceField[y][x] = elevation;
        } else {
          distanceField[y][x] = -distanceToPolygonSDF(point, vertices);
        }
      }
    }
    
    const result: SignedDistanceFieldResult = { field: distanceField, cols, rows, resolution, peakX, peakY, extension };
    contourFieldCacheRef.current = { key: cacheKey, field: result };
    shapeFillSchedulerRef.current?.setCpuField(cacheKey, result);
    return result;
  }, [distanceToPolygonSDF, isPointInPolygonSDF]);

  /**
   * Extract contour using marching squares
   */
  const extractContour = useCallback((
    field: number[][],
    cols: number,
    rows: number,
    resolution: number,
    targetDistance: number,
    extension: number = 0
  ) => {
    const segments: Array<[{ x: number; y: number }, { x: number; y: number }]> = [];
    
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols - 1; x++) {
        const tl = field[y][x];
        const tr = field[y][x + 1];
        const br = field[y + 1][x + 1];
        const bl = field[y + 1][x];
        
        if (Math.max(tl, tr, br, bl) < 0) continue;
        
        const min = Math.min(tl, tr, br, bl);
        const max = Math.max(tl, tr, br, bl);
        
        if (min <= targetDistance && max >= targetDistance) {
          const points: Array<{ x: number; y: number }> = [];
          
          // Check each edge for intersection with better interpolation
          // Adjust coordinates back to canvas space by subtracting extension
          if ((tl - targetDistance) * (tr - targetDistance) < 0) {
            const t = Math.max(0, Math.min(1, (targetDistance - tl) / (tr - tl)));
            points.push({
              x: (x + t) * resolution - extension,
              y: y * resolution - extension
            });
          }
          
          if ((tr - targetDistance) * (br - targetDistance) < 0) {
            const t = Math.max(0, Math.min(1, (targetDistance - tr) / (br - tr)));
            points.push({
              x: (x + 1) * resolution - extension,
              y: (y + t) * resolution - extension
            });
          }
          
          if ((br - targetDistance) * (bl - targetDistance) < 0) {
            const t = Math.max(0, Math.min(1, (targetDistance - br) / (bl - br)));
            points.push({
              x: (x + 1 - t) * resolution - extension,
              y: (y + 1) * resolution - extension
            });
          }
          
          if ((bl - targetDistance) * (tl - targetDistance) < 0) {
            const t = Math.max(0, Math.min(1, (targetDistance - bl) / (tl - bl)));
            points.push({
              x: x * resolution - extension,
              y: (y + 1 - t) * resolution - extension
            });
          }
          
          // Create segments based on marching squares configuration
          if (points.length === 2) {
            segments.push([points[0], points[1]]);
          } else if (points.length === 4) {
            // Handle saddle case by connecting opposite pairs
            const config = [
              tl > targetDistance ? 1 : 0,
              tr > targetDistance ? 1 : 0,
              br > targetDistance ? 1 : 0,
              bl > targetDistance ? 1 : 0
            ].join('');
            
            // Connect points properly based on the configuration
            if (config === '0110' || config === '1001') {
              // Saddle cases - connect diagonal opposites
              segments.push([points[0], points[3]]);
              segments.push([points[1], points[2]]);
            } else {
              // Normal case - connect adjacent points
              segments.push([points[0], points[1]]);
              segments.push([points[2], points[3]]);
            }
          }
        }
      }
    }
    
    return segments;
  }, []);
  
  /**
   * Connect segments into continuous loops
   */
  const connectSegments = useCallback((
    segments: Array<[{ x: number; y: number }, { x: number; y: number }]>
  ): Array<Array<{ x: number; y: number }>> => {
    if (segments.length === 0) return [];
    
    const loops: Array<Array<{ x: number; y: number }>> = [];
    const used = new Array(segments.length).fill(false);
    const tolerance = 3; // Increased tolerance for better segment connection
    
    for (let i = 0; i < segments.length; i++) {
      if (used[i]) continue;
      
      const loop = [segments[i][0], segments[i][1]];
      used[i] = true;
      
      let found = true;
      while (found) {
        found = false;
        const last = loop[loop.length - 1];
        let bestMatch = -1;
        let bestDistance = Infinity;
        let useP1 = true;
        
        // Find the closest unused segment endpoint
        for (let j = 0; j < segments.length; j++) {
          if (used[j]) continue;
          
          const [p1, p2] = segments[j];
          
          const dist1 = Math.hypot(p1.x - last.x, p1.y - last.y);
          const dist2 = Math.hypot(p2.x - last.x, p2.y - last.y);
          
          if (dist1 < tolerance && dist1 < bestDistance) {
            bestDistance = dist1;
            bestMatch = j;
            useP1 = false; // Use p2 as the next point
          }
          if (dist2 < tolerance && dist2 < bestDistance) {
            bestDistance = dist2;
            bestMatch = j;
            useP1 = true; // Use p1 as the next point
          }
        }
        
        if (bestMatch !== -1) {
          const [p1, p2] = segments[bestMatch];
          loop.push(useP1 ? p1 : p2);
          used[bestMatch] = true;
          found = true;
        }
      }
      
      // Try to close the loop by connecting end to start
      if (loop.length > 3) {
        const first = loop[0];
        const last = loop[loop.length - 1];
        const closingDistance = Math.hypot(first.x - last.x, first.y - last.y);
        
        // If the loop is nearly closed, ensure it's properly closed
        if (closingDistance < tolerance * 2) {
          // Remove the last point if it's very close to the first
          if (closingDistance < tolerance / 2) {
            loop.pop();
          }
        }
        
        if (loop.length > 3) {
          loops.push(loop);
        }
      }
    }
    
    return loops;
  }, []);
  
  /**
   * Draw contour polygon - creates contour lines like a topographic map using distance fields
   */
  const drawContourPolygon = useCallback((
    ctx: CanvasRenderingContext2D,
    polygonData: { vertices: Array<{ x: number; y: number }>; fillColor?: string },
    isPreview: boolean = false,
    lineOptions?: ContourLineOptions
  ) => {
    drawContourPolygonFill({
      ctx,
      polygonData,
      brushSettings: tools.brushSettings,
      isPreview,
      lineOptions,
      dependencies: {
        applyRisographEffect,
        createSignedDistanceField,
        extractContour,
        connectSegments,
        gpuScheduler: shapeFillSchedulerRef.current ?? undefined,
      },
    });
  }, [
    tools.brushSettings,
    applyRisographEffect,
    createSignedDistanceField,
    extractContour,
    connectSegments,
    shapeFillSchedulerRef,
  ]);

  /**
   * Draw cross-hatch polygon - fills with rough, hand-drawn cross-hatching pattern
   */
  const drawCrossHatchPolygon = useCallback((
    ctx: CanvasRenderingContext2D,
    polygonData: {
      vertices: Array<{ x: number; y: number }>;
      fillColor?: string;
      spacingOverride?: number;
      rotationOverride?: number;
      lineWidthOverride?: number;
    },
    isPreview: boolean = false
  ) => {
    drawCrossHatchPolygonFill({
      ctx,
      polygonData,
      brushSettings: tools.brushSettings,
      isPreview,
      dependencies: {
        gpuScheduler: shapeFillSchedulerRef.current ?? undefined,
      },
    });
  }, [
    tools.brushSettings,
    shapeFillSchedulerRef,
  ]);

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
        const shouldEnablePressure = tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE ? true : (tools.brushSettings.pressureEnabled || false);
        colorCycleBrush.setPressureEnabled(shouldEnablePressure);
        // quiet
        // Always set pressure values, using sensible defaults if not specified
        colorCycleBrush.setMinPressure(tools.brushSettings.minPressure || 50);
        colorCycleBrush.setMaxPressure(tools.brushSettings.maxPressure || 200);
      } catch (error) {
        console.error('[CC Init] Failed to set pressure settings:', error);
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
    const effectivePressureEnabled = tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE
      ? true
      : !!storePressureEnabled;
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
    getActiveLayerColorCycleBrush
  ]);
  
  /**
   * Render Color Cycle - UNIFIED rendering approach
   * Prioritizes direct rendering to layer canvas, falls back to context compositing
   */
  const renderColorCycle = useCallback((ctx: CanvasRenderingContext2D, applyOpacity: boolean = true, targetCanvas?: HTMLCanvasElement) => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (!colorCycleBrush) return;
    
    // UNIFIED PATH: Always prefer direct rendering when possible
    if (targetCanvas && activeLayerId) {
      // Direct render to layer canvas - this is the preferred path
      colorCycleBrush.renderDirectToCanvas(targetCanvas, activeLayerId);
      return;
    }
    
    // FALLBACK: Context compositing only when no target canvas
    const prevComposite = ctx.globalCompositeOperation;
    const prevAlpha = ctx.globalAlpha;
    
    try {
      // Set blend mode
      ctx.globalCompositeOperation = tools.brushSettings.blendMode || 'source-over';
      
      // Ensure we have the latest frame (single update call)
      colorCycleBrush.render(!applyOpacity); // Full opacity when finalizing
      
      // Get the internal canvas
      const internalCanvas = colorCycleBrush.getCanvas();
      if (!internalCanvas) return;
      
      // Apply appropriate opacity
      ctx.globalAlpha = applyOpacity ? tools.brushSettings.opacity : 1.0;
      
      // Composite the internal canvas
      ctx.drawImage(internalCanvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
      
    } finally {
      // Always restore state
      ctx.globalCompositeOperation = prevComposite;
      ctx.globalAlpha = prevAlpha;
    }
  }, [tools.brushSettings.blendMode, tools.brushSettings.opacity, activeLayerId, getActiveLayerColorCycleBrush]);
  
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
  const fillColorCycleShapeLinear = useCallback((vertices: Array<{ x: number; y: number }>, direction: { x: number; y: number }) => {
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
      brush.fillShapeLinear(vertices, direction, layerId);

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
  const fillColorCycleShape = useCallback((vertices: Array<{ x: number; y: number }>) => {
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
      brush.fillShape(vertices, layerId, tools.brushSettings.spacing);

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
    
    toggleColorCycleAnimation: () => {
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (!colorCycleBrush) {
        const brush = initializeColorCycleBrush();
        if (brush) {
          // Start animation properly
          brush.startAnimation();
        }
      } else {
        colorCycleBrush.togglePlayPause();
      }
    },

    // Explicit pause/resume to avoid unintended state resets when toggling
    resumeColorCycleAnimation: () => {
      // Ensure brush exists for the active CC layer
      let colorCycleBrush = getActiveLayerColorCycleBrush();
      if (!colorCycleBrush) {
        colorCycleBrush = initializeColorCycleBrush();
      }
      if (colorCycleBrush) {
        // If not animating at all, start; if paused, resume
        if (!colorCycleBrush.isPlaying()) {
          // startAnimation ensures callbacks are hooked without clearing buffers
          colorCycleBrush.startAnimation();
        } else {
          // Already playing; nothing to do
        }
      }
    },

    pauseColorCycleAnimation: () => {
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (colorCycleBrush) {
        // Pause without clearing pixels or resetting buffers
        if (colorCycleBrush.pause) {
          colorCycleBrush.pause();
        } else if (colorCycleBrush.stopAnimation) {
          // Fallback if API surface differs
          colorCycleBrush.stopAnimation();
        }
      }
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
