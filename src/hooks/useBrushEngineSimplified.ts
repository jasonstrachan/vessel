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

/**
 * Simplified brush engine hook with facade pattern
 */
export const useBrushEngineSimplified = () => {
  const { tools, project } = useAppStore();
  
  // Cache for brush stamps
  const brushStampCacheRef = useRef(new Map<string, HTMLCanvasElement>());
  const patternTempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rotationTempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  
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
   * Draw contour polygon - creates contour lines like a topographic map
   */
  const drawContourPolygon = useCallback((
    ctx: CanvasRenderingContext2D,
    polygonData: { vertices: Array<{ x: number; y: number }> },
    isPreview: boolean = false
  ) => {
    const { vertices } = polygonData || {};
    
    if (!vertices || !Array.isArray(vertices) || vertices.length < 3) return;
    
    // Validate all vertices are defined
    const validVertices = vertices.filter(v => v && typeof v.x === 'number' && typeof v.y === 'number');
    if (validVertices.length < 3) return;

    // Save context state
    ctx.save();
    
    // Use pixelated rendering for crisp edges
    ctx.imageSmoothingEnabled = false;
    
    // Apply opacity and blend mode
    ctx.globalAlpha = tools.brushSettings.opacity;
    ctx.globalCompositeOperation = tools.brushSettings.blendMode || 'source-over';
    
    // Get contour spacing from settings
    const contourSpacing = tools.brushSettings.contourSpacing || 5;
    
    // Find polygon bounds for random center placement
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    validVertices.forEach(v => {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    });
    
    // Place center at a random position within sensible bounds (inner 60% of polygon)
    const innerMargin = 0.2; // 20% margin from edges
    const innerMinX = minX + (maxX - minX) * innerMargin;
    const innerMaxX = maxX - (maxX - minX) * innerMargin;
    const innerMinY = minY + (maxY - minY) * innerMargin;
    const innerMaxY = maxY - (maxY - minY) * innerMargin;
    
    const centroidX = innerMinX + Math.random() * (innerMaxX - innerMinX);
    const centroidY = innerMinY + Math.random() * (innerMaxY - innerMinY);
    
    // Calculate max distance from centroid to vertices (for number of contours)
    let maxDistance = 0;
    validVertices.forEach(v => {
      const dist = Math.sqrt(Math.pow(v.x - centroidX, 2) + Math.pow(v.y - centroidY, 2));
      maxDistance = Math.max(maxDistance, dist);
    });
    
    // Calculate number of contour lines based on spacing
    const numContours = Math.floor(maxDistance / (contourSpacing * 3));
    
    // Draw contour lines from outside to inside
    ctx.strokeStyle = tools.brushSettings.color;
    ctx.lineWidth = 1;
    ctx.font = '10px monospace';
    ctx.fillStyle = tools.brushSettings.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    for (let i = 0; i <= numContours; i++) {
      const scale = 1 - (i / (numContours + 1));
      
      if (scale <= 0) continue;
      
      // Calculate scaled vertices
      const scaledVertices = validVertices.map(v => ({
        x: centroidX + (v.x - centroidX) * scale,
        y: centroidY + (v.y - centroidY) * scale
      }));
      
      // Draw contour line
      ctx.beginPath();
      ctx.moveTo(scaledVertices[0].x, scaledVertices[0].y);
      scaledVertices.slice(1).forEach(v => ctx.lineTo(v.x, v.y));
      ctx.closePath();
      ctx.stroke();
      
      // Add height marker (elevation number) at the midpoint of the first edge
      if (i > 0 && scaledVertices.length >= 2) {
        const midX = (scaledVertices[0].x + scaledVertices[1].x) / 2;
        const midY = (scaledVertices[0].y + scaledVertices[1].y) / 2;
        const elevation = i * 10; // Each contour represents 10 units of elevation
        ctx.fillText(elevation.toString(), midX, midY);
      }
    }
    
    // Draw the outermost polygon outline
    ctx.beginPath();
    ctx.moveTo(validVertices[0].x, validVertices[0].y);
    validVertices.slice(1).forEach(v => ctx.lineTo(v.x, v.y));
    ctx.closePath();
    ctx.stroke();
    
    // Apply risograph effect if enabled
    const risographIntensity = tools.brushSettings.risographIntensity || 0;
    if (risographIntensity > 0 && !isPreview) {
      applyRisographEffect(ctx, validVertices, risographIntensity);
    }
    
    // Restore context state
    ctx.restore();
  }, [tools.brushSettings.contourSpacing, tools.brushSettings.risographIntensity, tools.brushSettings.opacity, tools.brushSettings.blendMode, tools.brushSettings.color, applyRisographEffect]);

  // Clean up resources
  useEffect(() => {
    return () => {
      // Clear brush stamp cache on unmount
      brushStampCacheRef.current.clear();
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
    applyDithering,
    brushEngine
  ]);
};

// Export type for the hook return value
export type BrushEngine = ReturnType<typeof useBrushEngineSimplified>;