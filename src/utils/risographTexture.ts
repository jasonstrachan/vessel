/**
 * Shared risograph texture cache for consistent performance
 * OPTIMIZED VERSION - Maintains all original features with better performance
 */
let cachedRisographTexture: HTMLCanvasElement | null = null;
const cachedPatternMap = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();

const clamp01 = (value: number): number => {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};

export interface RisographEffectSettings {
  alpha: number;
  jitter: number;
  outlineJitter: number;
}

export interface RisographEffectOptions {
  isPixelBrush?: boolean;
}

/**
 * Map slider intensity to effect parameters shared across brush paths.
 * Keeps alpha and jitter growth consistent no matter which renderer applies the effect.
 */
export const getRisographEffectSettings = (
  intensity: number,
  options: RisographEffectOptions = {}
): RisographEffectSettings => {
  const { isPixelBrush = false } = options;
  const normalized = clamp01(intensity / 100);

  if (normalized === 0) {
    return { alpha: 0, jitter: 0, outlineJitter: 0 };
  }

  // Ease curve keeps low values gentle while letting the upper range push aggressively.
  const eased = Math.pow(normalized, 0.85);
  const alphaBase = 0.18 + eased * 0.82; // 18% baseline to keep light grain visible early on.
  const alpha = Math.min(alphaBase * (isPixelBrush ? 1.05 : 1), 0.95);

  // Jitter grows faster than linear so mid/high values show clear plate misalignment.
  const jitter = Math.pow(normalized, 1.2) * 3; // Up to roughly ±3px translation.

  // Outline jitter stays lower than translation to avoid tearing edges apart.
  const outlineJitter = Math.pow(normalized, 1.1) * (isPixelBrush ? 1 : 1.3);

  return {
    alpha,
    jitter,
    outlineJitter
  };
};

/**
 * Creates an optimized risograph noise texture using GPU-accelerated operations.
 * Uses procedural generation with canvas operations instead of pixel manipulation
 * for better performance.
 */
const getRisographTexture = (): HTMLCanvasElement => {
  if (cachedRisographTexture) {
    return cachedRisographTexture;
  }

  const size = 512; // Higher resolution for finer grain while still tiling cleanly
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { 
    willReadFrequently: false,
    desynchronized: true // Enable GPU acceleration
  });

  if (!ctx) return canvas;

  // Use GPU-accelerated noise generation with rect drawing
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, size, size);
  
  // Generate noise using single-pixel dots for a tighter texture
  const dotSize = 1;
  ctx.fillStyle = 'black';
  
  for (let y = 0; y < size; y += dotSize) {
    for (let x = 0; x < size; x += dotSize) {
      if (Math.random() > 0.38) {
        ctx.fillRect(x, y, dotSize, dotSize);
      }
    }
  }
  
  // Skip blur for better performance and crisper pixels
  // The noise pattern is already good enough without blur

  cachedRisographTexture = canvas;
  return cachedRisographTexture;
};

/**
 * Pre-create the texture to avoid lag on first use
 */
export const preloadRisographTexture = (): void => {
  // Pre-generate the texture
  if (!cachedRisographTexture) {
    getRisographTexture();
  }
};

/**
 * Get or create a cached risograph pattern for a specific context.
 * Uses WeakMap to cache patterns per context, avoiding recreation.
 */
export const getRisographPattern = (ctx: CanvasRenderingContext2D): CanvasPattern | null => {
  const cachedPattern = cachedPatternMap.get(ctx);
  if (cachedPattern) {
    return cachedPattern;
  }
  
  const texture = getRisographTexture();
  const pattern = ctx.createPattern(texture, 'repeat');
  if (pattern) {
    cachedPatternMap.set(ctx, pattern);
  }
  return pattern;
};

/**
 * Clear the cached texture (patterns are auto-cleared via WeakMap)
 */
export const clearRisographTextureCache = (): void => {
  cachedRisographTexture = null;
  // WeakMap automatically handles cleanup when contexts are GC'd
};

// ============= FAST SOFT BRUSH IMPLEMENTATION =============
// Using pixel brush approach for maximum performance

interface BrushStamp {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  size: number;
  softness: number;
}

// Cache brush stamps at different sizes
const brushStampCache = new Map<string, BrushStamp>();

/**
 * Create a simple soft brush stamp - like a pixel brush but with soft edges
 * This is MUCH faster than gradients or complex blending
 */
const createBrushStamp = (size: number, softness: number = 0.5): BrushStamp => {
  const cacheKey = `${size}_${softness}`;
  const cached = brushStampCache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { 
    willReadFrequently: false,
    alpha: true 
  })!;

  const center = size / 2;
  const radius = size / 2;

  // Simple approach: just use a radial gradient once
  // This is created ONCE and reused, not recreated each stroke
  const gradient = ctx.createRadialGradient(
    center, center, radius * softness,
    center, center, radius
  );
  
  gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const stamp = { canvas, ctx, size, softness };
  brushStampCache.set(cacheKey, stamp);
  return stamp;
};

/**
 * Fast soft brush drawing - similar to pixel brush implementation
 * Just stamps pre-made brush textures without complex operations
 */
export class FastSoftBrush {
  private lastX: number | null = null;
  private lastY: number | null = null;
  private brushSize: number = 20;
  private opacity: number = 0.8;
  private softness: number = 0.5;
  private spacing: number = 0.25; // As fraction of brush size
  private pattern: CanvasPattern | null = null;

  constructor(private ctx: CanvasRenderingContext2D) {
    // Pre-cache the pattern
    this.pattern = getRisographPattern(ctx);
  }

  /**
   * Set brush parameters
   */
  setBrush(size: number, opacity: number = 0.8, softness: number = 0.5) {
    this.brushSize = size;
    this.opacity = opacity;
    this.softness = softness;
  }

  /**
   * Start a new stroke
   */
  startStroke(x: number, y: number) {
    this.lastX = x;
    this.lastY = y;
    this.drawDot(x, y);
  }

  /**
   * Continue stroke to a new point
   * This is the FAST version - similar to pixel brushes
   */
  continueTo(x: number, y: number) {
    if (this.lastX === null || this.lastY === null) {
      this.startStroke(x, y);
      return;
    }

    const dx = x - this.lastX;
    const dy = y - this.lastY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Calculate spacing
    const space = this.brushSize * this.spacing;
    const steps = Math.max(1, Math.floor(distance / space));

    // Just stamp along the line - this is what makes pixel brushes fast!
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = this.lastX + dx * t;
      const py = this.lastY + dy * t;
      this.drawDot(px, py);
    }

    this.lastX = x;
    this.lastY = y;
  }

  /**
   * Draw a single brush dot - FAST version
   * Just stamps the pre-made texture, no complex operations
   */
  drawDot(x: number, y: number) {
    const stamp = createBrushStamp(this.brushSize, this.softness);
    
    this.ctx.save();
    
    // Set up the drawing state
    this.ctx.globalAlpha = this.opacity;
    this.ctx.globalCompositeOperation = 'multiply'; // Fast blending mode
    
    // Apply risograph pattern if available
    if (this.pattern) {
      this.ctx.fillStyle = this.pattern;
    } else {
      this.ctx.fillStyle = 'black';
    }
    
    // Just stamp it - this is the key to performance!
    // We're essentially doing what pixel brushes do
    const halfSize = this.brushSize / 2;
    this.ctx.translate(x - halfSize, y - halfSize);
    
    // Use the stamp as a mask
    this.ctx.globalCompositeOperation = 'destination-in';
    this.ctx.drawImage(stamp.canvas, 0, 0);
    
    // Draw the pattern through the mask
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillRect(0, 0, this.brushSize, this.brushSize);
    
    this.ctx.restore();
  }

  /**
   * End the current stroke
   */
  endStroke() {
    this.lastX = null;
    this.lastY = null;
  }

  /**
   * Clear brush stamp cache (call when changing many brush sizes)
   */
  static clearStampCache() {
    brushStampCache.clear();
  }
}

// ============= EVEN SIMPLER PIXEL BRUSH ALTERNATIVE =============
/**
 * Ultra-fast pixel brush implementation
 * This is as fast as it gets - just stamps circles/squares
 */
export class UltraFastBrush {
  private lastX: number | null = null;
  private lastY: number | null = null;
  private pattern: CanvasPattern | null = null;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private size: number = 20,
    private opacity: number = 0.8,
    private spacing: number = 0.25
  ) {
    this.pattern = getRisographPattern(ctx);
  }

  startStroke(x: number, y: number) {
    this.lastX = x;
    this.lastY = y;
    this.stamp(x, y);
  }

  continueTo(x: number, y: number) {
    if (this.lastX === null || this.lastY === null) {
      this.startStroke(x, y);
      return;
    }

    // Simple line interpolation
    const dx = x - this.lastX;
    const dy = y - this.lastY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(distance / (this.size * this.spacing));

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.stamp(
        this.lastX + dx * t,
        this.lastY + dy * t
      );
    }

    this.lastX = x;
    this.lastY = y;
  }

  stamp(x: number, y: number) {
    this.ctx.save();
    this.ctx.globalAlpha = this.opacity;
    
    if (this.pattern) {
      this.ctx.fillStyle = this.pattern;
    } else {
      this.ctx.fillStyle = 'black';
    }

    // Just draw a circle - this is pixel brush speed!
    this.ctx.beginPath();
    this.ctx.arc(x, y, this.size / 2, 0, Math.PI * 2);
    this.ctx.fill();
    
    this.ctx.restore();
  }

  endStroke() {
    this.lastX = null;
    this.lastY = null;
  }

  setSize(size: number) {
    this.size = size;
  }

  setOpacity(opacity: number) {
    this.opacity = opacity;
  }
}
