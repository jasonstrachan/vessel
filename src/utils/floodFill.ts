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

export interface FloodFillMaskResult {
  data: Uint8Array;
  width: number;
  height: number;
  bounds: { x: number; y: number; width: number; height: number };
}

export function createFloodFillMask(
  imageData: ImageData,
  startX: number,
  startY: number,
  options: FloodFillOptions
): FloodFillMaskResult | null {
  const { threshold, contiguous } = options;
  const { width, height, data } = imageData;
  const originX = Math.floor(startX);
  const originY = Math.floor(startY);
  if (originX < 0 || originY < 0 || originX >= width || originY >= height) {
    return null;
  }

  const startPos = (originY * width + originX) * 4;
  const startR = data[startPos];
  const startG = data[startPos + 1];
  const startB = data[startPos + 2];
  const startA = data[startPos + 3];
  const thresholdSq = threshold * threshold;
  const selected = new Uint8Array(width * height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  const matchesStartColor = (pixelIndex: number): boolean => {
    if (selected[pixelIndex] !== 0) {
      return false;
    }
    const pixelPos = pixelIndex * 4;
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
    return deltaR * deltaR + deltaG * deltaG + deltaB * deltaB + deltaA * deltaA <= thresholdSq;
  };

  const selectPixel = (x: number, y: number): void => {
    selected[y * width + x] = 255;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  if (contiguous) {
    const stack: number[] = [originY * width + originX];
    while (stack.length > 0) {
      const seedIndex = stack.pop()!;
      const x = seedIndex % width;
      let y = Math.floor(seedIndex / width);
      let pixelIndex = y * width + x;
      while (y >= 0 && matchesStartColor(pixelIndex)) {
        y -= 1;
        pixelIndex -= width;
      }
      y += 1;
      pixelIndex += width;
      let reachLeft = false;
      let reachRight = false;
      while (y < height && matchesStartColor(pixelIndex)) {
        selectPixel(x, y);
        if (x > 0) {
          if (matchesStartColor(pixelIndex - 1)) {
            if (!reachLeft) stack.push(pixelIndex - 1);
            reachLeft = true;
          } else {
            reachLeft = false;
          }
        }
        if (x + 1 < width) {
          if (matchesStartColor(pixelIndex + 1)) {
            if (!reachRight) stack.push(pixelIndex + 1);
            reachRight = true;
          } else {
            reachRight = false;
          }
        }
        y += 1;
        pixelIndex += width;
      }
    }
  } else {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (matchesStartColor(y * width + x)) {
          selectPixel(x, y);
        }
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  const resultWidth = maxX - minX + 1;
  const resultHeight = maxY - minY + 1;
  const result = new Uint8Array(resultWidth * resultHeight);
  for (let row = 0; row < resultHeight; row += 1) {
    const sourceStart = (minY + row) * width + minX;
    result.set(selected.subarray(sourceStart, sourceStart + resultWidth), row * resultWidth);
  }

  return {
    data: result,
    width: resultWidth,
    height: resultHeight,
    bounds: { x: minX, y: minY, width: resultWidth, height: resultHeight },
  };
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
  const visited = contiguous ? new Uint8Array(width * height) : null;
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
    if (visited?.[pixelPos / 4] === 1) return false;
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
    if (visited) visited[pixelPos / 4] = 1;
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
      const x = stackX;
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
