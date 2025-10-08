import type { ViewTransform } from './ShapeAdjustHelper';

export interface ShapeFillViewTargets {
  overlayCanvas: HTMLCanvasElement | null;
  finalCanvas: HTMLCanvasElement | null;
  viewTransform?: ViewTransform;
  devicePixelRatio: number;
}

const defaultTargets: ShapeFillViewTargets = {
  overlayCanvas: null,
  finalCanvas: null,
  devicePixelRatio: 1,
  viewTransform: undefined,
};

let currentTargets: ShapeFillViewTargets = { ...defaultTargets };

const cloneViewTransform = (transform?: ViewTransform): ViewTransform | undefined => {
  if (!transform) {
    return undefined;
  }
  return {
    scale: transform.scale,
    offsetX: transform.offsetX,
    offsetY: transform.offsetY,
  };
};

export const setShapeFillViewTargets = (targets: Partial<ShapeFillViewTargets>): void => {
  const next: ShapeFillViewTargets = {
    overlayCanvas: targets.overlayCanvas ?? currentTargets.overlayCanvas ?? null,
    finalCanvas: targets.finalCanvas ?? currentTargets.finalCanvas ?? null,
    devicePixelRatio: targets.devicePixelRatio ?? currentTargets.devicePixelRatio ?? 1,
    viewTransform: cloneViewTransform(targets.viewTransform ?? currentTargets.viewTransform),
  };
  currentTargets = next;
};

export const resetShapeFillViewTargets = (): void => {
  currentTargets = { ...defaultTargets };
};

export const getShapeFillViewTargets = (): ShapeFillViewTargets => ({
  overlayCanvas: currentTargets.overlayCanvas,
  finalCanvas: currentTargets.finalCanvas,
  devicePixelRatio: currentTargets.devicePixelRatio,
  viewTransform: cloneViewTransform(currentTargets.viewTransform),
});
