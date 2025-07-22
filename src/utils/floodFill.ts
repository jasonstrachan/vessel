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
    // Contiguous fill - use optimized iterative scanline flood fill algorithm
    const pixelStack: [number, number][] = [[startX, startY]];
    let newPos: [number, number];
    let x: number, y: number, pixelPos: number;
    let reachLeft: boolean, reachRight: boolean;
    
    while (pixelStack.length > 0) {
      newPos = pixelStack.pop()!;
      x = newPos[0];
      y = newPos[1];

      // Get current pixel position
      pixelPos = (y * width + x) * 4;
      
      // Go up as long as the color matches and we're inside the canvas
      while (y >= 0 && matchStartColor(pixelPos)) {
        y--;
        pixelPos -= width * 4;
      }
      
      // Don't overextend
      pixelPos += width * 4;
      y++;
      reachLeft = false;
      reachRight = false;
      
      // Go down as long as the color matches and we're inside the canvas
      while (y < height && matchStartColor(pixelPos)) {
        colorPixel(pixelPos);

        // Check left pixel
        if (x > 0) {
          if (matchStartColor(pixelPos - 4)) {
            if (!reachLeft) {
              // Add pixel to stack
              pixelStack.push([x - 1, y]);
              reachLeft = true;
            }
          } else if (reachLeft) {
            reachLeft = false;
          }
        }

        // Check right pixel
        if (x < width - 1) {
          if (matchStartColor(pixelPos + 4)) {
            if (!reachRight) {
              // Add pixel to stack
              pixelStack.push([x + 1, y]);
              reachRight = true;
            }
          } else if (reachRight) {
            reachRight = false;
          }
        }
        
        y++;
        pixelPos += width * 4;
      }
    }
  } else {
    // Non-contiguous fill - fill all matching pixels
    for (let i = 0; i < data.length; i += 4) {
      if (matchStartColor(i)) {
        colorPixel(i);
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
      // Use Euclidean distance for better color matching
      const deltaR = r - startR;
      const deltaG = g - startG;
      const deltaB = b - startB;
      const distance = Math.sqrt(deltaR * deltaR + deltaG * deltaG + deltaB * deltaB);
      return distance <= threshold;
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