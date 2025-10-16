/**
 * Color mixing and blending algorithms
 * Extracted for clarity and reusability
 */

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Parse hex color to RGBA
 */
export function hexToRGBA(hex: string): RGBA {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i.exec(hex);
  if (!result) {
    return { r: 0, g: 0, b: 0, a: 255 };
  }
  
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
    a: result[4] ? parseInt(result[4], 16) : 255
  };
}

/**
 * Convert RGBA to hex string
 */
export function rgbaToHex(color: RGBA): string {
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}${toHex(color.a)}`;
}

/**
 * Normal blend mode (standard alpha blending)
 */
export function blendNormal(base: RGBA, overlay: RGBA): RGBA {
  const alpha = overlay.a / 255;
  const invAlpha = 1 - alpha;
  
  return {
    r: overlay.r * alpha + base.r * invAlpha,
    g: overlay.g * alpha + base.g * invAlpha,
    b: overlay.b * alpha + base.b * invAlpha,
    a: 255
  };
}

/**
 * Multiply blend mode
 */
export function blendMultiply(base: RGBA, overlay: RGBA): RGBA {
  const alpha = overlay.a / 255;
  
  return {
    r: (base.r * overlay.r / 255) * alpha + base.r * (1 - alpha),
    g: (base.g * overlay.g / 255) * alpha + base.g * (1 - alpha),
    b: (base.b * overlay.b / 255) * alpha + base.b * (1 - alpha),
    a: 255
  };
}

/**
 * Screen blend mode
 */
export function blendScreen(base: RGBA, overlay: RGBA): RGBA {
  const alpha = overlay.a / 255;
  
  return {
    r: (255 - (255 - base.r) * (255 - overlay.r) / 255) * alpha + base.r * (1 - alpha),
    g: (255 - (255 - base.g) * (255 - overlay.g) / 255) * alpha + base.g * (1 - alpha),
    b: (255 - (255 - base.b) * (255 - overlay.b) / 255) * alpha + base.b * (1 - alpha),
    a: 255
  };
}

/**
 * Mix two colors by ratio
 */
export function mixColors(color1: RGBA, color2: RGBA, ratio: number = 0.5): RGBA {
  const invRatio = 1 - ratio;
  
  return {
    r: color1.r * invRatio + color2.r * ratio,
    g: color1.g * invRatio + color2.g * ratio,
    b: color1.b * invRatio + color2.b * ratio,
    a: color1.a * invRatio + color2.a * ratio
  };
}

/**
 * Apply opacity to color
 */
export function applyOpacity(color: RGBA, opacity: number): RGBA {
  return {
    ...color,
    a: Math.round(color.a * Math.max(0, Math.min(1, opacity)))
  };
}

/**
 * Calculate color for antialiased pixel
 */
export function getAntialiasedColor(
  color: RGBA,
  coverage: number,
  backgroundColor: RGBA = { r: 255, g: 255, b: 255, a: 255 }
): RGBA {
  const alpha = coverage * (color.a / 255);
  const invAlpha = 1 - alpha;
  
  return {
    r: color.r * alpha + backgroundColor.r * invAlpha,
    g: color.g * alpha + backgroundColor.g * invAlpha,
    b: color.b * alpha + backgroundColor.b * invAlpha,
    a: 255
  };
}

/**
 * Premultiply alpha for GPU operations
 */
export function premultiplyAlpha(color: RGBA): RGBA {
  const alpha = color.a / 255;
  
  return {
    r: color.r * alpha,
    g: color.g * alpha,
    b: color.b * alpha,
    a: color.a
  };
}

/**
 * Unpremultiply alpha after GPU operations
 */
export function unpremultiplyAlpha(color: RGBA): RGBA {
  if (color.a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  
  const alpha = color.a / 255;
  
  return {
    r: color.r / alpha,
    g: color.g / alpha,
    b: color.b / alpha,
    a: color.a
  };
}