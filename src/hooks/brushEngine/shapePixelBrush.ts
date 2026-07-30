import { BrushShape, type BrushSettings } from '@/types';
import { canvasPool } from '@/utils/canvasPool';

import {
  buildRotatedStampCacheKey,
  getRotatedPixelStamp,
  type RotatedStampCache,
} from './shapeRotatedStamp';

export interface PixelBrushDependencies {
  createPixelCircleStamp?: (size: number) => HTMLCanvasElement | null;
  rotatedStampCache?: RotatedStampCache;
}

interface DrawPixelBrushParams {
  drawingCtx: CanvasRenderingContext2D;
  drawX: number;
  drawY: number;
  size: number;
  halfSize: number;
  shape: BrushShape.PIXEL_DITHER | BrushShape.PIXEL_ROUND;
  quantizedRotation: number;
  brushSettings?: BrushSettings;
  deps?: PixelBrushDependencies;
}

const DIAMOND_9_MASK = [
  0, 0, 0, 0, 1, 0, 0, 0, 0,
  0, 0, 0, 1, 1, 1, 0, 0, 0,
  0, 0, 1, 1, 1, 1, 1, 0, 0,
  0, 1, 1, 1, 1, 1, 1, 1, 0,
  1, 1, 1, 1, 1, 1, 1, 1, 1,
  0, 1, 1, 1, 1, 1, 1, 1, 0,
  0, 0, 1, 1, 1, 1, 1, 0, 0,
  0, 0, 0, 1, 1, 1, 0, 0, 0,
  0, 0, 0, 0, 1, 0, 0, 0, 0,
];

const DIAMOND_7_MASK = [
  0, 0, 0, 1, 0, 0, 0,
  0, 0, 1, 1, 1, 0, 0,
  0, 1, 1, 1, 1, 1, 0,
  1, 1, 1, 1, 1, 1, 1,
  0, 1, 1, 1, 1, 1, 0,
  0, 0, 1, 1, 1, 0, 0,
  0, 0, 0, 1, 0, 0, 0,
];

const DIAMOND_5_MASK = [
  0, 0, 1, 0, 0,
  0, 1, 1, 1, 0,
  1, 1, 1, 1, 1,
  0, 1, 1, 1, 0,
  0, 0, 1, 0, 0,
];

const drawGridMask = (
  drawingCtx: CanvasRenderingContext2D,
  drawX: number,
  drawY: number,
  stampSize: number,
  gridSize: number,
  mask: readonly number[],
) => {
  const pixelScale = Math.max(1, Math.round(stampSize / gridSize));
  const rasterSize = pixelScale * gridSize;
  const originX = Math.round(drawX - rasterSize / 2);
  const originY = Math.round(drawY - rasterSize / 2);

  for (let row = 0; row < gridSize; row += 1) {
    for (let col = 0; col < gridSize; col += 1) {
      if (mask[row * gridSize + col] === 0) continue;
      drawingCtx.fillRect(
        originX + col * pixelScale,
        originY + row * pixelScale,
        pixelScale,
        pixelScale,
      );
    }
  }
};

const drawCheckeredTip = (
  drawingCtx: CanvasRenderingContext2D,
  drawX: number,
  drawY: number,
  stampSize: number,
) => {
  const gridSize = 4;
  const pixelScale = Math.max(1, Math.round(stampSize / gridSize));
  const rasterSize = pixelScale * gridSize;
  const originX = Math.round(drawX - rasterSize / 2);
  const originY = Math.round(drawY - rasterSize / 2);

  for (let row = 0; row < gridSize; row += 1) {
    for (let col = 0; col < gridSize; col += 1) {
      if ((row + col) % 2 !== 0) {
        continue;
      }
      drawingCtx.fillRect(
        originX + col * pixelScale,
        originY + row * pixelScale,
        pixelScale,
        pixelScale,
      );
    }
  }
};

const drawSquareOrDiamondTip = (
  drawingCtx: CanvasRenderingContext2D,
  drawX: number,
  drawY: number,
  stampSize: number,
  quantizedRotation: number,
  isDiamond: boolean,
  deps: PixelBrushDependencies | undefined,
) => {
  if (!isDiamond && Math.abs(quantizedRotation) < 0.01) {
    drawingCtx.fillRect(
      Math.round(drawX - stampSize / 2),
      Math.round(drawY - stampSize / 2),
      stampSize,
      stampSize,
    );
    return;
  }

  const colorKey = drawingCtx.fillStyle.toString();
  const rotation = isDiamond ? Math.PI / 4 + quantizedRotation : quantizedRotation;
  const cacheKey = isDiamond
    ? `pixel_diamond_${stampSize}_${colorKey}`
    : `pixel_square_${stampSize}_${colorKey}`;
  const cached = deps?.rotatedStampCache?.get(
    buildRotatedStampCacheKey(cacheKey, rotation)
  );
  if (cached) {
    drawingCtx.drawImage(
      cached,
      Math.round(drawX - cached.width / 2),
      Math.round(drawY - cached.height / 2),
    );
    return;
  }

  const squareStamp = document.createElement('canvas');
  squareStamp.width = stampSize;
  squareStamp.height = stampSize;
  const sqCtx = squareStamp.getContext('2d');
  if (!sqCtx) return;

  sqCtx.imageSmoothingEnabled = false;
  sqCtx.fillStyle = colorKey || '#000000';
  sqCtx.fillRect(0, 0, stampSize, stampSize);
  const rotatedSquare = getRotatedPixelStamp(deps?.rotatedStampCache, squareStamp, rotation, cacheKey);
  drawingCtx.drawImage(
    rotatedSquare,
    Math.round(drawX - rotatedSquare.width / 2),
    Math.round(drawY - rotatedSquare.height / 2),
  );
};

const drawTriangleTip = (
  drawingCtx: CanvasRenderingContext2D,
  drawX: number,
  drawY: number,
  stampSize: number,
) => {
  drawingCtx.beginPath();
  const height = Math.floor(stampSize * 0.866);
  drawingCtx.moveTo(drawX, drawY - Math.floor(height / 2));
  drawingCtx.lineTo(drawX - Math.floor(stampSize / 2), drawY + Math.floor(height / 2));
  drawingCtx.lineTo(drawX + Math.floor(stampSize / 2), drawY + Math.floor(height / 2));
  drawingCtx.closePath();
  drawingCtx.fill();
};

const drawSpecialDitherTip = (
  drawingCtx: CanvasRenderingContext2D,
  drawX: number,
  drawY: number,
  stampSize: number,
  ditherTipShape: NonNullable<BrushSettings['ditherStrokeTipShape']>,
  quantizedRotation: number,
  deps: PixelBrushDependencies | undefined,
) => {
  drawingCtx.imageSmoothingEnabled = false;
  if (ditherTipShape === 'checkered') {
    drawCheckeredTip(drawingCtx, drawX, drawY, stampSize);
  } else if (ditherTipShape === 'diamond5' || ditherTipShape === 'diamond7' || ditherTipShape === 'diamond9') {
    const gridSize = ditherTipShape === 'diamond9' ? 9 : ditherTipShape === 'diamond7' ? 7 : 5;
    const mask = gridSize === 9 ? DIAMOND_9_MASK : gridSize === 7 ? DIAMOND_7_MASK : DIAMOND_5_MASK;
    drawGridMask(drawingCtx, drawX, drawY, stampSize, gridSize, mask);
  } else if (ditherTipShape === 'square' || ditherTipShape === 'diamond') {
    drawSquareOrDiamondTip(
      drawingCtx,
      drawX,
      drawY,
      stampSize,
      quantizedRotation,
      ditherTipShape === 'diamond',
      deps,
    );
  } else if (ditherTipShape === 'triangle') {
    drawTriangleTip(drawingCtx, drawX, drawY, stampSize);
  }
};

export const drawPixelBrush = ({
  drawingCtx,
  drawX,
  drawY,
  size,
  halfSize,
  shape,
  quantizedRotation,
  brushSettings,
  deps,
}: DrawPixelBrushParams): void => {
  const ditherTipShape =
    shape === BrushShape.PIXEL_DITHER
      ? brushSettings?.ditherStrokeTipShape ?? 'round'
      : 'round';

  if (shape === BrushShape.PIXEL_DITHER && ditherTipShape !== 'round') {
    drawSpecialDitherTip(
      drawingCtx,
      drawX,
    drawY,
    Math.max(1, Math.round(size)),
    ditherTipShape,
    quantizedRotation,
    deps,
  );
    return;
  }

  if (deps?.createPixelCircleStamp) {
    const stampSize = Math.max(1, Math.round(size));
    const stampCanvas = deps.createPixelCircleStamp(stampSize);
    if (!stampCanvas) return;

    const tempCanvas = canvasPool.acquire(stampSize, stampSize);
    const tempCtx = tempCanvas.getContext('2d', { colorSpace: 'srgb' });

    if (tempCtx) {
      tempCtx.clearRect(0, 0, stampSize, stampSize);
      tempCtx.imageSmoothingEnabled = false;
      tempCtx.drawImage(stampCanvas, 0, 0);
      tempCtx.globalCompositeOperation = 'source-in';
      tempCtx.fillStyle = drawingCtx.fillStyle;
      tempCtx.fillRect(0, 0, stampSize, stampSize);

      let finalStamp = tempCanvas;
      if (quantizedRotation !== 0) {
        const colorKey = drawingCtx.fillStyle ? drawingCtx.fillStyle.toString() : '';
        finalStamp = getRotatedPixelStamp(
          deps?.rotatedStampCache,
          tempCanvas,
          quantizedRotation,
          `pixel_circle_${stampSize}`,
          colorKey,
        );
      }

      drawingCtx.imageSmoothingEnabled = false;
      drawingCtx.drawImage(
        finalStamp,
        Math.round(drawX - finalStamp.width / 2),
        Math.round(drawY - finalStamp.height / 2),
      );
    }

    canvasPool.release(tempCanvas);
    return;
  }

  drawingCtx.beginPath();
  drawingCtx.arc(drawX, drawY, halfSize, 0, Math.PI * 2);
  drawingCtx.fill();
};
