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
    algorithm?: string
  ) => {
    return brushEngine.applyDithering(imageData, numColors, algorithm);
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
      colors.forEach((color, index) => {
        const position = colors.length === 1 ? 0 : index / (colors.length - 1);
        gradient.addColorStop(position, color);
      });
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
            colors.forEach((color, index) => {
              const position = colors.length === 1 ? 0 : index / (colors.length - 1);
              localGradient.addColorStop(position, color);
            });
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
          
          const ditheredData = fillResolution > 1 
            ? applyDitheringWithFillResolution(imageData, numColors, fillResolution, algorithm, patternStyle)
            : applyDithering(imageData, numColors, algorithm);
          
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
          if (tools.brushSettings.risographOutline) {
            // Add slight roughness to edges if outline is enabled
            const roughX = corner.x + (Math.random() - 0.5) * effectStrength;
            const roughY = corner.y + (Math.random() - 0.5) * effectStrength;
            ctx.lineTo(roughX, roughY);
          } else {
            // Clean edges without roughness
            ctx.lineTo(corner.x, corner.y);
          }
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
  }, [tools.brushSettings.risographIntensity, tools.brushSettings.risographOutline, tools.brushSettings.ditherEnabled, tools.brushSettings.colors, tools.brushSettings.fillResolution, tools.brushSettings.ditherAlgorithm, tools.brushSettings.patternStyle, tools.brushSettings.antialiasing, tools.brushSettings.opacity, tools.brushSettings.blendMode]);

  /**
   * Draw polygon with gradient
   */
  const drawPolygonGradient = useCallback((
    ctx: CanvasRenderingContext2D,
    polygonData: { vertices: Array<{ x: number; y: number }>, colors: string[] },
    isPreview: boolean = false
  ) => {
    const { vertices, colors } = polygonData || {};
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
    
    // Create gradient from first to last vertex
    const gradient = ctx.createLinearGradient(
      validVertices[0].x, validVertices[0].y,
      validVertices[validVertices.length - 1].x, validVertices[validVertices.length - 1].y
    );
    
    // Add color stops
    if (colors && colors.length > 0) {
      colors.forEach((color, index) => {
        const position = colors.length === 1 ? 0 : index / (colors.length - 1);
        gradient.addColorStop(position, color);
      });
    } else {
      const defaultColor = tools.brushSettings.color;
      gradient.addColorStop(0, defaultColor);
      gradient.addColorStop(1, defaultColor);
    }
    
    // Check if we'll be applying dithering
    const willApplyDithering = tools.brushSettings.ditherEnabled && !isPreview;
    
    if (willApplyDithering && boundWidth > 0 && boundHeight > 0) {
      // Create clean version on temporary canvas
      const cleanCanvas = canvasPool.acquire(boundWidth, boundHeight);
      const cleanCtx = cleanCanvas.getContext('2d', { willReadFrequently: true });
      
      if (cleanCtx) {
        cleanCtx.imageSmoothingEnabled = true;
        
        // Convert vertices to local coordinates
        const localVertices = validVertices.map(v => ({ x: v.x - minX, y: v.y - minY }));
        
        // Create gradient in local space
        const localGradient = cleanCtx.createLinearGradient(
          localVertices[0].x, localVertices[0].y,
          localVertices[localVertices.length - 1].x, localVertices[localVertices.length - 1].y
        );
        
        // Add color stops
        if (colors && colors.length > 0) {
          colors.forEach((color, index) => {
            const position = colors.length === 1 ? 0 : index / (colors.length - 1);
            localGradient.addColorStop(position, color);
          });
        } else {
          const defaultColor = tools.brushSettings.color;
          localGradient.addColorStop(0, defaultColor);
          localGradient.addColorStop(1, defaultColor);
        }
        
        // Draw clean polygon
        cleanCtx.fillStyle = localGradient;
        cleanCtx.beginPath();
        cleanCtx.moveTo(localVertices[0].x, localVertices[0].y);
        localVertices.slice(1).forEach(vertex => cleanCtx.lineTo(vertex.x, vertex.y));
        cleanCtx.closePath();
        cleanCtx.fill();
        
        // Get clean image data and apply dithering
        const cleanImageData = cleanCtx.getImageData(0, 0, boundWidth, boundHeight);
        const numColors = tools.brushSettings.colors || 2;
        const fillResolution = tools.brushSettings.fillResolution || 1;
        const algorithm = tools.brushSettings.ditherAlgorithm || 'sierra-lite';
        const patternStyle = tools.brushSettings.patternStyle || 'dots';
        
        const ditheredData = fillResolution > 1 
          ? applyDitheringWithFillResolution(cleanImageData, numColors, fillResolution, algorithm, patternStyle)
          : applyDithering(cleanImageData, numColors, algorithm);
        
        // Create final composited result
        const resultData = new ImageData(
          new Uint8ClampedArray(ditheredData.data),
          boundWidth,
          boundHeight
        );
        
        // Preserve antialiased edges by restoring pixels with partial alpha
        for (let i = 0; i < resultData.data.length; i += 4) {
          const cleanAlpha = cleanImageData.data[i + 3];
          
          // If original pixel was partially transparent (antialiased edge), restore it
          if (cleanAlpha > 0 && cleanAlpha < 255) {
            resultData.data[i] = cleanImageData.data[i];     // R
            resultData.data[i + 1] = cleanImageData.data[i + 1]; // G
            resultData.data[i + 2] = cleanImageData.data[i + 2]; // B
            resultData.data[i + 3] = cleanImageData.data[i + 3]; // A
          }
        }
        
        // Put result back and draw to main canvas
        cleanCtx.putImageData(resultData, 0, 0);
        ctx.drawImage(cleanCanvas, minX, minY);
        
        // Release temp canvas
        canvasPool.release(cleanCanvas);
      }
    } else {
      // No dithering - draw directly with clean edges
      ctx.beginPath();
      ctx.moveTo(validVertices[0].x, validVertices[0].y);
      
      for (let i = 1; i < validVertices.length; i++) {
        ctx.lineTo(validVertices[i].x, validVertices[i].y);
      }
      
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
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
        
        // Create clipping path for the polygon
        ctx.beginPath();
        ctx.moveTo(validVertices[0].x, validVertices[0].y);
        for (let i = 1; i < validVertices.length; i++) {
          ctx.lineTo(validVertices[i].x, validVertices[i].y);
        }
        ctx.closePath();
        ctx.clip();
        
        // Apply pattern with multiply blend mode
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = pattern;
        ctx.globalAlpha = risographIntensity / 100 * 0.35;
        
        // Fill the clipped area with the pattern
        const minX = Math.floor(Math.min(...validVertices.map(v => v.x)));
        const minY = Math.floor(Math.min(...validVertices.map(v => v.y)));
        const maxX = Math.ceil(Math.max(...validVertices.map(v => v.x)));
        const maxY = Math.ceil(Math.max(...validVertices.map(v => v.y)));
        ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
        
        // Restore state
        ctx.restore();
      }
    }
  }, [tools.brushSettings.risographIntensity]);

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