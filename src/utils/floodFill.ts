// Flood fill implementation adapted from reference code
// Implements scanline flood fill algorithm with threshold support

export interface FloodFillOptions {
  threshold: number;
  contiguous: boolean;
}

export interface FloodFillColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function floodFill(
  imageData: ImageData,
  startX: number,
  startY: number,
  fillColor: FloodFillColor,
  options: FloodFillOptions
): ImageData {
  const { threshold, contiguous } = options;
  const { width, height, data } = imageData;
  
  // Create a copy of the image data to modify
  const colorLayer = new ImageData(
    new Uint8ClampedArray(data),
    width,
    height
  );

  const startPos = (startY * width + startX) * 4;

  // Get the color at the clicked position
  const startR = colorLayer.data[startPos];
  const startG = colorLayer.data[startPos + 1];
  const startB = colorLayer.data[startPos + 2];

  // Exit if the color is the same as fill color
  if (
    fillColor.r === startR &&
    fillColor.g === startG &&
    fillColor.b === startB
  ) {
    return colorLayer;
  }

  if (contiguous) {
    // Contiguous fill - use simple 4-connected flood fill
    const pixelStack: [number, number][] = [[startX, startY]];
    const visited = new Set<string>();
    let processedPixels = 0;
    const maxPixels = width * height * 0.5; // Limit to 50% of canvas to prevent crashes

    while (pixelStack.length > 0 && processedPixels < maxPixels) {
      const [x, y] = pixelStack.pop()!;
      
      // Check bounds
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      
      // Check if already visited
      const key = `${x},${y}`;
      if (visited.has(key)) continue;
      visited.add(key);
      
      const pixelPos = (y * width + x) * 4;
      
      // Check if pixel matches
      if (!matchStartColor(pixelPos)) continue;
      
      // Color the pixel
      colorPixel(pixelPos);
      processedPixels++;
      
      // Add neighboring pixels (4-connected)
      pixelStack.push([x + 1, y]); // right
      pixelStack.push([x - 1, y]); // left  
      pixelStack.push([x, y + 1]); // down
      pixelStack.push([x, y - 1]); // up
    }
  } else {
    // Non-contiguous fill - fill all matching pixels
    let processedPixels = 0;
    const maxPixels = width * height * 0.5; // Limit to 50% of canvas to prevent crashes
    
    for (let i = 0; i < data.length && processedPixels < maxPixels; i += 4) {
      if (matchStartColor(i)) {
        colorPixel(i);
        processedPixels++;
      }
    }
  }

  // Helper function to check if pixel color matches start color within threshold
  function matchStartColor(pixelPos: number): boolean {
    const r = colorLayer.data[pixelPos];
    const g = colorLayer.data[pixelPos + 1];
    const b = colorLayer.data[pixelPos + 2];
    
    if (threshold === 0) {
      // Exact match
      return r === startR && g === startG && b === startB;
    } else {
      // Threshold-based match
      const deltaR = Math.abs(r - startR);
      const deltaG = Math.abs(g - startG);
      const deltaB = Math.abs(b - startB);
      return deltaR <= threshold && deltaG <= threshold && deltaB <= threshold;
    }
  }

  // Helper function to color a pixel
  function colorPixel(pixelPos: number): void {
    colorLayer.data[pixelPos] = fillColor.r;
    colorLayer.data[pixelPos + 1] = fillColor.g;
    colorLayer.data[pixelPos + 2] = fillColor.b;
    colorLayer.data[pixelPos + 3] = fillColor.a;
  }

  return colorLayer;
}