import { BrushShape, type BrushSettings } from '@/types';

import { drawPixelBrush, type PixelBrushDependencies } from './shapePixelBrush';
import { getRotatedPixelStamp } from './shapeRotatedStamp';

export interface StandardShapeDependencies extends PixelBrushDependencies {
  brushStampCache?: Map<string, HTMLCanvasElement>;
  getNextSpamChar?: () => string;
}

interface DrawStandardShapeParams {
  targetCtx: CanvasRenderingContext2D;
  drawX: number;
  drawY: number;
  size: number;
  halfSize: number;
  shape: BrushShape;
  antiAliasing: boolean;
  quantizedRotation: number;
  pattern?: ImageData;
  brushSettings?: BrushSettings;
  deps?: StandardShapeDependencies;
}

const drawSquare = (
  drawingCtx: CanvasRenderingContext2D,
  drawX: number,
  drawY: number,
  size: number,
  halfSize: number,
  antiAliasing: boolean,
  quantizedRotation: number,
  deps: StandardShapeDependencies | undefined,
) => {
  if (antiAliasing) {
    drawingCtx.fillRect(drawX - halfSize, drawY - halfSize, size, size);
    return;
  }

  const pixelSize = Math.round(size);
  if (quantizedRotation !== 0) {
    const squareStamp = document.createElement('canvas');
    squareStamp.width = pixelSize;
    squareStamp.height = pixelSize;
    const sqCtx = squareStamp.getContext('2d');
    if (!sqCtx) return;

    sqCtx.imageSmoothingEnabled = false;
    sqCtx.fillStyle = drawingCtx.fillStyle;
    sqCtx.fillRect(0, 0, pixelSize, pixelSize);

    const colorKey = drawingCtx.fillStyle ? drawingCtx.fillStyle.toString() : '';
    const rotatedSquare = getRotatedPixelStamp(
      deps?.rotatedStampCache,
      squareStamp,
      quantizedRotation,
      `pixel_square_${pixelSize}`,
      colorKey,
    );
    drawingCtx.imageSmoothingEnabled = false;
    drawingCtx.drawImage(
      rotatedSquare,
      Math.round(drawX - rotatedSquare.width / 2),
      Math.round(drawY - rotatedSquare.height / 2),
    );
    return;
  }

  const offset = Math.floor(pixelSize / 2);
  drawingCtx.fillRect(drawX - offset, drawY - offset, pixelSize, pixelSize);
};

const drawRound = (
  targetCtx: CanvasRenderingContext2D,
  drawX: number,
  drawY: number,
  size: number,
  halfSize: number,
  antiAliasing: boolean,
  pattern: ImageData | undefined,
  deps: StandardShapeDependencies | undefined,
) => {
  const roundedSize = Math.round(size);
  const useFastRender = roundedSize > 2 && !pattern;

  if (useFastRender && antiAliasing && deps?.brushStampCache) {
    const currentColor = targetCtx.fillStyle.toString();
    const cacheKey = `soft_circle_${roundedSize}_${currentColor}`;
    let stampCanvas = deps.brushStampCache.get(cacheKey);

    if (!stampCanvas) {
      stampCanvas = document.createElement('canvas');
      const stampSize = roundedSize + 4;
      stampCanvas.width = stampSize;
      stampCanvas.height = stampSize;
      const stampCtx = stampCanvas.getContext('2d')!;

      const gradient = stampCtx.createRadialGradient(
        stampSize / 2,
        stampSize / 2,
        0,
        stampSize / 2,
        stampSize / 2,
        roundedSize / 2,
      );

      const match = currentColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (match) {
        const [, r, g, b] = match;
        gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
        gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.8)`);
        gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      } else if (currentColor.startsWith('#')) {
        const hex = currentColor.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
        gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.8)`);
        gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      } else {
        gradient.addColorStop(0, currentColor);
        gradient.addColorStop(0.5, currentColor);
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      }

      stampCtx.fillStyle = gradient;
      stampCtx.beginPath();
      stampCtx.arc(stampSize / 2, stampSize / 2, roundedSize / 2, 0, Math.PI * 2);
      stampCtx.fill();

      deps.brushStampCache.set(cacheKey, stampCanvas);
    }

    const originalGlobalAlpha = targetCtx.globalAlpha;
    const originalComposite = targetCtx.globalCompositeOperation;
    targetCtx.globalCompositeOperation = 'source-over';
    targetCtx.globalAlpha = originalGlobalAlpha * 0.9;
    const stampSize = stampCanvas.width;
    targetCtx.drawImage(stampCanvas, drawX - stampSize / 2, drawY - stampSize / 2);
    targetCtx.globalAlpha = originalGlobalAlpha;
    targetCtx.globalCompositeOperation = originalComposite;
    return;
  }

  if (useFastRender && !antiAliasing && roundedSize <= 8 && deps?.createPixelCircleStamp) {
    const stampCanvas = deps.createPixelCircleStamp(roundedSize);
    if (stampCanvas) {
      targetCtx.drawImage(stampCanvas, Math.round(drawX - roundedSize / 2), Math.round(drawY - roundedSize / 2));
    }
    return;
  }

  targetCtx.beginPath();
  targetCtx.arc(drawX, drawY, halfSize, 0, Math.PI * 2);
  targetCtx.fill();
};

const drawTriangle = (
  drawingCtx: CanvasRenderingContext2D,
  drawX: number,
  drawY: number,
  size: number,
  halfSize: number,
  antiAliasing: boolean,
) => {
  drawingCtx.beginPath();
  if (antiAliasing) {
    drawingCtx.moveTo(drawX, drawY - halfSize);
    drawingCtx.lineTo(drawX - halfSize, drawY + halfSize);
    drawingCtx.lineTo(drawX + halfSize, drawY + halfSize);
  } else {
    const height = Math.floor(size * 0.866);
    drawingCtx.moveTo(drawX, drawY - Math.floor(height / 2));
    drawingCtx.lineTo(drawX - Math.floor(size / 2), drawY + Math.floor(height / 2));
    drawingCtx.lineTo(drawX + Math.floor(size / 2), drawY + Math.floor(height / 2));
  }
  drawingCtx.closePath();
  drawingCtx.fill();
};

const drawPolygon = (
  drawingCtx: CanvasRenderingContext2D,
  drawX: number,
  drawY: number,
  halfSize: number,
  brushSettings?: BrushSettings,
) => {
  const sides = brushSettings?.polygonSides || 6;
  const ditherRes = brushSettings?.polygonDitherResolution || 3;

  drawingCtx.save();
  if (brushSettings?.ditherEnabled) {
    drawingCtx.imageSmoothingEnabled = false;
  }

  drawingCtx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = (Math.PI * 2 / sides) * i - Math.PI / 2;
    const px = drawX + Math.cos(angle) * halfSize;
    const py = drawY + Math.sin(angle) * halfSize;

    if (i === 0) {
      drawingCtx.moveTo(px, py);
    } else {
      drawingCtx.lineTo(px, py);
    }
  }
  drawingCtx.closePath();

  if (brushSettings?.ditherEnabled && ditherRes > 1) {
    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = ditherRes;
    patternCanvas.height = ditherRes;
    const patternCtx = patternCanvas.getContext('2d');

    if (patternCtx) {
      patternCtx.fillStyle = drawingCtx.fillStyle;
      for (let y = 0; y < ditherRes; y++) {
        for (let x = 0; x < ditherRes; x++) {
          if ((x + y) % 2 === 0) {
            patternCtx.fillRect(x, y, 1, 1);
          }
        }
      }

      const pattern = drawingCtx.createPattern(patternCanvas, 'repeat');
      if (pattern) {
        drawingCtx.fillStyle = pattern;
      }
    }
  }

  drawingCtx.fill();
  drawingCtx.restore();
};

const drawSpamText = (
  drawingCtx: CanvasRenderingContext2D,
  drawX: number,
  drawY: number,
  size: number,
  brushSettings: BrushSettings | undefined,
  deps: StandardShapeDependencies | undefined,
) => {
  const fontSize = Math.round(size);
  const char = deps?.getNextSpamChar ? deps.getNextSpamChar() : 'S';
  const fontFamily = brushSettings?.spamFont === 'consolas' ? 'Consolas, monospace' :
                    brushSettings?.spamFont === 'monaco' ? 'Monaco, monospace' :
                    brushSettings?.spamFont === 'lucida' ? 'Lucida Console, monospace' :
                    brushSettings?.spamFont === 'roboto' ? 'Roboto Mono, monospace' :
                    brushSettings?.spamFont === 'source' ? 'Source Code Pro, monospace' :
                    brushSettings?.spamFont === 'terminal' ? 'Terminal, monospace' :
                    brushSettings?.spamFont === 'menlo' ? 'Menlo, monospace' :
                    'Courier New, monospace';

  drawingCtx.save();
  drawingCtx.font = `${fontSize}px ${fontFamily}`;
  drawingCtx.textAlign = 'center';
  drawingCtx.textBaseline = 'middle';
  drawingCtx.fillText(char, drawX, drawY);
  drawingCtx.restore();
};

export const drawStandardShape = ({
  targetCtx,
  drawX,
  drawY,
  size,
  halfSize,
  shape,
  antiAliasing,
  quantizedRotation,
  pattern,
  brushSettings,
  deps,
}: DrawStandardShapeParams): void => {
  switch (shape) {
    case BrushShape.SQUARE:
      drawSquare(targetCtx, drawX, drawY, size, halfSize, antiAliasing, quantizedRotation, deps);
      break;

    case BrushShape.ROUND:
      drawRound(targetCtx, drawX, drawY, size, halfSize, antiAliasing, pattern, deps);
      break;

    case BrushShape.TRIANGLE:
      drawTriangle(targetCtx, drawX, drawY, size, halfSize, antiAliasing);
      break;

    case BrushShape.PIXEL_DITHER:
    case BrushShape.PIXEL_ROUND:
      drawPixelBrush({
        drawingCtx: targetCtx,
        drawX,
        drawY,
        size,
        halfSize,
        shape,
        quantizedRotation,
        brushSettings,
        deps,
      });
      break;

    case BrushShape.POLYGON:
      drawPolygon(targetCtx, drawX, drawY, halfSize, brushSettings);
      break;

    case BrushShape.SPAM_TEXT:
      drawSpamText(targetCtx, drawX, drawY, size, brushSettings, deps);
      break;

    default:
      targetCtx.fillRect(drawX - halfSize, drawY - halfSize, size, size);
      break;
  }
};
