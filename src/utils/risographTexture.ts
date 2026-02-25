import { parseCssColor } from './color/parseCssColor';
import { rgbToHsl } from './imageProcessing';

/**
 * Shared risograph texture cache for consistent performance.
 * Generates an organic, non‑halftone grain with coarse and fine dot layers.
 */
let cachedRisographTexture: HTMLCanvasElement | null = null;
const cachedPatternMap = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();

const clamp01 = (value: number): number => {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};

// Simple seeded RNG (mulberry32) for deterministic pattern generation
const mulberry32 = (seed: number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const BASE_SEED = Math.floor(Math.random() * 0xffffffff);

export const hashNumbers = (...nums: number[]): number => {
  let hash = 2166136261;
  for (const n of nums) {
    hash ^= Math.imul(Math.floor(n * 1000), 16777619);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const createSeededRng = (seed: number): (() => number) => mulberry32(seed || BASE_SEED);

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
 * Creates an organic risograph noise texture using layered coarse/fine dots.
 * Generated once per session; uses a seeded RNG for determinism.
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

  const rng = mulberry32(BASE_SEED);

  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, size, size);

  const drawDot = (x: number, y: number, radius: number, alpha: number) => {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
    ctx.fill();
  };

  // Coarse organic dots (slightly clustered) — denser
  const coarseDots = Math.floor(size * size * 0.014);
  for (let i = 0; i < coarseDots; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const radius = 0.55 + rng() * 1.35; // 0.55–1.9px
    const alpha = 0.16 + rng() * 0.26;
    drawDot(x, y, radius, alpha);

    // Tiny cluster satellites for organic clumps
    const satellites = 4 + Math.floor(rng() * 4); // 4-7 extras
    for (let s = 0; s < satellites; s++) {
      const angle = rng() * Math.PI * 2;
      const dist = 0.4 + rng() * 1.4;
      const sx = x + Math.cos(angle) * dist;
      const sy = y + Math.sin(angle) * dist;
      const sr = 0.18 + rng() * 0.36;
      const sa = alpha * (0.4 + rng() * 0.45);
      drawDot(sx, sy, sr, sa);
    }
  }

  // Fine paper grain (denser, very small)
  const fineDots = Math.floor(size * size * 0.18);
  for (let i = 0; i < fineDots; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const radius = 0.12 + rng() * 0.22; // 0.12–0.34px
    const alpha = 0.038 + rng() * 0.08;
    drawDot(x, y, radius, alpha);
  }

  // Micro specks for extra detail (very small, very light)
  const microDots = Math.floor(size * size * 0.08);
  for (let i = 0; i < microDots; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const radius = 0.05 + rng() * 0.07; // 0.05–0.12px
    const alpha = 0.014 + rng() * 0.026;
    drawDot(x, y, radius, alpha);
  }

  // Faint paper fibers (short strokes, very low alpha) — slightly denser
  const fibers = Math.floor(size * size * 0.0015);
  for (let i = 0; i < fibers; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const len = 2.5 + rng() * 4;
    const angle = rng() * Math.PI * 2;
    const ax = Math.cos(angle);
    const ay = Math.sin(angle);
    const steps = 6 + Math.floor(rng() * 6);
    const alpha = 0.01 + rng() * 0.015;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const px = x + ax * len * t;
      const py = y + ay * len * t;
      const radius = 0.12 + rng() * 0.14;
      drawDot(px, py, radius, alpha);
    }
  }

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
 * Build a CSS filter string that gently nudges hue/saturation toward CMY plates.
 * Accepts a seeded RNG for deterministic per-stroke variation.
 * Tuned to be subtle: ≤ ±4° hue, ≤ +4% saturation.
 */
export const getRisographFilter = (
  brushColor: string,
  colorShift: number = 3,
  rng: (() => number) | null = null
): string => {
  const parsed = parseCssColor(brushColor);
  const [h] = rgbToHsl(parsed.r, parsed.g, parsed.b);

  // Target hues approximating risograph plates (deg)
  const plateHues = [190, 330, 60];
  const nearest = plateHues.reduce((acc, val) => {
    const diff = Math.abs(val - h);
    return diff < acc.diff ? { hue: val, diff } : acc;
  }, { hue: plateHues[0], diff: Infinity }).hue;

  const limitedShift = clamp(colorShift ?? 0, 0, 10);
  const rngFn = rng ?? Math.random;
  const jitter = (rngFn() - 0.5) * (limitedShift * 0.6); // slight jitter
  const baseNudge = clamp(nearest - h, -limitedShift * 1.0, limitedShift * 1.0);
  const hueRotate = clamp(baseNudge + jitter, -6, 6);

  // Slight saturation lift to keep ink feel
  const satLift = 1 + limitedShift * 0.006 + (rngFn() - 0.5) * 0.012;
  const satPercent = clamp(satLift * 100, 96, 106);

  if (Math.abs(hueRotate) < 0.001 && Math.abs(satPercent - 100) < 0.5) {
    return 'none';
  }

  return `hue-rotate(${hueRotate.toFixed(2)}deg) saturate(${satPercent.toFixed(1)}%)`;
};

/**
 * Create a stroke-scoped tint mask so color shifts apply only to a band of the stroke.
 * For pixel brushes, a thin inset ring; for smooth brushes, a thicker feathered band with light noise.
 */
export const createRisoTintMask = (
  width: number,
  height: number,
  isPixelBrush: boolean,
  rng: () => number
): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'black';

  if (isPixelBrush) {
    // Slightly thicker ring + patch noise
    const inset = 1;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.clearRect(inset + 1, inset + 1, Math.max(0, canvas.width - (inset + 1) * 2), Math.max(0, canvas.height - (inset + 1) * 2));
    const noiseCount = Math.floor(canvas.width * canvas.height * 0.08);
    for (let i = 0; i < noiseCount; i++) {
      const x = Math.floor(rng() * canvas.width);
      const y = Math.floor(rng() * canvas.height);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x, y, 1, 1);
    }
  } else {
    // Feathered edge band + broader noise patches to cover ~50% of area
    const inset = Math.max(2, Math.floor(Math.min(canvas.width, canvas.height) * 0.06));
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.clearRect(inset, inset, Math.max(0, canvas.width - inset * 2), Math.max(0, canvas.height - inset * 2));

    // Feather toward center
    ctx.globalAlpha = 0.45;
    ctx.fillRect(inset * 0.5, inset * 0.5, Math.max(0, canvas.width - inset), Math.max(0, canvas.height - inset));
    ctx.globalAlpha = 1;

    // Coarse blotches
    const blotches = Math.floor(canvas.width * canvas.height * 0.005);
    for (let i = 0; i < blotches; i++) {
      const bw = 4 + Math.floor(rng() * 10);
      const bh = 4 + Math.floor(rng() * 10);
      const x = Math.floor(rng() * Math.max(1, canvas.width - bw));
      const y = Math.floor(rng() * Math.max(1, canvas.height - bh));
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x, y, bw, bh);
    }

    // Fine speckle
    const noiseCount = Math.floor(canvas.width * canvas.height * 0.02);
    for (let i = 0; i < noiseCount; i++) {
      const x = Math.floor(rng() * canvas.width);
      const y = Math.floor(rng() * canvas.height);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x, y, 1, 1);
    }
  }

  return canvas;
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
