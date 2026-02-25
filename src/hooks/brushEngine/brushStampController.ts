type MutableRef<T> = { current: T };

type PixelPoint = { x: number; y: number };

const PIXEL_CIRCLE_PATTERNS: Record<number, PixelPoint[]> = {
  1: [{ x: 0, y: 0 }],
  2: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  3: [{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 1 }],
  4: [
    { x: 0, y: 1 }, { x: 0, y: 2 },
    { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 },
    { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 },
    { x: 3, y: 1 }, { x: 3, y: 2 },
  ],
  5: [
    { x: 0, y: 2 },
    { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 },
    { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 }, { x: 2, y: 4 },
    { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 },
    { x: 4, y: 2 },
  ],
  6: [
    { x: 0, y: 2 }, { x: 0, y: 3 },
    { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }, { x: 1, y: 4 },
    { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 }, { x: 2, y: 4 }, { x: 2, y: 5 },
    { x: 3, y: 0 }, { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 3, y: 4 }, { x: 3, y: 5 },
    { x: 4, y: 1 }, { x: 4, y: 2 }, { x: 4, y: 3 }, { x: 4, y: 4 },
    { x: 5, y: 2 }, { x: 5, y: 3 },
  ],
  7: [
    { x: 0, y: 2 }, { x: 0, y: 3 }, { x: 0, y: 4 },
    { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }, { x: 1, y: 4 }, { x: 1, y: 5 },
    { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 }, { x: 2, y: 4 }, { x: 2, y: 5 }, { x: 2, y: 6 },
    { x: 3, y: 0 }, { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 3, y: 4 }, { x: 3, y: 5 }, { x: 3, y: 6 },
    { x: 4, y: 0 }, { x: 4, y: 1 }, { x: 4, y: 2 }, { x: 4, y: 3 }, { x: 4, y: 4 }, { x: 4, y: 5 }, { x: 4, y: 6 },
    { x: 5, y: 1 }, { x: 5, y: 2 }, { x: 5, y: 3 }, { x: 5, y: 4 }, { x: 5, y: 5 },
    { x: 6, y: 2 }, { x: 6, y: 3 }, { x: 6, y: 4 },
  ],
  8: [
    { x: 0, y: 2 }, { x: 0, y: 3 }, { x: 0, y: 4 }, { x: 0, y: 5 },
    { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }, { x: 1, y: 4 }, { x: 1, y: 5 }, { x: 1, y: 6 },
    { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 }, { x: 2, y: 4 }, { x: 2, y: 5 }, { x: 2, y: 6 }, { x: 2, y: 7 },
    { x: 3, y: 0 }, { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 3, y: 4 }, { x: 3, y: 5 }, { x: 3, y: 6 }, { x: 3, y: 7 },
    { x: 4, y: 0 }, { x: 4, y: 1 }, { x: 4, y: 2 }, { x: 4, y: 3 }, { x: 4, y: 4 }, { x: 4, y: 5 }, { x: 4, y: 6 }, { x: 4, y: 7 },
    { x: 5, y: 0 }, { x: 5, y: 1 }, { x: 5, y: 2 }, { x: 5, y: 3 }, { x: 5, y: 4 }, { x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 },
    { x: 6, y: 1 }, { x: 6, y: 2 }, { x: 6, y: 3 }, { x: 6, y: 4 }, { x: 6, y: 5 }, { x: 6, y: 6 },
    { x: 7, y: 2 }, { x: 7, y: 3 }, { x: 7, y: 4 }, { x: 7, y: 5 },
  ],
};

const resolvePixelCirclePoints = (size: number): PixelPoint[] => {
  if (PIXEL_CIRCLE_PATTERNS[size]) {
    return PIXEL_CIRCLE_PATTERNS[size];
  }

  const pixels: PixelPoint[] = [];
  const radius = size / 2;
  const centerX = radius - 0.5;
  const centerY = radius - 0.5;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy <= radius * radius) {
        pixels.push({ x, y });
      }
    }
  }
  return pixels;
};

export const getPatternTempContext = ({
  width,
  height,
  patternTempCanvasRef,
}: {
  width: number;
  height: number;
  patternTempCanvasRef: MutableRef<HTMLCanvasElement | null>;
}): CanvasRenderingContext2D | null => {
  if (!patternTempCanvasRef.current) {
    patternTempCanvasRef.current = document.createElement('canvas');
  }

  const canvas = patternTempCanvasRef.current;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext('2d');
  if (ctx) {
    const contextWithCanvas = ctx as CanvasRenderingContext2D & { _canvas?: HTMLCanvasElement };
    contextWithCanvas._canvas = canvas;
  }
  return ctx;
};

export const getRotationTempContext = ({
  width,
  height,
  rotationTempCanvasRef,
}: {
  width: number;
  height: number;
  rotationTempCanvasRef: MutableRef<HTMLCanvasElement | null>;
}): CanvasRenderingContext2D | null => {
  if (!rotationTempCanvasRef.current) {
    rotationTempCanvasRef.current = document.createElement('canvas');
  }

  const canvas = rotationTempCanvasRef.current;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  return canvas.getContext('2d');
};

export const createPixelSquareStamp = ({
  size,
  brushStampCache,
}: {
  size: number;
  brushStampCache: Map<string, HTMLCanvasElement>;
}): HTMLCanvasElement => {
  const cacheKey = `pixel_square_${size}`;
  let stamp = brushStampCache.get(cacheKey);

  if (!stamp) {
    stamp = document.createElement('canvas');
    stamp.width = size;
    stamp.height = size;
    const ctx = stamp.getContext('2d', { colorSpace: 'srgb' });

    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, size, size);
    }

    brushStampCache.set(cacheKey, stamp);
  }

  return stamp;
};

export const createPixelCircleStamp = ({
  size,
  brushStampCache,
}: {
  size: number;
  brushStampCache: Map<string, HTMLCanvasElement>;
}): HTMLCanvasElement => {
  const cacheKey = `pixel_circle_${size}`;
  let stamp = brushStampCache.get(cacheKey);

  if (!stamp) {
    const pixels = resolvePixelCirclePoints(size);

    stamp = document.createElement('canvas');
    stamp.width = size;
    stamp.height = size;
    const ctx = stamp.getContext('2d', { colorSpace: 'srgb' });

    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = 'white';
      pixels.forEach((pixel) => {
        ctx.fillRect(pixel.x, pixel.y, 1, 1);
      });
    }

    brushStampCache.set(cacheKey, stamp);
  }

  return stamp;
};

