import type React from 'react';
import { useCallback } from 'react';
import type { Layer } from '@/types';

type CompositeSampleOptions = {
  radius?: number;
  preferSolid?: boolean;
};

interface UseDrawingCanvasSamplingOptions {
  compositeCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  lastSampleRef: React.MutableRefObject<{ x: number; y: number; color: string; layerId: string | null; preferReference: boolean }>;
  layers: Layer[];
  referenceLayerId: string | null;
  preferReferenceSampling: boolean;
}

const rgbToHex = (r: number, g: number, b: number): string => {
  const toHex = (value: number) => value.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

export const useDrawingCanvasSampling = ({
  compositeCanvasRef,
  lastSampleRef,
  layers,
  referenceLayerId,
  preferReferenceSampling,
}: UseDrawingCanvasSamplingOptions) => {
  const sampleCompositeOpaque = useCallback(
    (x: number, y: number, options: CompositeSampleOptions = {}): string => {
      const { radius = 1, preferSolid = true } = options;
      const comp = compositeCanvasRef.current;
      if (!comp) return '#ffffff';

      const ctx = comp.getContext('2d', { willReadFrequently: true });
      if (!ctx) return '#ffffff';

      const cw = comp.width;
      const ch = comp.height;
      const cx = Math.max(0, Math.min(cw - 1, Math.floor(x)));
      const cy = Math.max(0, Math.min(ch - 1, Math.floor(y)));

      const sx0 = Math.max(0, cx - radius);
      const sy0 = Math.max(0, cy - radius);
      const sx1 = Math.min(cw - 1, cx + radius);
      const sy1 = Math.min(ch - 1, cy + radius);
      const boxW = sx1 - sx0 + 1;
      const boxH = sy1 - sy0 + 1;

      const image = ctx.getImageData(sx0, sy0, boxW, boxH).data;

      let solidAlpha = -1;
      let solidR = 255;
      let solidG = 255;
      let solidB = 255;

      let accR = 0;
      let accG = 0;
      let accB = 0;
      let samples = 0;

      for (let iy = 0; iy < boxH; iy += 1) {
        for (let ix = 0; ix < boxW; ix += 1) {
          const offset = (iy * boxW + ix) * 4;
          const r = image[offset];
          const g = image[offset + 1];
          const b = image[offset + 2];
          const alpha = image[offset + 3] / 255;

          if (preferSolid && alpha > solidAlpha) {
            solidAlpha = alpha;
            solidR = r;
            solidG = g;
            solidB = b;
          }

          accR += r;
          accG += g;
          accB += b;
          samples += 1;
        }
      }

      const toHex = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');

      if (preferSolid && solidAlpha >= 0) {
        return `#${toHex(solidR)}${toHex(solidG)}${toHex(solidB)}`;
      }

      if (samples > 0) {
        const avgR = accR / samples;
        const avgG = accG / samples;
        const avgB = accB / samples;
        return `#${toHex(avgR)}${toHex(avgG)}${toHex(avgB)}`;
      }

      return '#ffffff';
    },
    [compositeCanvasRef]
  );

  const sampleColorFromReferenceLayer = useCallback(
    (x: number, y: number): string | null => {
      if (!referenceLayerId) {
        return null;
      }

      const layer = layers.find((candidate) => candidate.id === referenceLayerId);
      if (!layer || !layer.framebuffer) {
        return null;
      }

      const width = layer.framebuffer.width;
      const height = layer.framebuffer.height;
      if (width <= 0 || height <= 0) {
        return null;
      }

      const clampedX = Math.max(0, Math.min(width - 1, Math.floor(x)));
      const clampedY = Math.max(0, Math.min(height - 1, Math.floor(y)));

      if (layer.imageData && layer.imageData.width === width && layer.imageData.height === height) {
        const baseIndex = (clampedY * layer.imageData.width + clampedX) * 4;
        const data = layer.imageData.data;
        const alpha = data[baseIndex + 3];
        if (alpha === 0) {
          return null;
        }
        return rgbToHex(data[baseIndex], data[baseIndex + 1], data[baseIndex + 2]);
      }

      const ctx = layer.framebuffer.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
      if (!ctx) {
        return null;
      }

      const sample = ctx.getImageData(clampedX, clampedY, 1, 1).data;
      if (sample[3] === 0) {
        return null;
      }
      return rgbToHex(sample[0], sample[1], sample[2]);
    },
    [layers, referenceLayerId]
  );

  const sampleColorAtPosition = useCallback(
    (x: number, y: number): string => {
      const comp = compositeCanvasRef.current;
      if (!comp) return '#000000';

      const clampedX = Math.max(0, Math.min(comp.width - 1, Math.floor(x)));
      const clampedY = Math.max(0, Math.min(comp.height - 1, Math.floor(y)));

      const last = lastSampleRef.current;
      const cacheLayerId = preferReferenceSampling && referenceLayerId ? referenceLayerId : null;
      if (
        last.x === clampedX &&
        last.y === clampedY &&
        last.layerId === cacheLayerId &&
        last.preferReference === preferReferenceSampling
      ) {
        return last.color;
      }

      if (preferReferenceSampling && referenceLayerId) {
        const referenceColor = sampleColorFromReferenceLayer(clampedX, clampedY);
        if (referenceColor) {
          lastSampleRef.current = { x: clampedX, y: clampedY, color: referenceColor, layerId: cacheLayerId, preferReference: preferReferenceSampling };
          return referenceColor;
        }
      }

      const color = sampleCompositeOpaque(clampedX, clampedY, { radius: 1, preferSolid: true });
      lastSampleRef.current = { x: clampedX, y: clampedY, color, layerId: cacheLayerId, preferReference: preferReferenceSampling };
      return color;
    },
    [compositeCanvasRef, lastSampleRef, preferReferenceSampling, referenceLayerId, sampleColorFromReferenceLayer, sampleCompositeOpaque]
  );

  const sampleColorsAlongLine = useCallback(
    (startX: number, startY: number, endX: number, endY: number, numSamples: number): string[] => {
      if (numSamples <= 0) return [];
      if (numSamples === 1) return [sampleColorAtPosition(startX, startY)];

      const colors: string[] = [];
      for (let i = 0; i < numSamples; i += 1) {
        const t = i / (numSamples - 1);
        const x = startX + (endX - startX) * t;
        const y = startY + (endY - startY) * t;
        colors.push(sampleColorAtPosition(x, y));
      }
      return colors;
    },
    [sampleColorAtPosition]
  );

  return {
    sampleCompositeOpaque,
    sampleColorFromReferenceLayer,
    sampleColorAtPosition,
    sampleColorsAlongLine,
  };
};
