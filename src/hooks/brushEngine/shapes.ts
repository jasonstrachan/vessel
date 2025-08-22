/**
 * Shape drawing functions with dependency injection
 * Pure functions for drawing shapes without hook dependencies
 */

import { BrushShape, type BrushSettings } from '@/types';
import { canvasPool } from '@/utils/canvasPool';

/**
 * Settings for drawing shapes
 */
export interface DrawShapeSettings {
  brushSettings?: BrushSettings;
  transparencyLockEnabled?: boolean;
}

/**
 * Dependencies for shape drawing
 */
export interface ShapeDrawingDependencies {
  getPatternTempContext?: (width: number, height: number) => CanvasRenderingContext2D | null;
  patternTempCanvas?: HTMLCanvasElement | null;
  brushStampCache?: Map<string, HTMLCanvasElement>;
  createPixelCircleStamp?: (size: number) => HTMLCanvasElement | null;
  createPixelSquareStamp?: (size: number) => HTMLCanvasElement | null;
  getRotationTempContext?: (width: number, height: number) => CanvasRenderingContext2D | null;
  rotationTempCanvas?: HTMLCanvasElement | null;
}

/**
 * Draw a shape on the canvas
 * Pure function without hook dependencies
 */
export const drawShape = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  shape: BrushShape,
  antiAliasing: boolean,
  rotation: number = 0,
  risographIntensity: number = 0,
  pattern?: ImageData,
  centerAlignment?: boolean,
  settings?: DrawShapeSettings,
  deps?: ShapeDrawingDependencies
) => {
  // Canvas clipping automatically handles bounds restriction
  const halfSize = size / 2;
  
  // Draw directly to main canvas for performance
  const targetCtx = ctx;
  let drawX = x;
  let drawY = y;
  
  if (!targetCtx) {
    return;
  }

  // Check transparency lock before drawing
  if (settings?.transparencyLockEnabled) {
    // Sample the center pixel to check if we can draw here
    const centerX = Math.floor(x);
    const centerY = Math.floor(y);
    
    // Ensure coordinates are within canvas bounds before getImageData
    const canvasWidth = ctx.canvas.width;
    const canvasHeight = ctx.canvas.height;
    
    if (centerX >= 0 && centerX < canvasWidth && centerY >= 0 && centerY < canvasHeight) {
      try {
        const imageData = ctx.getImageData(centerX, centerY, 1, 1);
        const alpha = imageData.data[3]; // Alpha channel
        
        // If transparency lock is enabled and pixel is fully transparent, skip drawing
        if (alpha === 0) {
          return;
        }
      } catch {
        // If we can't read the pixel data, allow drawing
      }
    }
  }
  
  // Save the current composite operation before save() overwrites it
  const currentCompositeOp = ctx.globalCompositeOperation;
  
  targetCtx.save();

  // Preserve the globalCompositeOperation from the main context
  targetCtx.globalCompositeOperation = currentCompositeOp;
  
  // Determine if this is a pixel brush that needs special handling
  const isPixelBrush = shape === BrushShape.PIXEL_ROUND || 
    (shape === BrushShape.SQUARE && !antiAliasing);
  
  // Special handling for pixel brushes with rotation
  // When rotation is applied to pixel brushes, browsers smooth edges even with imageSmoothingEnabled = false
  // Solution: Pre-render to temp canvas without rotation, then draw temp canvas with rotation
  const needsPixelRotationWorkaround = isPixelBrush && rotation !== 0;
  
  let rotatedPixelCanvas: HTMLCanvasElement | null = null;
  let rotatedPixelCtx: CanvasRenderingContext2D | null = null;
  
  if (needsPixelRotationWorkaround && deps?.getRotationTempContext) {
    // Use persistent temporary canvas for pixel-perfect pre-rendering
    const tempSize = Math.ceil(size) + 4; // Add padding for rotation
    rotatedPixelCtx = deps.getRotationTempContext(tempSize, tempSize);
    rotatedPixelCanvas = deps.rotationTempCanvas || null;
    
    if (rotatedPixelCtx && rotatedPixelCanvas) {
      rotatedPixelCtx.clearRect(0, 0, tempSize, tempSize);
      rotatedPixelCtx.imageSmoothingEnabled = false;
      rotatedPixelCtx.fillStyle = targetCtx.fillStyle;
      rotatedPixelCtx.globalAlpha = targetCtx.globalAlpha;
      rotatedPixelCtx.globalCompositeOperation = 'source-over';
      
      // Adjust coordinates for center rendering in temp canvas
      drawX = tempSize / 2;
      drawY = tempSize / 2;
    }
  } else {
    // Standard handling for non-pixel brushes or pixel brushes without rotation
    if (shape === BrushShape.PIXEL_ROUND) {
      targetCtx.imageSmoothingEnabled = false;
      // Always round to pixel boundaries for pixel brushes
      drawX = Math.round(x);
      drawY = Math.round(y);
    } else if (!antiAliasing) {
      targetCtx.imageSmoothingEnabled = false;
      // Round to pixel boundaries for pixel-perfect drawing
      drawX = Math.round(x);
      drawY = Math.round(y);
    } else {
      // Ensure smoothing is enabled for antialiased drawing
      targetCtx.imageSmoothingEnabled = true;
      // Keep original float values for smooth rendering
      drawX = x;
      drawY = y;
    }
    
    // Apply rotation if specified (only for non-pixel brushes)
    if (rotation !== 0) {
      targetCtx.translate(drawX, drawY);
      targetCtx.rotate(rotation);
      targetCtx.translate(-drawX, -drawY);
    }
  }
  
  // Handle custom pattern rendering
  if (pattern && pattern.width > 0 && pattern.height > 0 && deps?.getPatternTempContext && deps?.patternTempCanvas) {
    const tempCtx = deps.getPatternTempContext(pattern.width, pattern.height);
    const tempCanvas = deps.patternTempCanvas;
    
    if (tempCtx) {
      try {
        // Configure temp canvas context to match main context
        tempCtx.imageSmoothingEnabled = targetCtx.imageSmoothingEnabled;
        tempCtx.putImageData(pattern, 0, 0);
        
        // Create a pattern from the custom brush texture
        const brushPattern = targetCtx.createPattern(tempCanvas, 'repeat');
        
        if (brushPattern) {
          // Save current fill style
          const originalFillStyle = targetCtx.fillStyle;
          
          // Use pattern as fill style for the shape
          targetCtx.fillStyle = brushPattern;
          
          // Now draw the shape with the pattern fill
          switch (shape) {
            case BrushShape.SQUARE:
              if (antiAliasing) {
                targetCtx.fillRect(drawX - halfSize, drawY - halfSize, size, size);
              } else {
                // Pixel-perfect square
                const pixelSize = Math.round(size);
                const offset = Math.floor(pixelSize / 2);
                
                // For pixel-perfect squares, always use direct fillRect
                // Rotation is already applied to the context, and fillRect will respect it
                targetCtx.fillRect(drawX - offset, drawY - offset, pixelSize, pixelSize);
              }
              break;
              
            case BrushShape.ROUND:
              // Always use perfect circles for antialiased round brushes
              targetCtx.beginPath();
              targetCtx.arc(drawX, drawY, halfSize, 0, Math.PI * 2);
              targetCtx.fill();
              break;
              
            case BrushShape.TRIANGLE:
              targetCtx.beginPath();
              if (antiAliasing) {
                targetCtx.moveTo(drawX, drawY - halfSize);
                targetCtx.lineTo(drawX - halfSize, drawY + halfSize);
                targetCtx.lineTo(drawX + halfSize, drawY + halfSize);
              } else {
                // Pixel-perfect triangle
                const height = Math.floor(size * 0.866); // sqrt(3)/2
                targetCtx.moveTo(drawX, drawY - Math.floor(height / 2));
                targetCtx.lineTo(drawX - Math.floor(size / 2), drawY + Math.floor(height / 2));
                targetCtx.lineTo(drawX + Math.floor(size / 2), drawY + Math.floor(height / 2));
              }
              targetCtx.closePath();
              targetCtx.fill();
              break;
              
            default:
              // For other shapes or custom brush, draw the pattern directly
              const scaledWidth = pattern.width;
              const scaledHeight = pattern.height;
              
              let patternDrawX = drawX;
              let patternDrawY = drawY;
              
              if (centerAlignment) {
                patternDrawX = drawX - scaledWidth / 2;
                patternDrawY = drawY - scaledHeight / 2;
              }
              
              patternDrawX = Math.round(patternDrawX);
              patternDrawY = Math.round(patternDrawY);
              
              // Restore original fill style to draw the pattern image
              targetCtx.fillStyle = originalFillStyle;
              targetCtx.drawImage(tempCanvas, patternDrawX, patternDrawY);
              break;
          }
          
          // Restore original fill style if we didn't use it above
          if (shape !== BrushShape.PIXEL_ROUND && shape !== BrushShape.CUSTOM) {
            targetCtx.fillStyle = originalFillStyle;
          }
        }
      } catch {
        // Handle pattern errors silently
      }
    }
  } else {
    // Original shape rendering
    // Choose which context to draw to based on pixel rotation workaround
    const drawingCtx = needsPixelRotationWorkaround ? rotatedPixelCtx! : targetCtx;
    
    switch (shape) {
      case BrushShape.SQUARE:
        if (antiAliasing) {
          drawingCtx.fillRect(drawX - halfSize, drawY - halfSize, size, size);
        } else {
          // Pixel-perfect square
          const pixelSize = Math.round(size);
          const offset = Math.floor(pixelSize / 2);
          
          // For pixel-perfect squares, always use direct fillRect
          // When using temp canvas, rotation is NOT applied to context yet
          drawingCtx.fillRect(drawX - offset, drawY - offset, pixelSize, pixelSize);
        }
        break;
        
      case BrushShape.ROUND: {
        // Optimized rendering using pre-cached circular stamps
        const roundedSize = Math.round(size);
        const useFastRender = roundedSize > 2 && !pattern;
        
        if (useFastRender && antiAliasing && deps?.brushStampCache) {
          // Soft brush with pre-rendered CIRCULAR stamps for performance
          const cacheKey = `soft_circle_${roundedSize}`;
          let stampCanvas = deps.brushStampCache.get(cacheKey);
          
          if (!stampCanvas) {
            // Create a soft CIRCULAR brush stamp once and cache it
            stampCanvas = document.createElement('canvas');
            const stampSize = roundedSize + 4; // Add padding for anti-aliasing
            stampCanvas.width = stampSize;
            stampCanvas.height = stampSize;
            const stampCtx = stampCanvas.getContext('2d')!;
            
            // Draw soft circular brush with gradient
            const gradient = stampCtx.createRadialGradient(
              stampSize / 2, stampSize / 2, 0,
              stampSize / 2, stampSize / 2, roundedSize / 2
            );
            
            // Use the current fill style color
            const currentColor = ctx.fillStyle.toString();
            const match = currentColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
            if (match) {
              const [, r, g, b] = match;
              gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
              gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.8)`);
              gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
            } else {
              // Fallback for non-rgba colors
              gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
              gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.8)');
              gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            }
            
            stampCtx.fillStyle = gradient;
            stampCtx.beginPath();
            stampCtx.arc(stampSize / 2, stampSize / 2, roundedSize / 2, 0, Math.PI * 2);
            stampCtx.fill();
            
            deps.brushStampCache.set(cacheKey, stampCanvas);
          }
          
          // Draw the cached stamp with multiplicative blending for smooth overlap
          const originalGlobalAlpha = targetCtx.globalAlpha;
          const originalComposite = targetCtx.globalCompositeOperation;
          
          // Use source-over for normal blending
          targetCtx.globalCompositeOperation = 'source-over';
          targetCtx.globalAlpha = originalGlobalAlpha * 0.9; // Slightly reduce opacity for smoother strokes
          
          const stampSize = stampCanvas.width;
          targetCtx.drawImage(
            stampCanvas,
            drawX - stampSize / 2,
            drawY - stampSize / 2
          );
          
          // Restore original settings
          targetCtx.globalAlpha = originalGlobalAlpha;
          targetCtx.globalCompositeOperation = originalComposite;
        } else if (useFastRender && !antiAliasing && roundedSize <= 8 && deps?.createPixelCircleStamp) {
          // Pixel-perfect circles using stamps for sizes 1-8
          const stampCanvas = deps.createPixelCircleStamp(roundedSize);
          if (stampCanvas) {
            targetCtx.drawImage(
              stampCanvas,
              Math.round(drawX - roundedSize / 2),
              Math.round(drawY - roundedSize / 2)
            );
          }
        } else {
          // Fallback to regular arc drawing
          targetCtx.beginPath();
          targetCtx.arc(drawX, drawY, halfSize, 0, Math.PI * 2);
          targetCtx.fill();
        }
        break;
      }
        
      case BrushShape.TRIANGLE:
        drawingCtx.beginPath();
        if (antiAliasing) {
          drawingCtx.moveTo(drawX, drawY - halfSize);
          drawingCtx.lineTo(drawX - halfSize, drawY + halfSize);
          drawingCtx.lineTo(drawX + halfSize, drawY + halfSize);
        } else {
          // Pixel-perfect triangle
          const height = Math.floor(size * 0.866); // sqrt(3)/2
          drawingCtx.moveTo(drawX, drawY - Math.floor(height / 2));
          drawingCtx.lineTo(drawX - Math.floor(size / 2), drawY + Math.floor(height / 2));
          drawingCtx.lineTo(drawX + Math.floor(size / 2), drawY + Math.floor(height / 2));
        }
        drawingCtx.closePath();
        drawingCtx.fill();
        break;
        
      case BrushShape.PIXEL_ROUND: {
        // Special handling for pixel brushes - use stamps for ALL sizes
        // Match exact logic from monolithic implementation
        if (deps?.createPixelCircleStamp) {
          const stampSize = Math.max(1, Math.round(size));
          const stampCanvas = deps.createPixelCircleStamp(stampSize);
          if (stampCanvas) {
            // Use canvas pool for temporary canvas
            const tempCanvas = canvasPool.acquire(stampSize, stampSize);
            const tempCtx = tempCanvas.getContext('2d', { colorSpace: 'srgb' });
            
            if (tempCtx) {
              // Match monolithic: clear, no smoothing, exact rendering pipeline
              tempCtx.clearRect(0, 0, stampSize, stampSize);
              tempCtx.imageSmoothingEnabled = false;
              
              // Draw white stamp to temp canvas
              tempCtx.drawImage(stampCanvas, 0, 0);
              
              // Apply color using source-in (only affects existing pixels)
              tempCtx.globalCompositeOperation = 'source-in';
              tempCtx.fillStyle = drawingCtx.fillStyle;
              tempCtx.fillRect(0, 0, stampSize, stampSize);
              
              // Calculate offset based on which context we're drawing to
              const offsetX = Math.round(drawX - stampSize / 2);
              const offsetY = Math.round(drawY - stampSize / 2);
              
              // Draw the colored stamp to the drawing context (either target or temp)
              drawingCtx.drawImage(tempCanvas, offsetX, offsetY);
            }
            
            // Release canvas back to pool
            canvasPool.release(tempCanvas);
          }
        } else {
          // Fallback if no stamp creator available
          drawingCtx.beginPath();
          drawingCtx.arc(drawX, drawY, halfSize, 0, Math.PI * 2);
          drawingCtx.fill();
        }
        break;
      }
        
      default:
        // Default to square for unknown shapes
        drawingCtx.fillRect(drawX - halfSize, drawY - halfSize, size, size);
        break;
    }
  }
  
  // Apply rotation and draw temp canvas if pixel rotation workaround was used
  if (needsPixelRotationWorkaround && rotatedPixelCanvas && rotatedPixelCtx) {
    // Apply rotation to main context AFTER pixel brush is rendered
    targetCtx.translate(x, y);
    targetCtx.rotate(rotation);
    targetCtx.translate(-x, -y);
    
    // Draw the pre-rendered pixel brush with rotation applied
    const tempSize = rotatedPixelCanvas.width;
    targetCtx.imageSmoothingEnabled = false; // Critical: maintain hard edges during rotation
    targetCtx.drawImage(
      rotatedPixelCanvas,
      x - tempSize / 2,
      y - tempSize / 2
    );
    
    // Don't release - using persistent canvas from deps
  }
  
  // Apply risograph texture if enabled
  if (risographIntensity > 0) {
    const risX = needsPixelRotationWorkaround ? x : drawX;
    const risY = needsPixelRotationWorkaround ? y : drawY;
    applyRisographTexture(targetCtx, risX, risY, size, risographIntensity);
  }
  
  targetCtx.restore();
};

/**
 * Apply risograph texture effect to a drawn shape
 */
export const applyRisographTexture = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  intensity: number
) => {
  // Simplified risograph effect - would need full implementation
  // This is a placeholder for the actual risograph texture logic
  const halfSize = size / 2;
  const noiseSize = Math.max(1, Math.floor(size * 0.1));
  
  ctx.save();
  ctx.globalAlpha = intensity * 0.3;
  
  // Add some noise dots
  for (let i = 0; i < size; i += noiseSize * 2) {
    for (let j = 0; j < size; j += noiseSize * 2) {
      if (Math.random() > 0.5) {
        ctx.fillRect(
          x - halfSize + i + Math.random() * noiseSize,
          y - halfSize + j + Math.random() * noiseSize,
          noiseSize,
          noiseSize
        );
      }
    }
  }
  
  ctx.restore();
};

/**
 * Factory to create a shape drawing function with injected dependencies
 */
export const createShapeDrawer = (
  settings: DrawShapeSettings,
  deps: ShapeDrawingDependencies
) => {
  return (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    shape: BrushShape,
    antiAliasing: boolean,
    rotation?: number,
    risographIntensity?: number,
    pattern?: ImageData,
    centerAlignment?: boolean
  ) => {
    drawShape(
      ctx,
      x,
      y,
      size,
      shape,
      antiAliasing,
      rotation || 0,
      risographIntensity || 0,
      pattern,
      centerAlignment,
      settings,
      deps
    );
  };
};