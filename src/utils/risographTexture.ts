/**
 * Shared risograph texture cache for consistent performance
 */
let cachedRisographTexture: HTMLCanvasElement | null = null;
let cachedPatternMap = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();

/**
 * Creates an optimized risograph noise texture using GPU-accelerated operations.
 * Uses procedural generation with canvas operations instead of pixel manipulation
 * for better performance.
 */
export const getRisographTexture = (): HTMLCanvasElement => {
  if (cachedRisographTexture) {
    return cachedRisographTexture;
  }

  const size = 256; // Smaller size for better performance, still tiles well
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
  
  // Generate noise using small rects (much faster than pixel manipulation)
  const dotSize = 2;
  ctx.fillStyle = 'black';
  
  for (let y = 0; y < size; y += dotSize) {
    for (let x = 0; x < size; x += dotSize) {
      if (Math.random() > 0.3) {
        ctx.fillRect(x, y, dotSize, dotSize);
      }
    }
  }
  
  // Apply minimal blur using shadow instead of filter (faster)
  ctx.save();
  ctx.shadowBlur = 1;
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.drawImage(canvas, 0, 0);
  ctx.restore();

  cachedRisographTexture = canvas;
  return cachedRisographTexture;
};

/**
 * Pre-create the texture to avoid lag on first use
 */
export const preloadRisographTexture = (): void => {
  getRisographTexture();
};

/**
 * Get or create a cached risograph pattern for a specific context.
 * Uses WeakMap to cache patterns per context, avoiding recreation.
 */
export const getRisographPattern = (ctx: CanvasRenderingContext2D): CanvasPattern | null => {
  let pattern = cachedPatternMap.get(ctx);
  if (pattern) {
    return pattern;
  }
  
  const texture = getRisographTexture();
  pattern = ctx.createPattern(texture, 'repeat');
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