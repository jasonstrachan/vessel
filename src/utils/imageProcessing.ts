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
export function adjustHueAndSaturation(
  imageData: ImageData,
  hueShift: number,
  saturationPercent: number
): ImageData {
  // Use a temporary canvas from the pool for processing
  const tempCanvas = canvasPool.acquire(imageData.width, imageData.height);
  const ctx = tempCanvas.getContext('2d');

  if (!ctx) {
    canvasPool.release(tempCanvas);
    return imageData; // Return original on failure
  }

  // Draw the original image
  ctx.putImageData(imageData, 0, 0);

  // Apply saturation first
  if (saturationPercent !== 100) {
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = `hsl(0, ${saturationPercent}%, 50%)`; // Only saturation component matters
    ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
  }

  // Apply hue shift
  if (hueShift !== 0) {
    ctx.globalCompositeOperation = 'hue';
    ctx.fillStyle = `hsl(${hueShift}, 100%, 50%)`; // Only hue component matters
    ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
  }

  // Reset composite operation
  ctx.globalCompositeOperation = 'source-over';

  // Get the modified image data
  const resultImageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);

  // Release the canvas back to the pool
  canvasPool.release(tempCanvas);

  return resultImageData;
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