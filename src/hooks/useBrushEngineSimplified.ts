/**
 * Simplified Brush Engine Hook
 * Clean interface using the facade pattern
 */

import { useCallback, useMemo, useRef, useEffect } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { createBrushEngineFacade, type BrushEngineConfig, type BrushStrokeParams } from './brushEngine/BrushEngineFacade';
import type { CustomBrush } from '../types';
import { getRisographPattern } from '../utils/risographTexture';
import { applyDithering, applyDitheringWithFillResolution } from './brushEngine/dithering';
import { canvasPool } from '../utils/canvasPool';

/**
 * Simplified brush engine hook with facade pattern
 */
export const useBrushEngineSimplified = () => {
  const { tools, project, canvas } = useAppStore();
  
  // Cache for brush stamps
  const brushStampCacheRef = useRef(new Map<string, HTMLCanvasElement>());
  const patternTempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rotationTempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // Pattern temp context getter
  const getPatternTempContext = useCallback((width: number, height: number) => {
    if (!patternTempCanvasRef.current) {
      patternTempCanvasRef.current = document.createElement('canvas');
    }
    
    const canvas = patternTempCanvasRef.current;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    
    return canvas.getContext('2d');
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
      patternTempCanvas: patternTempCanvasRef.current,
      brushStampCache: brushStampCacheRef.current,
      createPixelCircleStamp,
      createPixelSquareStamp,
      getRotationTempContext,
      rotationTempCanvas: rotationTempCanvasRef.current,
      customBrushes: project?.customBrushes || []
    };
    
    return createBrushEngineFacade(config);
  }, [project?.customBrushes, getPatternTempContext, createPixelCircleStamp, createPixelSquareStamp, getRotationTempContext]);

  // Update engine config when settings change
  useEffect(() => {
    brushEngine.updateConfig({
      brushSettings: tools.brushSettings,
      transparencyLockEnabled: typeof window !== 'undefined' ? (window as any).transparencyLockEnabled : false
    });
  }, [brushEngine, tools.brushSettings]);

  /**
   * Main drawing function - simplified interface
   */
  const drawBrush = useCallback((
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    cursor: { pressure?: number } = {}
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
      timestamp: Date.now()
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
    
    // Always enable antialiasing for smooth rectangle edges
    ctx.imageSmoothingEnabled = true;
    
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
          // Draw the gradient on temp canvas
          const localCorners = corners.map(c => ({ x: c.x - minX, y: c.y - minY }));
          
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
          
          // Draw rectangle on temp canvas
          tempCtx.fillStyle = localGradient;
          tempCtx.beginPath();
          tempCtx.moveTo(localCorners[0].x, localCorners[0].y);
          localCorners.slice(1).forEach(corner => tempCtx.lineTo(corner.x, corner.y));
          tempCtx.closePath();
          tempCtx.fill();
          
          // Get and dither the image data
          const imageData = tempCtx.getImageData(0, 0, boundWidth, boundHeight);
          
          const numColors = tools.brushSettings.colors || 2;
          const fillResolution = tools.brushSettings.fillResolution || 1;
          const algorithm = tools.brushSettings.ditherAlgorithm || 'sierra-lite';
          const patternStyle = tools.brushSettings.patternStyle || 'dots';
          
          // Pass the gradient colors to dithering
          const paletteColors = colors.length > 0 ? colors : [tools.brushSettings.color];
          const ditheredData = fillResolution > 1 
            ? applyDitheringWithFillResolution(imageData, numColors, fillResolution, algorithm, patternStyle, paletteColors)
            : applyDithering(imageData, numColors, algorithm, patternStyle, paletteColors);
          
          // Put dithered data back on temp canvas
          tempCtx.putImageData(ditheredData, 0, 0);
          
          // Save state and set up clipping to preserve edges
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(corners[0].x, corners[0].y);
          corners.slice(1).forEach(corner => ctx.lineTo(corner.x, corner.y));
          ctx.closePath();
          ctx.clip();
          
          // Draw the dithered image (drawImage respects clipping, putImageData doesn't)
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
  }, [tools.brushSettings.risographIntensity, tools.brushSettings.ditherEnabled, tools.brushSettings.colors, tools.brushSettings.fillResolution, tools.brushSettings.ditherAlgorithm, tools.brushSettings.patternStyle, tools.brushSettings.antialiasing, tools.brushSettings.opacity, tools.brushSettings.blendMode]);

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
    
    // Debug: Log input colors
    console.log('Input colors to drawPolygonGradient:', colors);
    console.log('Number of colors:', colors?.length);
    if (colors && colors.length > 0) {
      console.log('First 10 colors:', colors.slice(0, 10));
      // Check for black/undefined values
      const blackCount = colors.filter(c => c === '#000000' || c === 'rgb(0, 0, 0)' || !c).length;
      console.log(`Black/undefined colors: ${blackCount} out of ${colors.length}`);
    }
    
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
    
    // Determine gradient direction based on polygon shape
    let gradient: CanvasGradient;
    if (boundWidth > boundHeight * 1.5) {
      // Predominantly horizontal polygon - use horizontal gradient
      gradient = ctx.createLinearGradient(minX, (minY + maxY) / 2, maxX, (minY + maxY) / 2);
    } else if (boundHeight > boundWidth * 1.5) {
      // Predominantly vertical polygon - use vertical gradient
      gradient = ctx.createLinearGradient((minX + maxX) / 2, minY, (minX + maxX) / 2, maxY);
    } else {
      // Roughly square or diagonal - use diagonal gradient
      gradient = ctx.createLinearGradient(minX, minY, maxX, maxY);
    }
    
    // Add color stops
    let validColors = colors?.filter(c => c !== undefined && c !== null && typeof c === 'string') || [];
    
    // TEMPORARY WORKAROUND: Use test colors if too many blacks
    if (validColors.length > 0) {
      const blackCount = validColors.filter(c => c === '#000000' || c === 'rgb(0, 0, 0)' || c === 'rgb(0,0,0)').length;
      if (blackCount > validColors.length * 0.8) {
        console.warn('Too many black colors detected, using test gradient instead');
        validColors = ['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF', '#4B0082', '#9400D3']; // Rainbow
      }
    }
    
    if (validColors.length === 0) {
      // Fallback to current brush color
      const defaultColor = tools.brushSettings.color || '#000000';
      gradient.addColorStop(0, defaultColor);
      gradient.addColorStop(1, defaultColor);
    } else if (validColors.length === 1) {
      // Single color - solid fill
      gradient.addColorStop(0, validColors[0]);
      gradient.addColorStop(1, validColors[0]);
    } else if (validColors.length === 2) {
      // Two colors - simple gradient
      gradient.addColorStop(0, validColors[0]);
      gradient.addColorStop(1, validColors[1]);
    } else {
      // Multiple colors - sample key colors for better distribution
      const numStops = Math.min(8, validColors.length); // Limit to 8 stops
      for (let i = 0; i < numStops; i++) {
        const index = Math.floor((i / (numStops - 1)) * (validColors.length - 1));
        const position = i / (numStops - 1);
        gradient.addColorStop(position, validColors[index]);
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
        // Enable antialiasing for smooth edges on temp canvas
        tempCtx.imageSmoothingEnabled = true;
        
        // Convert vertices to local coordinates with padding
        const localVertices = validVertices.map(v => ({ 
          x: v.x - minX + padding, 
          y: v.y - minY + padding 
        }));
        
        // Create gradient in local space
        let localGradient;
        if (boundWidth > boundHeight * 1.5) {
          localGradient = tempCtx.createLinearGradient(
            padding, paddedHeight / 2, 
            paddedWidth - padding, paddedHeight / 2
          );
        } else if (boundHeight > boundWidth * 1.5) {
          localGradient = tempCtx.createLinearGradient(
            paddedWidth / 2, padding, 
            paddedWidth / 2, paddedHeight - padding
          );
        } else {
          localGradient = tempCtx.createLinearGradient(
            padding, padding, 
            paddedWidth - padding, paddedHeight - padding
          );
        }
        
        // Add color stops (same as main gradient)
        if (validColors.length === 0) {
          const defaultColor = tools.brushSettings.color || '#000000';
          localGradient.addColorStop(0, defaultColor);
          localGradient.addColorStop(1, defaultColor);
        } else if (validColors.length === 1) {
          localGradient.addColorStop(0, validColors[0]);
          localGradient.addColorStop(1, validColors[0]);
        } else if (validColors.length === 2) {
          localGradient.addColorStop(0, validColors[0]);
          localGradient.addColorStop(1, validColors[1]);
        } else {
          const numStops = Math.min(8, validColors.length);
          for (let i = 0; i < numStops; i++) {
            const index = Math.floor((i / (numStops - 1)) * (validColors.length - 1));
            const position = i / (numStops - 1);
            localGradient.addColorStop(position, validColors[index]);
          }
        }
        
        // Draw clean polygon with antialiasing
        tempCtx.fillStyle = localGradient;
        tempCtx.beginPath();
        tempCtx.moveTo(localVertices[0].x, localVertices[0].y);
        localVertices.slice(1).forEach(vertex => tempCtx.lineTo(vertex.x, vertex.y));
        tempCtx.closePath();
        tempCtx.fill();
        
        // Get clean image data for edge preservation
        const cleanImageData = tempCtx.getImageData(0, 0, paddedWidth, paddedHeight);
        
        // Apply dithering
        const numColors = tools.brushSettings.colors || 2;
        const fillResolution = tools.brushSettings.fillResolution || 1;
        const algorithm = tools.brushSettings.ditherAlgorithm || 'sierra-lite';
        const patternStyle = tools.brushSettings.patternStyle || 'dots';
        
        // Apply dithering to a copy of the image data
        const imageDataCopy = new ImageData(
          new Uint8ClampedArray(cleanImageData.data),
          paddedWidth,
          paddedHeight
        );
        
        // Debug: Check colors before dithering
        console.log('Before dithering - sample pixels:', {
          pixel1: {
            r: cleanImageData.data[0],
            g: cleanImageData.data[1], 
            b: cleanImageData.data[2],
            a: cleanImageData.data[3]
          },
          pixel100: {
            r: cleanImageData.data[400],
            g: cleanImageData.data[401], 
            b: cleanImageData.data[402],
            a: cleanImageData.data[403]
          },
          pixel500: {
            r: cleanImageData.data[2000],
            g: cleanImageData.data[2001], 
            b: cleanImageData.data[2002],
            a: cleanImageData.data[2003]
          }
        });
        
        // Pass the gradient colors directly to the dithering function
        const ditheredData = fillResolution > 1 
          ? applyDitheringWithFillResolution(imageDataCopy, numColors, fillResolution, algorithm, patternStyle, validColors)
          : applyDithering(imageDataCopy, numColors, algorithm, patternStyle, validColors);
        
        // Debug: Check colors after dithering
        console.log('After dithering - sample pixels:', {
          pixel1: {
            r: ditheredData.data[0],
            g: ditheredData.data[1],
            b: ditheredData.data[2],
            a: ditheredData.data[3]
          },
          pixel100: {
            r: ditheredData.data[400],
            g: ditheredData.data[401],
            b: ditheredData.data[402],
            a: ditheredData.data[403]
          },
          pixel500: {
            r: ditheredData.data[2000],
            g: ditheredData.data[2001],
            b: ditheredData.data[2002],
            a: ditheredData.data[2003]
          }
        });
        
        // Preserve antialiased edges - enhanced edge detection
        const edgeThreshold = 250; // Pixels with alpha below this are considered edges
        for (let i = 0; i < ditheredData.data.length; i += 4) {
          const cleanAlpha = cleanImageData.data[i + 3];
          
          // Preserve edge pixels and semi-transparent pixels
          if (cleanAlpha < edgeThreshold) {
            // For edge pixels, use original clean rendering
            ditheredData.data[i] = cleanImageData.data[i];     // R
            ditheredData.data[i + 1] = cleanImageData.data[i + 1]; // G
            ditheredData.data[i + 2] = cleanImageData.data[i + 2]; // B
            ditheredData.data[i + 3] = cleanImageData.data[i + 3]; // A
          } else if (fillResolution > 1) {
            // For high fill resolution, check neighboring pixels for better edge detection
            const x = (i / 4) % paddedWidth;
            const y = Math.floor((i / 4) / paddedWidth);
            let isNearEdge = false;
            
            // Check 3x3 neighborhood
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < paddedWidth && ny >= 0 && ny < paddedHeight) {
                  const nIdx = (ny * paddedWidth + nx) * 4 + 3;
                  if (cleanImageData.data[nIdx] < edgeThreshold) {
                    isNearEdge = true;
                    break;
                  }
                }
              }
              if (isNearEdge) break;
            }
            
            // Restore clean pixels near edges
            if (isNearEdge) {
              ditheredData.data[i] = cleanImageData.data[i];
              ditheredData.data[i + 1] = cleanImageData.data[i + 1];
              ditheredData.data[i + 2] = cleanImageData.data[i + 2];
              ditheredData.data[i + 3] = cleanImageData.data[i + 3];
            }
          }
        }
        
        // Put the final result on temp canvas
        tempCtx.putImageData(ditheredData, 0, 0);
        
        // Draw to main canvas (opacity and blend mode already set)
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
  }, [tools.brushSettings.risographIntensity, tools.brushSettings.opacity, tools.brushSettings.blendMode, tools.brushSettings.ditherEnabled, tools.brushSettings.colors, tools.brushSettings.fillResolution, tools.brushSettings.ditherAlgorithm, tools.brushSettings.patternStyle, tools.brushSettings.color, applyRisographEffect]);

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
    applyDithering,
    brushEngine
  ]);
};

// Export type for the hook return value
export type BrushEngine = ReturnType<typeof useBrushEngineSimplified>;