import type React from 'react';
import type { ManagedColorCycleBrush } from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';
import type { BrushSettings } from '@/types';
import type { AppState } from '@/stores/useAppStore';
import {
  selectColorCycleDesiredPlaying,
  selectColorCycleSuspendDepth,
} from '@/stores/useAppStore';
import { setLayerColorCycleGradient, setSharedColorCycleGradient } from '@/utils/colorCycleGradients';

type AutoSampleStop = { position: number; color: string };

export type FinalizeColorCycleBrushArgs = {
  activeFlags: { isAny: boolean };
  activeSettings: BrushSettings;
  currentState: AppState;
};

export type FinalizeColorCycleBrushDeps = {
  storeRef: React.MutableRefObject<AppState>;
  brushEngine: {
    endColorCycleStroke: () => void;
    renderColorCycle: (ctx: CanvasRenderingContext2D, applyOpacity: boolean) => void;
    updateColorCycleGradient?: (stops: AutoSampleStop[]) => void;
  };
  drawingCanvas: HTMLCanvasElement | null;
  drawingCtx: CanvasRenderingContext2D | null;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  colorCycleAnimationRef: React.MutableRefObject<number | null>;
  brushSamplingPreviewActiveRef: React.MutableRefObject<boolean>;
  autoSamplePointsRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
  autoSampleLastUpdateRef: React.MutableRefObject<number>;
  autoSampleLastAppliedHashRef: React.MutableRefObject<string>;
  finalizeInProgressRef?: React.MutableRefObject<boolean>;
  computeAutoSampleStops: (
    sourcePts: Array<{ x: number; y: number }>,
    options?: { allowTiny?: boolean }
  ) => AutoSampleStop[] | null;
  clearBrushSamplingPreview: () => void;
  getBrushForLayer: (layerId: string) => ManagedColorCycleBrush | undefined;
  getEffectiveColorCyclePlaying: () => boolean;
  startPlaybackRef: React.MutableRefObject<((reason?: string) => void) | null>;
};

export const finalizeColorCycleBrush = async (
  { activeFlags, activeSettings, currentState }: FinalizeColorCycleBrushArgs,
  deps: FinalizeColorCycleBrushDeps
): Promise<{ shouldReturn: boolean }> => {
  const {
    storeRef,
    brushEngine,
    drawingCanvas,
    drawingCtx,
    drawingCanvasHasContent,
    colorCycleAnimationRef,
    brushSamplingPreviewActiveRef,
    autoSamplePointsRef,
    autoSampleLastUpdateRef,
    autoSampleLastAppliedHashRef,
    finalizeInProgressRef,
    computeAutoSampleStops,
    clearBrushSamplingPreview,
    getBrushForLayer,
    getEffectiveColorCyclePlaying,
    startPlaybackRef,
  } = deps;

  if (!activeFlags.isAny || !drawingCtx) {
    return { shouldReturn: false };
  }

  if (finalizeInProgressRef) {
    finalizeInProgressRef.current = true;
  }

  try {
    // If auto-sampling is enabled, compute final gradient across full stroke path now (single-pass)
    try {
      const pts = autoSamplePointsRef.current;
      if (pts.length > 0 && (brushSamplingPreviewActiveRef.current || activeSettings.autoSampleGradient || activeSettings.autoSampleGradientRealtime)) {
        const stops = computeAutoSampleStops([...pts], { allowTiny: true });
        if (stops && stops.length >= 2) {
          const hash = stops
            .map((stop) => `${Math.round(stop.position * 1000)}:${stop.color}`)
            .join('|');
          if (hash === autoSampleLastAppliedHashRef.current) {
            clearBrushSamplingPreview();
            brushSamplingPreviewActiveRef.current = false;
            autoSamplePointsRef.current = [];
            autoSampleLastUpdateRef.current = 0;
            drawingCanvasHasContent.current = false;
            return { shouldReturn: true };
          }
          autoSampleLastAppliedHashRef.current = hash;

          const realtime = Boolean(
            currentState.tools.brushSettings.autoSampleGradientRealtime ||
              activeSettings.autoSampleGradientRealtime
          );
          try {
            if (realtime) {
              setLayerColorCycleGradient(stops, currentState.activeLayerId ?? undefined, {
                allowForegroundOverride: true,
              });
            } else {
              setSharedColorCycleGradient(stops);
            }
          } catch {
            storeRef.current.setBrushSettings({ colorCycleGradient: stops });
          }
          try {
            const st = storeRef.current;
            const gb = st.tools.brushSettings.gradientBands || 0;
            if (gb < stops.length) {
              st.setBrushSettings({ gradientBands: stops.length });
            }
          } catch {}
          try {
            storeRef.current.setBrushSettings({ colorCycleGradient: stops });
          } catch {}
          // Push into live brush
          try { brushEngine.updateColorCycleGradient?.(stops); } catch {}
          // One-shot: auto-disable sampling after applying
          try {
            const st = storeRef.current;
            if (st.tools.brushSettings.autoSampleGradient && !st.tools.brushSettings.autoSampleGradientRealtime) {
              st.setBrushSettings({ autoSampleGradient: false });
            }
          } catch {}
        }
        clearBrushSamplingPreview();
        brushSamplingPreviewActiveRef.current = false;
        autoSamplePointsRef.current = [];
        autoSampleLastUpdateRef.current = 0;
        drawingCanvasHasContent.current = false;
        if (brushSamplingPreviewActiveRef.current) {
          return { shouldReturn: true };
        }
      }
    } catch {}

    // Stop animation loop
    if (colorCycleAnimationRef.current) {
      cancelAnimationFrame(colorCycleAnimationRef.current);
      colorCycleAnimationRef.current = null;
    }

    // Phase 3: Direct rendering approach
    const refreshedActiveLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
    const colorCycleBrush = refreshedActiveLayer ? getBrushForLayer(refreshedActiveLayer.id) : undefined;

    // For CC layers with a valid brush/canvas, defer finalization to the CC commit path
    // to avoid double-ending the stroke (which clears stamp dither buffers).
    if (colorCycleBrush && refreshedActiveLayer?.colorCycleData?.canvas && drawingCanvas && drawingCtx) {
      // Clear transient overlay so compositor paints the next frame
      drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
      drawingCanvasHasContent.current = false;
    } else if (drawingCanvas && drawingCtx) {
      // End stroke when we cannot lock it directly on the brush instance.
      brushEngine.endColorCycleStroke();
      // Fallback: Clear and do one final render at FULL OPACITY
      drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
      drawingCanvasHasContent.current = false;
      brushEngine.renderColorCycle(drawingCtx, false); // false = don't apply opacity
    }

    // Keep runtime aligned with toolbar intent after finalize.
    try {
      const st = storeRef.current;
      if (
        selectColorCycleDesiredPlaying(st) &&
        selectColorCycleSuspendDepth(st) > 0
      ) {
        st.forceResumeColorCycle('brush-stroke');
      }
    } catch {}

    if (getEffectiveColorCyclePlaying()) {
      Promise.resolve().then(() => startPlaybackRef.current?.('stroke-end'));
    }

    return { shouldReturn: false };
  } finally {
    if (finalizeInProgressRef) {
      finalizeInProgressRef.current = false;
    }
  }
};
