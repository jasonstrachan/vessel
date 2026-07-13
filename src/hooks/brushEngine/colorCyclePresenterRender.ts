import { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import {
  assertDerivedSurfaceFreshForRender,
  type ColorCycleLayerDocumentRead,
  type DerivedSurface,
} from '@/lib/colorCycle/document';
import { canvasPool } from '@/utils/canvasPool';

type ColorCyclePresenterSurface = DerivedSurface & {
  forceRender?: () => boolean | void;
  hasPendingDerivedSurfaceRebuild?: () => boolean;
};

export class ColorCyclePresenterRebuildScheduler {
  isCurrentForPresentation(
    layerId: string,
    surface: ColorCyclePresenterSurface,
    documentRead: ColorCycleLayerDocumentRead | undefined,
    label: string,
  ): boolean {
    if (!documentRead) {
      return true;
    }
    return assertDerivedSurfaceFreshForRender({
      document: documentRead,
      surface,
      label: `${label}:${layerId}`,
      hasScheduledRebuild: surface.hasPendingDerivedSurfaceRebuild?.() ?? false,
    });
  }

  assertFreshForRender(
    layerId: string,
    surface: ColorCyclePresenterSurface,
    documentRead: ColorCycleLayerDocumentRead | undefined,
    label: string,
  ): void {
    if (!documentRead) {
      return;
    }

    const isFresh = assertDerivedSurfaceFreshForRender({
      document: documentRead,
      surface,
      label: `${label}:${layerId}`,
      hasScheduledRebuild: surface.hasPendingDerivedSurfaceRebuild?.() ?? false,
    });
    if (isFresh) {
      return;
    }

    surface.rebuild(documentRead.snapshot, documentRead.version);
    const isRebuiltFresh = assertDerivedSurfaceFreshForRender({
      document: documentRead,
      surface,
      label: `${label}:${layerId}:rebuilt`,
      hasScheduledRebuild: false,
    });
    if (!isRebuiltFresh) {
      throw new Error(
        `Color-cycle derived surface is stale for layer ${layerId}: expected version ${documentRead.version}, received ${surface.builtFromVersion ?? 'null'}`,
      );
    }
  }

  forceRender(surface: ColorCyclePresenterSurface): void {
    if (surface.forceRender?.() === false) {
      throw new Error('Color-cycle derived surface render failed');
    }
  }
}

export const renderColorCycleAnimatorToContext = (
  animator: ColorCycleAnimator,
  ctx: CanvasRenderingContext2D,
  targetCanvas: HTMLCanvasElement,
): void => {
  const { width, height } = animator.getDimensions();
  if (width <= 0 || height <= 0) {
    return;
  }
  if (width === targetCanvas.width && height === targetCanvas.height) {
    animator.renderToCanvas2D(ctx);
    return;
  }

  const tempCanvas = canvasPool.acquire(width, height);
  const tempCtx = tempCanvas.getContext('2d', {
    willReadFrequently: true,
    alpha: true,
  }) as CanvasRenderingContext2D | null;
  if (!tempCtx) {
    canvasPool.release(tempCanvas);
    return;
  }
  tempCtx.clearRect(0, 0, width, height);
  animator.renderToCanvas2D(tempCtx);
  ctx.drawImage(tempCanvas, 0, 0, width, height, 0, 0, targetCanvas.width, targetCanvas.height);
  canvasPool.release(tempCanvas);
};
