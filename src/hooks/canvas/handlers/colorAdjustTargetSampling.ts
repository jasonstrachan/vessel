import { getAppStoreState } from '@/stores/appStoreAccess';
import type { ShapePoint } from '@/types';

export const sampleColorAdjustTarget = (
  point: ShapePoint | null,
  compositeCanvas: HTMLCanvasElement | null,
): void => {
  const state = getAppStoreState();
  if (!state.colorAdjust.active || !state.colorAdjust.isPickingTarget || !point || !state.project || !compositeCanvas) return;
  if (point.x < 0 || point.y < 0 || point.x >= state.project.width || point.y >= state.project.height) return;

  // Target the exact canvas pixel, independently of brush reference sampling and its cache.
  // Recompose because starting a pick restores originals before the next display frame.
  if (!state.compositeLayersToCanvasSync(compositeCanvas)) return;
  const context = compositeCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  const [r, g, b, alpha] = context.getImageData(Math.floor(point.x), Math.floor(point.y), 1, 1).data;
  if (alpha === 0) return;
  state.pickColorAdjustTarget(`rgba(${r}, ${g}, ${b}, ${alpha / 255})`);
};
