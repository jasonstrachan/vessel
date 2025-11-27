// Image processing utilities for brush tip editing
import { canvasPool } from './canvasPool';

// Convert RGB to HSL
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return [h * 360, s * 100, l * 100];
}

// Convert HSL to RGB
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360;
  s /= 100;
  l /= 100;

  if (s === 0) {
    const gray = Math.round(l * 255);
    return [gray, gray, gray];
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hue2rgb(p, q, h + 1/3);
  const g = hue2rgb(p, q, h);
  const b = hue2rgb(p, q, h - 1/3);

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// Shift the hue of all pixels in ImageData
export function shiftHue(imageData: ImageData, hueShift: number): ImageData {
  const data = new Uint8ClampedArray(imageData.data);
  
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    
    // Skip transparent pixels
    if (a === 0) continue;
    
    // Convert to HSL
    const [h, s, l] = rgbToHsl(r, g, b);
    
    // Shift hue (wrap around 360 degrees)
    let newHue = h + hueShift;
    if (newHue < 0) newHue += 360;
    if (newHue >= 360) newHue -= 360;
    
    // Convert back to RGB
    const [newR, newG, newB] = hslToRgb(newHue, s, l);
    
    // Update the pixel data
    data[i] = newR;
    data[i + 1] = newG;
    data[i + 2] = newB;
    // Keep original alpha
  }
  
  return new ImageData(data, imageData.width, imageData.height);
}

// Adjust the saturation of all pixels in ImageData
export function adjustSaturation(imageData: ImageData, saturationPercent: number): ImageData {
  const data = new Uint8ClampedArray(imageData.data);
  const saturationFactor = saturationPercent / 100;
  
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    
    // Skip transparent pixels
    if (a === 0) continue;
    
    // Convert to HSL
    const [h, s, l] = rgbToHsl(r, g, b);
    
    // Adjust saturation
    const newSaturation = Math.max(0, Math.min(100, s * saturationFactor));
    
    // Convert back to RGB
    const [newR, newG, newB] = hslToRgb(h, newSaturation, l);
    
    // Update the pixel data
    data[i] = newR;
    data[i + 1] = newG;
    data[i + 2] = newB;
    // Keep original alpha
  }
  
  return new ImageData(data, imageData.width, imageData.height);
}

// Apply both hue shift and saturation adjustment using GPU acceleration
export function adjustHueLightness(
  imageData: ImageData,
  hueShift: number,          // in degrees (-180 to 180)
  lightnessAdjust: number    // in percentage (-100 to 100)
): ImageData {
  const result = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height
  );
  
  const data = result.data;
  
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    
    // Skip transparent pixels
    if (a === 0) continue;
    
    // Convert to HSL
    const [hOriginal, s, lOriginal] = rgbToHsl(r, g, b);
    let h = hOriginal;
    let l = lOriginal;
    
    // Apply hue shift
    h = (h + hueShift + 360) % 360;
    
    // Apply lightness adjustment
    // Lightness is 0-100, adjustment is -100 to 100
    l = Math.max(0, Math.min(100, l + lightnessAdjust));
    
    // Convert back to RGB
    const [newR, newG, newB] = hslToRgb(h, s, l);
    
    data[i] = newR;
    data[i + 1] = newG;
    data[i + 2] = newB;
    // Keep alpha unchanged
  }
  
  return result;
}

// Apply hue, lightness, and saturation adjustments
export function adjustHueLightnessSaturation(
  imageData: ImageData,
  hueShift: number,          // in degrees (-180 to 180)
  lightnessAdjust: number,   // in percentage (-100 to 100)
  saturationPercent: number  // 0 to 200 (100 is normal)
): ImageData {
  const result = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height
  );
  
  const data = result.data;
  const saturationFactor = saturationPercent / 100;
  
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    
    // Skip transparent pixels
    if (a === 0) continue;
    
    // Convert to HSL
    const [hOriginal, sOriginal, lOriginal] = rgbToHsl(r, g, b);
    let h = hOriginal;
    let s = sOriginal;
    let l = lOriginal;
    
    // Apply hue shift
    h = (h + hueShift + 360) % 360;
    
    // Apply lightness adjustment
    l = Math.max(0, Math.min(100, l + lightnessAdjust));
    
    // Apply saturation adjustment
    s = Math.max(0, Math.min(100, s * saturationFactor));
    
    // Convert back to RGB
    const [newR, newG, newB] = hslToRgb(h, s, l);
    
    data[i] = newR;
    data[i + 1] = newG;
    data[i + 2] = newB;
    // Keep alpha unchanged
  }
  
  return result;
}

export function adjustHueAndSaturation(
  imageData: ImageData,
  hueShift: number,          // in degrees
  saturationPercent: number  // as a percentage (e.g., 100 is normal, 50 is half, 200 is double)
): ImageData {
  // Acquire two temporary canvases for processing to avoid conflicts
  const sourceCanvas = canvasPool.acquire(imageData.width, imageData.height);
  const destCanvas = canvasPool.acquire(imageData.width, imageData.height);

  const contextOptions: CanvasRenderingContext2DSettings = {
    colorSpace: 'srgb', // Enforce consistent color space
    alpha: true
  };

  const sourceCtx = sourceCanvas.getContext('2d', contextOptions);
  const destCtx = destCanvas.getContext('2d', contextOptions);

  // Ensure we got the contexts before proceeding
  if (!sourceCtx || !destCtx) {
    canvasPool.release(sourceCanvas);
    canvasPool.release(destCanvas);
    console.error("Failed to get 2D context for processing hue and saturation.");
    return imageData; // Return original on failure
  }

  try {
    // 1. Put the original image data onto the source canvas
    sourceCtx.putImageData(imageData, 0, 0);

    // 2. Build the filter string for the destination context
    const filters: string[] = [];
    if (hueShift !== 0) {
      // The hue-rotate filter takes an angle in degrees
      filters.push(`hue-rotate(${hueShift}deg)`);
    }
    if (saturationPercent !== 100) {
      // The saturate filter takes a percentage (100% is unchanged)
      filters.push(`saturate(${saturationPercent}%)`);
    }

    // 3. Apply the combined filter if any adjustments are needed
    if (filters.length > 0) {
      destCtx.filter = filters.join(' ');
    }

    // 4. Draw the source canvas to the destination canvas.
    // This is the step where the GPU applies the filter. It correctly handles alpha.
    destCtx.drawImage(sourceCanvas, 0, 0);

    // 5. Get the resulting image data from the destination canvas
    const resultImageData = destCtx.getImageData(0, 0, destCanvas.width, destCanvas.height);

    return resultImageData;

  } finally {
    // 6. Always release the canvases back to the pool
    canvasPool.release(sourceCanvas);
    canvasPool.release(destCanvas);
  }
}


// Apply brightness adjustment to ImageData
export function adjustBrightness(imageData: ImageData, brightness: number): ImageData {
  const data = new Uint8ClampedArray(imageData.data);
  
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    
    // Skip transparent pixels
    if (a === 0) continue;
    
    // Apply brightness adjustment
    data[i] = Math.max(0, Math.min(255, data[i] + brightness));     // R
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + brightness)); // G
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + brightness)); // B
  }
  
  return new ImageData(data, imageData.width, imageData.height);
}

// Apply contrast adjustment to ImageData
export function adjustContrast(imageData: ImageData, contrast: number): ImageData {
  const data = new Uint8ClampedArray(imageData.data);
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    
    // Skip transparent pixels
    if (a === 0) continue;
    
    // Apply contrast adjustment
    data[i] = Math.max(0, Math.min(255, factor * (data[i] - 128) + 128));     // R
    data[i + 1] = Math.max(0, Math.min(255, factor * (data[i + 1] - 128) + 128)); // G
    data[i + 2] = Math.max(0, Math.min(255, factor * (data[i + 2] - 128) + 128)); // B
  }

  return new ImageData(data, imageData.width, imageData.height);
}

const clampByte = (value: number): number => {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return value;
};

const channelPercentToOffset = (percent: number): number => {
  if (!Number.isFinite(percent)) {
    return 0;
  }
  return Math.max(-255, Math.min(255, Math.round(percent * 2.55)));
};

export interface RgbChannelOffsets {
  red: number;
  green: number;
  blue: number;
}

export function adjustRgbChannelOffsets(
  imageData: ImageData,
  offsets: RgbChannelOffsets
): ImageData {
  const rOffset = channelPercentToOffset(offsets.red);
  const gOffset = channelPercentToOffset(offsets.green);
  const bOffset = channelPercentToOffset(offsets.blue);

  if (rOffset === 0 && gOffset === 0 && bOffset === 0) {
    return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  }

  const data = new Uint8ClampedArray(imageData.data);

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 0) {
      continue;
    }

    data[i] = clampByte(data[i] + rOffset);
    data[i + 1] = clampByte(data[i + 1] + gOffset);
    data[i + 2] = clampByte(data[i + 2] + bOffset);
  }

  return new ImageData(data, imageData.width, imageData.height);
}

export interface ColorAdjustOptions {
  hue: number;
  saturation: number;
  lightness: number;
  contrast: number;
  red: number;
  green: number;
  blue: number;
  toneCurvePoints?: Array<{ x: number; y: number }>;
}

export const buildToneCurveLut = (points?: Array<{ x: number; y: number }>): Uint8ClampedArray | null => {
  if (!points || points.length === 0) {
    return null; // identity
  }

  const cleaned = points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) }))
    .sort((a, b) => a.x - b.x);

  const startCandidate = cleaned.find((p) => p.x <= 0.0001);
  const endCandidate = [...cleaned].reverse().find((p) => p.x >= 0.9999);

  const startPoint = startCandidate ? { x: 0, y: startCandidate.y } : { x: 0, y: 0 };
  const endPoint = endCandidate ? { x: 1, y: endCandidate.y } : { x: 1, y: 1 };

  const middle = cleaned.filter((p) => p.x > 0.0001 && p.x < 0.9999);
  const sorted = [startPoint, ...middle, endPoint];

  const lut = new Uint8ClampedArray(256);

  let segIndex = 0;
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    while (segIndex < sorted.length - 2 && t > sorted[segIndex + 1].x) {
      segIndex++;
    }

    const a = sorted[segIndex];
    const b = sorted[segIndex + 1];
    const span = Math.max(1e-6, b.x - a.x);
    const localT = (t - a.x) / span;
    const y = a.y + (b.y - a.y) * localT;
    lut[i] = Math.min(255, Math.max(0, Math.round(y * 255)));
  }

  return lut;
};

export function applyColorAdjustments(imageData: ImageData, options: ColorAdjustOptions): ImageData {
  const { hue, saturation, lightness, contrast, red, green, blue, toneCurvePoints } = options;
  const hasHueSatLightness = hue !== 0 || saturation !== 0 || lightness !== 0;
  const hasContrast = contrast !== 0;
  const hasChannelOffsets = red !== 0 || green !== 0 || blue !== 0;
  const toneCurveLut = buildToneCurveLut(toneCurvePoints);
  const hasToneCurve = toneCurveLut !== null;

  if (!hasHueSatLightness && !hasContrast && !hasChannelOffsets && !hasToneCurve) {
    return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  }

  let working = imageData;

  if (hasHueSatLightness) {
    const saturationPercent = Math.max(0, Math.min(200, 100 + saturation));
    const lightnessAdjust = Math.max(-100, Math.min(100, lightness));
    const hueShift = Math.max(-180, Math.min(180, hue));
    working = adjustHueLightnessSaturation(working, hueShift, lightnessAdjust, saturationPercent);
  } else {
    working = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  }

  if (hasContrast) {
    const contrastValue = Math.max(-255, Math.min(255, Math.round(contrast * 2.55)));
    if (contrastValue !== 0) {
      working = adjustContrast(working, contrastValue);
    }
  }

  if (hasChannelOffsets) {
    working = adjustRgbChannelOffsets(working, { red, green, blue });
  }

  if (hasToneCurve && toneCurveLut) {
    const data = new Uint8ClampedArray(working.data);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = toneCurveLut[data[i]];
      data[i + 1] = toneCurveLut[data[i + 1]];
      data[i + 2] = toneCurveLut[data[i + 2]];
    }
    working = new ImageData(data, working.width, working.height);
  }

  return working;
}

// Replace a color in ImageData with another color
export function replaceColor(
  imageData: ImageData, 
  targetColor: { r: number; g: number; b: number }, 
  replacementColor: { r: number; g: number; b: number },
  tolerance: number = 0
): ImageData {
  const data = new Uint8ClampedArray(imageData.data);
  
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    
    // Skip transparent pixels
    if (a === 0) continue;
    
    // Calculate color distance
    const distance = Math.sqrt(
      Math.pow(r - targetColor.r, 2) +
      Math.pow(g - targetColor.g, 2) +
      Math.pow(b - targetColor.b, 2)
    );
    
    // Replace if within tolerance
    if (distance <= tolerance) {
      data[i] = replacementColor.r;
      data[i + 1] = replacementColor.g;
      data[i + 2] = replacementColor.b;
    }
  }
  
  return new ImageData(data, imageData.width, imageData.height);
}
