import { BrushShape, type BrushSettings } from '@/types';
import type { ColorCyclePaintMask } from '@/lib/colorCycle/document';

import type { CustomBrushStrokeData } from './BrushEngineFacade';

export type PaintedColorCycleStamp = {
  x: number;
  y: number;
  width: number;
  height: number;
  shape: BrushShape | NonNullable<BrushSettings['colorCycleStampShape']>;
  customStamp?: CustomBrushStrokeData;
  pressure: number;
  rotation: number;
};

type ColorCycleStrokeMaskHealerOptions = {
  internalCanvas: HTMLCanvasElement;
  layerId: string;
  healColorCycleEraseMask?: (layerId: string, paintMask: ColorCyclePaintMask) => void;
  resolveStampTargetSize: (pressure: number) => number;
};

export const createColorCycleStrokeMaskHealer = ({
  internalCanvas,
  layerId,
  healColorCycleEraseMask,
  resolveStampTargetSize,
}: ColorCycleStrokeMaskHealerOptions): {
  markPaintedStamp: (stamp: PaintedColorCycleStamp) => void;
  healPaintedEraseMask: () => void;
} => {
  const paintedStamps: PaintedColorCycleStamp[] = [];

  const markPaintedStamp = (stamp: PaintedColorCycleStamp): void => {
    paintedStamps.push(stamp);
  };

  const healPaintedEraseMask = (): void => {
    if (!healColorCycleEraseMask || paintedStamps.length === 0) {
      return;
    }

    const minX = Math.max(0, Math.floor(Math.min(
      ...paintedStamps.map((stamp) => stamp.x - stamp.width / 2),
    )));
    const minY = Math.max(0, Math.floor(Math.min(
      ...paintedStamps.map((stamp) => stamp.y - stamp.height / 2),
    )));
    const maxX = Math.min(internalCanvas.width - 1, Math.ceil(Math.max(
      ...paintedStamps.map((stamp) => stamp.x + stamp.width / 2),
    )));
    const maxY = Math.min(internalCanvas.height - 1, Math.ceil(Math.max(
      ...paintedStamps.map((stamp) => stamp.y + stamp.height / 2),
    )));
    if (maxX < minX || maxY < minY) {
      return;
    }

    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const data = new Uint8Array(width * height);
    const markPixel = (x: number, y: number): void => {
      if (x < minX || x > maxX || y < minY || y > maxY) {
        return;
      }
      data[(y - minY) * width + (x - minX)] = 255;
    };

    paintedStamps.forEach((stamp) => {
      if (stamp.customStamp) {
        markCustomStampPixels(stamp, markPixel, resolveStampTargetSize);
        return;
      }
      markShapeStampPixels(stamp, markPixel);
    });

    if (data.some((value) => value !== 0)) {
      healColorCycleEraseMask(layerId, {
        data,
        width,
        height,
        bounds: { x: minX, y: minY, width, height },
      });
    }
  };

  return { markPaintedStamp, healPaintedEraseMask };
};

const markCustomStampPixels = (
  stamp: PaintedColorCycleStamp,
  markPixel: (x: number, y: number) => void,
  resolveStampTargetSize: (pressure: number) => number,
): void => {
  const customStamp = stamp.customStamp;
  const imageData = customStamp?.imageData;
  if (!customStamp || !imageData) {
    return;
  }

  const baseWidth = Math.max(1, customStamp.width);
  const baseHeight = Math.max(1, customStamp.height);
  const maxDimension = Math.max(baseWidth, baseHeight);
  const scale = maxDimension > 0 ? resolveStampTargetSize(stamp.pressure) / maxDimension : 1;
  const scaledWidth = Math.max(1, Math.round(baseWidth * scale));
  const scaledHeight = Math.max(1, Math.round(baseHeight * scale));
  const cos = Math.cos(stamp.rotation);
  const sin = Math.sin(stamp.rotation);
  const originX = Math.round(stamp.x - stamp.width / 2);
  const originY = Math.round(stamp.y - stamp.height / 2);
  const centerX = stamp.width / 2;
  const centerY = stamp.height / 2;

  for (let py = 0; py < stamp.height; py += 1) {
    for (let px = 0; px < stamp.width; px += 1) {
      const relX = px + 0.5 - centerX;
      const relY = py + 0.5 - centerY;
      const unrotatedX = relX * cos + relY * sin;
      const unrotatedY = -relX * sin + relY * cos;
      const scaledX = unrotatedX + scaledWidth / 2;
      const scaledY = unrotatedY + scaledHeight / 2;
      if (scaledX < 0 || scaledX >= scaledWidth || scaledY < 0 || scaledY >= scaledHeight) {
        continue;
      }

      const sourceX = Math.floor((scaledX / scaledWidth) * baseWidth);
      const sourceY = Math.floor((scaledY / scaledHeight) * baseHeight);
      if (
        sourceX < 0 ||
        sourceY < 0 ||
        sourceX >= imageData.width ||
        sourceY >= imageData.height
      ) {
        continue;
      }
      const alpha = imageData.data[(sourceY * imageData.width + sourceX) * 4 + 3] ?? 0;
      if (alpha >= 16) {
        markPixel(originX + px, originY + py);
      }
    }
  }
};

const markShapeStampPixels = (
  stamp: PaintedColorCycleStamp,
  markPixel: (x: number, y: number) => void,
): void => {
  const left = Math.floor(stamp.x - stamp.width / 2);
  const top = Math.floor(stamp.y - stamp.height / 2);
  const right = Math.ceil(stamp.x + stamp.width / 2);
  const bottom = Math.ceil(stamp.y + stamp.height / 2);
  const centerX = stamp.x;
  const centerY = stamp.y;
  const radiusX = Math.max(1, stamp.width / 2);
  const radiusY = Math.max(1, stamp.height / 2);

  for (let py = top; py <= bottom; py += 1) {
    for (let px = left; px <= right; px += 1) {
      if (!containsStampPixel(stamp, px, py, centerX, centerY, radiusX, radiusY)) {
        continue;
      }
      markPixel(px, py);
    }
  }
};

const containsStampPixel = (
  stamp: PaintedColorCycleStamp,
  px: number,
  py: number,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
): boolean => {
  if (stamp.shape === 'round') {
    const dx = (px + 0.5 - centerX) / radiusX;
    const dy = (py + 0.5 - centerY) / radiusY;
    return dx * dx + dy * dy <= 1;
  }
  if (stamp.shape === 'diamond') {
    const dx = Math.abs(px + 0.5 - centerX) / radiusX;
    const dy = Math.abs(py + 0.5 - centerY) / radiusY;
    return dx + dy <= 1;
  }
  if (stamp.shape === BrushShape.COLOR_CYCLE_TRIANGLE) {
    return containsTrianglePixel(px, py, centerX, centerY, radiusX, radiusY);
  }
  return true;
};

const containsTrianglePixel = (
  px: number,
  py: number,
  centerX: number,
  centerY: number,
  halfW: number,
  halfH: number,
): boolean => {
  const ax = centerX;
  const ay = centerY - halfH;
  const bx = centerX - halfW;
  const by = centerY + halfH;
  const cx = centerX + halfW;
  const cy = centerY + halfH;
  const sampleX = px + 0.5;
  const sampleY = py + 0.5;
  const sign = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) =>
    (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  const d1 = sign(sampleX, sampleY, ax, ay, bx, by);
  const d2 = sign(sampleX, sampleY, bx, by, cx, cy);
  const d3 = sign(sampleX, sampleY, cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
};
