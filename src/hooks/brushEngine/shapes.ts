/**
 * Shape drawing functions with dependency injection
 * Pure functions for drawing shapes without hook dependencies
 */

import { BrushShape, type BrushSettings } from '@/types';
import { canvasPool } from '@/utils/canvasPool';
import { getRisographPattern } from '@/utils/risographTexture';

// Cache for pre-rotated pixel stamps
const rotatedStampCache = new Map<string, HTMLCanvasElement>();

/**
 * Get or create a pre-rotated pixel stamp
 */
function getRotatedPixelStamp(
  baseStamp: HTMLCanvasElement,
  rotation: number,
  cacheKey: string
): HTMLCanvasElement {
  // Check cache first
  const fullKey = `${cacheKey}_rot${Math.round(rotation * 180 / Math.PI)}`;
  const cached = rotatedStampCache.get(fullKey);
  if (cached) return cached;
  
  // No rotation needed
  if (Math.abs(rotation) < 0.01) return baseStamp;
  
  const size = baseStamp.width;
  // Calculate bounds for rotated stamp (needs to be larger)
  const diagonal = Math.ceil(Math.sqrt(size * size * 2));
  
  const rotCanvas = document.createElement('canvas');
  rotCanvas.width = diagonal;
  rotCanvas.height = diagonal;
  const rotCtx = rotCanvas.getContext('2d', { willReadFrequently: false });
  
  if (!rotCtx) return baseStamp;
  
  // IMPORTANT: Disable smoothing BEFORE any operations
  rotCtx.imageSmoothingEnabled = false;
  rotCtx.save();
  
  // Translate to center, rotate, then draw
  const centerX = diagonal / 2;
  const centerY = diagonal / 2;
  rotCtx.translate(centerX, centerY);
  rotCtx.rotate(rotation);
  
  // Draw the stamp centered at origin
  rotCtx.drawImage(baseStamp, -size / 2, -size / 2);
  rotCtx.restore();
  
  // Cache for reuse
  rotatedStampCache.set(fullKey, rotCanvas);
  
  // Limit cache size
  if (rotatedStampCache.size > 100) {
    const firstKey = rotatedStampCache.keys().next().value;
    if (typeof firstKey === 'string') {
      rotatedStampCache.delete(firstKey);
    }
  }
  
  return rotCanvas;
}

// Cache for riso effect settings to avoid recalculation
let cachedRisoAlpha = 0;
let cachedRisoIntensity = -1;
let cachedRisoIsPixel = false;

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
  
  // Determine if this is a pixel brush
  const isPixelBrush = shape === BrushShape.PIXEL_ROUND || 
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
            const tempCanvas = tempCtx.canvas;
            
            if (tempCtx && tempCanvas) {
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
          console.warn('[Resampler] Continuous sampling failed:', e);
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
  if (pattern && pattern.width > 0 && pattern.height > 0 && shape === BrushShape.CUSTOM && deps?.getPatternTempContext) {
    const tempCtx = deps.getPatternTempContext(pattern.width, pattern.height);
    // Get the temp canvas from the context - it's stored as _canvas
    const tempCanvas = tempCtx.canvas;

    if (tempCtx) {
      // Ensure we have a canvas to draw to
      const canvasToUse = tempCanvas || tempCtx.canvas;
      if (!canvasToUse) {
        targetCtx.restore();
        return;
      }
      
      try {
        // Configure temp canvas context to match main context
        tempCtx.imageSmoothingEnabled = false; // Custom brushes should be crisp
        tempCtx.clearRect(0, 0, pattern.width, pattern.height);
        tempCtx.putImageData(pattern, 0, 0);
        
        // Apply color tint if the brush is colorizable (using the fillStyle color)
        // For custom brushes, centerAlignment is repurposed to pass isColorizable flag
        const isColorizable = centerAlignment || false;
        if (isColorizable && targetCtx.fillStyle) {
          tempCtx.globalCompositeOperation = 'source-atop';
          tempCtx.fillStyle = targetCtx.fillStyle;
          tempCtx.fillRect(0, 0, pattern.width, pattern.height);
          tempCtx.globalCompositeOperation = 'source-over';
        }
        
        // For custom brushes, the size parameter already represents the scaled size
        // (it's been pre-calculated based on the brush size slider percentage)
        // We need to maintain aspect ratio while scaling to this size
        
        // Check if this is a Resampler brush - it has the isResampler flag set
        // Resampler should draw at 1:1 scale since it was captured at the right size
        const isResampler = ('isResampler' in pattern && pattern.isResampler) || (!isColorizable && settings?.brushSettings?.brushShape === BrushShape.RESAMPLER);
        
        let scaledWidth, scaledHeight;
        if (isResampler) {
          // Resampler: apply pressure-based scaling if pressure is enabled
          // The 'size' parameter already includes pressure modulation from the brush engine
          const maxDimension = Math.max(pattern.width, pattern.height);
          const scaleFactor = size / maxDimension;
          scaledWidth = pattern.width * scaleFactor;
          scaledHeight = pattern.height * scaleFactor;
        } else {
          // Regular custom brush: apply scaling
          const maxDimension = Math.max(pattern.width, pattern.height);
          const scaleFactor = size / maxDimension;
          scaledWidth = pattern.width * scaleFactor;
          scaledHeight = pattern.height * scaleFactor;
        }
        
        // Apply rotation if specified
        if (rotation !== 0) {
          targetCtx.save();
          targetCtx.translate(drawX, drawY);
          targetCtx.rotate(rotation);
          targetCtx.translate(-drawX, -drawY);
        }
        
        // Draw the custom brush centered at the position
        const centerX = drawX - scaledWidth / 2;
        const centerY = drawY - scaledHeight / 2;
        
        // Ensure crisp custom brush rendering (no smoothing)
        targetCtx.imageSmoothingEnabled = false;
        
        // Draw the custom brush image, scaling from source dimensions to target size
        targetCtx.drawImage(
          canvasToUse, 
          0, 0, pattern.width, pattern.height,  // source rectangle 
          centerX, centerY, scaledWidth, scaledHeight  // destination rectangle
        );
        
        if (rotation !== 0) {
          targetCtx.restore();
        }
        
        // Important: Return early after drawing custom brush to avoid drawing default shape
        targetCtx.restore();
        return;
      } catch {
        // Handle pattern errors silently
      }
    }
    // Also return here if we attempted to draw a custom brush
    if (shape === BrushShape.CUSTOM) {
      targetCtx.restore();
      return;
    }
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
    // Original shape rendering
    const drawingCtx = targetCtx;
    
    switch (shape) {
      case BrushShape.SQUARE:
        if (antiAliasing) {
          drawingCtx.fillRect(drawX - halfSize, drawY - halfSize, size, size);
        } else {
          // Pixel-perfect square
          const pixelSize = Math.round(size);
          
          if (quantizedRotation !== 0) {
            // Create a square stamp and rotate it
            const squareStamp = document.createElement('canvas');
            squareStamp.width = pixelSize;
            squareStamp.height = pixelSize;
            const sqCtx = squareStamp.getContext('2d');
            if (sqCtx) {
              sqCtx.imageSmoothingEnabled = false;
              sqCtx.fillStyle = drawingCtx.fillStyle;
              sqCtx.fillRect(0, 0, pixelSize, pixelSize);
              
              // Get pre-rotated version
              const rotatedSquare = getRotatedPixelStamp(squareStamp, quantizedRotation, `pixel_square_${pixelSize}`);
              
              // Draw rotated square
              const offsetX = Math.round(drawX - rotatedSquare.width / 2);
              const offsetY = Math.round(drawY - rotatedSquare.height / 2);
              drawingCtx.imageSmoothingEnabled = false;
              drawingCtx.drawImage(rotatedSquare, offsetX, offsetY);
            }
          } else {
            // No rotation - use direct fillRect
            const offset = Math.floor(pixelSize / 2);
            drawingCtx.fillRect(drawX - offset, drawY - offset, pixelSize, pixelSize);
          }
        }
        break;
        
      case BrushShape.ROUND: {
        // Optimized rendering using pre-cached circular stamps
        const roundedSize = Math.round(size);
        const useFastRender = roundedSize > 2 && !pattern;
        
        if (useFastRender && antiAliasing && deps?.brushStampCache) {
          // Soft brush with pre-rendered CIRCULAR stamps for performance
          // Include color in cache key to handle color changes
          const currentColor = drawingCtx.fillStyle.toString();
          const cacheKey = `soft_circle_${roundedSize}_${currentColor}`;
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
            
            // Parse the current color to extract RGB values
            const match = currentColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
            if (match) {
              const [, r, g, b] = match;
              gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
              gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.8)`);
              gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
            } else if (currentColor.startsWith('#')) {
              // Handle hex colors
              const hex = currentColor.replace('#', '');
              const r = parseInt(hex.substr(0, 2), 16);
              const g = parseInt(hex.substr(2, 2), 16);
              const b = parseInt(hex.substr(4, 2), 16);
              gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
              gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.8)`);
              gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
            } else {
              // Fallback - use the color directly with alpha variations
              gradient.addColorStop(0, currentColor);
              gradient.addColorStop(0.5, currentColor);
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
              
              // Get pre-rotated stamp if rotation is needed
              let finalStamp = tempCanvas;
              if (quantizedRotation !== 0) {
                finalStamp = getRotatedPixelStamp(tempCanvas, quantizedRotation, `pixel_circle_${stampSize}`);
              }
              
              // Calculate offset for stamp (account for larger size if rotated)
              const offsetX = Math.round(drawX - finalStamp.width / 2);
              const offsetY = Math.round(drawY - finalStamp.height / 2);
              
              // Draw the colored and possibly rotated stamp
              if (finalStamp) {
                // CRITICAL: Ensure no smoothing when drawing pixel stamps
                drawingCtx.imageSmoothingEnabled = false;
                drawingCtx.drawImage(finalStamp, offsetX, offsetY);
              }
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
      
      case BrushShape.POLYGON: {
        // Polygon shape with dither support
        const sides = settings?.brushSettings?.polygonSides || 6; // Default to hexagon
        const ditherRes = settings?.brushSettings?.polygonDitherResolution || 3; // Default dither resolution
        
        drawingCtx.save();
        
        // For dithered polygons, ensure hard pixel edges
        if (settings?.brushSettings?.ditherEnabled) {
          drawingCtx.imageSmoothingEnabled = false;
        }
        
        drawingCtx.beginPath();
        
        // Draw polygon path
        for (let i = 0; i < sides; i++) {
          const angle = (Math.PI * 2 / sides) * i - Math.PI / 2; // Start from top
          const px = drawX + Math.cos(angle) * halfSize;
          const py = drawY + Math.sin(angle) * halfSize;
          
          if (i === 0) {
            drawingCtx.moveTo(px, py);
          } else {
            drawingCtx.lineTo(px, py);
          }
        }
        drawingCtx.closePath();
        
        // Apply dithering if enabled
        if (settings?.brushSettings?.ditherEnabled && ditherRes > 1) {
          // Create a dithered fill pattern
          const patternSize = ditherRes;
          const patternCanvas = document.createElement('canvas');
          patternCanvas.width = patternSize;
          patternCanvas.height = patternSize;
          const patternCtx = patternCanvas.getContext('2d');
          
          if (patternCtx) {
            // Create dither pattern (checkerboard for now)
            patternCtx.fillStyle = drawingCtx.fillStyle;
            for (let y = 0; y < patternSize; y++) {
              for (let x = 0; x < patternSize; x++) {
                // Simple ordered dither
                if ((x + y) % 2 === 0) {
                  patternCtx.fillRect(x, y, 1, 1);
                }
              }
            }
            
            const pattern = drawingCtx.createPattern(patternCanvas, 'repeat');
            if (pattern) {
              drawingCtx.fillStyle = pattern;
            }
          }
        }
        
        drawingCtx.fill();
        drawingCtx.restore();
        break;
      }
      
      case BrushShape.SPAM_TEXT: {
        // Spam text brush - render single characters sequentially
        const fontSize = Math.round(size);
        
        // Get the next character from the continuous text stream
        const char = deps?.getNextSpamChar ? deps.getNextSpamChar() : 'S';
        
        // Get font from settings or default to Courier
        const brushSettings = settings?.brushSettings;
        const fontFamily = brushSettings?.spamFont === 'consolas' ? 'Consolas, monospace' :
                          brushSettings?.spamFont === 'monaco' ? 'Monaco, monospace' :
                          brushSettings?.spamFont === 'lucida' ? 'Lucida Console, monospace' :
                          brushSettings?.spamFont === 'roboto' ? 'Roboto Mono, monospace' :
                          brushSettings?.spamFont === 'source' ? 'Source Code Pro, monospace' :
                          brushSettings?.spamFont === 'terminal' ? 'Terminal, monospace' :
                          brushSettings?.spamFont === 'menlo' ? 'Menlo, monospace' :
                          'Courier New, monospace';
        
        drawingCtx.save();
        drawingCtx.font = `${fontSize}px ${fontFamily}`;
        drawingCtx.textAlign = 'center';
        drawingCtx.textBaseline = 'middle';
        
        // No rotation for better readability of continuous text
        drawingCtx.fillText(char, drawX, drawY);
        
        drawingCtx.restore();
        break;
      }
        
      default:
        // Default to square for unknown shapes
        drawingCtx.fillRect(drawX - halfSize, drawY - halfSize, size, size);
        break;
    }
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
 * Apply risograph texture effect to a drawn shape
 * Matches the monolithic implementation's per-stamp risograph effect
 */
export const applyRisographTexture = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  intensity: number
) => {
  if (intensity <= 0) {
    return;
  }
  
  // Get cached risograph pattern
  const risoPattern = getRisographPattern(ctx);
  
  if (!risoPattern) {
    return;
  }
  
  // Check if we need to recalculate cached alpha value
  const isPixelBrush = !ctx.imageSmoothingEnabled;
  
  if (cachedRisoIntensity !== intensity || cachedRisoIsPixel !== isPixelBrush) {
    cachedRisoIntensity = intensity;
    cachedRisoIsPixel = isPixelBrush;
    cachedRisoAlpha = isPixelBrush 
      ? (intensity / 100) * 0.6
      : (intensity / 100) * 0.35;
  }
  
  // Store original values (much faster than save/restore)
  const originalAlpha = ctx.globalAlpha;
  const originalComposite = ctx.globalCompositeOperation;
  const originalFillStyle = ctx.fillStyle;
  
  // Apply risograph effect
  ctx.globalCompositeOperation = 'multiply';
  // Combine the risograph alpha with the existing alpha (e.g., from brush opacity)
  ctx.globalAlpha = originalAlpha * cachedRisoAlpha;
  ctx.fillStyle = risoPattern;
  
  // Draw slightly larger to cover the shape (matching monolithic)
  const risoSize = size * 1.1;
  const halfSize = risoSize / 2;
  ctx.fillRect(x - halfSize, y - halfSize, risoSize, risoSize);
  
  // Restore original values
  ctx.globalAlpha = originalAlpha;
  ctx.globalCompositeOperation = originalComposite;
  ctx.fillStyle = originalFillStyle;
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
