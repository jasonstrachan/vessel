import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import { NON_ACTIVE_COLOR_CYCLE_FPS } from '@/constants/colorCycle';

export type ColorCycleBrush = ColorCycleBrushImplementation;
const NON_ACTIVE_COLOR_CYCLE_FRAME_MS = 1000 / NON_ACTIVE_COLOR_CYCLE_FPS;
const nonActiveLayerAnimationUpdateAt = new Map<string, number>();

const shouldAdvanceColorCycleAnimation = (
  layerId: string,
  isActiveLayer: boolean,
  isAnimating: boolean,
  now: number
): boolean => {
  if (!isAnimating) {
    nonActiveLayerAnimationUpdateAt.delete(layerId);
    return false;
  }

  if (isActiveLayer) {
    nonActiveLayerAnimationUpdateAt.set(layerId, now);
    return true;
  }

  const lastUpdateAt = nonActiveLayerAnimationUpdateAt.get(layerId);
  if (lastUpdateAt === undefined || now - lastUpdateAt >= NON_ACTIVE_COLOR_CYCLE_FRAME_MS) {
    nonActiveLayerAnimationUpdateAt.set(layerId, now);
    return true;
  }
  return false;
};

export type ColorCycleRenderDeps = {
  storeRef: React.MutableRefObject<AppState>;
  maskManager: { applyMaskToCanvas: (layerId: string, ctx: CanvasRenderingContext2D) => void };
  renderAllCCLogTSRef: React.MutableRefObject<number>;
  ccLog: (label: string, payload?: Record<string, unknown>) => void;
  getColorCycleBrushManager: () => { getBrush: (layerId: string) => ColorCycleBrush | null | undefined };
  refreshLayerCCSurface: (brush: ColorCycleBrush, layerId: string, state: AppState) => HTMLCanvasElement | null;
  bindBrushToCanvas: (brush: ColorCycleBrush | null | undefined, canvas: HTMLCanvasElement | null | undefined) => void;
};

export const renderAllColorCycleLayers = (
  deps: ColorCycleRenderDeps,
  targetCtx?: CanvasRenderingContext2D,
  onlyActiveLayer: boolean = false
): boolean => {
  const { storeRef, maskManager, renderAllCCLogTSRef, ccLog } = deps;
  const currentState = storeRef.current;
  let hasRendered = false;

  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - renderAllCCLogTSRef.current > 1000) {
    const ccLayersSnapshot = currentState.layers.filter(layer => layer.layerType === 'color-cycle');
    const animatingCount = ccLayersSnapshot.filter(layer => layer.colorCycleData?.isAnimating).length;
    ccLog('renderAllCC', {
      onlyActiveLayer,
      ccLayers: ccLayersSnapshot.length,
      animating: animatingCount
    });
    renderAllCCLogTSRef.current = now;
  }

  currentState.layers.forEach(layer => {
    if (onlyActiveLayer && layer.id !== currentState.activeLayerId) {
      return;
    }
    if (layer.visible && layer.layerType === 'color-cycle' && layer.colorCycleData?.canvas) {
      const colorCycleBrushManager = deps.getColorCycleBrushManager();
      const colorCycleBrush = colorCycleBrushManager.getBrush(layer.id);
      if (!colorCycleBrush) return;

      const liveCanvas = deps.refreshLayerCCSurface(colorCycleBrush, layer.id, currentState);
      if (!liveCanvas) {
        return;
      }

      const isActiveLayer = layer.id === currentState.activeLayerId;
      if (shouldAdvanceColorCycleAnimation(layer.id, isActiveLayer, Boolean(layer.colorCycleData.isAnimating), now)) {
        colorCycleBrush.updateAnimation?.();
      }

      if (liveCanvas.isConnected) {
        deps.bindBrushToCanvas(colorCycleBrush, liveCanvas);
      }
      colorCycleBrush.renderDirectToCanvas?.(liveCanvas, layer.id);
      const maskCtx = liveCanvas.getContext('2d', { willReadFrequently: true });
      if (maskCtx) {
        maskManager.applyMaskToCanvas(layer.id, maskCtx);
      }
      hasRendered = true;

      if (
        targetCtx &&
        (layer.id === currentState.activeLayerId || !onlyActiveLayer)
      ) {
        targetCtx.globalAlpha = layer.opacity;
        targetCtx.globalCompositeOperation = layer.blendMode || 'source-over';
        targetCtx.drawImage(liveCanvas, 0, 0);
        hasRendered = true;
      }
    }
  });

  return hasRendered;
};

export type DeferredOverlayDeps = {
  deferredOverlayRenderHandleRef: React.MutableRefObject<number | null>;
  deferredOverlayRenderKindRef: React.MutableRefObject<'idle' | 'timeout' | null>;
  renderAllColorCycleLayers: (targetCtx?: CanvasRenderingContext2D, onlyActiveLayer?: boolean) => boolean;
  cancelDeferredOverlayRender: () => void;
  dispatchFrameUpdate?: () => void;
};

export const cancelDeferredOverlayRender = ({
  deferredOverlayRenderHandleRef,
  deferredOverlayRenderKindRef,
}: {
  deferredOverlayRenderHandleRef: React.MutableRefObject<number | null>;
  deferredOverlayRenderKindRef: React.MutableRefObject<'idle' | 'timeout' | null>;
}): void => {
  if (deferredOverlayRenderHandleRef.current === null) {
    return;
  }
  if (
    typeof window !== 'undefined' &&
    deferredOverlayRenderKindRef.current === 'idle' &&
    'cancelIdleCallback' in window
  ) {
    (window as Window & { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback?.(
      deferredOverlayRenderHandleRef.current
    );
  } else {
    clearTimeout(deferredOverlayRenderHandleRef.current);
  }
  deferredOverlayRenderHandleRef.current = null;
  deferredOverlayRenderKindRef.current = null;
};

export const scheduleDeferredOverlayRender = ({
  deferredOverlayRenderHandleRef,
  deferredOverlayRenderKindRef,
  renderAllColorCycleLayers,
  cancelDeferredOverlayRender: cancelDeferred,
  dispatchFrameUpdate,
}: DeferredOverlayDeps): void => {
  if (typeof window === 'undefined') {
    renderAllColorCycleLayers(undefined, false);
    return;
  }
  cancelDeferred();
  const idleWindow = window as Window & {
    requestIdleCallback?: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number;
  };
  const run = () => {
    if (typeof window === 'undefined') {
      return;
    }
    deferredOverlayRenderHandleRef.current = null;
    deferredOverlayRenderKindRef.current = null;
    renderAllColorCycleLayers(undefined, false);
    dispatchFrameUpdate?.();
  };
  if (typeof idleWindow.requestIdleCallback === 'function') {
    deferredOverlayRenderKindRef.current = 'idle';
    deferredOverlayRenderHandleRef.current = idleWindow.requestIdleCallback(
      () => run(),
      { timeout: 250 }
    );
    return;
  }
  deferredOverlayRenderKindRef.current = 'timeout';
  deferredOverlayRenderHandleRef.current = window.setTimeout(run, 50);
};
