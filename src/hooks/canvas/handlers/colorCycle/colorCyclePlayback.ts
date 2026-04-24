import type React from 'react';
import type { BrushEngine } from '@/hooks/useBrushEngineSimplified';
import {
  getSharedAnimationRuntime,
} from '@/hooks/canvas/handlers/animation/animationRuntime';
import type { AppState, CCReason } from '@/stores/useAppStore';
import { selectEffectiveColorCyclePlaying } from '@/stores/useAppStore';
import { BrushShape, type Layer } from '@/types';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';

const lastSyntheticStopAtMap = new Map<string, number>();
const colorCycleRuntimeConsumerByStoreRef = new WeakMap<
  React.MutableRefObject<AppState>,
  () => void
>();
const SHARED_RUNTIME_HANDLE_SENTINEL = -1;
const isPanStoreSyncTransition = (
  reason: string,
  storeRef: React.MutableRefObject<AppState>
): boolean => {
  if (reason !== 'store-sync') {
    return false;
  }
  return storeRef.current.colorCyclePlayback?.lastReason === 'pan';
};

const hasSharedColorCycleRuntimeConsumer = (
  storeRef: React.MutableRefObject<AppState>
): boolean => colorCycleRuntimeConsumerByStoreRef.has(storeRef);

const summarizeColorCycleLayers = (storeRef: React.MutableRefObject<AppState>) => {
  try {
    return storeRef.current.layers
      .filter((layer) => layer.layerType === 'color-cycle')
      .map((layer) => ({
        id: layer.id.slice(-6),
        isAnimating: !!layer.colorCycleData?.isAnimating,
        mode: layer.colorCycleData?.mode ?? 'unknown',
      }));
  } catch {
    return [];
  }
};

const summarizePlaybackState = (storeRef: React.MutableRefObject<AppState>) => {
  try {
    return {
      desiredPlaying: storeRef.current.colorCyclePlayback.desiredPlaying,
      suspendDepth: storeRef.current.colorCyclePlayback.suspendDepth,
      lastReason: storeRef.current.colorCyclePlayback.lastReason ?? null,
      effectivePlaying: selectEffectiveColorCyclePlaying(storeRef.current),
    };
  } catch {
    return null;
  }
};

const setSharedColorCycleRuntimeConsumer = (
  storeRef: React.MutableRefObject<AppState>,
  unregister: () => void
): void => {
  const existing = colorCycleRuntimeConsumerByStoreRef.get(storeRef);
  if (existing) {
    existing();
  }
  colorCycleRuntimeConsumerByStoreRef.set(storeRef, unregister);
};

export const clearSharedColorCycleRuntimeConsumer = (
  storeRef: React.MutableRefObject<AppState>
): void => {
  const unregister = colorCycleRuntimeConsumerByStoreRef.get(storeRef);
  if (!unregister) {
    return;
  }
  unregister();
  colorCycleRuntimeConsumerByStoreRef.delete(storeRef);
};

export type StopPlaybackDeps = {
  cancelDeferredOverlayRender: () => void;
  storeRef: React.MutableRefObject<AppState>;
  ccLog: (label: string, payload?: Record<string, unknown>) => void;
  ccGroup: (label: string, payload?: Record<string, unknown>) => void;
  ccGroupEnd: () => void;
  dumpLayerFlags: () => void;
  pauseAllBrushCCAnimationsNow: () => boolean;
  continuousColorCycleAnimationActiveRef: React.MutableRefObject<boolean>;
  continuousColorCycleAnimationRef: React.MutableRefObject<number | null>;
  colorCycleAnimationRef: React.MutableRefObject<number | null>;
  shouldResumeColorCycleAfterInteractionRef: React.MutableRefObject<boolean>;
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  lastStopAtRef: React.MutableRefObject<number>;
  stopCooldownMs: number;
  syntheticStopThrottleMs: number;
  syntheticStopReasons: Set<string>;
};

export const stopContinuousColorCycleAnimationCore = (
  reason: string,
  deps: StopPlaybackDeps
): void => {
  const {
    cancelDeferredOverlayRender,
    storeRef,
    ccLog,
    ccGroup,
    ccGroupEnd,
    dumpLayerFlags,
    pauseAllBrushCCAnimationsNow,
    continuousColorCycleAnimationActiveRef,
    continuousColorCycleAnimationRef,
    colorCycleAnimationRef,
    shouldResumeColorCycleAfterInteractionRef,
    drawingCtxRef,
    drawingCanvasRef,
    drawingCanvasHasContent,
    lastStopAtRef,
    stopCooldownMs,
    syntheticStopThrottleMs,
    syntheticStopReasons,
  } = deps;

  cancelDeferredOverlayRender();
  let isCCBrushActive = false;
  try {
    const st = storeRef.current;
    const brushShape = st.tools.brushSettings.brushShape;
    isCCBrushActive =
      brushShape === BrushShape.COLOR_CYCLE ||
      brushShape === BrushShape.COLOR_CYCLE_TRIANGLE ||
      brushShape === BrushShape.COLOR_CYCLE_SHAPE ||
      (brushShape === BrushShape.CUSTOM && !!st.tools.brushSettings.customBrushColorCycle);
  } catch {}

  if (syntheticStopReasons.has(reason)) {
    try {
      const st = storeRef.current;
      const shape = st.tools.brushSettings.brushShape;
      const isCCShape = shape === BrushShape.COLOR_CYCLE_SHAPE;
      if (isCCShape && (reason === 'shape-tool-start' || reason === 'shape-tool-drag')) {
        ccLog('skip synthetic stop for CC shape', { reason });
        return;
      }
    } catch {}

    const now =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    const last = lastSyntheticStopAtMap.get(reason) ?? 0;
    if (now - last < syntheticStopThrottleMs) {
      ccLog('skip synthetic stop (throttled)', { reason });
      return;
    }
    lastSyntheticStopAtMap.set(reason, now);

    ccLog('stopContinuousColorCycleAnimation synthetic stop', { reason });

    continuousColorCycleAnimationActiveRef.current = false;
    clearSharedColorCycleRuntimeConsumer(storeRef);
    continuousColorCycleAnimationRef.current = null;
    ccLog('cancel shared animation consumer (synthetic)', { reason });
    if (colorCycleAnimationRef.current) {
      cancelAnimationFrame(colorCycleAnimationRef.current);
      colorCycleAnimationRef.current = null;
      ccLog('cancel per-stroke RAF (synthetic)', { reason });
    }
    if (typeof window !== 'undefined') {
      window.__ccRafAlive = false;
    }

    const pausedAny = pauseAllBrushCCAnimationsNow();
    ccLog('pauseAllBrushCCAnimationsNow() (synthetic)', { pausedAny, reason });

    try {
      if (!shouldResumeColorCycleAfterInteractionRef.current) {
        const st = storeRef.current;
        const wasPlaying = selectEffectiveColorCyclePlaying(st);
        if (wasPlaying) {
          st.suspendColorCycle(reason as CCReason);
          shouldResumeColorCycleAfterInteractionRef.current = true;
          ccLog('suspendColorCycle (synthetic)', { reason });
        }
      }
    } catch {}

    try {
      if (drawingCtxRef.current && drawingCanvasRef.current) {
        drawingCtxRef.current.clearRect(
          0,
          0,
          drawingCanvasRef.current.width,
          drawingCanvasRef.current.height
        );
        ccLog('cleared overlay canvas (synthetic)', { reason });
      }
    } catch {}
    drawingCanvasHasContent.current = false;

    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
        ccLog('dispatched colorCycleFrameUpdate (synthetic)', { reason });
      }
    } catch {}

    return;
  }

  if (!isCCBrushActive && reason === 'unknown') {
    ccLog('stopContinuousColorCycleAnimation skipped (unknown reason, no CC brush)', { reason });
    return;
  }

  if (isPanStoreSyncTransition(reason, storeRef)) {
    continuousColorCycleAnimationActiveRef.current = false;
    clearSharedColorCycleRuntimeConsumer(storeRef);
    continuousColorCycleAnimationRef.current = null;
    if (typeof window !== 'undefined') {
      window.__ccRafAlive = false;
    }
    if (colorCycleAnimationRef.current) {
      cancelAnimationFrame(colorCycleAnimationRef.current);
      colorCycleAnimationRef.current = null;
    }
    drawingCanvasHasContent.current = false;
    ccLog('stopContinuousColorCycleAnimation lightweight suspend for pan', { reason });
    return;
  }

  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const bypassCooldown = reason === 'store-sync' || reason === 'toolbar';
  if (!bypassCooldown && now - lastStopAtRef.current < stopCooldownMs) {
    ccLog('stopContinuousColorCycleAnimation skipped (cooldown)', {
      reason,
      sinceLast: now - lastStopAtRef.current
    });
    return;
  }
  lastStopAtRef.current = now;

  ccGroup('stopContinuousColorCycleAnimation()', { reason });
  dumpLayerFlags();
  const pausedAny = pauseAllBrushCCAnimationsNow();
  ccLog('pauseAllBrushCCAnimationsNow()', { pausedAny, reason });

  const shouldAutoResume =
    reason === 'brush-stroke' ||
    reason === 'shape-preview' ||
    reason === 'history-apply' ||
    reason === 'visibility-hidden' ||
    reason === 'layer-switch';

  if (pausedAny && shouldAutoResume) {
    shouldResumeColorCycleAfterInteractionRef.current = true;
  }

  continuousColorCycleAnimationActiveRef.current = false;
  clearSharedColorCycleRuntimeConsumer(storeRef);
  continuousColorCycleAnimationRef.current = null;
  ccLog('cancel shared animation consumer', {
    reason,
    playback: summarizePlaybackState(storeRef),
    layers: summarizeColorCycleLayers(storeRef),
  });
  if (typeof window !== 'undefined') {
    window.__ccRafAlive = false;
  }
  if (colorCycleAnimationRef.current) {
    cancelAnimationFrame(colorCycleAnimationRef.current);
    colorCycleAnimationRef.current = null;
    ccLog('cancel per-stroke RAF', { reason });
  }

  try {
    const st = storeRef.current;
    st.layers.forEach(layer => {
      const shouldPause =
        layer.layerType === 'color-cycle' &&
        layer.colorCycleData?.mode !== 'recolor' &&
        layer.colorCycleData?.isAnimating;

      if (!shouldPause || !layer.colorCycleData) {
        return;
      }

      const updatedData: Layer['colorCycleData'] = {
        ...layer.colorCycleData,
        isAnimating: false,
      };

      st.updateLayer(layer.id, { colorCycleData: updatedData });
      ccLog('mark isAnimating=false', { id: layer.id.slice(-6), reason });
    });
  } catch {}

  try {
    if (drawingCtxRef.current && drawingCanvasRef.current) {
      drawingCtxRef.current.clearRect(
        0,
        0,
        drawingCanvasRef.current.width,
        drawingCanvasRef.current.height
      );
      ccLog('cleared overlay canvas', { reason });
    }
  } catch {}

  drawingCanvasHasContent.current = false;
  ccLog('drawingCanvasHasContent -> false', { reason });

  try {
    window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
    ccLog('dispatched colorCycleFrameUpdate', { reason });
  } catch {}
  ccGroupEnd();
};

export type StartPlaybackDeps = {
  brushEngine: BrushEngine;
  ensureOverlayInitialized: () => boolean;
  renderAllColorCycleLayers: (targetCtx?: CanvasRenderingContext2D, onlyActiveLayer?: boolean) => boolean;
  storeRef: React.MutableRefObject<AppState>;
  getEffectiveColorCyclePlaying: () => boolean;
  cancelDeferredOverlayRender: () => void;
  scheduleDeferredOverlayRender: () => void;
  ccLog: (label: string, payload?: Record<string, unknown>) => void;
  ccGroup: (label: string, payload?: Record<string, unknown>) => void;
  ccGroupEnd: () => void;
  dumpLayerFlags: () => void;
  debugWarn: (message: string, error?: unknown) => void;
  continuousColorCycleAnimationRef: React.MutableRefObject<number | null>;
  continuousColorCycleAnimationActiveRef: React.MutableRefObject<boolean>;
  startingColorCycleAnimationRef: React.MutableRefObject<boolean>;
  lastStartAtRef: React.MutableRefObject<number>;
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  firstPaintRef: React.MutableRefObject<boolean>;
  lastRendererLogTS: React.MutableRefObject<number>;
  startCooldownMs: number;
};

export const startContinuousColorCycleAnimationCore = (
  reason: string,
  deps: StartPlaybackDeps
): void => {
  const {
    brushEngine,
    ensureOverlayInitialized,
    renderAllColorCycleLayers,
    storeRef,
    getEffectiveColorCyclePlaying,
    cancelDeferredOverlayRender,
    scheduleDeferredOverlayRender,
    ccLog,
    ccGroup,
    ccGroupEnd,
    dumpLayerFlags,
    debugWarn,
    continuousColorCycleAnimationRef,
    continuousColorCycleAnimationActiveRef,
    startingColorCycleAnimationRef,
    lastStartAtRef,
    drawingCanvasRef,
    drawingCtxRef,
    drawingCanvasHasContent,
    firstPaintRef,
    lastRendererLogTS,
    startCooldownMs,
  } = deps;

  if (
    continuousColorCycleAnimationActiveRef.current &&
    !continuousColorCycleAnimationRef.current &&
    !hasSharedColorCycleRuntimeConsumer(storeRef)
  ) {
    ccLog('CC RAF stuck: activeRef=true but no RAF id -> resetting');
    continuousColorCycleAnimationActiveRef.current = false;
  }

  let ccLayers: Layer[] = [];
  try {
    const st = storeRef.current;
    ccLayers = st.layers.filter(
      (layer) => layer.layerType === 'color-cycle' && layer.colorCycleData?.mode !== 'recolor'
    );
  } catch {}

  const ensureLayersAnimating = () => {
    try {
      const st = storeRef.current;
      ccLayers.forEach((layer) => {
        const freshLayer = st.layers.find((entry) => entry.id === layer.id) ?? layer;
        if (!freshLayer.colorCycleData) {
          return;
        }
        if (freshLayer.colorCycleData.isAnimating) {
          return;
        }
        st.updateLayer(layer.id, {
          colorCycleData: {
            ...freshLayer.colorCycleData,
            isAnimating: true,
          },
        });
        ccLog('ensure isAnimating=true (noop start)', { id: layer.id.slice(-6), reason });
      });
    } catch {}
  };

  if (
    continuousColorCycleAnimationActiveRef.current ||
    startingColorCycleAnimationRef.current
  ) {
    ccLog('startContinuousColorCycleAnimation noop (already running)', { reason });
    ensureLayersAnimating();
    return;
  }

  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  const bypassCooldown = reason === 'store-sync' || reason === 'toolbar';
  if (!bypassCooldown && now - lastStartAtRef.current < startCooldownMs) {
    ccLog('startContinuousColorCycleAnimation throttled', { reason });
    return;
  }
  lastStartAtRef.current = now;

  startingColorCycleAnimationRef.current = true;

  try {
    const state = storeRef.current;
    const lightweightPanResume = isPanStoreSyncTransition(reason, storeRef);
    const ccLayers = state.layers.filter(l => l.layerType === 'color-cycle' && l.colorCycleData?.mode !== 'recolor');
    ccGroup('startContinuousColorCycleAnimation()', { reason, ccLayers: ccLayers.length });
    dumpLayerFlags();
    if (ccLayers.length === 0) {
      ccLog('abort: no brush CC layers');
      ccGroupEnd();
      return;
    }

    clearSharedColorCycleRuntimeConsumer(storeRef);
    continuousColorCycleAnimationRef.current = null;
    ccLog('cancel prior shared animation consumer', {
      reason,
      playback: summarizePlaybackState(storeRef),
      layers: summarizeColorCycleLayers(storeRef),
    });
    if (typeof window !== 'undefined') {
      window.__ccRafAlive = false;
    }

    let overlayReady = ensureOverlayInitialized();
    ccLog('overlay status', {
      reason,
      overlayReady,
      hasCanvas: !!drawingCanvasRef.current,
      hasCtx: !!drawingCtxRef.current
    });

    if (!lightweightPanResume) {
      try {
        const mgr = getColorCycleBrushManager();
        const projW = state.project?.width || 1024;
        const projH = state.project?.height || 1024;
        ccLayers.forEach(l => {
          const hasBrush = !!mgr.getBrush(l.id);
          if (!hasBrush) {
            try { state.initColorCycleForLayer(l.id, projW, projH); ccLog('initColorCycleForLayer()', { id: l.id.slice(-6), reason }); } catch {}
          }
        });
        ccLayers.forEach(l => {
          const brush = mgr.getBrush(l.id);
          brush?.stopAnimation?.();
        });
      } catch {}
    }

    if (!overlayReady && !getEffectiveColorCyclePlaying()) {
      overlayReady = ensureOverlayInitialized();
      ccLog('overlay retry', {
        reason,
        overlayReady,
        hasCanvas: !!drawingCanvasRef.current,
        hasCtx: !!drawingCtxRef.current
      });
    }

    if (!lightweightPanResume) {
      try {
        const st = storeRef.current;
        ccLayers.forEach(layer => {
          const freshLayer = st.layers.find((entry) => entry.id === layer.id) ?? layer;
          if (!freshLayer.colorCycleData) {
            return;
          }
          const updatedData: Layer['colorCycleData'] = {
            ...freshLayer.colorCycleData,
            isAnimating: true,
          };
          st.updateLayer(layer.id, { colorCycleData: updatedData });
          ccLog('mark isAnimating=true', { id: layer.id.slice(-6), reason });
        });
      } catch {}

      try {
        const mgr = getColorCycleBrushManager();
        ccLayers.forEach((layer) => {
          const brush = mgr.getBrush(layer.id);
          if (!brush) {
            return;
          }
          const isPlaying = typeof brush.isPlaying === 'function' ? brush.isPlaying() : false;
          if (!isPlaying) {
            if (typeof brush.startAnimation === 'function') {
              brush.startAnimation();
            } else if (typeof brush.setPlaying === 'function') {
              brush.setPlaying(true);
            }
            ccLog('force brush playback start', { id: layer.id.slice(-6), reason });
          }
        });
      } catch {}
    }

    const limitInitialRenderToActiveLayer = reason === 'stroke-start';
    cancelDeferredOverlayRender();
    renderAllColorCycleLayers(undefined, limitInitialRenderToActiveLayer);
    try {
      window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
      ccLog('dispatched colorCycleFrameUpdate', { reason });
    } catch {}
    if (limitInitialRenderToActiveLayer) {
      scheduleDeferredOverlayRender();
    }

    if (!overlayReady) {
      debugWarn('[DrawingHandlers] Overlay canvas not ready; animation will start once initialized');
      ccLog('overlay missing; defer animation', { reason });
    }

    drawingCanvasHasContent.current = false;
    firstPaintRef.current = true;
    lastRendererLogTS.current = 0;
    let lastBlankFrameLogAt = 0;

    let lastRenderTime = 0;
    const configuredFPS = storeRef.current.tools.brushSettings.colorCycleFPS;
    const targetFPS = Number.isFinite(configuredFPS)
      ? Math.max(1, Math.min(120, configuredFPS as number))
      : 60;
    const frameInterval = 1000 / targetFPS;

    continuousColorCycleAnimationActiveRef.current = true;
    continuousColorCycleAnimationRef.current = SHARED_RUNTIME_HANDLE_SENTINEL;

    const runtime = getSharedAnimationRuntime();
    const unregister = runtime.register((timestamp) => {
      if (!continuousColorCycleAnimationActiveRef.current) {
        return;
      }

      if (timestamp - lastRenderTime < frameInterval) {
        return;
      }

      const renderedAny = renderAllColorCycleLayers(undefined, false);

      if (renderedAny) {
        drawingCanvasHasContent.current = false;
      } else if (drawingCtxRef.current && drawingCanvasRef.current) {
        drawingCtxRef.current.clearRect(
          0,
          0,
          drawingCanvasRef.current.width,
          drawingCanvasRef.current.height
        );
        let shouldAdvance = false;
        try {
          shouldAdvance = !!(brushEngine.isColorCycleAnimating && brushEngine.isColorCycleAnimating());
          if (!shouldAdvance) {
            const st = storeRef.current;
            shouldAdvance = st.layers.some(
              (layer) => layer.layerType === 'color-cycle' && !!layer.colorCycleData?.isAnimating
            );
          }
        } catch {}
        if (shouldAdvance) {
          brushEngine.updateColorCycleAnimation?.();
        }
        brushEngine.renderColorCycle(drawingCtxRef.current, true);
        drawingCanvasHasContent.current = true;

        const now =
          typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        if (now - lastBlankFrameLogAt >= 500) {
          ccLog('shared runtime blank frame', {
            reason,
            shouldAdvance,
            activeRef: continuousColorCycleAnimationActiveRef.current,
            runtimeHandle: continuousColorCycleAnimationRef.current,
            layers: summarizeColorCycleLayers(storeRef),
          });
          lastBlankFrameLogAt = now;
        }
      }

      if (firstPaintRef.current) {
        ccLog('RAF first paint', { hadContent: renderedAny, reason });
        firstPaintRef.current = false;
      }

      const logNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (logNow - lastRendererLogTS.current > 1000) {
        const snapshot = storeRef.current;
        const animatingLayers = snapshot.layers.filter(
          (layer) => layer.layerType === 'color-cycle' && layer.colorCycleData?.isAnimating
        ).length;
        ccLog('RAF tick', { animatingLayers, reason });
        lastRendererLogTS.current = logNow;
      }

      try {
        window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
      } catch {}

      lastRenderTime = timestamp;
    });
    setSharedColorCycleRuntimeConsumer(storeRef, unregister);
    ccLog('register shared animation consumer', {
      reason,
      playback: summarizePlaybackState(storeRef),
      layers: summarizeColorCycleLayers(storeRef),
    });
    runtime.start();
    ccLog('start shared animation runtime', {
      reason,
      playback: summarizePlaybackState(storeRef),
      layers: summarizeColorCycleLayers(storeRef),
    });

    if (typeof window !== 'undefined') {
      window.__ccRafAlive = true;
    }

    ccGroupEnd();
  } finally {
    startingColorCycleAnimationRef.current = false;
  }
};
