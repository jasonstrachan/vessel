export interface FloodSelectOptions {
  threshold: number;
  contiguous: boolean;
}

export interface FloodSelectResult {
  mask: ImageData;
  bounds: { x: number; y: number; width: number; height: number };
}

export function floodSelect(
  imageData: ImageData,
  startX: number,
  startY: number,
  options: FloodSelectOptions
): FloodSelectResult | null {
  const { width, height, data } = imageData;
  if (width <= 0 || height <= 0) {
    return null;
  }

  if (startX < 0 || startY < 0 || startX >= width || startY >= height) {
    return null;
  }

  const threshold = Math.max(0, Math.min(255, Math.round(options.threshold)));
  const selected = new Uint8Array(width * height);

  const startPos = (startY * width + startX) * 4;
  const startR = data[startPos];
  const startG = data[startPos + 1];
  const startB = data[startPos + 2];
  const startA = data[startPos + 3];

  const matchesSeedColor = (pixelPos: number): boolean => {
    const r = data[pixelPos];
    const g = data[pixelPos + 1];
    const b = data[pixelPos + 2];
    const a = data[pixelPos + 3];

    if (threshold === 0) {
      return r === startR && g === startG && b === startB && a === startA;
    }

    const deltaR = Math.abs(r - startR);
    const deltaG = Math.abs(g - startG);
    const deltaB = Math.abs(b - startB);
    const deltaA = Math.abs(a - startA);

    // Magic wand semantics: each channel must stay within threshold.
    // This avoids selecting across very different hues with similar luminance.
    return deltaR <= threshold && deltaG <= threshold && deltaB <= threshold && deltaA <= threshold;
  };

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  const markSelected = (x: number, y: number) => {
    const idx = y * width + x;
    if (selected[idx] === 1) {
      return;
    }
    selected[idx] = 1;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  if (options.contiguous) {
    const stack: Array<[number, number]> = [[startX, startY]];

    while (stack.length > 0) {
      const [stackX, stackY] = stack.pop()!;
      const x = stackX;
      let y = stackY;
      let pixelPos = (y * width + x) * 4;

      while (y >= 0 && matchesSeedColor(pixelPos) && selected[y * width + x] === 0) {
        y -= 1;
        pixelPos -= width * 4;
      }

      pixelPos += width * 4;
      y += 1;
      let reachLeft = false;
      let reachRight = false;

      while (y < height && matchesSeedColor(pixelPos) && selected[y * width + x] === 0) {
        markSelected(x, y);

        if (x > 0) {
          const leftPos = pixelPos - 4;
          const leftSelected = selected[y * width + (x - 1)] === 1;
          if (!leftSelected && matchesSeedColor(leftPos)) {
            if (!reachLeft) {
              stack.push([x - 1, y]);
              reachLeft = true;
            }
          } else if (reachLeft) {
            reachLeft = false;
          }
        }

        if (x < width - 1) {
          const rightPos = pixelPos + 4;
          const rightSelected = selected[y * width + (x + 1)] === 1;
          if (!rightSelected && matchesSeedColor(rightPos)) {
            if (!reachRight) {
              stack.push([x + 1, y]);
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
    for (let pixelPos = 0; pixelPos < data.length; pixelPos += 4) {
      if (matchesSeedColor(pixelPos)) {
        markSelected(x, y);
      }
      x += 1;
      if (x === width) {
        x = 0;
        y += 1;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  const bounds = {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };

  const mask = new ImageData(bounds.width, bounds.height);
  for (let y = bounds.y; y <= maxY; y += 1) {
    const destY = y - bounds.y;
    for (let x = bounds.x; x <= maxX; x += 1) {
      if (selected[y * width + x] === 0) {
        continue;
      }
      const destIdx = (destY * bounds.width + (x - bounds.x)) * 4;
      mask.data[destIdx] = 255;
      mask.data[destIdx + 1] = 255;
      mask.data[destIdx + 2] = 255;
      mask.data[destIdx + 3] = 255;
    }
  }

  return { mask, bounds };
}
