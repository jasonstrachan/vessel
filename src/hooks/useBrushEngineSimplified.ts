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
import { canvasPool } from '../utils/canvasPool';
import { ColorCycleBrush } from './brushEngine/ColorCycleBrush';

/**
 * Simplified brush engine hook with facade pattern
 */
export const useBrushEngineSimplified = () => {
  const { tools, project } = useAppStore();
  
  // Cache for brush stamps
  const brushStampCacheRef = useRef(new Map<string, HTMLCanvasElement>());
  const patternTempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rotationTempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // Color cycle brush instances - one per stroke to maintain independent gradients
  const colorCycleBrushRef = useRef<ColorCycleBrush | null>(null);
  const colorCycleStrokesRef = useRef<Map<string, { brush: ColorCycleBrush; canvas: HTMLCanvasElement }>>(new Map());
  
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
          
          // Add color stops
          if (colors.length > 0) {
            if (colors.length === 1) {
              // For single color, add it at both start and end
              localGradient.addColorStop(0, colors[0]);
              localGradient.addColorStop(1, colors[0]);
            } else {
              // Multiple colors - distribute them evenly
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
          
          const numColors = tools.brushSettings.colors || 2;
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
  }, [tools.brushSettings.risographIntensity, tools.brushSettings.ditherEnabled, tools.brushSettings.colors, tools.brushSettings.fillResolution, tools.brushSettings.ditherAlgorithm, tools.brushSettings.patternStyle, tools.brushSettings.antialiasing, tools.brushSettings.opacity, tools.brushSettings.blendMode, isPixelBrush]);

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
   * Draw polygon with gradient - FIXED VERSION
   */
  const drawPolygonGradient = useCallback((
    ctx: CanvasRenderingContext2D,
    polygonData: { vertices: Array<{ x: number; y: number }>, colors: string[] },
    isPreview: boolean = false
  ) => {
    const { vertices, colors } = polygonData || {};
    
    // Use cached isPixelBrush value for crisp edges
    
    // Debug: Log input colors
    // console.log('Input colors to drawPolygonGradient:', colors);
    // console.log('Number of colors:', colors?.length);
    // if (colors && colors.length > 0) {
    //   console.log('First 10 colors:', colors.slice(0, 10));
    //   // Check for black/undefined values
    //   const blackCount = colors.filter(c => c === '#000000' || c === 'rgb(0, 0, 0)' || !c).length;
    //   console.log(`Black/undefined colors: ${blackCount} out of ${colors.length}`);
    // }
    
    if (!vertices || !Array.isArray(vertices) || vertices.length < 3) return;
    
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
    
    // console.log('Gradient calculation:', {
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
      const numColors = tools.brushSettings.colors || orderedUniqueColors.length;
      
      // Sample the unique colors evenly
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
      
      // console.log(`Gradient with ${Math.min(numColors, orderedUniqueColors.length)} unique colors from ${orderedUniqueColors.length} available`);
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
          
          const numColors = tools.brushSettings.colors || orderedUniqueColors.length;
          
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
        const numColors = tools.brushSettings.colors || 2;
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
      ctx.beginPath();
      ctx.moveTo(validVertices[0].x, validVertices[0].y);
      validVertices.slice(1).forEach(vertex => ctx.lineTo(vertex.x, vertex.y));
      ctx.closePath();
      ctx.fill();
      
      // Apply risograph effect if enabled
      const risographIntensity = tools.brushSettings.risographIntensity || 0;
      if (risographIntensity > 0 && !isPreview) {
        applyRisographEffect(ctx, validVertices, risographIntensity);
      }
    }
    
    // Restore context state
    ctx.restore();
  }, [tools.brushSettings.risographIntensity, tools.brushSettings.opacity, tools.brushSettings.blendMode, tools.brushSettings.ditherEnabled, tools.brushSettings.colors, tools.brushSettings.fillResolution, tools.brushSettings.ditherAlgorithm, tools.brushSettings.patternStyle, tools.brushSettings.color, applyRisographEffect, isPixelBrush]);


  /**
   * Helper functions for signed distance field contours
   */
  const distanceToPolygon = useCallback((
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
  
  const isPointInPolygon = useCallback((
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
        
        const inside = isPointInPolygon(point, vertices);
        
        if (inside) {
          const edgeDist = distanceToPolygon(point, vertices);
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
          distanceField[y][x] = -distanceToPolygon(point, vertices);
        }
      }
    }
    
    return { field: distanceField, cols, rows, resolution, peakX, peakY, extension };
  }, [distanceToPolygon, isPointInPolygon]);
  
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
    polygonData: { vertices: Array<{ x: number; y: number }> },
    isPreview: boolean = false
  ) => {
    const { vertices } = polygonData || {};
    
    if (!vertices || !Array.isArray(vertices) || vertices.length < 3) return;
    
    // Validate all vertices
    const validVertices = vertices.filter(v => v && typeof v.x === 'number' && typeof v.y === 'number');
    if (validVertices.length < 3) return;

    // Save context state
    ctx.save();
    
    // Use antialiased rendering for smoother lines
    ctx.imageSmoothingEnabled = true;
    
    // Apply opacity and blend mode
    ctx.globalAlpha = tools.brushSettings.opacity;
    ctx.globalCompositeOperation = tools.brushSettings.blendMode || 'source-over';
    
    // Base contour spacing - properly use the slider value
    const spacing = (tools.brushSettings.contourSpacing || 5) * 2; // Scale for better visibility
    const smoothness = tools.brushSettings.contourSmoothness ?? 2.5; // Use smoothness from settings
    // Use contourVariance from brush settings if available, otherwise default to high variance
    const variancePercent = (tools.brushSettings.contourVariance ?? 8) / 10; // Convert 0-10 to 0-1
    
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
      
      loops.forEach(loop => {
        const smoothed = gaussianSmooth(loop, smoothness, 4);
        
        ctx.beginPath();
        if (smoothed.length > 3) {
          ctx.moveTo(smoothed[0].x, smoothed[0].y);
          
          // Use Catmull-Rom splines for ultra-smooth curves with proper loop closure
          for (let i = 0; i < smoothed.length; i++) {
            const p0 = smoothed[(i - 1 + smoothed.length) % smoothed.length];
            const p1 = smoothed[i];
            const p2 = smoothed[(i + 1) % smoothed.length];
            const p3 = smoothed[(i + 2) % smoothed.length];
            
            // Reduced tension for smoother curves
            const tension = 0.2;
            const cp1x = p1.x + (p2.x - p0.x) * tension;
            const cp1y = p1.y + (p2.y - p0.y) * tension;
            const cp2x = p2.x - (p3.x - p1.x) * tension;
            const cp2y = p2.y - (p3.y - p1.y) * tension;
            
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
          }
          
          // Ensure the path is properly closed by drawing back to start
          ctx.lineTo(smoothed[0].x, smoothed[0].y);
          ctx.stroke();
        }
        
        // Add elevation labels on major contours
        if (isMajor && smoothed.length > 20) {
          const idx = Math.floor(smoothed.length / 2);
          const point = smoothed[idx];
          const elevation = 100 + level * 50;
          const text = elevation.toString();
          
          ctx.save();
          ctx.font = '9px monospace';
          
          // Measure text to make box as small as possible
          const metrics = ctx.measureText(text);
          const textWidth = metrics.width;
          const padding = 2; // Minimal padding
          
          // Clear out the area for cutout effect
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fillStyle = 'rgba(0, 0, 0, 1)';
          ctx.fillRect(
            point.x - textWidth / 2 - padding,
            point.y - 5,
            textWidth + padding * 2,
            10
          );
          
          // Now draw the numbers back in with normal composite operation
          ctx.globalCompositeOperation = tools.brushSettings.blendMode || 'source-over';
          ctx.fillStyle = tools.brushSettings.color;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, point.x, point.y);
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
      
      // Draw triangle marker
      ctx.strokeStyle = tools.brushSettings.color;
      ctx.lineWidth = 1.5;
      
      ctx.beginPath();
      ctx.moveTo(actualPeakX, actualPeakY - 6);
      ctx.lineTo(actualPeakX - 4, actualPeakY + 3);
      ctx.lineTo(actualPeakX + 4, actualPeakY + 3);
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
        actualPeakX - textWidth / 2 - padding,
        actualPeakY + 10,
        textWidth + padding * 2,
        10
      );
      
      // Now draw the peak text back in with normal composite operation
      ctx.globalCompositeOperation = tools.brushSettings.blendMode || 'source-over';
      ctx.fillStyle = tools.brushSettings.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(peakText, actualPeakX, actualPeakY + 15);
      
      ctx.restore();
    }
    
    // Apply risograph effect if enabled
    const risographIntensity = tools.brushSettings.risographIntensity || 0;
    if (risographIntensity > 0 && !isPreview) {
      applyRisographEffect(ctx, validVertices, risographIntensity);
    }
    
    // Restore context state
    ctx.restore();
  }, [tools.brushSettings.contourSpacing, tools.brushSettings.contourSmoothness, tools.brushSettings.risographIntensity, tools.brushSettings.opacity, tools.brushSettings.blendMode, tools.brushSettings.color, applyRisographEffect, createSignedDistanceField, extractContour, connectSegments, gaussianSmooth]);

  /**
   * Initialize Color Cycle Brush
   */
  const initializeColorCycleBrush = useCallback(() => {
    if (!colorCycleBrushRef.current) {
      // OPTIMIZED: Use actual canvas dimensions for initial brush
      const targetWidth = project?.width || 1024;
      const targetHeight = project?.height || 1024;
      
      // Create a separate canvas for WebGL rendering
      const webglCanvas = document.createElement('canvas');
      webglCanvas.width = targetWidth;
      webglCanvas.height = targetHeight;
      webglCanvas.className = 'truly-offscreen-canvas';
      document.body.appendChild(webglCanvas);
      
      colorCycleBrushRef.current = new ColorCycleBrush(webglCanvas, {
        brushSize: tools.brushSettings.size || 20,
        fps: tools.brushSettings.colorCycleFPS || 30
      });
      
      // Store canvas reference
      (colorCycleBrushRef.current as any).webglCanvas = webglCanvas;
      
      // Apply initial settings
      colorCycleBrushRef.current.setSpeed(tools.brushSettings.colorCycleSpeed || 1.0);
      
      // Apply initial gradient if set, or use default rainbow
      const gradientToUse = tools.brushSettings.colorCycleGradient || [
        { position: 0.0, color: '#ff0000' },
        { position: 0.17, color: '#ff7f00' },
        { position: 0.33, color: '#ffff00' },
        { position: 0.5, color: '#00ff00' },
        { position: 0.67, color: '#0000ff' },
        { position: 0.83, color: '#4b0082' },
        { position: 1.0, color: '#9400d3' }
      ];
      console.log('[useBrushEngineSimplified] Applying gradient during brush creation:', gradientToUse);
      colorCycleBrushRef.current.setGradient(gradientToUse);
    } else {
      // Update settings
      colorCycleBrushRef.current.setBrushSize(tools.brushSettings.size);
      if (tools.brushSettings.colorCycleFPS) {
        colorCycleBrushRef.current.setFPS(tools.brushSettings.colorCycleFPS);
      }
      if (tools.brushSettings.colorCycleSpeed) {
        colorCycleBrushRef.current.setSpeed(tools.brushSettings.colorCycleSpeed);
      }
      // Update gradient - always set it to ensure it's current
      const gradientToUse = tools.brushSettings.colorCycleGradient || [
        { position: 0.0, color: '#ff0000' },
        { position: 0.17, color: '#ff7f00' },
        { position: 0.33, color: '#ffff00' },
        { position: 0.5, color: '#00ff00' },
        { position: 0.67, color: '#0000ff' },
        { position: 0.83, color: '#4b0082' },
        { position: 1.0, color: '#9400d3' }
      ];
      console.log('[useBrushEngineSimplified] Updating existing brush gradient:', gradientToUse);
      colorCycleBrushRef.current.setGradient(gradientToUse);
    }
    
    return colorCycleBrushRef.current;
  }, [tools.brushSettings.size, tools.brushSettings.colorCycleFPS, tools.brushSettings.colorCycleSpeed, tools.brushSettings.colorCycleGradient, project?.width, project?.height]);
  
  /**
   * Draw with Color Cycle Brush - only paints to WebGL buffer, no immediate rendering
   */
  const drawColorCycle = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    pressure: number = 1.0
  ) => {
    // Ensure we have a current brush from resetColorCycle
    if (!colorCycleBrushRef.current) {
      console.warn('[ColorCycle] No active brush - call resetColorCycle first');
      return;
    }
    
    const colorCycleBrush = colorCycleBrushRef.current;
    colorCycleBrush.setBrushSize(tools.brushSettings.size);
    
    // Paint to the WebGL buffer only
    // Convert canvas coordinates to WebGL canvas coordinates
    const webglCanvas = (colorCycleBrush as any).webglCanvas;
    const scaleX = webglCanvas.width / ctx.canvas.width;
    const scaleY = webglCanvas.height / ctx.canvas.height;
    
    colorCycleBrush.paint(Math.floor(x * scaleX), Math.floor(y * scaleY));
    
    // Don't composite here - let renderColorCycle handle all rendering
    // This prevents visible brush stamps and ensures only animated strokes show
  }, [tools.brushSettings.size]);
  
  /**
   * Render Color Cycle - composites all stroke canvases onto the main canvas
   */
  const renderColorCycle = useCallback((ctx: CanvasRenderingContext2D, applyOpacity: boolean = true) => {
    // Save current state
    const prevComposite = ctx.globalCompositeOperation;
    const prevAlpha = ctx.globalAlpha;
    
    // Set blend mode
    ctx.globalCompositeOperation = tools.brushSettings.blendMode || 'source-over';
    
    // When finalizing (applyOpacity = false), only render the current stroke
    // Previous strokes are already composited onto the canvas
    if (!applyOpacity) {
      // OPTIMIZED: Fast finalization path - single render + composite
      if (colorCycleBrushRef.current) {
        // Stop animation to prevent interference
        colorCycleBrushRef.current.pauseAnimation();
        
        // Single render call instead of continuous animation
        colorCycleBrushRef.current.render(true); // Force full opacity
        const webglCanvas = (colorCycleBrushRef.current as any).webglCanvas;
        if (webglCanvas) {
          ctx.globalAlpha = 1.0; // Full opacity for final composite
          ctx.drawImage(webglCanvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
        }
      }
    } else {
      // OPTIMIZED: Batch render operations for better performance
      const strokeCount = colorCycleStrokesRef.current.size;
      if (strokeCount > 0) {
        // Batch previous strokes rendering
        colorCycleStrokesRef.current.forEach(({ brush, canvas }) => {
          // Only render if brush has content
          if ((brush as any).hasContent()) {
            brush.render(false);
            ctx.globalAlpha = 1.0;
            ctx.drawImage(canvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
          }
        });
      }
      
      // Current active stroke: Apply brush opacity setting
      if (colorCycleBrushRef.current) {
        colorCycleBrushRef.current.render(false);
        const webglCanvas = (colorCycleBrushRef.current as any).webglCanvas;
        if (webglCanvas) {
          ctx.globalAlpha = tools.brushSettings.opacity;
          ctx.drawImage(webglCanvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
        }
      }
    }
    
    // Restore state
    ctx.globalCompositeOperation = prevComposite;
    ctx.globalAlpha = prevAlpha;
  }, [tools.brushSettings.blendMode, tools.brushSettings.opacity]);
  
  /**
   * Reset Color Cycle - starts a new stroke with its own gradient
   */
  const resetColorCycle = useCallback(() => {
    // Create a new stroke with current gradient
    const strokeId = `stroke_${Date.now()}_${Math.random()}`;
    
    // OPTIMIZED: Use actual canvas dimensions instead of fixed 2048x2048
    // This saves massive amounts of VRAM (16MB -> 1-4MB per stroke)
    const targetWidth = project?.width || 1024;
    const targetHeight = project?.height || 1024;
    
    // Create a separate canvas for this stroke with optimal size
    const webglCanvas = document.createElement('canvas');
    webglCanvas.width = targetWidth;
    webglCanvas.height = targetHeight;
    webglCanvas.className = 'truly-offscreen-canvas';
    webglCanvas.style.position = 'absolute';
    webglCanvas.style.left = '-9999px';
    document.body.appendChild(webglCanvas);
    
    // Create a new brush instance with current gradient
    const strokeBrush = new ColorCycleBrush(webglCanvas, {
      brushSize: tools.brushSettings.size || 20,
      fps: tools.brushSettings.colorCycleFPS || 30
    });
    
    // Apply current settings and gradient
    strokeBrush.setSpeed(tools.brushSettings.colorCycleSpeed || 1.0);
    const gradientToUse = tools.brushSettings.colorCycleGradient || [
      { position: 0.0, color: '#ff0000' },
      { position: 0.17, color: '#ff7f00' },
      { position: 0.33, color: '#ffff00' },
      { position: 0.5, color: '#00ff00' },
      { position: 0.67, color: '#0000ff' },
      { position: 0.83, color: '#4b0082' },
      { position: 1.0, color: '#9400d3' }
    ];
    strokeBrush.setGradient(gradientToUse);
    strokeBrush.startStroke();
    
    // OPTIMIZED: More aggressive stroke cleanup for better performance
    // Reduced from 20 to 8 strokes maximum - saves ~50MB VRAM
    const MAX_STROKES = 8;
    
    // Store the stroke 
    colorCycleStrokesRef.current.set(strokeId, { brush: strokeBrush, canvas: webglCanvas });
    
    // Aggressive cleanup: Remove multiple old strokes if over limit
    while (colorCycleStrokesRef.current.size > MAX_STROKES) {
      const oldestKey = colorCycleStrokesRef.current.keys().next().value;
      if (oldestKey) {
        const oldest = colorCycleStrokesRef.current.get(oldestKey);
        if (oldest) {
          // Immediately stop any animation to prevent WebGL errors
          oldest.brush.stopAnimation();
          oldest.brush.destroy();
          oldest.canvas.remove();
          colorCycleStrokesRef.current.delete(oldestKey);
        }
      }
    }
    
    // Set as current brush
    colorCycleBrushRef.current = strokeBrush;
    (colorCycleBrushRef.current as any).webglCanvas = webglCanvas;
    
    console.log(`[ColorCycle] Started new stroke ${strokeId} with gradient:`, gradientToUse[0]?.color, 'to', gradientToUse[gradientToUse.length - 1]?.color);
  }, [tools.brushSettings.size, tools.brushSettings.colorCycleFPS, tools.brushSettings.colorCycleSpeed, tools.brushSettings.colorCycleGradient, project?.width, project?.height]);
  
  /**
   * End color cycle stroke
   */
  const endColorCycleStroke = useCallback(() => {
    if (colorCycleBrushRef.current) {
      colorCycleBrushRef.current.endStroke();
    }
  }, []);

  /**
   * Update color cycle gradient
   */
  const updateColorCycleGradient = useCallback((stops: Array<{ position: number; color: string }>) => {
    console.log('[useBrushEngineSimplified] updateColorCycleGradient called with:', stops);
    console.log('[useBrushEngineSimplified] colorCycleBrushRef.current exists:', !!colorCycleBrushRef.current);
    
    // Initialize the brush if it doesn't exist
    if (!colorCycleBrushRef.current) {
      console.log('[useBrushEngineSimplified] Brush not initialized, initializing now...');
      initializeColorCycleBrush();
    }
    
    if (colorCycleBrushRef.current) {
      console.log('[useBrushEngineSimplified] Calling colorCycleBrushRef.current.setGradient');
      colorCycleBrushRef.current.setGradient(stops);
      console.log('[useBrushEngineSimplified] setGradient call completed');
    } else {
      console.warn('[useBrushEngineSimplified] colorCycleBrushRef.current is still null after initialization attempt');
    }
  }, [initializeColorCycleBrush]);

  /**
   * Update color cycle speed
   */
  const updateColorCycleSpeed = useCallback((speed: number) => {
    if (colorCycleBrushRef.current) {
      colorCycleBrushRef.current.setSpeed(speed);
    }
  }, []);
  
  /**
   * Toggle color cycle animation play/pause
   */
  const toggleColorCycleAnimation = useCallback(() => {
    // Ensure brush is initialized before toggling
    if (!colorCycleBrushRef.current) {
      initializeColorCycleBrush();
    }
    
    if (colorCycleBrushRef.current) {
      if (colorCycleBrushRef.current.isPlaying()) {
        colorCycleBrushRef.current.pauseAnimation();
      } else {
        colorCycleBrushRef.current.resumeAnimation();
      }
    } else {
      console.warn('[ColorCycle] Failed to initialize brush for toggle');
    }
  }, [initializeColorCycleBrush]);
  
  /**
   * Get color cycle animation state
   */
  const isColorCycleAnimating = useCallback(() => {
    // If no brush exists, assume it's not playing
    if (!colorCycleBrushRef.current) {
      return false;
    }
    return colorCycleBrushRef.current.isPlaying();
  }, []);
  
  /**
   * Clear all color cycle strokes
   */
  const clearColorCycleStrokes = useCallback(() => {
    // Destroy all stroke brushes and remove canvases
    colorCycleStrokesRef.current.forEach(({ brush, canvas }) => {
      brush.destroy();
      canvas.remove();
    });
    colorCycleStrokesRef.current.clear();
    
    // Clear current brush if exists
    if (colorCycleBrushRef.current) {
      const webglCanvas = (colorCycleBrushRef.current as any).webglCanvas;
      if (webglCanvas) {
        colorCycleBrushRef.current.clear();
      }
    }
    
    console.log('[ColorCycle] Cleared all strokes');
  }, []);

  // Clean up resources
  useEffect(() => {
    return () => {
      // Clear brush stamp cache on unmount
      brushStampCacheRef.current.clear();
      
      // Clean up all color cycle strokes
      colorCycleStrokesRef.current.forEach(({ brush, canvas }) => {
        brush.destroy();
        canvas.remove();
      });
      colorCycleStrokesRef.current.clear();
      
      // Clean up current color cycle brush
      if (colorCycleBrushRef.current) {
        colorCycleBrushRef.current.destroy();
        colorCycleBrushRef.current = null;
      }
    };
  }, []);

  // Return simplified API
  return useMemo(() => ({
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
    updateColorCycleGradient,
    updateColorCycleSpeed,
    toggleColorCycleAnimation,
    isColorCycleAnimating,
    clearColorCycleStrokes,
    
    // Effects
    applyDithering,
    
    // Utilities
    canDrawAt: (ctx: CanvasRenderingContext2D, x: number, y: number) => 
      brushEngine.canDrawAt(ctx, x, y),
    
    // Direct access to engine for advanced use
    engine: brushEngine
  }), [
    drawBrush,
    drawStamp,
    finalizeStroke,
    resetStroke,
    drawRectangleGradient,
    drawPolygonGradient,
    drawContourPolygon,
    drawColorCycle,
    renderColorCycle,
    resetColorCycle,
    endColorCycleStroke,
    updateColorCycleGradient,
    updateColorCycleSpeed,
    toggleColorCycleAnimation,
    isColorCycleAnimating,
    clearColorCycleStrokes,
    applyDithering,
    brushEngine
  ]);
};

// Export type for the hook return value
export type BrushEngine = ReturnType<typeof useBrushEngineSimplified>;