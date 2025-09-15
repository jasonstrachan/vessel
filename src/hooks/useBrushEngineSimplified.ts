/**
 * Simplified Brush Engine Hook
 * Clean interface using the facade pattern
 */

import { useCallback, useMemo, useRef, useEffect } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { createBrushEngineFacade, type BrushEngineConfig, type BrushStrokeParams } from './brushEngine/BrushEngineFacade';
import { BrushShape } from '../types';
import { getRisographPattern } from '../utils/risographTexture';
import { applyDithering as applyDitheringImport, applyDitheringWithFillResolution } from './brushEngine/dithering';
import { debugLog } from '@/utils/debug';
import { canvasPool } from '../utils/canvasPool';
// Use migration wrapper to switch between WebGL and Canvas2D implementations
import { createColorCycleBrush, type ColorCycleBrushImplementation } from './brushEngine/ColorCycleBrushMigration';
import { featureFlags } from '../config/featureFlags';

/**
 * Simplified brush engine hook with facade pattern
 */
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
      (ctx as any)._canvas = canvas;
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
      transparencyLockEnabled: typeof window !== 'undefined' ? (window as any).transparencyLockEnabled : false,
      getPatternTempContext,
      brushStampCache: brushStampCacheRef.current,
      createPixelCircleStamp,
      createPixelSquareStamp,
      getRotationTempContext,
      customBrushes: project?.customBrushes || []
    };
    
    return createBrushEngineFacade(config);
  }, [project?.customBrushes, getPatternTempContext, createPixelCircleStamp, createPixelSquareStamp, getRotationTempContext]);

  // Update engine config when settings change
  useEffect(() => {
    brushEngine.updateConfig({
      brushSettings: tools.brushSettings,
      transparencyLockEnabled: typeof window !== 'undefined' ? (window as any).transparencyLockEnabled : false,
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
  }, [tools.brushSettings.risographIntensity, tools.brushSettings.ditherEnabled, tools.brushSettings.colors, tools.brushSettings.gradientBands, tools.brushSettings.fillResolution, tools.brushSettings.ditherAlgorithm, tools.brushSettings.patternStyle, tools.brushSettings.antialiasing, tools.brushSettings.opacity, tools.brushSettings.blendMode, isPixelBrush]);

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
  }, [tools.brushSettings.risographIntensity]);

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
        
        // Set up clipping path with antialiasing for smooth edges
        ctx.save();
        ctx.imageSmoothingEnabled = true; // Ensure antialiasing is on
        ctx.beginPath();
        ctx.moveTo(validVertices[0].x, validVertices[0].y);
        validVertices.slice(1).forEach(vertex => ctx.lineTo(vertex.x, vertex.y));
        ctx.closePath();
        ctx.clip();
        
        // Draw the dithered pattern (will be clipped to polygon shape)
        ctx.imageSmoothingEnabled = false; // Don't smooth the dither pattern itself
        ctx.drawImage(tempCanvas, minX - padding, minY - padding);
        
        // Restore clipping
        ctx.restore();
        
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
  }, [tools.brushSettings.risographIntensity, tools.brushSettings.opacity, tools.brushSettings.blendMode, tools.brushSettings.ditherEnabled, tools.brushSettings.colors, tools.brushSettings.gradientBands, tools.brushSettings.fillResolution, tools.brushSettings.ditherAlgorithm, tools.brushSettings.patternStyle, tools.brushSettings.color, applyRisographEffect, isPixelBrush]);


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
  ) => {
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
    
    return { field: distanceField, cols, rows, resolution, peakX, peakY, extension };
  }, [distanceToPolygonSDF, isPointInPolygonSDF]);

  /**
   * Build a distance field measured from a set of seed edges (segments) only.
   * Positive inside the polygon = distance to the nearest seed edge.
   * Negative outside = -distance to the polygon boundary (for robust marching squares at edges).
   */
  const createEdgeDistanceField = useCallback((
    vertices: Array<{ x: number; y: number }>,
    seedEdges: Array<{ a: { x: number; y: number }; b: { x: number; y: number } }>,
    canvasWidth: number,
    canvasHeight: number,
    resolution: number = 2,
    useInfiniteLines: boolean = false
  ) => {
    const extension = 300;
    const extendedWidth = canvasWidth + extension * 2;
    const extendedHeight = canvasHeight + extension * 2;
    const cols = Math.ceil(extendedWidth / resolution);
    const rows = Math.ceil(extendedHeight / resolution);
    const field: number[][] = [];

    const distToSeg = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
      const vx = b.x - a.x, vy = b.y - a.y;
      const wx = p.x - a.x, wy = p.y - a.y;
      const len2 = vx * vx + vy * vy || 1e-5;
      let t = (wx * vx + wy * vy) / len2;
      t = Math.max(0, Math.min(1, t));
      const cx = a.x + vx * t;
      const cy = a.y + vy * t;
      return Math.hypot(p.x - cx, p.y - cy);
    };
    const distToInfLine = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
      const vx = b.x - a.x, vy = b.y - a.y;
      const len = Math.hypot(vx, vy) || 1e-5;
      // area of parallelogram divided by base length = distance to infinite line
      const cross = Math.abs((p.x - a.x) * vy - (p.y - a.y) * vx);
      return cross / len;
    };

    for (let y = 0; y < rows; y++) {
      field[y] = [];
      for (let x = 0; x < cols; x++) {
        const px = x * resolution - extension;
        const py = y * resolution - extension;
        const point = { x: px, y: py };
        const inside = isPointInPolygonSDF(point, vertices);
        if (inside) {
          let d = Infinity;
          for (const e of seedEdges) {
            const de = useInfiniteLines ? distToInfLine(point, e.a, e.b) : distToSeg(point, e.a, e.b);
            if (de < d) d = de;
          }
          field[y][x] = isFinite(d) ? d : 0;
        } else {
          field[y][x] = -distanceToPolygonSDF(point, vertices);
        }
      }
    }

    return { field, cols, rows, resolution, extension };
  }, [isPointInPolygonSDF, distanceToPolygonSDF]);

  /**
   * Extract polygon edges with angle and length
   */
  const getPolygonEdges = useCallback((
    vertices: Array<{ x: number; y: number }>
  ) => {
    const edges: Array<{ a: { x: number; y: number }; b: { x: number; y: number }; angle: number; length: number; index: number }> = [];
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i];
      const b = vertices[(i + 1) % vertices.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const angle = Math.atan2(dy, dx);
      const length = Math.hypot(dx, dy);
      edges.push({ a, b, angle, length, index: i });
    }
    return edges;
  }, []);
  
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
   * Gaussian smooth for natural contour lines
   */
  const gaussianSmooth = useCallback((
    points: Array<{ x: number; y: number }>,
    sigma: number = 1.5,
    iterations: number = 2
  ): Array<{ x: number; y: number }> => {
    let smooth = [...points];
    const actualIterations = Math.ceil(iterations * (sigma / 1.5));
    
    for (let iter = 0; iter < actualIterations; iter++) {
      const newPoints: Array<{ x: number; y: number }> = [];
      const n = smooth.length;
      const kernelRadius = Math.min(Math.ceil(sigma * 2), 10);
      
      for (let i = 0; i < n; i++) {
        let x = 0, y = 0;
        let weightSum = 0;
        
        for (let k = -kernelRadius; k <= kernelRadius; k++) {
          const idx = (i + k + n * 10) % n;
          const weight = Math.exp(-(k * k) / (2 * sigma * sigma));
          
          x += smooth[idx].x * weight;
          y += smooth[idx].y * weight;
          weightSum += weight;
        }
        
        newPoints.push({
          x: x / weightSum,
          y: y / weightSum
        });
      }
      
      smooth = newPoints;
    }
    
    return smooth;
  }, []);

  /**
   * Draw contour polygon - creates contour lines like a topographic map using distance fields
   */
  const drawContourPolygon = useCallback((
    ctx: CanvasRenderingContext2D,
    polygonData: { vertices: Array<{ x: number; y: number }>; fillColor?: string },
    isPreview: boolean = false
  ) => {
    const { vertices, fillColor } = polygonData || {};
    
    if (!vertices || !Array.isArray(vertices) || vertices.length < 3) return;
    
    // Validate all vertices
    const validVertices = vertices.filter(v => v && typeof v.x === 'number' && typeof v.y === 'number');
    if (validVertices.length < 3) return;

    // Save context state
    ctx.save();
    
    // Use pixel-perfect rendering for crisp hard edges
    ctx.imageSmoothingEnabled = false;
    ctx.lineJoin = 'miter';  // Use miter join for sharp corners
    ctx.lineCap = 'butt';    // Use butt cap for clean ends
    
    // Apply opacity and blend mode
    ctx.globalAlpha = tools.brushSettings.opacity;
    ctx.globalCompositeOperation = tools.brushSettings.blendMode || 'source-over';

    // Fill the polygon first with sampled color (from first click) if provided
    try {
      const fc = fillColor || undefined;
      if (fc && validVertices.length >= 3) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(Math.round(validVertices[0].x), Math.round(validVertices[0].y));
        for (let i = 1; i < validVertices.length; i++) {
          ctx.lineTo(Math.round(validVertices[i].x), Math.round(validVertices[i].y));
        }
        ctx.closePath();
        const prevStyle = ctx.fillStyle;
        const prevAlpha = ctx.globalAlpha;
        ctx.fillStyle = fc;
        ctx.globalAlpha = tools.brushSettings.opacity;
        ctx.fill();
        ctx.fillStyle = prevStyle as any;
        ctx.globalAlpha = prevAlpha;
        ctx.restore();
      }
    } catch {}
    
    // Check the shape gradient mode and render accordingly
    const mode = tools.brushSettings.shapeGradientMode || 'contour';
    
    // Calculate bounds for all modes
    const minX = Math.floor(Math.min(...validVertices.map(v => v.x)));
    const minY = Math.floor(Math.min(...validVertices.map(v => v.y)));
    const maxX = Math.ceil(Math.max(...validVertices.map(v => v.x)));
    const maxY = Math.ceil(Math.max(...validVertices.map(v => v.y)));
    const boundWidth = maxX - minX;
    const boundHeight = maxY - minY;
    
    if (mode === 'mesh') {
      // Curvilinear mesh aligned to one chosen edge (U iso-lines) and an orthogonal family (V lines)
      ctx.strokeStyle = tools.brushSettings.color;
      ctx.lineWidth = 1;
      ctx.imageSmoothingEnabled = false;

      // Choose base edge = longest edge, and the opposite parallel edge = farthest from base
      const edges = getPolygonEdges(validVertices);
      const baseEdge = edges.reduce((best, e) => (e.length > best.length ? e : best), edges[0]);
      const baseAngle = baseEdge.angle;
      const angleDiff = (a: number, b: number) => {
        let d = a - b;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        return Math.abs(d);
      };
      const parallelTol = Math.PI / 12; // 15°

      // Base edge line normal (for separation)
      const bdx = baseEdge.b.x - baseEdge.a.x;
      const bdy = baseEdge.b.y - baseEdge.a.y;
      const blen = Math.hypot(bdx, bdy) || 1e-5;
      const bn = { x: -bdy / blen, y: bdx / blen };
      const distToBaseLine = (p: { x: number; y: number }) => Math.abs((p.x - baseEdge.a.x) * bn.x + (p.y - baseEdge.a.y) * bn.y);

      // Find the opposite edge: parallel and with max separation
      let oppEdge = baseEdge;
      let maxSep = -1;
      for (const e of edges) {
        if (e.index === baseEdge.index) continue;
        const diff = angleDiff(e.angle, baseAngle);
        const isParallel = diff < parallelTol || Math.abs(diff - Math.PI) < parallelTol;
        if (!isParallel) continue;
        const sep = (distToBaseLine(e.a) + distToBaseLine(e.b)) * 0.5;
        if (sep > maxSep) {
          maxSep = sep;
          oppEdge = e;
        }
      }

      // Build distance field from the two opposite sides only (conform to both sides, not all)
      const fieldData = createEdgeDistanceField(
        validVertices,
        [
          { a: baseEdge.a, b: baseEdge.b },
          { a: oppEdge.a, b: oppEdge.b }
        ],
        ctx.canvas.width,
        ctx.canvas.height,
        2,
        true // use infinite supporting lines so other sides don't influence curvature
      );

      // Bilinear sampling of field at world coords
      const sampleField = (wx: number, wy: number): number => {
        const gx = (wx + fieldData.extension) / fieldData.resolution;
        const gy = (wy + fieldData.extension) / fieldData.resolution;
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const x1 = Math.min(fieldData.cols - 1, x0 + 1);
        const y1 = Math.min(fieldData.rows - 1, y0 + 1);
        const sx = Math.max(0, Math.min(1, gx - x0));
        const sy = Math.max(0, Math.min(1, gy - y0));

        const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
        const f00 = fieldData.field[clamp(y0, 0, fieldData.rows - 1)][clamp(x0, 0, fieldData.cols - 1)];
        const f10 = fieldData.field[clamp(y0, 0, fieldData.rows - 1)][clamp(x1, 0, fieldData.cols - 1)];
        const f01 = fieldData.field[clamp(y1, 0, fieldData.rows - 1)][clamp(x0, 0, fieldData.cols - 1)];
        const f11 = fieldData.field[clamp(y1, 0, fieldData.rows - 1)][clamp(x1, 0, fieldData.cols - 1)];

        const fx0 = f00 * (1 - sx) + f10 * sx;
        const fx1 = f01 * (1 - sx) + f11 * sx;
        return fx0 * (1 - sy) + fx1 * sy;
      };

      // Normalized gradient of the field at world coords
      const gradientAt = (wx: number, wy: number): { x: number; y: number } => {
        const h = fieldData.resolution * 1.5;
        const dx = sampleField(wx + h, wy) - sampleField(wx - h, wy);
        const dy = sampleField(wx, wy + h) - sampleField(wx, wy - h);
        const len = Math.hypot(dx, dy) || 1e-5;
        return { x: dx / len, y: dy / len };
      };

      // Find max positive value in the field
      let maxPositive = 0;
      for (let y = 0; y < fieldData.rows; y++) {
        for (let x = 0; x < fieldData.cols; x++) {
          const v = fieldData.field[y][x];
          if (v > maxPositive) maxPositive = v;
        }
      }

      // Spacing from UI
      const spacing = (tools.brushSettings.contourSpacing || 5) * 2;

      // Clip to polygon while drawing
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(validVertices[0].x, validVertices[0].y);
      validVertices.slice(1).forEach(vertex => ctx.lineTo(vertex.x, vertex.y));
      ctx.closePath();
      ctx.clip();

      // Family 1 (U): iso-distance contours from the base edge (flow in one direction away from that edge)
      for (let d = spacing; d < maxPositive; d += spacing) {
        const segments = extractContour(
          fieldData.field,
          fieldData.cols,
          fieldData.rows,
          fieldData.resolution,
          d,
          fieldData.extension
        );
        const loops = connectSegments(segments);
        loops.forEach(loop => {
          if (loop.length < 3) return;
          ctx.beginPath();
          const snap = (val: number) => Math.floor(val) + 0.5;
          ctx.moveTo(snap(loop[0].x), snap(loop[0].y));
          for (let i = 1; i < loop.length; i++) ctx.lineTo(snap(loop[i].x), snap(loop[i].y));
          ctx.closePath();
          ctx.stroke();
        });
      }

      // Single-family only: no orthogonal lines rendered

      ctx.restore(); // clip
      ctx.restore(); // function-level save
      return;
    } else if (mode === 'triangle') {
      // Triangle mode - draw triangulated mesh
      ctx.strokeStyle = tools.brushSettings.color;
      ctx.lineWidth = 1;
      
      // Create clipping path
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(validVertices[0].x, validVertices[0].y);
      validVertices.slice(1).forEach(vertex => ctx.lineTo(vertex.x, vertex.y));
      ctx.closePath();
      ctx.clip();
      
      // Simple triangulation - connect center to all edges
      const centerX = validVertices.reduce((sum, v) => sum + v.x, 0) / validVertices.length;
      const centerY = validVertices.reduce((sum, v) => sum + v.y, 0) / validVertices.length;
      
      // Draw triangles from center to each edge
      for (let i = 0; i < validVertices.length; i++) {
        const next = (i + 1) % validVertices.length;
        
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(validVertices[i].x, validVertices[i].y);
        ctx.lineTo(validVertices[next].x, validVertices[next].y);
        ctx.closePath();
        ctx.stroke();
      }
      
      // Add some internal triangulation for more detail
      const gridSize = Math.max(20, Math.min(40, Math.min(boundWidth, boundHeight) / 8));
      
      // Create internal grid points
      const internalPoints: Array<{x: number, y: number}> = [];
      for (let x = minX + gridSize; x < maxX; x += gridSize) {
        for (let y = minY + gridSize; y < maxY; y += gridSize) {
          // Check if point is inside polygon using helper function
          let inside = false;
          for (let i = 0, j = validVertices.length - 1; i < validVertices.length; j = i++) {
            const xi = validVertices[i].x, yi = validVertices[i].y;
            const xj = validVertices[j].x, yj = validVertices[j].y;
            
            const intersect = ((yi > y) !== (yj > y))
                && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
          }
          if (inside) {
            internalPoints.push({x, y});
          }
        }
      }
      
      // Connect internal points with triangles
      for (const point of internalPoints) {
        // Find nearest vertices
        const distances = validVertices.map(v => ({
          vertex: v,
          dist: Math.hypot(v.x - point.x, v.y - point.y)
        })).sort((a, b) => a.dist - b.dist);
        
        // Connect to nearest 3 vertices
        if (distances.length >= 3) {
          for (let i = 0; i < 2; i++) {
            ctx.beginPath();
            ctx.moveTo(point.x, point.y);
            ctx.lineTo(distances[i].vertex.x, distances[i].vertex.y);
            ctx.lineTo(distances[i + 1].vertex.x, distances[i + 1].vertex.y);
            ctx.stroke();
          }
        }
      }
      
      ctx.restore();
      ctx.restore();
      return;
    }
    
    // Default contour mode continues with existing implementation
    // Base contour spacing - properly use the slider value
    const spacing = (tools.brushSettings.contourSpacing || 5) * 2; // Scale for better visibility
    // Smoothness is available from settings but not used in this implementation yet
    // Use contourVariance from brush settings if available, otherwise default to medium variance
    const variancePercent = (tools.brushSettings.contourVariance ?? 5) / 10; // Convert 0-10 to 0-1
    
    // Setup drawing style
    ctx.strokeStyle = tools.brushSettings.color;
    ctx.fillStyle = tools.brushSettings.color;
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Create distance field with offset peak
    const fieldData = createSignedDistanceField(
      validVertices, 
      ctx.canvas.width, 
      ctx.canvas.height, 
      2
    );
    
    // Find max distance for scaling contours
    let maxDistance = 0;
    let maxElevation = 0;
    
    for (let y = 0; y < fieldData.rows; y++) {
      for (let x = 0; x < fieldData.cols; x++) {
        if (fieldData.field[y][x] > 0) {
          maxDistance = Math.max(maxDistance, fieldData.field[y][x]);
          maxElevation = Math.max(maxElevation, fieldData.field[y][x]);
        }
      }
    }
    
    // Use the intended offset peak position directly
    const actualPeakX = fieldData.peakX;
    const actualPeakY = fieldData.peakY;
    
    // Generate contours with organic variable spacing
    let currentDistance = spacing * (0.5 + Math.random() * 0.5); // Start at random offset
    let level = 1;
    
    // Multiple layers of randomness for organic feel
    const baseNoise = Math.random() * 2 - 1;
    const noiseScale = 0.3 + Math.random() * 0.4;
    
    // Random walk parameters
    let randomWalk = Math.random() * 2 - 1;
    const walkSpeed = 0.2 + Math.random() * 0.3;
    
    // Clustering - sometimes lines cluster together
    let clusterPhase = Math.random() * Math.PI * 2;
    const clusterFreq = 0.1 + Math.random() * 0.2;
    const clusterStrength = Math.random();
    
    while (currentDistance < maxDistance) {
      const segments = extractContour(
        fieldData.field, 
        fieldData.cols, 
        fieldData.rows, 
        fieldData.resolution, 
        currentDistance,
        fieldData.extension
      );
      const loops = connectSegments(segments);
      
      const isMajor = level % 3 === 0;
      ctx.strokeStyle = tools.brushSettings.color;
      ctx.lineWidth = 1; // All lines same width
      
      // Critical: Ensure pixel-perfect rendering for each contour level
      ctx.imageSmoothingEnabled = false;
      
      loops.forEach(loop => {
        // NO SMOOTHING - use raw contour points for pixel-perfect hard edges
        const processedLoop = loop;  // Raw contour points only
        
        ctx.beginPath();
        if (processedLoop.length > 3) {
          // Absolutely ensure pixel-perfect rendering before stroking
          ctx.imageSmoothingEnabled = false;
          
          // Snap to pixel grid for ultra-crisp lines
          const snapToPixel = (val: number) => Math.floor(val) + 0.5; // Centers line on pixel
          
          ctx.moveTo(snapToPixel(processedLoop[0].x), snapToPixel(processedLoop[0].y));
          
          // Use simple line segments with pixel snapping
          for (let i = 1; i < processedLoop.length; i++) {
            ctx.lineTo(snapToPixel(processedLoop[i].x), snapToPixel(processedLoop[i].y));
          }
          
          // Ensure the path is properly closed
          ctx.lineTo(snapToPixel(processedLoop[0].x), snapToPixel(processedLoop[0].y));
          ctx.stroke();
        }
        
        // Add elevation labels on major contours
        if (isMajor && processedLoop.length > 20) {
          const idx = Math.floor(processedLoop.length / 2);
          const point = processedLoop[idx];
          const elevation = 100 + level * 50;
          const text = elevation.toString();
          
          ctx.save();
          // Ensure pixel-perfect rendering is maintained
          ctx.imageSmoothingEnabled = false;
          ctx.font = '9px monospace';
          
          // Measure text to make box as small as possible
          const metrics = ctx.measureText(text);
          const textWidth = metrics.width;
          const padding = 2; // Minimal padding
          
          // Snap text position to pixel grid
          const snapToPixel = (val: number) => Math.floor(val) + 0.5;
          const textX = snapToPixel(point.x);
          const textY = snapToPixel(point.y);
          
          // Clear out the area for cutout effect
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fillStyle = 'rgba(0, 0, 0, 1)';
          ctx.fillRect(
            Math.floor(textX - textWidth / 2 - padding),
            Math.floor(textY - 5),
            Math.ceil(textWidth + padding * 2),
            10
          );
          
          // Now draw the numbers back in with normal composite operation
          ctx.globalCompositeOperation = tools.brushSettings.blendMode || 'source-over';
          ctx.fillStyle = tools.brushSettings.color;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, textX, textY);
          ctx.restore();
        }
      });
      
      // Evolve the random walk
      randomWalk += (Math.random() * 2 - 1) * walkSpeed;
      randomWalk = Math.max(-1, Math.min(1, randomWalk)); // Clamp to [-1, 1]
      
      // Calculate clustering effect (lines bunch together periodically)
      clusterPhase += clusterFreq;
      const clusterEffect = Math.sin(clusterPhase) * clusterStrength;
      
      // Occasional jumps for variety
      const jumpChance = 0.15 * variancePercent;
      const jump = Math.random() < jumpChance ? (Math.random() * 2 - 0.5) : 0;
      
      // Combine all variance factors
      const localNoise = (Math.random() * 2 - 1) * noiseScale;
      const totalVariance = (
        randomWalk * 0.4 +           // Smooth random walk
        clusterEffect * 0.3 +         // Clustering effect
        localNoise * 0.2 +            // Local randomness
        jump * 0.5 +                  // Occasional jumps
        baseNoise * 0.1               // Base offset
      ) * variancePercent;
      
      // Calculate next spacing with organic variance
      const baseSpacing = spacing * (1 + totalVariance * 2.0);
      
      // More extreme range based on variance setting
      const minSpacing = spacing * (0.1 + (1 - variancePercent) * 0.4); // 0.1x to 0.5x
      const maxSpacing = spacing * (1.5 + variancePercent * 3.5);        // 1.5x to 5x
      
      currentDistance += Math.max(minSpacing, Math.min(maxSpacing, baseSpacing));
      level++;
    }
    
    // Draw peak marker - only 10% chance
    if (Math.random() < 0.1) {
      ctx.save();
      // Ensure pixel-perfect rendering is maintained
      ctx.imageSmoothingEnabled = false;
      
      // Draw triangle marker with pixel snapping
      ctx.strokeStyle = tools.brushSettings.color;
      ctx.lineWidth = 1;  // Use exactly 1 pixel width
      
      // Snap peak position to pixel grid
      const snapToPixel = (val: number) => Math.floor(val) + 0.5;
      const snappedPeakX = snapToPixel(actualPeakX);
      const snappedPeakY = snapToPixel(actualPeakY);
      
      ctx.beginPath();
      ctx.moveTo(snappedPeakX, snappedPeakY - 6);
      ctx.lineTo(snappedPeakX - 4, snappedPeakY + 3);
      ctx.lineTo(snappedPeakX + 4, snappedPeakY + 3);
      ctx.closePath();
      ctx.stroke();
      
      // Draw peak elevation with minimal box
      const peakElevation = Math.round(100 + maxElevation * 3);
      const peakText = peakElevation + 'm';
      
      ctx.font = '9px monospace';
      const metrics = ctx.measureText(peakText);
      const textWidth = metrics.width;
      const padding = 1; // Minimal padding
      
      // Clear out the area for cutout effect
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0, 0, 0, 1)';
      ctx.fillRect(
        Math.floor(snappedPeakX - textWidth / 2 - padding),
        Math.floor(snappedPeakY + 10),
        Math.ceil(textWidth + padding * 2),
        10
      );
      
      // Now draw the peak text back in with normal composite operation
      ctx.globalCompositeOperation = tools.brushSettings.blendMode || 'source-over';
      ctx.fillStyle = tools.brushSettings.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(peakText, snappedPeakX, snapToPixel(snappedPeakY + 15));
      
      ctx.restore();
    }
    
    // Apply risograph effect if enabled
    const risographIntensity = tools.brushSettings.risographIntensity || 0;
    if (risographIntensity > 0 && !isPreview) {
      applyRisographEffect(ctx, validVertices, risographIntensity);
    }
    
    // Restore context state
    ctx.restore();
  }, [tools.brushSettings.contourSpacing, tools.brushSettings.contourSmoothness, tools.brushSettings.shapeGradientMode, tools.brushSettings.contourVariance, tools.brushSettings.risographIntensity, tools.brushSettings.opacity, tools.brushSettings.blendMode, tools.brushSettings.color, applyRisographEffect, createSignedDistanceField, extractContour, connectSegments, gaussianSmooth]);

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
        (colorCycleBrush as any).setBandSpacing(tools.brushSettings.spacing);
      }
      // Set pressure enabled state and min/max values
      // quiet
      try {
        // Force enable pressure for COLOR_CYCLE - the UI toggle isn't working correctly
        const shouldEnablePressure = tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE ? true : (tools.brushSettings.pressureEnabled || false);
        (colorCycleBrush as any).setPressureEnabled(shouldEnablePressure);
        // quiet
        // Always set pressure values, using sensible defaults if not specified
        (colorCycleBrush as any).setMinPressure(tools.brushSettings.minPressure || 50);
        (colorCycleBrush as any).setMaxPressure(tools.brushSettings.maxPressure || 200);
      } catch (e) {
        console.error('[CC Init] Failed to set pressure settings:', e);
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
  }, [tools.brushSettings.size, tools.brushSettings.colorCycleFPS, tools.brushSettings.colorCycleSpeed, tools.brushSettings.colorCycleGradient, project?.width, project?.height, activeLayerId]);
  
  /**
   * Draw with Color Cycle Brush - only paints to Canvas2D buffer, no immediate rendering
   */
  const drawColorCycle = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    pressure: number = 1.0,
    rotation: number = 0
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
        (colorCycleBrush as any).setPressureEnabled(shouldEnablePressure);
        // quiet
        // Always set pressure values, using sensible defaults if not specified
        (colorCycleBrush as any).setMinPressure(effectiveMin);
        (colorCycleBrush as any).setMaxPressure(effectiveMax);
      } catch (e) {
        console.error('[CC DrawCycle] Error setting pressure:', e);
      }
      
      // Safe brush size setting
      if (tools.brushSettings.size > 0) {
        colorCycleBrush.setBrushSize(tools.brushSettings.size);
      }
      
      // Paint to the Canvas2D buffer only - AFTER setting pressure
      // Convert canvas coordinates to internal canvas coordinates
      const internalCanvas = (colorCycleBrush as any).getCanvas();
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
        colorCycleBrush.paint(paintX, paintY, activeLayerId || undefined, pressure, rotation);
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
    tools.currentTool,
    activeLayerId
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
  }, [tools.brushSettings.blendMode, tools.brushSettings.opacity, activeLayerId]);
  
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
        // If there is visible content on the internal canvas, proactively
        // separate it by committing to the layer and clearing buffers so
        // this new stroke is stored distinctly in history.
        try {
          const state = useAppStore.getState();
          const layer = state.layers.find(l => l.id === state.activeLayerId);
          const layerCanvas = layer?.colorCycleData?.canvas || null;
          if (layer && layer.layerType === 'color-cycle' && layerCanvas && activeLayerId) {
            const internal = (brush as any).getCanvas?.();
            const ictx = internal?.getContext?.('2d');
            let hasAlpha = false;
            if (internal && ictx) {
              try {
                const img = ictx.getImageData(0, 0, Math.min(8, internal.width), Math.min(8, internal.height));
                const data = img.data;
                for (let i = 3; i < data.length; i += 4) {
                  if (data[i] > 0) { hasAlpha = true; break; }
                }
              } catch {}
            }
            if (hasAlpha) {
              // quiet
              if (typeof (brush as any).commitCurrentStroke === 'function') {
                (brush as any).commitCurrentStroke(activeLayerId);
              }
              if (typeof (brush as any).commitToLayer === 'function') {
                (brush as any).commitToLayer(layerCanvas, activeLayerId);
              } else {
                (brush as any).renderDirectToCanvas?.(layerCanvas, activeLayerId);
              }
              if (typeof (brush as any).clearPaintBuffer === 'function') {
                (brush as any).clearPaintBuffer(activeLayerId);
              }
            }
          }
        } catch (e) {
          // quiet
        }

        // Ensure any in-progress stroke is finalized before starting a new one
        try {
          if (typeof (brush as any).finalizeCurrentStroke === 'function') {
            (brush as any).finalizeCurrentStroke(activeLayerId || undefined);
          } else if (typeof brush.endStroke === 'function') {
            brush.endStroke(activeLayerId || undefined);
          }
        } catch (e) {
          // quiet
        }

        // quiet
        // Start a new stroke with the existing brush, passing layer ID and clearBuffer flag
        brush.startStroke(activeLayerId || undefined, clearBuffer);
      }
    } catch (error) {
      // quiet
      // Fail gracefully - don't crash the app
    }
  }, [initializeColorCycleBrush, activeLayerId]);
  
  /**
   * End color cycle stroke
   */
  const endColorCycleStroke = useCallback(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (colorCycleBrush) {
      colorCycleBrush.endStroke(activeLayerId || undefined);
    }
  }, [activeLayerId]);
  
  /**
   * Fill a shape with linear color cycle gradient in specified direction
   */
  const fillColorCycleShapeLinear = useCallback((vertices: Array<{ x: number; y: number }>, direction: { x: number; y: number }) => {
    // quiet
    
    // Initialize brush if needed
    const brush = initializeColorCycleBrush();
    
    if (brush && activeLayerId) {
      // Ensure we have a layer by setting the gradient if needed
      if ((brush as any).currentLayerIndex < 0) {
        // quiet
        const currentGradient = tools.brushSettings.colorCycleGradient || [
          { position: 0, color: '#ff0000' },
          { position: 0.5, color: '#00ff00' },
          { position: 1, color: '#0000ff' }
        ];
        brush.setGradient(currentGradient, activeLayerId);
      }
      
      // Ensure bands are set before filling
      const bands = tools.brushSettings.gradientBands || 12;
      brush.setGradientBands(bands);
      
      // quiet
      // Fill the shape with linear gradient
      (brush as any).fillShapeLinear(vertices, direction, activeLayerId);

      // quiet
      // End the stroke to ensure texture is updated
      brush.endStroke(activeLayerId);

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
    
    if (brush && activeLayerId) {
      // quiet
      // DON'T call startStroke here - resetColorCycle() already called it
      // This was causing the double startStroke issue that accumulated shapes
      
      // Ensure we have a layer by setting the gradient if needed
      if ((brush as any).currentLayerIndex < 0) {
        // quiet
        // Set the gradient to create a layer
        const currentGradient = tools.brushSettings.colorCycleGradient || [
          { position: 0, color: '#ff0000' },
          { position: 0.5, color: '#00ff00' },
          { position: 1, color: '#0000ff' }
        ];
        brush.setGradient(currentGradient, activeLayerId);
      }
      
      // Ensure bands are set before filling
      const bands = tools.brushSettings.gradientBands || 12;
      brush.setGradientBands(bands);
      
      // The vertices are already in the correct coordinate space
      // The ColorCycleBrush internal canvas should match the project dimensions
      // No scaling needed - just pass vertices directly
      
      // quiet
      // Fill the shape with layer ID and spacing
      (brush as any).fillShape(vertices, activeLayerId, tools.brushSettings.spacing);

      // quiet
      // End the stroke to ensure texture is updated
      brush.endStroke(activeLayerId);

      // quiet
      // Force a render to ensure the shape is visible
      brush.render(true);
    }
  }, [initializeColorCycleBrush, activeLayerId, project?.width, project?.height, tools.brushSettings.colorCycleGradient, tools.brushSettings.spacing, tools.brushSettings.gradientBands]);

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
  }, [tools.brushSettings.colorCycleFPS, activeLayerId]);
  
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
      (colorCycleBrush as any).setBandSpacing(tools.brushSettings.spacing);
    }
  }, [tools.brushSettings.spacing, activeLayerId]);

  // Update dithering toggle for color-cycle shape fills
  useEffect(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (colorCycleBrush) {
      try {
        (colorCycleBrush as any).setDitherEnabled(!!tools.brushSettings.ditherEnabled);
      } catch (e) {
        // Non-fatal; older brushes may not support dithering
      }
    }
  }, [tools.brushSettings.ditherEnabled, activeLayerId]);

  // Update dither pixel size (fillResolution) for color-cycle shape fills
  useEffect(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (colorCycleBrush && tools.brushSettings.fillResolution) {
      try {
        (colorCycleBrush as any).setDitherPixelSize(Math.max(1, Math.floor(tools.brushSettings.fillResolution)));
      } catch {}
    }
  }, [tools.brushSettings.fillResolution, activeLayerId]);

  // Perceptual dithering removed
  
  // Update pressure enabled when it changes
  useEffect(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (colorCycleBrush) {
      try {
        (colorCycleBrush as any).setPressureEnabled(tools.brushSettings.pressureEnabled || false);
      } catch (e) {
        console.error('[CC Effect] Failed to set pressure enabled:', e);
      }
    }
  }, [tools.brushSettings.pressureEnabled, activeLayerId]);
  
  // Update min pressure when it changes
  useEffect(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (colorCycleBrush && tools.brushSettings.minPressure) {
      try {
        (colorCycleBrush as any).setMinPressure(tools.brushSettings.minPressure);
      } catch (e) {
        console.error('[CC Effect] Failed to set min pressure:', e);
      }
    }
  }, [tools.brushSettings.minPressure, activeLayerId]);
  
  // Update max pressure when it changes
  useEffect(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (colorCycleBrush && tools.brushSettings.maxPressure) {
      try {
        (colorCycleBrush as any).setMaxPressure(tools.brushSettings.maxPressure);
      } catch (e) {
        console.error('[CC Effect] Failed to set max pressure:', e);
      }
    }
  }, [tools.brushSettings.maxPressure, activeLayerId]);

  // Clean up resources
  useEffect(() => {
    return () => {
      // Clear brush stamp cache on unmount
      brushStampCacheRef.current.clear();
      
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
    
    // Color cycle brush
    drawColorCycle,
    renderColorCycle,
    resetColorCycle,
    endColorCycleStroke,
    fillColorCycleShape,
    fillColorCycleShapeLinear,
    
    // Force immediate texture update for color cycle brush
    updateColorCycleTexture: (_layerId: string) => {
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
      if (colorCycleBrush && activeLayerId) {
        colorCycleBrush.setGradient(stops, activeLayerId);
      }
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
      if (colorCycleBrush && activeLayerId) {
        colorCycleBrush.endStroke(activeLayerId || undefined);
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
