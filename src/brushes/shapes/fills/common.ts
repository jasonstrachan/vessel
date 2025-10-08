import type { BrushSettings } from '@/types';

export const snapToPixel = (value: number): number => Math.floor(value) + 0.5;

const identity = (value: number): number => value;

export const resolveCoordinateSnap = (pixelMode?: boolean) => (
  pixelMode ? snapToPixel : identity
);

export const resolveShapeFillGpuParams = (brushSettings: BrushSettings) => {
  const hardening = Math.max(0, Math.min(1, brushSettings.shapeFillHardening ?? 1));
  const threshold = Math.max(0, Math.min(1, brushSettings.shapeFillHardeningThreshold ?? 0.5));
  const edgeFeather = Math.max(0.5, brushSettings.shapeFillEdgeFeather ?? 1);
  return {
    shapeFillHardening: hardening,
    shapeFillHardeningThreshold: threshold,
    shapeFillEdgeFeather: edgeFeather,
  };
};
