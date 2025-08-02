'use client';

import { useCallback, useRef } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { BrushComponent, ComponentType, BrushShape, CustomBrush } from '../types';
import { shouldApplyGridSnap, snapToGrid, getGridPositionsBetween, calculateGridDimensions, snapToRectangularGrid, getRectangularGridPositionsBetween } from '../utils/gridSnap';
import { canvasPool } from '../utils/canvasPool';
import { brushCache } from '../utils/brushCache';
import { scaledBrushCache } from '../utils/scaledBrushCache';
import { pressureOptimizer } from '../utils/pressureOptimizer';
import { memoryManager } from '../utils/memoryCleanup';
import { performanceMonitor } from '../utils/performanceMonitor';
import { adjustHueAndSaturation } from '../utils/imageProcessing';

// Cache for pre-rendered pixel circle stamps
const pixelCircleStampCache = new Map<string, HTMLCanvasElement>();

// Color jitter utility function
// Cache for color jitter canvas context (reused across all calls)
let jitterCanvas: HTMLCanvasElement | null = null;
let jitterCtx: CanvasRenderingContext2D | null = null;

// Cache for pattern rendering temp canvas (reused for all pattern operations)
let patternTempCanvas: HTMLCanvasElement | null = null;
let patternTempCtx: CanvasRenderingContext2D | null = null;

const getJitterContext = (): CanvasRenderingContext2D => {
  if (!jitterCanvas || !jitterCtx) {
    jitterCanvas = document.createElement('canvas');
    jitterCanvas.width = 1;
    jitterCanvas.height = 1;
    jitterCtx = jitterCanvas.getContext('2d', { colorSpace: 'srgb' })!;
  }
  return jitterCtx;
};

const getPatternTempContext = (width: number, height: number): CanvasRenderingContext2D => {
  if (!patternTempCanvas || !patternTempCtx || 
      patternTempCanvas.width < width || patternTempCanvas.height < height) {
    patternTempCanvas = document.createElement('canvas');
    patternTempCanvas.width = Math.max(width, patternTempCanvas?.width || 0);
    patternTempCanvas.height = Math.max(height, patternTempCanvas?.height || 0);
    patternTempCtx = patternTempCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' })!;
  }
  // Clear and resize for this pattern
  patternTempCtx.clearRect(0, 0, width, height);
  return patternTempCtx;
};

const applyColorJitter = (baseColor: string, jitterAmount: number): string => {
  if (jitterAmount === 0) {
    return baseColor;
  }
  
  // Parse color to HSL for smooth jitter variations using cached context
  const ctx = getJitterContext();
  ctx.fillStyle = baseColor;
  const computedColor = ctx.fillStyle;
  
  // Extract RGB from computed color
  let r: number, g: number, b: number;
  if (computedColor.startsWith('#')) {
    const hex = computedColor.slice(1);
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else if (computedColor.startsWith('rgb')) {
    const matches = computedColor.match(/\d+/g);
    if (!matches) return baseColor;
    r = parseInt(matches[0]);
    g = parseInt(matches[1]);
    b = parseInt(matches[2]);
  } else {
    return baseColor;
  }
  
  // Convert RGB to HSL
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h: number, s: number, l = (max + min) / 2;
  
  if (max === min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
      default: h = 0;
    }
    h /= 6;
  }
  
  // Apply jitter with smooth randomization
  const jitterFactor = jitterAmount / 100;
  h += (Math.random() - 0.5) * jitterFactor;
  s = Math.max(0, Math.min(1, s + (Math.random() - 0.5) * jitterFactor * 0.5));
  l = Math.max(0, Math.min(1, l + (Math.random() - 0.5) * jitterFactor * 0.3));
  
  // Keep hue within bounds
  h = ((h % 1) + 1) % 1;
  
  // Convert HSL back to RGB
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  
  let rOut: number, gOut: number, bOut: number;
  if (s === 0) {
    rOut = gOut = bOut = l; // achromatic
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    rOut = hue2rgb(p, q, h + 1/3);
    gOut = hue2rgb(p, q, h);
    bOut = hue2rgb(p, q, h - 1/3);
  }
  
  const result = `rgb(${Math.round(rOut * 255)}, ${Math.round(gOut * 255)}, ${Math.round(bOut * 255)})`;
  return result;
};

// Base sizes for standard brushes (100% = these sizes in pixels)
const BRUSH_BASE_SIZES = {
  [BrushShape.PIXEL_ROUND]: 1,
  [BrushShape.ROUND]: 10,
  [BrushShape.SQUARE]: 10,
  [BrushShape.TRIANGLE]: 10,
  [BrushShape.CUSTOM]: 32 // Default for custom brushes
} as const;

export interface StrokeInput {
  position: { x: number; y: number };
  pressure: number;
  velocity: number;
  timestamp: number;
  direction?: number; // Angle in radians from movement vector
}

export interface RenderSettings {
  size: number;
  opacity: number;
  color: string;
  antiAliasing: boolean;
  pixelAlignment: boolean;
  spacing: number;
  rotation: number;
  shape: BrushShape;
  pattern?: ImageData;
  centerAlignment?: boolean;
  blendMode?: GlobalCompositeOperation;
}


export const useBrushEngine = () => {
  const { tools, activeBrushComponents, project, brushPresets, temporaryCustomBrush } = useAppStore();
  
  
  // Pixel queue state for perfect pixel drawing with distance-based spacing
  const pixelQueueRef = useRef({
    lastDrawnX: 0,
    lastDrawnY: 0,
    waitingPixelX: 0,
    waitingPixelY: 0,
    initialized: false,
    spacingCounter: 0,
    // Distance-based spacing state
    accumulatedDistance: 0,
    lastStrokePosition: { x: 0, y: 0 },
    // Dashed brush state
    dashStampCounter: 0,
    // Grid position tracking to prevent multiple stamps per grid cell
    stampedGridPositions: new Set<string>()
  });

  // Direction smoothing for rotation
  const directionHistoryRef = useRef<number[]>([]);
  const lastDirectionRef = useRef<number>(0);

  // --- START FIX 1 ---
  // Create a ref to hold a reusable input object.
  const strokeInputRef = useRef<StrokeInput>({
    position: { x: 0, y: 0 },
    pressure: 0,
    velocity: 0,
    timestamp: 0,
    direction: 0,
  });
  // --- END FIX 1 ---

  // Quantize brush size to prevent micro-variations when using grid snap + pressure
  const quantizeBrushSize = useCallback((size: number, stepSize: number = 0.5): number => {
    const invStepSize = 1 / stepSize; // Avoid division in hot path
    return Math.round(size * invStepSize) / invStepSize;
  }, []);

  // Calculate and smooth direction from movement vector
  const calculateSmoothDirection = useCallback((from: { x: number; y: number }, to: { x: number; y: number }): number => {
    const deltaX = to.x - from.x;
    const deltaY = to.y - from.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    // Get current pressure to detect stylus vs mouse input
    const cursorPressure = useAppStore.getState().canvas.cursor.pressure ?? 1.0;
    const isStylusInput = cursorPressure < 0.98; // Stylus typically has variable pressure
    
    // Adaptive smoothing based on input type
    const minDistance = isStylusInput ? 1.5 : 3; // Stylus: more responsive, Mouse: more filtered
    const historySize = isStylusInput ? 4 : 7; // Stylus: shorter history, Mouse: longer history
    
    // If movement is very small, keep last direction to avoid jitter
    if (distance < minDistance) {
      return lastDirectionRef.current;
    }
    
    // Calculate direction angle (radians)
    const direction = Math.atan2(deltaY, deltaX);
    
    // Add to history for smoothing
    directionHistoryRef.current.push(direction);
    
    // Keep adaptive history size
    if (directionHistoryRef.current.length > historySize) {
      directionHistoryRef.current.shift();
    }
    
    // Smooth direction using weighted average with adaptive weights
    let smoothedDirection = direction;
    if (directionHistoryRef.current.length > 1) {
      // Adaptive weight distribution based on input type
      const weights = isStylusInput 
        ? [0.45, 0.30, 0.20, 0.05] // Stylus: more emphasis on recent directions
        : [0.25, 0.20, 0.18, 0.15, 0.12, 0.07, 0.03]; // Mouse: gradual smoothing
      
      let weightSum = 0;
      let sinSum = 0;
      let cosSum = 0;
      
      // Use circular averaging to handle angle wraparound properly
      for (let i = 0; i < directionHistoryRef.current.length; i++) {
        const weight = weights[directionHistoryRef.current.length - 1 - i] || 0.02;
        const angle = directionHistoryRef.current[i];
        sinSum += Math.sin(angle) * weight;
        cosSum += Math.cos(angle) * weight;
        weightSum += weight;
      }
      
      // Convert back to angle using atan2 for proper quadrant
      smoothedDirection = Math.atan2(sinSum / weightSum, cosSum / weightSum);
    }
    
    // Apply adaptive final smoothing
    if (lastDirectionRef.current !== 0) {
      let angleDiff = smoothedDirection - lastDirectionRef.current;
      
      // Normalize angle difference to [-PI, PI]
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      
      // Adaptive smoothing factor: stylus more responsive, mouse smoother
      const smoothingFactor = isStylusInput ? 0.35 : 0.15;
      smoothedDirection = lastDirectionRef.current + angleDiff * smoothingFactor;
    }
    
    lastDirectionRef.current = smoothedDirection;
    return smoothedDirection;
  }, []);

  // Pixel-perfect circle patterns based on reference image
  const getPixelCircleStamp = useCallback((size: number): HTMLCanvasElement => {
    const cacheKey = `${size}`;
    
    // Check cache first
    if (pixelCircleStampCache.has(cacheKey)) {
      return pixelCircleStampCache.get(cacheKey)!;
    }

    // Define hardcoded patterns for small sizes (1-8)
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
      // Fallback to calculated circle for larger sizes
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

    // Create an offscreen canvas for the stamp
    const stampCanvas = document.createElement('canvas');
    stampCanvas.width = size;
    stampCanvas.height = size;
    const stampCtx = stampCanvas.getContext('2d', { colorSpace: 'srgb' })!;

    // Draw the pixel pattern in white (color will be applied during drawing)
    stampCtx.fillStyle = 'white';
    stampCtx.imageSmoothingEnabled = false;
    pixels.forEach(pixel => {
      stampCtx.fillRect(pixel.x, pixel.y, 1, 1);
    });

    // Store the new stamp in the cache and return it
    pixelCircleStampCache.set(cacheKey, stampCanvas);
    return stampCanvas;
  }, []);
  
  const drawShape = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    shape: BrushShape,
    antiAliasing: boolean,
    rotation: number = 0,
    pattern?: ImageData,
    centerAlignment?: boolean
  ) => {
    const halfSize = size / 2;
    
    // Check transparency lock before drawing
    if ((window as any).transparencyLockEnabled) {
      // Sample the center pixel to check if we can draw here
      const centerX = Math.floor(x);
      const centerY = Math.floor(y);
      
      try {
        const imageData = ctx.getImageData(centerX, centerY, 1, 1);
        const alpha = imageData.data[3]; // Alpha channel
        
        // If transparency lock is enabled and pixel is fully transparent, skip drawing
        if (alpha === 0) {
          return;
        }
      } catch (error) {
        // If we can't read the pixel data, allow drawing
      }
    }
    
    ctx.save();
    
    if (!antiAliasing) {
      ctx.imageSmoothingEnabled = false;
      // Round to pixel boundaries for pixel-perfect drawing
      x = Math.round(x);
      y = Math.round(y);
    } else {
      // Ensure smoothing is enabled for antialiased drawing
      ctx.imageSmoothingEnabled = true;
    }
    
    // Apply rotation if specified
    if (rotation !== 0) {
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.translate(-x, -y);
    }
    
    // Handle custom pattern rendering
    if (pattern && pattern.width > 0 && pattern.height > 0) {
      
      // Use cached temporary canvas for pattern
      const tempCtx = getPatternTempContext(pattern.width, pattern.height);
      const tempCanvas = patternTempCanvas!;
      
      if (tempCtx) {
        try {
          // Configure temp canvas context to match main context
          tempCtx.imageSmoothingEnabled = ctx.imageSmoothingEnabled;
          tempCtx.putImageData(pattern, 0, 0);
          
          // Use pattern at original pixel size
          const scaledWidth = pattern.width;
          const scaledHeight = pattern.height;
          
          // Calculate position based on alignment
          let drawX = x;
          let drawY = y;
          
          if (centerAlignment) {
            drawX = x - scaledWidth / 2;
            drawY = y - scaledHeight / 2;
          }
          
          // Round coordinates to prevent sub-pixel positioning
          drawX = Math.round(drawX);
          drawY = Math.round(drawY);
          
          // Draw the pattern at original size
          ctx.drawImage(tempCanvas, drawX, drawY);
        } catch (error) {
        }
      }
    } else {
      // Original shape rendering
      switch (shape) {
        case BrushShape.SQUARE:
          if (antiAliasing) {
            ctx.fillRect(x - halfSize, y - halfSize, size, size);
          } else {
            // Pixel-perfect square
            const offset = Math.floor(size / 2);
            ctx.fillRect(x - offset, y - offset, size, size);
          }
          break;
          
        case BrushShape.ROUND:
          // Always use perfect circles for antialiased round brushes
          ctx.beginPath();
          ctx.arc(x, y, halfSize, 0, Math.PI * 2);
          ctx.fill();
          break;
          
        case BrushShape.PIXEL_ROUND: {
          // Get the colorless pre-rendered stamp canvas
          const stampCanvas = getPixelCircleStamp(Math.max(1, Math.round(size)));
          const stampSize = stampCanvas.width;

          // Acquire a canvas from the pool. It will be reused across calls.
          const tempCanvas = canvasPool.acquire(stampSize, stampSize);
          const tempCtx = tempCanvas.getContext('2d', { colorSpace: 'srgb' });

          if (!tempCtx) {
            canvasPool.release(tempCanvas);
            break;
          }

          try {
            const offsetX = Math.round(x - stampSize / 2);
            const offsetY = Math.round(y - stampSize / 2);

            // Clear previous content from the pooled canvas
            tempCtx.clearRect(0, 0, stampSize, stampSize);
            
            // Draw the white stamp to temp canvas
            tempCtx.drawImage(stampCanvas, 0, 0);
            
            // Apply color using source-in (only affects existing pixels)
            tempCtx.globalCompositeOperation = 'source-in';
            tempCtx.fillStyle = ctx.fillStyle;
            tempCtx.fillRect(0, 0, stampSize, stampSize);
            
            // Draw the colored stamp to the main canvas
            ctx.drawImage(tempCanvas, offsetX, offsetY);
          } finally {
            // IMPORTANT: Release the canvas back to the pool for reuse
            canvasPool.release(tempCanvas);
          }
          break;
        }
          
        case BrushShape.TRIANGLE:
          ctx.beginPath();
          if (antiAliasing) {
            ctx.moveTo(x, y - halfSize);
            ctx.lineTo(x - halfSize, y + halfSize);
            ctx.lineTo(x + halfSize, y + halfSize);
          } else {
            // Pixel-perfect triangle
            const height = Math.floor(size * 0.866); // sqrt(3)/2
            
            // Draw filled triangle pixel by pixel
            for (let row = 0; row < height; row++) {
              const width = Math.floor((row + 1) * size / height);
              const startX = Math.round(x - Math.floor(width / 2));
              const startY = Math.round(y - Math.floor(height / 2));
              for (let col = 0; col < width; col++) {
                ctx.fillRect(startX + col, startY + row, 1, 1);
              }
            }
          }
          if (antiAliasing) {
            ctx.closePath();
            ctx.fill();
          }
          break;
      }
    }
    
    ctx.restore();
  }, [getPixelCircleStamp]);
  
  const calculateSizeModification = useCallback((
    component: BrushComponent,
    input: StrokeInput,
    baseSize: number
  ): number => {
    const params = component.parameters as any;
    const pressure = input.pressure || 0.5;
    
    // Apply pressure influence
    const pressureEffect = (pressure - 0.5) * (params.pressureInfluence || 0);
    const modifiedSize = baseSize * (1 + pressureEffect);
    
    // Apply min/max constraints from component
    return Math.max(
      params.minSize || 1,
      Math.min(params.maxSize || 1000, modifiedSize)
    );
  }, []);
  
  const calculateOpacityModification = useCallback((
    component: BrushComponent,
    input: StrokeInput,
    baseOpacity: number
  ): number => {
    const params = component.parameters as any;
    const pressure = input.pressure || 0.5;
    
    // Apply pressure influence to opacity
    const pressureEffect = (pressure - 0.5) * (params.pressureInfluence || 0);
    const modifiedOpacity = baseOpacity * (1 + pressureEffect);
    
    return Math.max(0, Math.min(1, modifiedOpacity));
  }, []);
  
  const calculatePressureEffects = useCallback((
    component: BrushComponent,
    input: StrokeInput,
    settings: RenderSettings
  ): RenderSettings => {
    const params = component.parameters as any;
    const pressure = input.pressure || 0.5;
    
    const newSettings = { ...settings };
    
    // Apply pressure to size if enabled
    if (params.sizeInfluence) {
      const sizeEffect = (pressure - 0.5) * params.sizeInfluence;
      newSettings.size = Math.max(1, settings.size * (1 + sizeEffect));
    }
    
    // Apply pressure to opacity if enabled
    if (params.opacityInfluence) {
      const opacityEffect = (pressure - 0.5) * params.opacityInfluence;
      newSettings.opacity = Math.max(0, Math.min(1, settings.opacity * (1 + opacityEffect)));
    }
    
    return newSettings;
  }, []);
  
  const executeComponent = useCallback((
    component: BrushComponent,
    input: StrokeInput,
    currentSettings: RenderSettings
  ): RenderSettings => {
    switch (component.type) {
      case ComponentType.SIZE_MODIFIER:
        return {
          ...currentSettings,
          size: calculateSizeModification(component, input, currentSettings.size)
        };
        
      case ComponentType.OPACITY_MODIFIER:
        return {
          ...currentSettings,
          opacity: calculateOpacityModification(component, input, currentSettings.opacity)
        };
        
      case ComponentType.PRESSURE_HANDLER:
        return calculatePressureEffects(component, input, currentSettings);
        
      case ComponentType.ANTI_ALIASING:
        return {
          ...currentSettings,
          antiAliasing: component.parameters.mode === 'antialiased',
          pixelAlignment: component.parameters.mode === 'pixel'
        };
        
      case ComponentType.SHAPE_RENDERER:
        return {
          ...currentSettings,
          shape: component.parameters.shape as BrushShape
        };
        
      case ComponentType.PATTERN_RENDERER:
        const pattern = component.parameters.pattern as ImageData;
        const centerAlignment = component.parameters.centerAlignment as boolean;
        return {
          ...currentSettings,
          pattern,
          centerAlignment
        };
        
      case ComponentType.ROTATION_TRANSFORM:
        // Apply rotation based on movement direction if enabled
        const { brushSettings } = tools;
        if (!brushSettings.rotationEnabled || input.direction === undefined) {
          return currentSettings;
        }
        return {
          ...currentSettings,
          rotation: input.direction
        };
        
      default:
        return currentSettings;
    }
  }, [calculateSizeModification, calculateOpacityModification, calculatePressureEffects]);
  
  const executeComponents = useCallback((
    components: BrushComponent[], 
    input: StrokeInput
  ): RenderSettings => {
    const { brushSettings, eraserSettings, currentTool } = tools;
    const activeSettings = currentTool === 'eraser' ? eraserSettings : brushSettings;
    
    // Apply pressure-based size modification if enabled
    let finalSize = activeSettings.size;
    if (activeSettings.pressureEnabled) {
      // Map pressure (0.0-1.0) to size range based on maxPressure setting
      // maxPressure directly sets the max pixel size at full pressure
      const minSizePx = activeSettings.minPressure || 1;
      const maxSizePx = activeSettings.maxPressure || activeSettings.size;
      
      // Add pressure deadzone for better low-pressure control
      const pressureThreshold = 0.2;
      const adjustedPressure = input.pressure < pressureThreshold ? 0 : 
        (input.pressure - pressureThreshold) / (1.0 - pressureThreshold);
      
      finalSize = minSizePx + (adjustedPressure * (maxSizePx - minSizePx));
      
      // Quantize brush size when using grid snap + pressure to prevent multiple stamps per grid cell
      if (shouldApplyGridSnap(activeSettings)) {
        finalSize = quantizeBrushSize(finalSize, 0.5);
      }
    }
    
    // Start with base settings (don't override pixelAlignment - let components control it)
    let settings: RenderSettings = {
      size: finalSize,
      opacity: activeSettings.opacity,
      color: activeSettings.color,
      antiAliasing: activeSettings.antialiasing,
      pixelAlignment: !activeSettings.antialiasing, // Default fallback
      spacing: activeSettings.spacing,
      rotation: activeSettings.rotationEnabled && input.direction !== undefined ? input.direction : 0,
      shape: activeSettings.brushShape || BrushShape.ROUND, // Use actual brush shape from settings
      blendMode: activeSettings.blendMode || 'source-over'
    };    
    
    // Add pattern if using a brush tip from mini canvas
    if (activeSettings.currentBrushTip && 
        activeSettings.currentBrushTip.brushId === activeSettings.selectedCustomBrush) {
      settings.pattern = activeSettings.currentBrushTip.imageData;
    }
    
    // Sort components by priority
    const sortedComponents = components
      .filter(comp => comp.enabled)
      .sort((a, b) => a.priority - b.priority);
    
    // Execute each component in order
    for (const component of sortedComponents) {
      const newSettings = executeComponent(component, input, settings);
      settings = newSettings;
    }
    
    return settings;
  }, [tools, executeComponent]);
  
  
  const resetPixelQueue = useCallback(() => {
    pixelQueueRef.current = {
      lastDrawnX: 0,
      lastDrawnY: 0,
      waitingPixelX: 0,
      waitingPixelY: 0,
      initialized: false,
      spacingCounter: 0,
      // Reset distance-based spacing state
      accumulatedDistance: 0,
      lastStrokePosition: { x: 0, y: 0 },
      // Reset dashed brush state
      dashStampCounter: 0,
      // Clear grid position tracking
      stampedGridPositions: new Set<string>()
    };
    // Reset direction history for rotation
    directionHistoryRef.current = [];
    lastDirectionRef.current = 0;
    
    // Mark stroke as inactive and trigger memory cleanup
    brushCache.markStrokeInactive();
    memoryManager.runCleanup();
  }, []);

  // Helper function to determine if we should draw the current stamp (cursor-speed independent)
  const shouldDrawStamp = useCallback((brushSettings: any, queue: any, actualSize?: number, isGridSnapping: boolean = false): boolean => {
    // Defensive checks for brush settings
    if (!brushSettings || typeof brushSettings !== 'object') {
      return true;
    }
    
    const dashedEnabled = brushSettings.dashedEnabled;
    const dashLength = brushSettings.dashLength;
    const dashGap = brushSettings.dashGap;
    
    // When grid snapping is enabled, prioritize grid positioning over dash patterns
    if (isGridSnapping) {
      // For grid snapping, we always draw (grid position tracking handles duplicates)
      return true;
    }
    
    if (!dashedEnabled) {
      return true; // Always draw when dashing is disabled
    }
    
    // More defensive checks
    const baseDashLen = Number(dashLength) || 3;
    const baseDashGapLen = Number(dashGap) || 2;
    
    if (baseDashLen <= 0 || baseDashGapLen <= 0) {
      return true; // Invalid settings, default to drawing
    }
    
    // Scale dash length and gap with brush size for consistent visual proportions
    // Use actual render size (including pressure effects) for accurate dash scaling
    const brushSize = Number(actualSize || brushSettings.size) || 4;
    
    let dashLen: number;
    let dashGapLen: number;
    
    if (brushSize <= 2) {
      // For very small brushes (1-2px), use original values to ensure visible dashing
      dashLen = baseDashLen;
      dashGapLen = baseDashGapLen;
    } else {
      // For larger brushes, scale proportionally
      const sizeScaleFactor = brushSize / 4; // No minimum to allow proper scaling
      dashLen = Math.max(1, Math.round(baseDashLen * sizeScaleFactor));
      dashGapLen = Math.max(1, Math.round(baseDashGapLen * sizeScaleFactor));
    }
    
    // Calculate total cycle length in stamps
    const totalCycleLength = dashLen + dashGapLen;
    
    // Get current position in dash cycle
    const cyclePosition = queue.dashStampCounter % totalCycleLength;
    
    // Determine if we're in dash or gap segment
    const isInDashSegment = cyclePosition < dashLen;
    
    // Debug logging (disabled)
    
    // Advance counter for next stamp (happens regardless of whether we draw)
    queue.dashStampCounter++;
    
    return isInDashSegment;
  }, []);


  const drawPixelPerfectLine = useCallback((
    ctx: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    settings: RenderSettings
  ) => {
    // Bresenham's line algorithm for pixel-perfect lines with distance-based spacing
    // Note: Color jitter will be applied per stamp, not per line
    
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    
    let x = x0;
    let y = y0;
    let lastX = x0;
    let lastY = y0;
    
    // Use queue's accumulated distance for consistent spacing
    const queue = pixelQueueRef.current;
    
    while (true) {
      // Calculate distance from last position
      const distance = Math.sqrt(Math.pow(x - lastX, 2) + Math.pow(y - lastY, 2));
      queue.accumulatedDistance += distance;
      
      // Draw shape at position only if accumulated distance exceeds spacing
      if (queue.accumulatedDistance >= settings.spacing) {
        // Check if we should draw this stamp (cursor-speed independent)
        const brushSettings = tools.brushSettings;
        if (shouldDrawStamp(brushSettings, queue, settings.size)) {
          // Apply color jitter per stamp for true randomization
          const jitteredColor = applyColorJitter(settings.color, brushSettings.colorJitter || 0);
          ctx.fillStyle = jitteredColor;
          drawShape(ctx, x, y, settings.size, settings.shape, false, settings.rotation, settings.pattern, settings.centerAlignment);
        }
        queue.accumulatedDistance -= settings.spacing;
      }
      
      if (x === x1 && y === y1) break;
      
      lastX = x;
      lastY = y;
      
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }, [drawShape, tools]);

  const perfectPixels = useCallback((
    ctx: CanvasRenderingContext2D,
    currentX: number,
    currentY: number,
    settings: RenderSettings
  ) => {
    const queue = pixelQueueRef.current;
    const roundedX = Math.round(currentX);
    const roundedY = Math.round(currentY);
    
    // Note: Color jitter will be applied per stamp, not once per function call
    
    if (!queue.initialized) {
      // First pixel - initialize queue with distance-based state
      queue.lastDrawnX = roundedX;
      queue.lastDrawnY = roundedY;
      queue.waitingPixelX = roundedX;
      queue.waitingPixelY = roundedY;
      queue.initialized = true;
      queue.spacingCounter = 0;
      queue.lastStrokePosition = { x: roundedX, y: roundedY };
      queue.accumulatedDistance = 0;
      
      // Draw the first shape (check dash state)
      if (shouldDrawStamp(tools.brushSettings, queue, settings.size, false)) {
        // Apply color jitter per stamp
        const jitteredColor = applyColorJitter(settings.color, tools.brushSettings.colorJitter || 0);
        ctx.fillStyle = jitteredColor;
        drawShape(ctx, roundedX, roundedY, settings.size, settings.shape, false, settings.rotation, settings.pattern, settings.centerAlignment);
      }
      return;
    }
    
    // Calculate distance from last stroke position to current position
    const distance = Math.sqrt(
      Math.pow(roundedX - queue.lastStrokePosition.x, 2) + 
      Math.pow(roundedY - queue.lastStrokePosition.y, 2)
    );
    queue.accumulatedDistance += distance;
    
    // If current pixel not neighbor to lastDrawn, draw waiting pixel
    if (Math.abs(roundedX - queue.lastDrawnX) > 1 || Math.abs(roundedY - queue.lastDrawnY) > 1) {
      // Draw the waiting shape only if accumulated distance exceeds spacing
      if (queue.accumulatedDistance >= settings.spacing) {
        // Check if we should draw this stamp (cursor-speed independent)
        if (shouldDrawStamp(tools.brushSettings, queue, settings.size, false)) {
          // Apply color jitter per stamp
          const jitteredColor = applyColorJitter(settings.color, tools.brushSettings.colorJitter || 0);
          ctx.fillStyle = jitteredColor;
          drawShape(ctx, queue.waitingPixelX, queue.waitingPixelY, settings.size, settings.shape, false, settings.rotation, settings.pattern, settings.centerAlignment);
        }
        queue.accumulatedDistance -= settings.spacing;
        queue.lastStrokePosition = { x: queue.waitingPixelX, y: queue.waitingPixelY };
      }
      
      // Update queue
      queue.lastDrawnX = queue.waitingPixelX;
      queue.lastDrawnY = queue.waitingPixelY;
      queue.waitingPixelX = roundedX;
      queue.waitingPixelY = roundedY;
    } else {
      // Update waiting pixel to current position
      queue.waitingPixelX = roundedX;
      queue.waitingPixelY = roundedY;
    }
    
    // Update last stroke position for distance calculation
    queue.lastStrokePosition = { x: roundedX, y: roundedY };
  }, [drawShape]);

  // Note: Previously used a reusable canvas, but this caused race conditions.
  // Now we create a new canvas for each stamp to ensure isolation and correctness.

  // Custom brush drawing functions
  const drawCustomBrushStamp = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    customBrush: CustomBrush,
    scale: number = 1,
    rotation: number = 0,
    color?: string,
    isColorizable?: boolean,
    isPressureSensitive?: boolean
  ) => {
    performanceMonitor.measureStampTime(() => {
      const colorJitterAmount = tools.brushSettings.colorJitter || 0;

      // Jitter is disabled when tinting the brush with a solid color.
      if (colorJitterAmount > 0 && !isColorizable) {
        // --- OPTIMIZED JITTER PATH ---

        // 1. Get the base brush canvas (fast, cached, no CPU/GPU transfer).
        const baseBrushCanvas = scaledBrushCache.getBaseBrushCanvas(customBrush);
        
        // 2. Calculate randomized filter values.
        let jitteredHueShift = tools.brushSettings.hueShift || 0;
        let jitteredSaturationAdjust = tools.brushSettings.saturationAdjust || 100;
        
        const normalizedJitter = colorJitterAmount / 100;
        const jitterFactor = normalizedJitter * normalizedJitter;
        jitteredHueShift += (Math.random() - 0.5) * jitterFactor * 360;
        jitteredSaturationAdjust = Math.max(0, Math.min(200, jitteredSaturationAdjust + (Math.random() - 0.5) * jitterFactor * 100));

        // 3. Prepare a temporary canvas from the pool for this stamp.
        const scaledWidth = Math.ceil(customBrush.width * scale);
        const scaledHeight = Math.ceil(customBrush.height * scale);
        const stampCanvas = canvasPool.acquire(scaledWidth, scaledHeight);
        const stampCtx = stampCanvas.getContext('2d', { colorSpace: 'srgb' });

        if (!stampCtx) {
          canvasPool.release(stampCanvas);
          return;
        }

        try {
          // 4. Apply the random filter to the context.
          stampCtx.filter = `hue-rotate(${jitteredHueShift}deg) saturate(${jitteredSaturationAdjust}%)`;

          // 5. Apply rotation if needed.
          if (rotation !== 0) {
            stampCtx.translate(scaledWidth / 2, scaledHeight / 2);
            stampCtx.rotate(rotation);
            stampCtx.translate(-scaledWidth / 2, -scaledHeight / 2);
          }
          
          // 6. Draw the base brush onto the stamp canvas. The GPU applies the filter here.
          stampCtx.imageSmoothingEnabled = false;
          stampCtx.drawImage(baseBrushCanvas, 0, 0, scaledWidth, scaledHeight);
          
          // 7. Draw the final, jittered stamp to the main canvas.
          const centerX = x - scaledWidth / 2;
          const centerY = y - scaledHeight / 2;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(stampCanvas, centerX, centerY);
        } finally {
          canvasPool.release(stampCanvas);
        }

      } else {
        // --- NON-JITTER PATH (uses the existing fast cache) ---
        const scaledCanvas = scaledBrushCache.createScaledBrush(
          customBrush, scale, rotation, color, isColorizable, isPressureSensitive,
          tools.brushSettings.hueShift || 0, tools.brushSettings.saturationAdjust || 100
        );
        
        const centerX = x - scaledCanvas.width / 2;
        const centerY = y - scaledCanvas.height / 2;
        
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(scaledCanvas, centerX, centerY);
      }
    });
  }, [
    tools.brushSettings.colorJitter, 
    tools.brushSettings.hueShift, 
    tools.brushSettings.saturationAdjust,
    tools.brushSettings.pressureEnabled
  ]);

  const drawCustomBrushLine = useCallback((ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, customBrush: CustomBrush, scale: number = 1, rotation: number = 0, color?: string, isColorizable?: boolean) => {
    const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    const spacing = Math.max(1, Math.min(customBrush.width, customBrush.height) * scale * 0.5);
    const steps = Math.max(1, Math.ceil(distance / spacing));
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      drawCustomBrushStamp(ctx, x, y, customBrush, scale, rotation, color, isColorizable, tools.brushSettings.pressureEnabled);
    }
  }, [drawCustomBrushStamp]);

  const renderBrushStroke = useCallback((
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    components: BrushComponent[] = activeBrushComponents
  ) => {
    // Mark stroke as active for cache retention
    brushCache.markStrokeActive();
    
    // Performance monitoring for brush strokes
    const strokeStartTime = process.env.NODE_ENV === 'development' ? performance.now() : 0;
    
    // Get actual pressure from cursor state in the store
    const cursorPressure = useAppStore.getState().canvas.cursor.pressure ?? 1.0;
    
    const isCustomBrush = tools.brushSettings.brushShape === BrushShape.CUSTOM;
    
    // Look for custom brush early to include dimensions in cache key
    let customBrush = null;
    
    // Create current brush ID
    const currentBrushId = isCustomBrush && tools.brushSettings.selectedCustomBrush 
      ? tools.brushSettings.selectedCustomBrush // Use raw format (matches BrushControls/MiniCanvas)
      : `standard_${tools.brushSettings.brushShape}`;
    
    // Check if there's a currentBrushTip for this specific brush
    if (tools.brushSettings.currentBrushTip && tools.brushSettings.currentBrushTip.brushId === currentBrushId) {
      // Create a temporary custom brush from the current brush tip
      const imageData = tools.brushSettings.currentBrushTip.imageData;
      
      // Use the actual dimensions from currentBrushTip if available, otherwise fall back to imageData dimensions
      const actualWidth = tools.brushSettings.currentBrushTip.width || imageData.width;
      const actualHeight = tools.brushSettings.currentBrushTip.height || imageData.height;
      
      customBrush = {
        id: 'current-brush-tip',
        name: 'Current Brush Tip',
        imageData: imageData,
        thumbnail: '',
        width: actualWidth,
        height: actualHeight,
        createdAt: Date.now()
      };
    } else if (isCustomBrush && tools.brushSettings.selectedCustomBrush) {
      
      // Check temporary custom brush first
      if (temporaryCustomBrush && temporaryCustomBrush.id === tools.brushSettings.selectedCustomBrush) {
        customBrush = temporaryCustomBrush;
      } else if (project) {
        // Check project custom brushes
        customBrush = project.customBrushes.find(b => b.id === tools.brushSettings.selectedCustomBrush);
      }
    }
    
    // If not found in project custom brushes, check brush presets for custom brush presets
    if (!customBrush && isCustomBrush && tools.brushSettings.selectedCustomBrush) {
      const customBrushPreset = brushPresets.find(p => 
        p.id === tools.brushSettings.selectedCustomBrush && p.isCustomBrush && p.customBrushData
      );
      if (customBrushPreset?.customBrushData) {
        // Convert preset to custom brush format
        customBrush = {
          id: customBrushPreset.id,
          name: customBrushPreset.name,
          imageData: customBrushPreset.customBrushData.imageData,
          thumbnail: customBrushPreset.thumbnail,
          width: customBrushPreset.customBrushData.width,
          height: customBrushPreset.customBrushData.height,
          createdAt: customBrushPreset.createdAt.getTime()
        };
      }
    }
    
    
    
    // Check cache for expensive size/pressure calculations
    const cacheKey = brushCache.getCacheKey(
      tools.brushSettings.brushShape || BrushShape.ROUND,
      tools.brushSettings.size,
      cursorPressure,
      0, // rotation handled separately
      undefined, // grid spacing
      isCustomBrush ? (tools.brushSettings.selectedCustomBrush || undefined) : undefined,
      tools.brushSettings.pressureEnabled,
      tools.brushSettings.minPressure,
      tools.brushSettings.maxPressure,
      customBrush?.width,
      customBrush?.height
    );
    
    let actualBrushSize;
    const cached = brushCache.get(cacheKey);
    
    if (cached) {
      // Use cached calculations
      actualBrushSize = cached.actualSize;
    } else {
      // Calculate actual brush size using unified percentage scaling
      const baseSize = BRUSH_BASE_SIZES[tools.brushSettings.brushShape || BrushShape.ROUND];
      const baseBrushSize = (tools.brushSettings.size / 100) * baseSize;
      
      // Use optimized pressure calculation
      const pressureResult = pressureOptimizer.calculatePressureSize(baseBrushSize, {
        pressureEnabled: tools.brushSettings.pressureEnabled,
        minPressure: tools.brushSettings.minPressure,
        maxPressure: tools.brushSettings.maxPressure,
        rawPressure: cursorPressure
      });
      
      actualBrushSize = pressureResult.adjustedSize;
      
      // Cache the calculated size
      brushCache.set(cacheKey, {
        scaleFactor: 1, // Will be updated for custom brushes
        actualSize: actualBrushSize,
        rotation: 0
      });
    }
    
    
    // Now recalculate actualBrushSize with the correct customBrush information
    if (tools.brushSettings.currentBrushTip && tools.brushSettings.currentBrushTip.brushId === currentBrushId && customBrush) {
      // For currentBrushTip, use the max dimension of the brush tip as base size
      const brushTipBaseSize = Math.max(customBrush.width, customBrush.height);
      const baseBrushSize = (tools.brushSettings.size / 100) * brushTipBaseSize;
      
      // For currentBrushTip, if maxPressure is not set, use the calculated brush size
      // This ensures 100% pressure shows the brush at its intended size
      const effectiveMaxPressure = tools.brushSettings.maxPressure || baseBrushSize;
      
      // Use optimized pressure calculation
      const pressureResult = pressureOptimizer.calculatePressureSize(baseBrushSize, {
        pressureEnabled: tools.brushSettings.pressureEnabled,
        minPressure: tools.brushSettings.minPressure,
        maxPressure: effectiveMaxPressure,
        rawPressure: cursorPressure
      });
      
      actualBrushSize = pressureResult.adjustedSize;
    } else if (isCustomBrush && customBrush) {
      // For custom brushes, calculate base size from the brush's actual dimensions
      const customBrushMaxDimension = Math.max(customBrush.width, customBrush.height);
      const baseBrushSize = (tools.brushSettings.size / 100) * customBrushMaxDimension;
      
      // For custom brushes, if maxPressure is not set, use the calculated brush size
      // This ensures 100% pressure shows the brush at its intended size
      const effectiveMaxPressure = tools.brushSettings.maxPressure || baseBrushSize;
      
      // Use optimized pressure calculation
      const pressureResult = pressureOptimizer.calculatePressureSize(baseBrushSize, {
        pressureEnabled: tools.brushSettings.pressureEnabled,
        minPressure: tools.brushSettings.minPressure,
        maxPressure: effectiveMaxPressure,
        rawPressure: cursorPressure
      });
      
      actualBrushSize = pressureResult.adjustedSize;
      
      
    }
    
    // Apply grid snapping if enabled using the actual brush size
    let snappedTo = { x: to.x, y: to.y };
    let snappedFrom = { x: from.x, y: from.y };
    const isGridSnapping = shouldApplyGridSnap(tools.brushSettings);
    let gridSize = 0;
    
    // Calculate smooth direction for rotation using snapped positions
    const direction = calculateSmoothDirection(snappedFrom, snappedTo);
    
    // --- START FIX 2 ---
    // Instead of creating a new object, update the properties of the reusable one.
    const input = strokeInputRef.current;
    input.position.x = snappedTo.x;
    input.position.y = snappedTo.y;
    input.pressure = cursorPressure;
    input.velocity = Math.sqrt(Math.pow(snappedTo.x - snappedFrom.x, 2) + Math.pow(snappedTo.y - snappedFrom.y, 2));
    input.timestamp = Date.now();
    input.direction = direction;
    // --- END FIX 2 ---
    
    let settings;
    try {
      settings = executeComponents(components, input);
    } catch (error) {
      return; // Exit early to prevent further issues
    }
    
    // Apply grid snapping after settings are calculated so we can use actual brush size
    if (isGridSnapping) {
      if (isCustomBrush && customBrush) {
        // For custom brushes, use rectangular grid based on brush dimensions with pressure-modified size
        // Check cache for grid dimensions calculation
        const gridCacheKey = brushCache.getCacheKey(
          tools.brushSettings.brushShape || BrushShape.CUSTOM,
          actualBrushSize,
          cursorPressure,
          0,
          undefined, // gridSpacing not available in BrushSettings
          customBrush.id,
          tools.brushSettings.pressureEnabled,
          undefined, // minPressure
          undefined, // maxPressure
          customBrush.width,
          customBrush.height
        );
        
        
        let gridDimensions;
        const gridCached = brushCache.get(gridCacheKey);
        
        if (gridCached && gridCached.gridDimensions) {
          gridDimensions = gridCached.gridDimensions;
        } else {
          
          gridDimensions = calculateGridDimensions(tools.brushSettings, customBrush, actualBrushSize);
          
          // Cache the grid dimensions
          brushCache.set(gridCacheKey, {
            scaleFactor: 1,
            actualSize: actualBrushSize,
            rotation: 0,
            gridDimensions
          });
        }
        
        gridSize = Math.max(gridDimensions.width, gridDimensions.height); // Keep for backward compatibility
        
        const snappedToPos = snapToRectangularGrid(to.x, to.y, gridDimensions.width, gridDimensions.height);
        const snappedFromPos = snapToRectangularGrid(from.x, from.y, gridDimensions.width, gridDimensions.height);
        snappedTo = { x: snappedToPos.x, y: snappedToPos.y };
        snappedFrom = { x: snappedFromPos.x, y: snappedFromPos.y };
      } else {
        // For regular brushes, use square grid with pressure-modified size
        gridSize = settings.size; // Use pressure-modified size directly
        
        const snappedToPos = snapToGrid(to.x, to.y, gridSize);
        const snappedFromPos = snapToGrid(from.x, from.y, gridSize);
        snappedTo = { x: snappedToPos.x, y: snappedToPos.y };
        snappedFrom = { x: snappedFromPos.x, y: snappedFromPos.y };
      }
    }
    
    ctx.save();
    
    // Initialize distance tracking state if needed
    const queue = pixelQueueRef.current;
    if (!queue.initialized) {
      queue.lastStrokePosition = { x: snappedFrom.x, y: snappedFrom.y };
      queue.accumulatedDistance = 0;
      queue.initialized = true;
    }
    
    // Apply rendering settings
    ctx.globalCompositeOperation = settings.blendMode || 'source-over';
    ctx.globalAlpha = settings.opacity;
    ctx.lineWidth = settings.size;
    ctx.lineCap = settings.pixelAlignment ? 'butt' : 'round';
    ctx.lineJoin = settings.pixelAlignment ? 'miter' : 'round';
    
    // Custom brush is already found above
    
    // Handle custom brush rendering with spacing support
    // Also use custom brush rendering if we have a currentBrushTip
    
    if (customBrush) {
      // Determine if this brush should use swatch color or support jitter
      // Always respect the useSwatchColor setting for custom brushes
      const originalIsColorizable = tools.brushSettings.brushShape === BrushShape.CUSTOM 
        ? tools.brushSettings.useSwatchColor 
        : true;
      
      // For custom brushes: allow jitter even when useSwatchColor is false
      // But only apply color tint when useSwatchColor is explicitly enabled
      const shouldApplyColorTint = originalIsColorizable;
      const brushColor = shouldApplyColorTint ? settings.color : undefined;
      
      
      // Scale custom brush using pressure-modified actualBrushSize
      // Use optimized scale factor calculation
      const isCurrentBrushTip = tools.brushSettings.currentBrushTip && 
        tools.brushSettings.currentBrushTip.brushId === currentBrushId;
      const brushTipBaseSize = isCurrentBrushTip ? Math.max(customBrush.width, customBrush.height) : undefined;
      
      // Calculate scale factor using the brush's actual dimensions, not the fixed base size
      const customBrushMaxDimension = Math.max(customBrush.width, customBrush.height);
      
      const scaleFactor = pressureOptimizer.calculateScaleFactor(
        actualBrushSize,
        customBrushMaxDimension,
        !!isCurrentBrushTip,
        brushTipBaseSize
      );
      
      // For grid snapping, the scale factor should still preserve pressure effects
      // (actualBrushSize already includes pressure modifications)
      
      if (isGridSnapping) {
        // Grid snapping mode: draw at all grid positions between last and current position
        // Use cached grid dimensions calculation
        const gridCacheKey = brushCache.getCacheKey(
          tools.brushSettings.brushShape || BrushShape.CUSTOM,
          actualBrushSize,
          cursorPressure,
          0,
          undefined, // gridSpacing not available in BrushSettings
          customBrush.id,
          tools.brushSettings.pressureEnabled,
          undefined, // minPressure
          undefined, // maxPressure
          customBrush.width,
          customBrush.height
        );
        
        
        let gridDimensions;
        const gridCached = brushCache.get(gridCacheKey);
        
        if (gridCached && gridCached.gridDimensions) {
          gridDimensions = gridCached.gridDimensions;
        } else {
          
          gridDimensions = calculateGridDimensions(tools.brushSettings, customBrush, actualBrushSize);
          
          // Cache the grid dimensions
          brushCache.set(gridCacheKey, {
            scaleFactor,
            actualSize: actualBrushSize,
            rotation: 0,
            gridDimensions
          });
        }
        
        // Fill in grid positions between last and current position for fast movement
        const gridPositions = getRectangularGridPositionsBetween(
          queue.lastStrokePosition.x || snappedFrom.x, 
          queue.lastStrokePosition.y || snappedFrom.y, 
          snappedTo.x, 
          snappedTo.y, 
          gridDimensions.width,
          gridDimensions.height
        );
        
        // Draw at each grid position that hasn't been stamped
        for (const pos of gridPositions) {
          const posKey = `${pos.x},${pos.y}`;
          if (!queue.stampedGridPositions.has(posKey) && shouldDrawStamp(tools.brushSettings, queue, settings.size, isGridSnapping)) {
            drawCustomBrushStamp(ctx, pos.x, pos.y, customBrush, scaleFactor, settings.rotation, brushColor, shouldApplyColorTint, tools.brushSettings.pressureEnabled);
            queue.stampedGridPositions.add(posKey);
          }
        }
      } else {
        // Normal mode: Apply spacing system to custom brushes using snapped positions
        const distance = Math.sqrt(Math.pow(snappedTo.x - queue.lastStrokePosition.x, 2) + Math.pow(snappedTo.y - queue.lastStrokePosition.y, 2));
        queue.accumulatedDistance += distance;
        
        // Draw custom brush stamps along the path only when accumulated distance exceeds spacing
        while (queue.accumulatedDistance >= settings.spacing) {
          // Check if we should draw this stamp (cursor-speed independent)
          if (shouldDrawStamp(tools.brushSettings, queue, settings.size, false)) {
            // Calculate the position where we should place the next stamp
            const remaining = queue.accumulatedDistance - settings.spacing;
            const progress = (distance - remaining) / distance;
            const x = queue.lastStrokePosition.x + (snappedTo.x - queue.lastStrokePosition.x) * progress;
            const y = queue.lastStrokePosition.y + (snappedTo.y - queue.lastStrokePosition.y) * progress;
            
            drawCustomBrushStamp(ctx, x, y, customBrush, scaleFactor, settings.rotation, brushColor, shouldApplyColorTint, tools.brushSettings.pressureEnabled);
          }
          
          queue.accumulatedDistance -= settings.spacing;
        }
      }
      
      // Update last stroke position for next call
      queue.lastStrokePosition = { x: snappedTo.x, y: snappedTo.y };
      
      ctx.restore();
      return; // Exit early for custom brushes
    }
    
    // Handle tool-specific behavior for regular brushes
    
    // Handle antialiasing and pixel-perfect drawing
    if (settings.pixelAlignment) {
      ctx.imageSmoothingEnabled = false;
      
      
      if (isGridSnapping) {
        // Grid snapping mode: draw at all grid positions between last and current position
        // Use unified grid size calculation
        
        // Fill in grid positions between last and current position for fast movement
        const gridPositions = getGridPositionsBetween(
          queue.lastStrokePosition.x || snappedFrom.x, 
          queue.lastStrokePosition.y || snappedFrom.y, 
          snappedTo.x, 
          snappedTo.y, 
          gridSize
        );
        
        // Draw at each grid position that hasn't been stamped
        for (const pos of gridPositions) {
          const posKey = `${pos.x},${pos.y}`;
          if (!queue.stampedGridPositions.has(posKey) && shouldDrawStamp(tools.brushSettings, queue, settings.size, isGridSnapping)) {
            const jitteredColor = applyColorJitter(settings.color, tools.brushSettings.colorJitter || 0);
            ctx.fillStyle = jitteredColor;
            drawShape(ctx, pos.x, pos.y, settings.size, settings.shape, false, settings.rotation, settings.pattern, settings.centerAlignment);
            queue.stampedGridPositions.add(posKey);
          }
        }
      } else {
        // Normal mode: Follow Tom Cantwell's exact algorithm using snapped positions
        const roundedFromX = Math.round(snappedFrom.x);
        const roundedFromY = Math.round(snappedFrom.y);
        const roundedToX = Math.round(snappedTo.x);
        const roundedToY = Math.round(snappedTo.y);
        
        // If movement is > 1 pixel, use line drawing
        if (Math.abs(roundedToX - roundedFromX) > 1 || Math.abs(roundedToY - roundedFromY) > 1) {
          // Fast movement - draw pixel-perfect line using shapes
          drawPixelPerfectLine(ctx, roundedFromX, roundedFromY, roundedToX, roundedToY, settings);
        } else {
          // Slow movement - use perfect pixel queue algorithm
          perfectPixels(ctx, snappedTo.x, snappedTo.y, settings);
        }
      }
    } else {
      if (isGridSnapping) {
        // Grid snapping mode: draw at all grid positions between last and current position
        // Use unified grid size calculation
        
        // Fill in grid positions between last and current position for fast movement
        const gridPositions = getGridPositionsBetween(
          queue.lastStrokePosition.x || snappedFrom.x, 
          queue.lastStrokePosition.y || snappedFrom.y, 
          snappedTo.x, 
          snappedTo.y, 
          gridSize
        );
        
        // Draw at each grid position that hasn't been stamped
        for (const pos of gridPositions) {
          const posKey = `${pos.x},${pos.y}`;
          if (!queue.stampedGridPositions.has(posKey) && shouldDrawStamp(tools.brushSettings, queue, settings.size, isGridSnapping)) {
            const jitteredColor = applyColorJitter(settings.color, tools.brushSettings.colorJitter || 0);
            ctx.fillStyle = jitteredColor;
            drawShape(ctx, pos.x, pos.y, settings.size, settings.shape, true, settings.rotation, settings.pattern, settings.centerAlignment);
            queue.stampedGridPositions.add(posKey);
          }
        }
      } else {
        // Normal mode: For antialiased drawing, use distance-based spacing with accumulated distance using snapped positions
        const distance = Math.sqrt(Math.pow(snappedTo.x - queue.lastStrokePosition.x, 2) + Math.pow(snappedTo.y - queue.lastStrokePosition.y, 2));
        queue.accumulatedDistance += distance;
        
        // Draw shapes along the path only when accumulated distance exceeds spacing
        while (queue.accumulatedDistance >= settings.spacing) {
          // Check if we should draw this stamp (cursor-speed independent)
          if (shouldDrawStamp(tools.brushSettings, queue, settings.size, false)) {
            // Calculate the position where we should place the next shape
            const remaining = queue.accumulatedDistance - settings.spacing;
            const progress = (distance - remaining) / distance;
            const x = queue.lastStrokePosition.x + (snappedTo.x - queue.lastStrokePosition.x) * progress;
            const y = queue.lastStrokePosition.y + (snappedTo.y - queue.lastStrokePosition.y) * progress;
            
            const jitteredColor = applyColorJitter(settings.color, tools.brushSettings.colorJitter || 0);
            ctx.fillStyle = jitteredColor;
            drawShape(ctx, x, y, settings.size, settings.shape, true, settings.rotation, settings.pattern, settings.centerAlignment);
          }
          
          queue.accumulatedDistance -= settings.spacing;
        }
      }
    }
    
    // Update last stroke position for next call
    queue.lastStrokePosition = { x: snappedTo.x, y: snappedTo.y };
    
    ctx.restore();
    
    // Performance monitoring (silent - data available in dev tools if needed)
    if (process.env.NODE_ENV === 'development' && strokeStartTime) {
      // Stroke timing data available for debugging if needed
      performance.now() - strokeStartTime;
    }
  }, [executeComponents, tools, activeBrushComponents, perfectPixels, drawPixelPerfectLine, drawShape, project, brushPresets, drawCustomBrushLine, drawCustomBrushStamp]);
  
  // Draw rectangle gradient brush
  const drawRectangleGradient = useCallback((ctx: CanvasRenderingContext2D, rectangleState: any) => {
    const { startPos, endPos, width, startColor, endColor, colors } = rectangleState;
    const { brushSettings } = useAppStore.getState().tools;
    
    // Calculate rectangle geometry
    const dx = endPos.x - startPos.x;
    const dy = endPos.y - startPos.y;
    const length = Math.hypot(dx, dy);
    
    if (length === 0 || width === 0) return;
    
    // Calculate perpendicular vector for width
    const perpX = -dy / length * (width / 2);
    const perpY = dx / length * (width / 2);
    
    // Rectangle corners
    const corners = [
      { x: startPos.x + perpX, y: startPos.y + perpY },
      { x: startPos.x - perpX, y: startPos.y - perpY },
      { x: endPos.x - perpX, y: endPos.y - perpY },
      { x: endPos.x + perpX, y: endPos.y + perpY }
    ];
    
    ctx.save();
    ctx.globalAlpha = brushSettings.opacity;
    ctx.globalCompositeOperation = brushSettings.blendMode || 'source-over';
    
    // Create linear gradient
    const gradient = ctx.createLinearGradient(startPos.x, startPos.y, endPos.x, endPos.y);
    
    // Use provided colors array or fall back to start/end colors
    if (colors && colors.length > 0) {
      // Use the provided sampled colors
      colors.forEach((color: string, index: number) => {
        const position = index / (colors.length - 1);
        gradient.addColorStop(position, color);
      });
    } else {
      // Fallback to original behavior if no colors array provided
      const numColors = brushSettings.colors || 2;
      if (numColors === 2) {
        gradient.addColorStop(0, startColor);
        gradient.addColorStop(1, endColor);
      } else {
        // Interpolate between start and end
        for (let i = 0; i < numColors; i++) {
          const position = i / (numColors - 1);
          
          const start = startColor.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
          const end = endColor.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
          
          if (start && end) {
            const r = Math.round(parseInt(start[1], 16) + (parseInt(end[1], 16) - parseInt(start[1], 16)) * position);
            const g = Math.round(parseInt(start[2], 16) + (parseInt(end[2], 16) - parseInt(start[2], 16)) * position);
            const b = Math.round(parseInt(start[3], 16) + (parseInt(end[3], 16) - parseInt(start[3], 16)) * position);
            
            const interpolatedColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
            gradient.addColorStop(position, interpolatedColor);
          } else {
            gradient.addColorStop(position, position < 0.5 ? startColor : endColor);
          }
        }
      }
    }
    
    // Draw rectangle
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    corners.slice(1).forEach(corner => ctx.lineTo(corner.x, corner.y));
    ctx.closePath();
    ctx.fill();
    
    ctx.restore();
  }, []);

  // Draw polygon gradient brush
  const drawPolygonGradient = useCallback((ctx: CanvasRenderingContext2D, options: { vertices: Array<{ x: number; y: number }>, colors: string[] }) => {
    const { vertices, colors } = options;
    const { brushSettings } = useAppStore.getState().tools;
    
    if (!vertices || vertices.length < 3 || !colors || colors.length < 2) return;
    
    ctx.save();
    ctx.globalAlpha = brushSettings.opacity;
    ctx.globalCompositeOperation = brushSettings.blendMode || 'source-over';
    
    // Create gradient along the path from first to last vertex (cursor path direction)
    const startPoint = vertices[0];
    const endPoint = vertices[vertices.length - 1];
    
    // Create linear gradient from start to end of drawing path
    const gradient = ctx.createLinearGradient(startPoint.x, startPoint.y, endPoint.x, endPoint.y);
    
    // Add color stops for each sampled color
    colors.forEach((color, index) => {
      const position = index / (colors.length - 1);
      gradient.addColorStop(position, color);
    });
    
    // Create polygon path
    ctx.beginPath();
    ctx.moveTo(vertices[0].x, vertices[0].y);
    for (let i = 1; i < vertices.length; i++) {
      ctx.lineTo(vertices[i].x, vertices[i].y);
    }
    ctx.closePath();
    
    // Fill the polygon once with the complete gradient
    ctx.fillStyle = gradient;
    ctx.fill();
    
    ctx.restore();
  }, []);

  return {
    executeComponents,
    executeComponent,
    renderBrushStroke,
    resetPixelQueue,
    drawRectangleGradient,
    drawPolygonGradient
  };
};