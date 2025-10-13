import type { Project, Rectangle } from '@/types';
import type { NormalizedCropRect } from './types';

const clampValue = (value: number, min: number, max: number): number => {
  if (Number.isNaN(value)) {
    return min;
  }
  if (min > max) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
};

export function normalizeCropRect(
  rect: Rectangle | null | undefined,
  project: Project | null | undefined
): NormalizedCropRect | null {
  if (!rect || !project) {
    return null;
  }

  const normalized: NormalizedCropRect = {
    x: clampValue(Math.floor(rect.x), 0, Math.max(0, project.width - 1)),
    y: clampValue(Math.floor(rect.y), 0, Math.max(0, project.height - 1)),
    width: clampValue(Math.floor(rect.width), 1, project.width),
    height: clampValue(Math.floor(rect.height), 1, project.height)
  };

  normalized.width = clampValue(
    normalized.width,
    1,
    Math.max(1, project.width - normalized.x)
  );
  normalized.height = clampValue(
    normalized.height,
    1,
    Math.max(1, project.height - normalized.y)
  );

  if (normalized.width <= 0 || normalized.height <= 0) {
    return null;
  }

  return normalized;
}
