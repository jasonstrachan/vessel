import { useCallback } from 'react';
import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import {
  clearBrushSamplingPreview as clearBrushSamplingPreviewExternal,
  renderBrushSamplingPreview as renderBrushSamplingPreviewExternal,
  resetAutoSampleState as resetAutoSampleStateExternal,
  updateAutoSampledGradient as updateAutoSampledGradientExternal,
  updateDitherGradSamples as updateDitherGradSamplesExternal,
} from '@/hooks/canvas/handlers/brushSampling';

type BrushSamplingDeps = {
  storeRef: React.MutableRefObject<AppState>;
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  sampleColorAt?: (x: number, y: number) => string;
};

export const useBrushSamplingCallbacks = ({
  storeRef,
  drawingCanvasRef,
  drawingCtxRef,
  drawingCanvasHasContent,
  sampleColorAt,
  autoSamplePointsRef,
  autoSampleLastUpdateRef,
  autoSampleForkRef,
  autoSampleLastAppliedHashRef,
  brushSamplingPreviewActiveRef,
  ditherGradSampleLastUpdateRef,
}: BrushSamplingDeps & {
  autoSamplePointsRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
  autoSampleLastUpdateRef: React.MutableRefObject<number>;
  autoSampleForkRef: React.MutableRefObject<boolean>;
  autoSampleLastAppliedHashRef: React.MutableRefObject<string>;
  brushSamplingPreviewActiveRef: React.MutableRefObject<boolean>;
  ditherGradSampleLastUpdateRef: React.MutableRefObject<number>;
}) => {
  const renderBrushSamplingPreview = useCallback((points: Array<{ x: number; y: number }>) => {
    renderBrushSamplingPreviewExternal({
      points,
      deps: {
        storeRef,
        drawingCanvasRef,
        drawingCtxRef,
        drawingCanvasHasContent,
        sampleColorAt,
      },
    });
  }, [storeRef, drawingCanvasRef, drawingCtxRef, drawingCanvasHasContent, sampleColorAt]);

  const clearBrushSamplingPreview = useCallback(() => {
    clearBrushSamplingPreviewExternal({
      deps: {
        storeRef,
        drawingCanvasRef,
        drawingCtxRef,
        drawingCanvasHasContent,
        sampleColorAt,
      },
    });
  }, [storeRef, drawingCanvasRef, drawingCtxRef, drawingCanvasHasContent, sampleColorAt]);

  const resetAutoSampleState = useCallback((disableGradient: boolean = true) => {
    resetAutoSampleStateExternal({
      storeRef,
      autoSamplePointsRef,
      autoSampleLastUpdateRef,
      brushSamplingPreviewActiveRef,
      disableGradient,
    });
  }, [storeRef, autoSamplePointsRef, autoSampleLastUpdateRef, brushSamplingPreviewActiveRef]);

  const updateAutoSampledGradient = useCallback((sourcePts: Array<{ x: number; y: number }>) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    updateAutoSampledGradientExternal({
      sourcePts,
      now,
      autoSampleLastUpdateRef,
      autoSampleForkRef,
      autoSampleLastAppliedHashRef,
      deps: {
        storeRef,
        drawingCanvasRef,
        drawingCtxRef,
        drawingCanvasHasContent,
        sampleColorAt,
      },
    });
  }, [
    storeRef,
    drawingCanvasRef,
    drawingCtxRef,
    drawingCanvasHasContent,
    sampleColorAt,
    autoSampleLastUpdateRef,
    autoSampleForkRef,
    autoSampleLastAppliedHashRef,
  ]);

  const updateDitherGradSamples = useCallback((sourcePts: Array<{ x: number; y: number }>) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    updateDitherGradSamplesExternal({
      sourcePts,
      now,
      ditherGradSampleLastUpdateRef,
      deps: {
        storeRef,
        drawingCanvasRef,
        drawingCtxRef,
        drawingCanvasHasContent,
        sampleColorAt,
      },
    });
  }, [storeRef, drawingCanvasRef, drawingCtxRef, drawingCanvasHasContent, sampleColorAt, ditherGradSampleLastUpdateRef]);

  return {
    renderBrushSamplingPreview,
    clearBrushSamplingPreview,
    resetAutoSampleState,
    updateAutoSampledGradient,
    updateDitherGradSamples,
  };
};
