import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { ColorCycleRuntimeBrush } from '@/lib/colorCycle/document';
import { NON_ACTIVE_COLOR_CYCLE_FPS } from '@/constants/colorCycle';
import { recordRuntimeIncident } from '@/utils/runtimeIncidentJournal';

export type ColorCycleBrush = ColorCycleRuntimeBrush & {
  updateAnimation?: () => void;
  setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
};
const NON_ACTIVE_COLOR_CYCLE_FRAME_MS = 1000 / NON_ACTIVE_COLOR_CYCLE_FPS;
const nonActiveLayerAnimationUpdateAt = new Map<string, number>();
const lastRenderedLayerVersionById = new Map<string, number>();
const lastBoundCanvasByLayerId = new Map<string, HTMLCanvasElement>();
const cached2DContextByCanvas = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D | null>();
const activePresentationFailures = new Set<string>();

const presentationFailureKey = (layerId: string, stage: 'advance' | 'present'): string => (
  `${layerId}:${stage}`
);

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
  getColorCycleBrushManager: () => { getSurfaceBrush: (layerId: string) => ColorCycleBrush | null | undefined };
  refreshLayerCCSurface: (brush: ColorCycleBrush, layerId: string, state: AppState) => HTMLCanvasElement | null;
  bindBrushToCanvas: (brush: ColorCycleBrush | null | undefined, canvas: HTMLCanvasElement | null | undefined) => void;
};

const recordLayerPresentationFailure = ({
  layerId,
  layerVersion,
  activeLayerId,
  isAnimating,
  stage,
  error,
  ccLog,
}: {
  layerId: string;
  layerVersion: number;
  activeLayerId: string | null;
  isAnimating: boolean;
  stage: 'advance' | 'present';
  error: unknown;
  ccLog: ColorCycleRenderDeps['ccLog'];
}): void => {
  const message = error instanceof Error ? error.message : String(error);
  const failureKey = presentationFailureKey(layerId, stage);
  if (activePresentationFailures.has(failureKey)) {
    return;
  }
  activePresentationFailures.add(failureKey);
  recordRuntimeIncident({
    scope: 'cc-render',
    event: 'layer-presentation-failed',
    severity: 'error',
    data: {
      layerId,
      layerVersion,
      activeLayerId,
      isAnimating,
      stage,
      message,
    },
  });
  ccLog('CC layer presentation failed; preserved previous frame', {
    layerId,
    layerVersion,
    stage,
  });
};

const recordLayerPresentationRecovery = ({
  layerId,
  layerVersion,
  stage,
  ccLog,
}: {
  layerId: string;
  layerVersion: number;
  stage: 'advance' | 'present';
  ccLog: ColorCycleRenderDeps['ccLog'];
}): void => {
  const failureKey = presentationFailureKey(layerId, stage);
  if (!activePresentationFailures.delete(failureKey)) {
    return;
  }
  recordRuntimeIncident({
    scope: 'cc-render',
    event: 'layer-presentation-recovered',
    severity: 'warning',
    data: { layerId, layerVersion, stage },
  });
  ccLog('CC layer presentation recovered', { layerId, layerVersion, stage });
};

export const renderAllColorCycleLayers = (
  deps: ColorCycleRenderDeps,
  targetCtx?: CanvasRenderingContext2D,
  onlyActiveLayer: boolean = false
): boolean => {
  const { storeRef, renderAllCCLogTSRef, ccLog } = deps;
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

  const colorCycleBrushManager = deps.getColorCycleBrushManager();

  currentState.layers.forEach(layer => {
    if (onlyActiveLayer && layer.id !== currentState.activeLayerId) {
      return;
    }
    if (layer.visible && layer.layerType === 'color-cycle' && layer.colorCycleData?.canvas) {
      const colorCycleBrush = colorCycleBrushManager.getSurfaceBrush(layer.id);
      if (!colorCycleBrush) return;

      const liveCanvas = deps.refreshLayerCCSurface(colorCycleBrush, layer.id, currentState);
      if (!liveCanvas) {
        return;
      }

      const isActiveLayer = layer.id === currentState.activeLayerId;
      const isAnimating = Boolean(layer.colorCycleData.isAnimating);
      const shouldAdvanceAnimation = shouldAdvanceColorCycleAnimation(
        layer.id,
        isActiveLayer,
        isAnimating,
        now
      );
      let didAdvanceFail = false;
      if (shouldAdvanceAnimation) {
        try {
          colorCycleBrush.updateAnimation?.();
          recordLayerPresentationRecovery({
            layerId: layer.id,
            layerVersion: layer.version ?? 0,
            stage: 'advance',
            ccLog,
          });
        } catch (error) {
          recordLayerPresentationFailure({
            layerId: layer.id,
            layerVersion: layer.version ?? 0,
            activeLayerId: currentState.activeLayerId ?? null,
            isAnimating,
            stage: 'advance',
            error,
            ccLog,
          });
          didAdvanceFail = true;
        }
      }

      if (liveCanvas.isConnected && lastBoundCanvasByLayerId.get(layer.id) !== liveCanvas) {
        deps.bindBrushToCanvas(colorCycleBrush, liveCanvas);
        lastBoundCanvasByLayerId.set(layer.id, liveCanvas);
      }
      const layerVersion = layer.version ?? 0;
      const didLayerVersionChange = lastRenderedLayerVersionById.get(layer.id) !== layerVersion;
      const shouldRenderFrame =
        !didAdvanceFail && (
          shouldAdvanceAnimation ||
          didLayerVersionChange ||
          !lastRenderedLayerVersionById.has(layer.id)
        );

      if (shouldRenderFrame) {
        try {
          colorCycleBrush.renderDirectToCanvas?.(liveCanvas, layer.id);
          if (!cached2DContextByCanvas.has(liveCanvas)) {
            cached2DContextByCanvas.set(liveCanvas, liveCanvas.getContext('2d'));
          }
          lastRenderedLayerVersionById.set(layer.id, layerVersion);
          recordLayerPresentationRecovery({
            layerId: layer.id,
            layerVersion,
            stage: 'present',
            ccLog,
          });
        } catch (error) {
          recordLayerPresentationFailure({
            layerId: layer.id,
            layerVersion,
            activeLayerId: currentState.activeLayerId ?? null,
            isAnimating,
            stage: 'present',
            error,
            ccLog,
          });
        }
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
