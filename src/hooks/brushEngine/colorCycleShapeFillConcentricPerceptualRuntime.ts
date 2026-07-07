import { fillConcentric } from './ccGradientFillDither';
import type { FillDitherAlgorithm } from './ccGradientFillDither';
import type { ColorCycleShapeFillExecutionContext } from './colorCycleShapeFillExecutionTypes';

type ConcentricPerceptualFillContext = {
  isPxlEdgeEnabled: ColorCycleShapeFillExecutionContext['isPxlEdgeEnabled'];
  isDitherEnabled: ColorCycleShapeFillExecutionContext['isDitherEnabled'];
  getDitherPixelSize: ColorCycleShapeFillExecutionContext['getDitherPixelSize'];
  colorAtPosition: ColorCycleShapeFillExecutionContext['colorAtPosition'];
  buildQuantizedGradientPalette: ColorCycleShapeFillExecutionContext['buildQuantizedGradientPalette'];
};

export type ConcentricPerceptualFillParams = {
  context: ConcentricPerceptualFillContext;
  vertices: Array<{ x: number; y: number }>;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  maxDist: number;
  numBands: number;
  baseOffset: number;
  fillAlgorithm: FillDitherAlgorithm;
  fillPatternStyle: string | undefined;
  writeConcentricIndex(x: number, y: number, colorIndex: number, phaseByte?: number): void;
  resolveConcentricPhaseByte(x: number, y: number, colorIndex: number): number;
  yieldIfNeeded(row: number): Promise<void>;
  finish(): void;
};

export async function tryRunConcentricPerceptualFill({
  context,
  vertices,
  minX,
  minY,
  maxX,
  maxY,
  maxDist,
  numBands,
  baseOffset,
  fillAlgorithm,
  fillPatternStyle,
  writeConcentricIndex,
  resolveConcentricPhaseByte,
  yieldIfNeeded,
  finish,
}: ConcentricPerceptualFillParams): Promise<boolean> {
  try {
    const bbox = {
      minX: Math.floor(minX),
      minY: Math.floor(minY),
      width: Math.max(1, Math.ceil(maxX) - Math.floor(minX) + 1),
      height: Math.max(1, Math.ceil(maxY) - Math.floor(minY) + 1),
    };
    const width = bbox.width;
    const height = bbox.height;
    const img = new ImageData(width, height);
    const data = img.data;
    const x0 = bbox.minX;
    const y0 = bbox.minY;

    const edges = new Array(vertices.length);
    for (let j = 0; j < vertices.length; j++) {
      const v1 = vertices[j];
      const v2 = vertices[(j + 1) % vertices.length];
      const dx = v2.x - v1.x;
      const dy = v2.y - v1.y;
      const len2 = dx * dx + dy * dy;
      edges[j] = { v1x: v1.x, v1y: v1.y, dx, dy, len2 };
    }

    const spans: Array<Array<[number, number]>> = [];
    for (let y = y0; y <= Math.ceil(maxY); y++) {
      await yieldIfNeeded(y - y0);
      const ints: number[] = [];
      for (let i = 0; i < vertices.length; i++) {
        const v1 = vertices[i];
        const v2 = vertices[(i + 1) % vertices.length];
        if (Math.abs(v2.y - v1.y) < 1e-4) continue;
        if ((v1.y <= y && v2.y > y) || (v2.y <= y && v1.y > y)) {
          const t = (y - v1.y) / (v2.y - v1.y);
          const x = v1.x + t * (v2.x - v1.x);
          ints.push(x);
        }
      }
      ints.sort((a, b) => a - b);
      const row: [number, number][] = [];
      for (let i = 0; i < ints.length - 1; i += 2) {
        const startX = Math.floor(ints[i]);
        const endX = context.isPxlEdgeEnabled()
          ? Math.ceil(ints[i + 1]) - 1
          : Math.ceil(ints[i + 1]);
        if (endX >= startX) {
          row.push([startX, endX]);
        }
      }
      spans.push(row);
    }

    const maxDistSafe = Math.max(1e-6, maxDist);
    const useBlockQuantization =
      context.isDitherEnabled() &&
      Math.max(1, context.getDitherPixelSize()) > 1;
    const blockSize = Math.max(1, context.getDitherPixelSize());
    const quantizeSample = (value: number, base: number, extent: number) => {
      if (!useBlockQuantization || blockSize <= 1) return value + 0.5;
      const rel = value - base;
      const snapped = base + Math.floor(rel / blockSize) * blockSize + blockSize * 0.5;
      const limit = base + extent - 0.5;
      return Math.min(limit, Math.max(base, snapped));
    };

    for (let yy = 0; yy < height; yy++) {
      await yieldIfNeeded(yy);
      const y = y0 + yy;
      const rowSpans = spans[yy] || [];
      for (const [sx, ex] of rowSpans) {
        for (let x = sx; x <= ex; x++) {
          const xx = x - x0;
          if (xx < 0 || xx >= width) continue;
          const sampleX = quantizeSample(x, x0, width);
          const sampleY = quantizeSample(y, y0, height);
          let minDistSq = Math.min((sampleX - sx) ** 2, (ex - sampleX) ** 2);
          for (let k = 0; k < edges.length; k++) {
            const e = edges[k];
            if (e.len2 <= 0) continue;
            const tNum = (sampleX - e.v1x) * e.dx + (sampleY - e.v1y) * e.dy;
            const tVal = Math.max(0, Math.min(1, tNum / e.len2));
            const px = e.v1x + tVal * e.dx;
            const py = e.v1y + tVal * e.dy;
            const ddx = sampleX - px;
            const ddy = sampleY - py;
            const d2 = ddx * ddx + ddy * ddy;
            if (d2 < minDistSq) {
              minDistSq = d2;
              if (minDistSq <= 1) break;
            }
          }
          const r = Math.min(1, Math.sqrt(minDistSq) / maxDistSafe);
          const { r: R, g: G, b: B } = context.colorAtPosition(r);
          const p = (yy * width + xx) * 4;
          data[p] = R;
          data[p + 1] = G;
          data[p + 2] = B;
          data[p + 3] = 255;
        }
      }
    }

    const { css: paletteCss, mapRgbToIndex } = context.buildQuantizedGradientPalette(numBands);
    const dithered: ImageData = fillConcentric(img, {
      levels: numBands,
      pixelSize: Math.max(1, context.getDitherPixelSize()),
      algorithm: fillAlgorithm,
      patternStyle: fillPatternStyle,
      perceptual: true,
      customPalette: paletteCss,
    });
    const out = dithered.data;
    for (let yy = 0; yy < height; yy++) {
      await yieldIfNeeded(yy);
      const y = y0 + yy;
      const rowSpans = spans[yy] || [];
      for (const [sx, ex] of rowSpans) {
        for (let x = sx; x <= ex; x++) {
          const xx = x - x0;
          if (xx < 0 || xx >= width) continue;
          const p = (yy * width + xx) * 4;
          const key = `${out[p]},${out[p + 1]},${out[p + 2]}`;
          const gi = mapRgbToIndex.get(key);
          if (gi !== undefined) {
            const shifted = (gi - 1 + baseOffset) % 255;
            writeConcentricIndex(x, y, shifted + 1, resolveConcentricPhaseByte(x, y, shifted + 1));
          }
        }
      }
    }

    finish();
    return true;
  } catch {
    return false;
  }
}
