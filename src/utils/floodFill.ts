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

export interface FloodFillResult {
  imageData: ImageData;
  bounds: { x: number; y: number; width: number; height: number } | null;
}

export function floodFill(
  imageData: ImageData,
  startX: number,
  startY: number,
  fillColor: FloodFillColor,
  options: FloodFillOptions
): FloodFillResult {
  const { threshold, contiguous } = options;
  const { width, height, data } = imageData;

  const startPos = (startY * width + startX) * 4;

  const startR = data[startPos];
  const startG = data[startPos + 1];
  const startB = data[startPos + 2];
  const startA = data[startPos + 3];

  if (
    fillColor.r === startR &&
    fillColor.g === startG &&
    fillColor.b === startB &&
    fillColor.a === startA
  ) {
    return { imageData, bounds: null };
  }

  const thresholdSq = threshold * threshold;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  const applyBounds = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  const matchStartColor = (pixelPos: number): boolean => {
    const r = data[pixelPos];
    const g = data[pixelPos + 1];
    const b = data[pixelPos + 2];
    const a = data[pixelPos + 3];

    if (threshold === 0) {
      return r === startR && g === startG && b === startB && a === startA;
    }

    const deltaR = r - startR;
    const deltaG = g - startG;
    const deltaB = b - startB;
    const deltaA = a - startA;
    const distanceSq = deltaR * deltaR + deltaG * deltaG + deltaB * deltaB + deltaA * deltaA;
    return distanceSq <= thresholdSq;
  };

  const colorPixel = (pixelPos: number, x: number, y: number): void => {
    data[pixelPos] = fillColor.r;
    data[pixelPos + 1] = fillColor.g;
    data[pixelPos + 2] = fillColor.b;
    data[pixelPos + 3] = fillColor.a;
    applyBounds(x, y);
  };

  if (contiguous) {
    const pixelStack: [number, number][] = [[startX, startY]];

    while (pixelStack.length > 0) {
      const [stackX, stackY] = pixelStack.pop()!;
      let x = stackX;
      let y = stackY;
      let pixelPos = (y * width + x) * 4;

      while (y >= 0 && matchStartColor(pixelPos)) {
        y -= 1;
        pixelPos -= width * 4;
      }

      pixelPos += width * 4;
      y += 1;
      let reachLeft = false;
      let reachRight = false;

      while (y < height && matchStartColor(pixelPos)) {
        colorPixel(pixelPos, x, y);

        if (x > 0) {
          if (matchStartColor(pixelPos - 4)) {
            if (!reachLeft) {
              pixelStack.push([x - 1, y]);
              reachLeft = true;
            }
          } else if (reachLeft) {
            reachLeft = false;
          }
        }

        if (x < width - 1) {
          if (matchStartColor(pixelPos + 4)) {
            if (!reachRight) {
              pixelStack.push([x + 1, y]);
              reachRight = true;
            }
          } else if (reachRight) {
            reachRight = false;
          }
        }

        y += 1;
        pixelPos += width * 4;
      }
    }
  } else {
    let x = 0;
    let y = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (matchStartColor(i)) {
        colorPixel(i, x, y);
      }
      x += 1;
      if (x === width) {
        x = 0;
        y += 1;
      }
    }
  }

  const bounds =
    maxX >= minX && maxY >= minY
      ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
      : null;

  return { imageData, bounds };
}
