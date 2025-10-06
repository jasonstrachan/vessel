import type { BoundingBox } from './types';

export interface ContourParamInput {
  spacing?: number;
  spacingB?: number;
  variance?: number;
  smoothness?: number;
  maxDistance?: number;
  directionExtent?: number;
  resolution: { width: number; height: number };
  bounds: BoundingBox;
  fieldResolution?: number;
  previewScale?: number;
  minSpacing?: number;
}

export interface ResolvedContourParams {
  spacingA: number;
  spacingB: number;
  variance: number;
  smoothness: number;
  maxDistance: number;
  directionExtent: number;
  fieldResolution: number;
}

export const resolveContourParams = (input: ContourParamInput): ResolvedContourParams => {
  const minSpacing = Math.max(0.5, input.minSpacing ?? 4);
  const spacingBase = typeof input.spacing === 'number' ? input.spacing : 12;
  const spacingA = Math.max(minSpacing, Math.round(spacingBase));
  const spacingBRaw = typeof input.spacingB === 'number' ? input.spacingB : spacingA;
  const spacingB = Math.max(minSpacing, Math.round(spacingBRaw));

  const previewScale = Math.max(1e-3, input.previewScale ?? 1);

  const variance = Math.max(0, Math.min(1, input.variance ?? 0));
  const smoothnessBase = Math.max(0, Math.min(0.9, input.smoothness ?? 0.15));
  const smoothness = Math.min(0.9, smoothnessBase * previewScale);

  const boundsWidth = Math.max(1, input.bounds.maxX - input.bounds.minX);
  const boundsHeight = Math.max(1, input.bounds.maxY - input.bounds.minY);
  const fallbackDistance = Math.min(input.resolution.width, input.resolution.height, Math.max(boundsWidth, boundsHeight)) * 0.5;
  const rawMaxDistance = typeof input.maxDistance === 'number' ? input.maxDistance : fallbackDistance;
  const maxDistance = Math.max(minSpacing, rawMaxDistance * previewScale);

  const baseDirectionExtent = typeof input.directionExtent === 'number'
    ? input.directionExtent
    : Math.max(boundsWidth, boundsHeight);
  const directionExtent = Math.max(1e-3, baseDirectionExtent * previewScale);

  const fieldResolution = Math.max(0.5, input.fieldResolution ?? 2);

  return {
    spacingA,
    spacingB,
    variance,
    smoothness,
    maxDistance,
    directionExtent,
    fieldResolution,
  };
};

