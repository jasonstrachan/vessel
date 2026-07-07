/**
 * Shape drawing functions with dependency injection
 * Pure functions for drawing shapes without hook dependencies
 */

import { debugWarn } from '@/utils/debug';
import { BrushShape, type BrushSettings } from '@/types';
import { drawCustomPatternShape, type CustomPatternCache } from './shapeCustomPattern';
import { applyRisographTexture } from './shapeRisographEffect';
import { drawStandardShape } from './shapeStandardRenderer';
import type { RotatedStampCache } from './shapeRotatedStamp';

export { resolveCustomPatternDrawDimensions } from './shapeCustomPattern';
export { applyRisographTexture } from './shapeRisographEffect';
export { buildRotatedStampCacheKey } from './shapeRotatedStamp';

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
  brushStampCache?: Map<string, HTMLCanvasElement>;
  createPixelCircleStamp?: (size: number) => HTMLCanvasElement | null;
  createPixelSquareStamp?: (size: number) => HTMLCanvasElement | null;
  getRotationTempContext?: (width: number, height: number) => CanvasRenderingContext2D | null;
  getNextSpamChar?: () => string;
  rotatedStampCache?: RotatedStampCache;
  customPatternCache?: CustomPatternCache;
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
  customPatternDimensions?: { width: number; height: number },
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

  // Save the current composite operation before save() overwrites it
  const currentCompositeOp = ctx.globalCompositeOperation;
  
  targetCtx.save();

  // Preserve the globalCompositeOperation from the main context
  targetCtx.globalCompositeOperation = currentCompositeOp;
  
  // Determine if this is a pixel brush
  const isPixelBrush = shape === BrushShape.PIXEL_ROUND ||
    shape === BrushShape.PIXEL_DITHER ||
    (shape === BrushShape.SQUARE && !antiAliasing);
  
  // Quantize rotation to nearest 15 degrees for pixel brushes to enable caching
  let quantizedRotation = rotation;
  if (isPixelBrush && rotation !== 0) {
    const degrees = (rotation * 180 / Math.PI) % 360;
    const quantizedDegrees = Math.round(degrees / 15) * 15;
    quantizedRotation = quantizedDegrees * Math.PI / 180;
  }
  
  // Standard handling for all brushes
  {
    if (isPixelBrush) {
      // For pixel brushes, disable smoothing in the context
      targetCtx.imageSmoothingEnabled = false;
      // Round to pixel boundaries
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
    
    // Apply rotation if specified (use quantized rotation for pixel brushes)
    const rotationToApply = isPixelBrush ? quantizedRotation : rotation;
    if (rotationToApply !== 0 && !isPixelBrush) {
      // Only apply canvas rotation for non-pixel brushes
      targetCtx.translate(drawX, drawY);
      targetCtx.rotate(rotationToApply);
      targetCtx.translate(-drawX, -drawY);
    }
  }
  
  // Handle resampler brush - either use provided pattern or sample continuously
  if (shape === BrushShape.RESAMPLER) {
    // Check if we have a pattern (single capture mode)
    if (pattern && pattern.width > 0 && pattern.height > 0) {
      // Resampler with captured pattern - treat EXACTLY like CUSTOM brush
      // Just change the shape temporarily to reuse all the custom brush logic
      shape = BrushShape.CUSTOM;
      // Fall through to custom brush handling below which handles the pattern perfectly
    } else if (settings?.brushSettings?.continuousSampling) {
      // Continuous sampling mode - sample at each stamp position
      const sampleSize = Math.ceil(size);
      const halfSize = sampleSize / 2;
      
      // Get the bounds for sampling (square area)
      const canvasWidth = ctx.canvas.width;
      const canvasHeight = ctx.canvas.height;
      const sampleX = Math.max(0, Math.floor(x - halfSize));
      const sampleY = Math.max(0, Math.floor(y - halfSize));
      const sampleWidth = Math.min(sampleSize, canvasWidth - sampleX);
      const sampleHeight = Math.min(sampleSize, canvasHeight - sampleY);
      
      if (sampleWidth > 0 && sampleHeight > 0) {
        try {
          // Sample the canvas content directly with optimized context
          const sampledData = ctx.getImageData(sampleX, sampleY, sampleWidth, sampleHeight);
          
          // Create temporary canvas with proper configuration
          if (deps?.getPatternTempContext) {
            const tempCtx = deps.getPatternTempContext(sampleWidth, sampleHeight);

            if (tempCtx) {
              const tempCanvas = tempCtx.canvas;
              if (!tempCanvas) {
                targetCtx.restore();
                return;
              }
              // Configure for high-quality pixel-perfect operations
              tempCtx.imageSmoothingEnabled = false;
              tempCtx.clearRect(0, 0, sampleWidth, sampleHeight);
              tempCtx.putImageData(sampledData, 0, 0);

              // Draw the sampled content at the current position (square shape)
              // Ensure pixel-perfect positioning
              targetCtx.imageSmoothingEnabled = false;
              targetCtx.drawImage(
                tempCanvas,
                0, 0, sampleWidth, sampleHeight,
                Math.round(drawX - sampleWidth / 2),
                Math.round(drawY - sampleHeight / 2),
                sampleWidth,
                sampleHeight
              );
            }
          } else {
            // Direct putImageData fallback with improved quality
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = sampleWidth;
            tempCanvas.height = sampleHeight;
            const tempCtx = tempCanvas.getContext('2d', {
              willReadFrequently: true,
              colorSpace: 'srgb',
              alpha: true
            });
            if (tempCtx) {
              tempCtx.imageSmoothingEnabled = false;
              tempCtx.putImageData(sampledData, 0, 0);
              
              // Ensure target context is configured for pixel-perfect drawing
              targetCtx.imageSmoothingEnabled = false;
              targetCtx.drawImage(
                tempCanvas,
                0, 0, sampleWidth, sampleHeight,
                Math.round(drawX - sampleWidth / 2),
                Math.round(drawY - sampleHeight / 2),
                sampleWidth,
                sampleHeight
              );
            }
          }
        } catch (e) {
          debugWarn('raw-console', '[Resampler] Continuous sampling failed:', e);
          // If we can't sample, draw a square fallback
          targetCtx.fillRect(Math.round(drawX - halfSize), Math.round(drawY - halfSize), sampleSize, sampleSize);
        }
      }
    } else {
      // No pattern and not continuous - just draw a square
      const halfSize = size / 2;
      targetCtx.fillRect(drawX - halfSize, drawY - halfSize, size, size);
    }
    
    targetCtx.restore();
    return;
  }
  
  // Handle custom pattern rendering (for custom brushes)
  if (pattern && pattern.width > 0 && pattern.height > 0 && shape === BrushShape.CUSTOM) {
    drawCustomPatternShape({
      targetCtx,
      drawX,
      drawY,
      size,
      pattern,
      rotation,
      centerAlignment,
      customPatternDimensions,
      cache: deps?.customPatternCache,
    });
    targetCtx.restore();
    return;
  } else if (pattern && pattern.width > 0 && pattern.height > 0 && deps?.getPatternTempContext) {
    // Handle non-custom brush patterns (textures, etc)
    const tempCtx = deps.getPatternTempContext(pattern.width, pattern.height);
    const tempCanvas = tempCtx?.canvas;
    
    if (tempCtx) {
      try {
        // Configure temp canvas context to match main context
        tempCtx.imageSmoothingEnabled = targetCtx.imageSmoothingEnabled;
        tempCtx.putImageData(pattern, 0, 0);
        
        // Create a pattern from the texture
        const brushPattern = tempCanvas ? targetCtx.createPattern(tempCanvas, 'repeat') : null;
        
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
              if (tempCanvas) {
                targetCtx.drawImage(tempCanvas, patternDrawX, patternDrawY);
              }
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
  } else if (shape === BrushShape.CUSTOM) {
    // Custom brush without pattern - this shouldn't happen but handle gracefully
    targetCtx.restore();
    return;
  } else {
    drawStandardShape({
      targetCtx,
      drawX,
      drawY,
      size,
      halfSize,
      shape,
      antiAliasing,
      quantizedRotation,
      pattern,
      brushSettings: settings?.brushSettings,
      deps,
    });
  }
  
  // Apply risograph texture if enabled
  if (risographIntensity > 0) {
    const risX = drawX;
    const risY = drawY;
    applyRisographTexture(targetCtx, risX, risY, size, risographIntensity);
  }
  
  targetCtx.restore();
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
    centerAlignment?: boolean,
    customPatternDimensions?: { width: number; height: number }
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
      customPatternDimensions,
      settings,
      deps
    );
  };
};
