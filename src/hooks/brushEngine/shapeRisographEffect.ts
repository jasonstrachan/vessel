type Point = { x: number; y: number };

type CanvasPoolLike = {
  acquire: (width: number, height: number) => HTMLCanvasElement;
  release: (canvas: HTMLCanvasElement) => void;
};

export type ApplyRisographEffectArgs = {
  ctx: CanvasRenderingContext2D;
  vertices: Array<{ x: number; y: number }>;
  risographIntensity: number;
  isPixelBrush: boolean;
  brushColor: string;
  risographColorShift?: number;
  setMultiplyIfUnlocked: (ctx: CanvasRenderingContext2D) => void;
  canvasPool: CanvasPoolLike;
  getRisographPattern: (ctx: CanvasRenderingContext2D) => CanvasPattern | null;
  getRisographEffectSettings: (
    intensity: number,
    options: { isPixelBrush: boolean }
  ) => { alpha: number; jitter: number };
  getRisographFilter: (
    color: string,
    amount: number,
    rng: () => number
  ) => string;
  createSeededRng: (seed: number) => () => number;
  hashNumbers: (...values: number[]) => number;
  createRisoTintMask: (
    width: number,
    height: number,
    isPixelBrush: boolean,
    rng: () => number
  ) => HTMLCanvasElement | undefined;
};

const drawPolygonPath = (ctx: CanvasRenderingContext2D, vertices: Point[], roundPoints: boolean) => {
  if (roundPoints) {
    ctx.moveTo(Math.round(vertices[0].x), Math.round(vertices[0].y));
    for (let i = 1; i < vertices.length; i += 1) {
      ctx.lineTo(Math.round(vertices[i].x), Math.round(vertices[i].y));
    }
    return;
  }

  ctx.moveTo(vertices[0].x, vertices[0].y);
  for (let i = 1; i < vertices.length; i += 1) {
    ctx.lineTo(vertices[i].x, vertices[i].y);
  }
};

export const applyRisographEffect = ({
  ctx,
  vertices,
  risographIntensity,
  isPixelBrush,
  brushColor,
  risographColorShift,
  setMultiplyIfUnlocked,
  canvasPool,
  getRisographPattern,
  getRisographEffectSettings,
  getRisographFilter,
  createSeededRng,
  hashNumbers,
  createRisoTintMask,
}: ApplyRisographEffectArgs): void => {
  const pattern = getRisographPattern(ctx);
  if (!pattern) {
    return;
  }

  ctx.save();

  const effect = getRisographEffectSettings(risographIntensity, { isPixelBrush });
  if (effect.alpha <= 0) {
    ctx.restore();
    return;
  }

  const minX = Math.floor(Math.min(...vertices.map((v) => v.x)));
  const minY = Math.floor(Math.min(...vertices.map((v) => v.y)));
  const maxX = Math.ceil(Math.max(...vertices.map((v) => v.x)));
  const maxY = Math.ceil(Math.max(...vertices.map((v) => v.y)));
  if ((maxX - minX) * (maxY - minY) < 16) {
    ctx.restore();
    return;
  }

  const seed = hashNumbers(minX, minY, maxX, maxY, risographIntensity);
  const rng = createSeededRng(seed);
  const misregXBase = (rng() - 0.5) * effect.jitter;
  const misregYBase = (rng() - 0.5) * effect.jitter;
  const misregX = isPixelBrush ? 0 : misregXBase;
  const misregY = isPixelBrush ? 0 : misregYBase;
  const rotation = isPixelBrush ? 0 : (rng() - 0.5) * 0.08;
  const scale = isPixelBrush ? 1 : 1 + (rng() - 0.5) * 0.04;
  const filter = isPixelBrush
    ? 'none'
    : getRisographFilter(brushColor || '#000', risographColorShift ?? 3, rng);

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  ctx.translate(misregX, misregY);
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);

  ctx.beginPath();
  drawPolygonPath(ctx, vertices, isPixelBrush);
  ctx.closePath();
  ctx.clip();

  const width = maxX - minX;
  const height = maxY - minY;

  const drawPatternPass = (mask: HTMLCanvasElement | undefined, alpha: number, passFilter: string) => {
    if (alpha <= 0) {
      return;
    }

    if (!mask) {
      setMultiplyIfUnlocked(ctx);
      ctx.fillStyle = pattern;
      ctx.globalAlpha = alpha;
      ctx.filter = passFilter;
      ctx.fillRect(minX, minY, width, height);
      return;
    }

    const temp = canvasPool.acquire(width, height);
    const tctx = temp.getContext('2d');
    if (!tctx) {
      canvasPool.release(temp);
      return;
    }

    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.clearRect(0, 0, width, height);
    tctx.filter = passFilter;
    tctx.globalAlpha = alpha;
    tctx.fillStyle = pattern;
    tctx.fillRect(0, 0, width, height);
    tctx.globalCompositeOperation = 'destination-in';
    tctx.drawImage(mask, 0, 0, width, height);

    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    setMultiplyIfUnlocked(ctx);
    ctx.drawImage(temp, minX, minY, width, height);
    canvasPool.release(temp);
  };

  drawPatternPass(undefined, effect.alpha, 'none');

  const tintMask = createRisoTintMask(width, height, isPixelBrush, rng);
  const tintAlpha = Math.min(effect.alpha * 0.45, 0.5);
  drawPatternPass(tintMask, tintAlpha, filter);

  ctx.restore();
};
