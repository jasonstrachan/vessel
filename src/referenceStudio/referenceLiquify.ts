export interface LiquifyPushOptions {
  centerX: number;
  centerY: number;
  deltaX: number;
  deltaY: number;
  radius: number;
  strength: number;
}

const clamp = (value: number, min: number, max: number): number => (
  Math.max(min, Math.min(max, value))
);

const sampleChannel = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  channel: number,
): number => {
  const sampleX = clamp(x, 0, width - 1);
  const sampleY = clamp(y, 0, height - 1);
  const x0 = Math.floor(sampleX);
  const y0 = Math.floor(sampleY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const weightX = sampleX - x0;
  const weightY = sampleY - y0;
  const topLeft = pixels[(y0 * width + x0) * 4 + channel] ?? 0;
  const topRight = pixels[(y0 * width + x1) * 4 + channel] ?? 0;
  const bottomLeft = pixels[(y1 * width + x0) * 4 + channel] ?? 0;
  const bottomRight = pixels[(y1 * width + x1) * 4 + channel] ?? 0;
  const top = topLeft + (topRight - topLeft) * weightX;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * weightX;
  return top + (bottom - top) * weightY;
};

export const liquifyPushPixels = (
  source: Uint8ClampedArray,
  width: number,
  height: number,
  options: LiquifyPushOptions,
): Uint8ClampedArray => {
  const radius = Math.max(1, options.radius);
  const strength = clamp(options.strength, 0, 1);
  if (
    width <= 0
    || height <= 0
    || source.length !== width * height * 4
    || strength === 0
    || (options.deltaX === 0 && options.deltaY === 0)
  ) {
    return new Uint8ClampedArray(source);
  }
  const output = new Uint8ClampedArray(source);

  const left = Math.max(0, Math.floor(options.centerX - radius));
  const top = Math.max(0, Math.floor(options.centerY - radius));
  const right = Math.min(width - 1, Math.ceil(options.centerX + radius));
  const bottom = Math.min(height - 1, Math.ceil(options.centerY + radius));
  const radiusSquared = radius * radius;

  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const offsetX = x - options.centerX;
      const offsetY = y - options.centerY;
      const distanceSquared = offsetX * offsetX + offsetY * offsetY;
      if (distanceSquared >= radiusSquared) continue;

      const distance = Math.sqrt(distanceSquared);
      const falloff = 1 - distance / radius;
      const displacement = strength * falloff * falloff;
      const sourceX = x - options.deltaX * displacement;
      const sourceY = y - options.deltaY * displacement;
      const targetIndex = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        output[targetIndex + channel] = sampleChannel(
          source,
          width,
          height,
          sourceX,
          sourceY,
          channel,
        );
      }
    }
  }

  return output;
};

export const applyLiquifyPushToContext = (
  context: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  options: LiquifyPushOptions,
): boolean => {
  const radius = Math.max(1, options.radius);
  const displacementPadding = Math.hypot(options.deltaX, options.deltaY)
    * clamp(options.strength, 0, 1);
  const padding = Math.ceil(radius + displacementPadding + 2);
  const left = clamp(Math.floor(options.centerX) - padding, 0, canvasWidth);
  const top = clamp(Math.floor(options.centerY) - padding, 0, canvasHeight);
  const right = clamp(Math.ceil(options.centerX) + padding, 0, canvasWidth);
  const bottom = clamp(Math.ceil(options.centerY) + padding, 0, canvasHeight);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return false;

  const source = context.getImageData(left, top, width, height);
  const output = liquifyPushPixels(source.data, width, height, {
    ...options,
    centerX: options.centerX - left,
    centerY: options.centerY - top,
  });
  source.data.set(output);
  context.putImageData(source, left, top);
  return true;
};
