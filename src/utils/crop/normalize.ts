import type { Project, Rectangle } from '@/types';
import type { NormalizedCropRect } from './types';

export function normalizeCropRect(
  rect: Rectangle | null | undefined,
  project: Project | null | undefined
): NormalizedCropRect | null {
  if (!rect || !project) {
    return null;
  }

  const sanitize = (value: number, fallback: number): number => {
    if (!Number.isFinite(value)) {
      return fallback;
    }
    return Math.floor(value);
  };

  const normalized: NormalizedCropRect = {
    x: sanitize(rect.x, 0),
    y: sanitize(rect.y, 0),
    width: Math.max(1, sanitize(rect.width, project.width)),
    height: Math.max(1, sanitize(rect.height, project.height))
  };

  if (normalized.width <= 0 || normalized.height <= 0) {
    return null;
  }

  return normalized;
}
