import type React from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { resolveLayerSamplingCanvas } from '@/components/canvas/resolveColorCyclePresentation';
import { mapProjectPointToReferencePixel } from '@/referenceStudio/referenceAssets';
import type { Layer, ReferenceAsset, ReferenceSamplingSource } from '@/types';

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
  referenceAssets?: ReferenceAsset[];
  referenceSamplingSource?: ReferenceSamplingSource;
}

const rgbToHex = (r: number, g: number, b: number): string => {
  const toHex = (value: number) => value.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

type SamplingCanvas = HTMLCanvasElement | OffscreenCanvas;

const readCanvasPixel = (
  source: SamplingCanvas,
  x: number,
  y: number,
  scratchRef: React.MutableRefObject<HTMLCanvasElement | null>,
): Uint8ClampedArray | null => {
  const sourceContext = source.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings,
  ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (sourceContext) {
    return sourceContext.getImageData(x, y, 1, 1).data;
  }
  if (typeof document === 'undefined') {
    return null;
  }

  const scratch = scratchRef.current ?? document.createElement('canvas');
  scratchRef.current = scratch;
  if (scratch.width !== 1 || scratch.height !== 1) {
    scratch.width = 1;
    scratch.height = 1;
  }
  const scratchContext = scratch.getContext('2d', { willReadFrequently: true });
  if (!scratchContext) {
    return null;
  }
  scratchContext.clearRect(0, 0, 1, 1);
  try {
    scratchContext.drawImage(source as CanvasImageSource, x, y, 1, 1, 0, 0, 1, 1);
  } catch {
    return null;
  }
  return scratchContext.getImageData(0, 0, 1, 1).data;
};

export const useDrawingCanvasSampling = ({
  compositeCanvasRef,
  lastSampleRef,
  layers,
  referenceLayerId,
  preferReferenceSampling,
  referenceAssets = [],
  referenceSamplingSource,
}: UseDrawingCanvasSamplingOptions) => {
  const referenceSampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const referenceAssetCanvasCacheRef = useRef(new Map<string, {
    dataUrl: string;
    naturalWidth: number;
    naturalHeight: number;
    canvas: HTMLCanvasElement;
  }>());
  const effectiveSamplingSource = useMemo<ReferenceSamplingSource>(() => {
    if (referenceSamplingSource) return referenceSamplingSource;
    if (preferReferenceSampling && referenceLayerId) {
      return { kind: 'layer', layerId: referenceLayerId };
    }
    return { kind: 'canvas' };
  }, [preferReferenceSampling, referenceLayerId, referenceSamplingSource]);
  const effectiveReferenceLayerId = effectiveSamplingSource.kind === 'layer'
    ? effectiveSamplingSource.layerId
    : null;

  useEffect(() => {
    if (typeof Image === 'undefined' || typeof document === 'undefined') return;
    const validIds = new Set(referenceAssets.map((asset) => asset.id));
    referenceAssetCanvasCacheRef.current.forEach((_entry, assetId) => {
      if (!validIds.has(assetId)) referenceAssetCanvasCacheRef.current.delete(assetId);
    });

    let cancelled = false;
    referenceAssets.forEach((asset) => {
      const cached = referenceAssetCanvasCacheRef.current.get(asset.id);
      if (
        cached?.dataUrl === asset.dataUrl
        && cached.naturalWidth === asset.naturalWidth
        && cached.naturalHeight === asset.naturalHeight
      ) {
        return;
      }
      referenceAssetCanvasCacheRef.current.delete(asset.id);
      const image = new Image();
      image.onload = () => {
        if (cancelled) return;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, asset.naturalWidth);
        canvas.height = Math.max(1, asset.naturalHeight);
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        referenceAssetCanvasCacheRef.current.set(asset.id, {
          dataUrl: asset.dataUrl,
          naturalWidth: asset.naturalWidth,
          naturalHeight: asset.naturalHeight,
          canvas,
        });
      };
      image.src = asset.dataUrl;
    });
    return () => {
      cancelled = true;
    };
  }, [referenceAssets]);

  const hasDynamicSamplingSource = useMemo(() => {
    const referenceLayer = effectiveReferenceLayerId
      ? layers.find((layer) => layer.id === effectiveReferenceLayerId)
      : null;
    return (
      effectiveSamplingSource.kind === 'asset' ||
      (effectiveSamplingSource.kind === 'layer' && Boolean(referenceLayer)) ||
      layers.some((layer) => layer.visible && layer.layerType === 'color-cycle')
    );
  }, [effectiveReferenceLayerId, effectiveSamplingSource.kind, layers]);

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

          if (preferSolid && alpha > 0 && alpha > solidAlpha) {
            solidAlpha = alpha;
            solidR = r;
            solidG = g;
            solidB = b;
          }

          if (alpha > 0) {
            accR += r;
            accG += g;
            accB += b;
            samples += 1;
          }
        }
      }

      const toHex = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');

      if (preferSolid && solidAlpha > 0) {
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
      if (!effectiveReferenceLayerId) {
        return null;
      }

      const layer = layers.find((candidate) => candidate.id === effectiveReferenceLayerId);
      const samplingCanvas = resolveLayerSamplingCanvas(layer);
      if (!samplingCanvas) {
        return null;
      }

      const width = samplingCanvas.width;
      const height = samplingCanvas.height;
      if (width <= 0 || height <= 0) {
        return null;
      }

      const clampedX = Math.max(0, Math.min(width - 1, Math.floor(x)));
      const clampedY = Math.max(0, Math.min(height - 1, Math.floor(y)));

      const sample = readCanvasPixel(
        samplingCanvas,
        clampedX,
        clampedY,
        referenceSampleCanvasRef,
      );
      if (!sample) {
        return null;
      }
      if (sample[3] === 0) {
        return null;
      }
      return rgbToHex(sample[0], sample[1], sample[2]);
    },
    [effectiveReferenceLayerId, layers]
  );

  const sampleColorFromReferenceAsset = useCallback(
    (assetId: string, x: number, y: number): string | null => {
      const asset = referenceAssets.find((candidate) => candidate.id === assetId);
      const cached = referenceAssetCanvasCacheRef.current.get(assetId);
      if (!asset || !cached) return null;
      const point = mapProjectPointToReferencePixel(asset, x, y);
      if (!point) return null;
      const sample = readCanvasPixel(
        cached.canvas,
        point.x,
        point.y,
        referenceSampleCanvasRef,
      );
      if (!sample || sample[3] === 0) return null;
      return rgbToHex(sample[0], sample[1], sample[2]);
    },
    [referenceAssets],
  );

  const sampleColorAtPosition = useCallback(
    (x: number, y: number): string => {
      const comp = compositeCanvasRef.current;
      if (!comp) return '#000000';

      const clampedX = Math.max(0, Math.min(comp.width - 1, Math.floor(x)));
      const clampedY = Math.max(0, Math.min(comp.height - 1, Math.floor(y)));

      const last = lastSampleRef.current;
      const cacheLayerId = effectiveSamplingSource.kind === 'layer'
        ? effectiveSamplingSource.layerId
        : effectiveSamplingSource.kind === 'asset'
          ? effectiveSamplingSource.assetId
          : null;
      const prefersReference = effectiveSamplingSource.kind !== 'canvas';
      if (
        !hasDynamicSamplingSource &&
        last.x === clampedX &&
        last.y === clampedY &&
        last.layerId === cacheLayerId &&
        last.preferReference === prefersReference
      ) {
        return last.color;
      }

      if (effectiveSamplingSource.kind === 'layer') {
        const referenceColor = sampleColorFromReferenceLayer(clampedX, clampedY);
        if (referenceColor) {
          lastSampleRef.current = { x: clampedX, y: clampedY, color: referenceColor, layerId: cacheLayerId, preferReference: true };
          return referenceColor;
        }
      } else if (effectiveSamplingSource.kind === 'asset') {
        const referenceColor = sampleColorFromReferenceAsset(
          effectiveSamplingSource.assetId,
          clampedX,
          clampedY,
        );
        if (referenceColor) {
          lastSampleRef.current = { x: clampedX, y: clampedY, color: referenceColor, layerId: cacheLayerId, preferReference: true };
          return referenceColor;
        }
      }

      const color = sampleCompositeOpaque(clampedX, clampedY, { radius: 1, preferSolid: true });
      lastSampleRef.current = { x: clampedX, y: clampedY, color, layerId: cacheLayerId, preferReference: prefersReference };
      return color;
    },
    [
      compositeCanvasRef,
      effectiveSamplingSource,
      hasDynamicSamplingSource,
      lastSampleRef,
      sampleColorFromReferenceAsset,
      sampleColorFromReferenceLayer,
      sampleCompositeOpaque,
    ]
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
    sampleColorFromReferenceAsset,
    sampleColorAtPosition,
    sampleColorsAlongLine,
  };
};
