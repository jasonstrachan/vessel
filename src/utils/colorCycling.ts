// Color cycling utilities for palette animation effects (Optimized Version)
// Implements color cycling (palette swapping) technique for animated effects

import type { Layer } from '../types';

// --- Helper Functions (optimized) ---

export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).padStart(6, '0');
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

/**
 * Finds the closest color index from a pre-calculated RGB array.
 * This is much faster as it avoids repeated hex-to-rgb conversions.
 */
function findClosestColorIndex(
    r: number, g: number, b: number, 
    selectedColorsRGB: { r: number; g: number; b: number }[], 
    threshold: number = 30
): number | null {
    if (selectedColorsRGB.length === 0) return null;

    let closestIndex: number | null = null;
    let closestDistanceSq = threshold * threshold; // Use squared distance to avoid sqrt

    for (let i = 0; i < selectedColorsRGB.length; i++) {
        const candidate = selectedColorsRGB[i];
        const distanceSq = Math.pow(r - candidate.r, 2) + Math.pow(g - candidate.g, 2) + Math.pow(b - candidate.b, 2);

        if (distanceSq < closestDistanceSq) {
            closestDistanceSq = distanceSq;
            closestIndex = i;
        }
    }
    return closestIndex;
}

// --- CORE OPTIMIZATION FUNCTIONS ---

/**
 * [NEW] Builds a lookup map for a single layer.
 * This is the expensive, one-time operation.
 * It maps each color in the layer to an index in the selectedColors array.
 * @returns A Map<string, number> where key is original hex color and value is the index.
 */
export function buildLayerColorIndexMap(
    layer: Layer, 
    selectedColors: string[], 
    selectedColorsRGB: { r: number; g: number; b: number }[]
): Map<string, number> {
    const indexMap = new Map<string, number>();
    if (!layer.imageData || selectedColors.length === 0) {
        return indexMap;
    }

    const data = layer.imageData.data;
    const colorCache = new Map<string, number | null>(); // Memoize findClosestColorIndex results

    for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a < 10) continue; // Skip transparent pixels

        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        const currentColorHex = rgbToHex(r, g, b);

        if (colorCache.has(currentColorHex)) {
            const cachedIndex = colorCache.get(currentColorHex);
            if (cachedIndex !== null && cachedIndex !== undefined && !indexMap.has(currentColorHex)) {
                indexMap.set(currentColorHex, cachedIndex);
            }
        } else {
            const closestIndex = findClosestColorIndex(r, g, b, selectedColorsRGB);
            colorCache.set(currentColorHex, closestIndex);
            if (closestIndex !== null) {
                indexMap.set(currentColorHex, closestIndex);
            }
        }
    }
    console.log(`Built index map for layer "${layer.name}". Found ${indexMap.size} mappable colors.`);
    return indexMap;
}

/**
 * [NEW & FAST] Applies color cycling using the pre-computed index map.
 * This function is designed to be called in the animation loop (requestAnimationFrame).
 */
export function applyCycleToLayer_Optimized(
    layer: Layer,
    layerIndexMap: Map<string, number>,
    shiftedColorsRGB: { r: number; g: number; b: number }[]
): ImageData | null {
    if (!layer.imageData || layerIndexMap.size === 0 || shiftedColorsRGB.length === 0) {
        return layer.imageData;
    }
    
    // Create a copy to avoid modifying the original layer data
    const cycledImageData = new ImageData(
        new Uint8ClampedArray(layer.imageData.data),
        layer.imageData.width,
        layer.imageData.height
    );
    const data = cycledImageData.data;

    for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a < 10) continue;

        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        const currentColorHex = rgbToHex(r, g, b);
        const colorIndex = layerIndexMap.get(currentColorHex);
        
        if (colorIndex !== undefined) {
            const newColor = shiftedColorsRGB[colorIndex];
            if (newColor) {
                data[i] = newColor.r;
                data[i + 1] = newColor.g;
                data[i + 2] = newColor.b;
                // Alpha (data[i + 3]) is preserved
            }
        }
    }

    return cycledImageData;
}

/**
 * [NEW] Builds the color map for the current frame of the animation.
 * This is very fast.
 * @returns An array of RGB color objects in their new, shifted positions.
 */
export function buildShiftedColors(
    selectedColorsRGB: { r: number; g: number; b: number }[], 
    cycleIndex: number
): { r: number; g: number; b: number }[] {
    if (selectedColorsRGB.length === 0) return [];
    
    const cyclePos = cycleIndex % selectedColorsRGB.length;
    // Slice and concatenate to create the shifted array
    return selectedColorsRGB.slice(cyclePos).concat(selectedColorsRGB.slice(0, cyclePos));
}

/**
 * [NEW] Main function to call from your animation loop.
 */
export function applyCycleToLayers_Optimized(
    layers: Layer[],
    selectedLayerIds: string[],
    layerColorIndexMaps: Map<string, Map<string, number>>, // The pre-computed maps from the store
    shiftedColorsRGB: { r: number; g: number; b: number }[]
): Map<string, ImageData | null> {
    const cycledLayers = new Map<string, ImageData | null>();

    for (const layer of layers) {
        if (selectedLayerIds.includes(layer.id)) {
            const layerIndexMap = layerColorIndexMaps.get(layer.id);
            if (layerIndexMap) {
                const cycledData = applyCycleToLayer_Optimized(layer, layerIndexMap, shiftedColorsRGB);
                cycledLayers.set(layer.id, cycledData);
            } else {
                // If no map exists for this layer, return its original data
                cycledLayers.set(layer.id, layer.imageData);
            }
        }
    }
    return cycledLayers;
}

// --- DEPRECATED FUNCTIONS (kept for compatibility) ---

/**
 * @deprecated Use buildShiftedColors instead for better performance
 * Build a color mapping for the current cycle position
 */
export function buildColorMapping(selectedColors: string[], cycleIndex: number): Map<string, string> {
  const colorMap = new Map<string, string>();
  
  if (selectedColors.length === 0) return colorMap;
  
  // Create the shifted color array
  const shiftedColors = [...selectedColors];
  for (let i = 0; i < cycleIndex; i++) {
    const first = shiftedColors.shift();
    if (first) shiftedColors.push(first);
  }
  
  // Map each original color to its shifted position
  for (let i = 0; i < selectedColors.length; i++) {
    colorMap.set(selectedColors[i], shiftedColors[i]);
  }
  
  return colorMap;
}

/**
 * @deprecated Use applyCycleToLayer_Optimized instead for better performance
 * Find the closest color in the selected colors array
 */
function findClosestColor(targetColor: string, selectedColors: string[], threshold: number = 30): string | null {
  if (selectedColors.length === 0) return null;
  
  const target = hexToRgb(targetColor);
  let closestColor = null;
  let closestDistance = Infinity;
  
  for (const color of selectedColors) {
    const candidate = hexToRgb(color);
    
    // Calculate color distance (simple Euclidean distance in RGB space)
    const distance = Math.sqrt(
      Math.pow(target.r - candidate.r, 2) +
      Math.pow(target.g - candidate.g, 2) +
      Math.pow(target.b - candidate.b, 2)
    );
    
    if (distance < closestDistance && distance <= threshold) {
      closestDistance = distance;
      closestColor = color;
    }
  }
  
  return closestColor;
}

/**
 * @deprecated Use applyCycleToLayer_Optimized instead for better performance
 * Apply color cycling to a layer's ImageData
 */
export function applyCycleToLayer(layer: Layer, colorMap: Map<string, string>, selectedColors: string[]): ImageData | null {
  if (!layer.imageData || selectedColors.length === 0) {
    return layer.imageData;
  }
  
  try {
    // Create a copy of the original image data
    const cycledImageData = new ImageData(
      new Uint8ClampedArray(layer.imageData.data),
      layer.imageData.width,
      layer.imageData.height
    );
    
    const data = cycledImageData.data;
    
    // Process each pixel
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      
      // Skip transparent pixels
      if (a < 10) continue;
      
      const currentColor = rgbToHex(r, g, b);
      
      // Check if this color should be cycled
      const closestSelectedColor = findClosestColor(currentColor, selectedColors);
      
      if (closestSelectedColor) {
        const newColor = colorMap.get(closestSelectedColor);
        if (newColor) {
          const rgb = hexToRgb(newColor);
          data[i] = rgb.r;
          data[i + 1] = rgb.g;
          data[i + 2] = rgb.b;
          // Keep original alpha
        }
      }
    }
    
    return cycledImageData;
  } catch (error) {
    console.warn('Failed to apply color cycle to layer:', error);
    return layer.imageData;
  }
}

/**
 * @deprecated Use applyCycleToLayers_Optimized instead for better performance
 * Apply color cycling to multiple layers
 */
export function applyCycleToLayers(
  layers: Layer[],
  selectedLayerIds: string[],
  selectedColors: string[],
  cycleIndex: number
): Map<string, ImageData | null> {
  const cycledLayers = new Map<string, ImageData | null>();
  
  if (selectedColors.length === 0) {
    // If no colors selected, return original data
    for (const layer of layers) {
      if (selectedLayerIds.includes(layer.id)) {
        cycledLayers.set(layer.id, layer.imageData);
      }
    }
    return cycledLayers;
  }
  
  const colorMap = buildColorMapping(selectedColors, cycleIndex);
  
  for (const layer of layers) {
    if (selectedLayerIds.includes(layer.id)) {
      const cycledData = applyCycleToLayer(layer, colorMap, selectedColors);
      cycledLayers.set(layer.id, cycledData);
    }
  }
  
  return cycledLayers;
}

/**
 * @deprecated This function may be removed in future versions
 * Create a preview canvas showing the color cycle effect
 */
export function createCyclePreview(
  sourceCanvas: HTMLCanvasElement,
  layers: Layer[],
  selectedLayerIds: string[],
  selectedColors: string[],
  cycleIndex: number
): HTMLCanvasElement | null {
  if (!sourceCanvas || selectedColors.length === 0) {
    return null;
  }
  
  try {
    // Create a temporary canvas for the preview
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = sourceCanvas.width;
    previewCanvas.height = sourceCanvas.height;
    
    const previewCtx = previewCanvas.getContext('2d');
    if (!previewCtx) return null;
    
    // Draw the original canvas first
    previewCtx.drawImage(sourceCanvas, 0, 0);
    
    // Apply color cycling to selected layers
    const cycledLayers = applyCycleToLayers(layers, selectedLayerIds, selectedColors, cycleIndex);
    
    // Composite the cycled layers on top
    for (const [layerId, cycledData] of Array.from(cycledLayers.entries())) {
      if (!cycledData) continue;
      
      const layer = layers.find(l => l.id === layerId);
      if (!layer || !layer.visible) continue;
      
      // Create a temporary canvas for this layer
      const layerCanvas = document.createElement('canvas');
      layerCanvas.width = cycledData.width;
      layerCanvas.height = cycledData.height;
      
      const layerCtx = layerCanvas.getContext('2d');
      if (!layerCtx) continue;
      
      layerCtx.putImageData(cycledData, 0, 0);
      
      // Apply layer blend mode and opacity
      previewCtx.save();
      previewCtx.globalAlpha = layer.opacity;
      previewCtx.globalCompositeOperation = layer.blendMode;
      previewCtx.drawImage(layerCanvas, 0, 0);
      previewCtx.restore();
    }
    
    return previewCanvas;
  } catch (error) {
    console.warn('Failed to create cycle preview:', error);
    return null;
  }
}

/**
 * Calculate the next cycle index
 */
export function getNextCycleIndex(currentIndex: number, totalColors: number): number {
  if (totalColors === 0) return 0;
  return (currentIndex + 1) % totalColors;
}