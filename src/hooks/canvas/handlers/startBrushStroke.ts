import { getAppStoreState } from '@/stores/appStoreAccess';
import type React from 'react';
import { BrushShape } from '@/types';
import { type AppState } from '@/stores/useAppStore';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import {
  captureSequentialStampsForActiveLayer,
  createFallbackSequentialStamp,
} from '@/hooks/canvas/handlers/sequential/sequentialCapture';

export const startNonColorCycleBrushStroke = ({
  currentState,
  worldPos,
  pressure,
  drawCtx,
  brushEngine,
  resolveCustomBrushData,
  captureResamplerSingleSample,
  resamplerBrushDataRef,
}: {
  currentState: AppState;
  worldPos: { x: number; y: number };
  pressure: number;
  drawCtx: CanvasRenderingContext2D;
  brushEngine: {
    drawBrush: (
      ctx: CanvasRenderingContext2D,
      from: { x: number; y: number },
      to: { x: number; y: number },
      options: {
        pressure: number;
        customBrushData?: CustomBrushStrokeData;
        velocityPxPerMs?: number;
        timestampMs?: number;
      }
    ) => void;
    consumeRecentStamps?: () => Array<{
      x: number;
      y: number;
      pressure: number;
      rotation: number;
      size: number;
      alpha: number;
    }>;
  };
  resolveCustomBrushData: (state: AppState) => CustomBrushStrokeData | undefined;
  captureResamplerSingleSample: (args: {
    samplePos: { x: number; y: number };
    brushSize: number;
    compositeCanvas: HTMLCanvasElement | null;
    resamplerBrushDataRef: React.MutableRefObject<CustomBrushStrokeData | undefined>;
  }) => CustomBrushStrokeData | undefined;
  resamplerBrushDataRef: React.MutableRefObject<CustomBrushStrokeData | undefined>;
}): void => {
  const captureNowMs = Date.now();
  let customBrushData: CustomBrushStrokeData | undefined = resolveCustomBrushData(currentState);
  const isCustomBrushShape = currentState.tools.brushSettings.brushShape === BrushShape.CUSTOM;
  if (!customBrushData && isCustomBrushShape) {
    customBrushData = resamplerBrushDataRef.current;
  }
  if (customBrushData && isCustomBrushShape) {
    // Preserve the active custom tip for this stroke if live lookup briefly returns undefined.
    resamplerBrushDataRef.current = customBrushData;
  }

  if (
    currentState.tools.brushSettings.brushShape === BrushShape.RESAMPLER &&
    !currentState.tools.brushSettings.continuousSampling
  ) {
    const resamplerSample = captureResamplerSingleSample({
      samplePos: worldPos,
      brushSize: currentState.tools.brushSettings.size || 20,
      compositeCanvas: currentState.currentOffscreenCanvas ?? null,
      resamplerBrushDataRef,
    });
    if (resamplerSample) {
      customBrushData = resamplerSample;
    }
  }

  if (currentState.tools.brushSettings.brushShape === BrushShape.RESAMPLER) {
    customBrushData = resamplerBrushDataRef.current ?? customBrushData;
  }

  if (typeof brushEngine.consumeRecentStamps === 'function') {
    brushEngine.consumeRecentStamps();
  }
  brushEngine.drawBrush(drawCtx, worldPos, worldPos, { pressure, customBrushData });
  const emittedStamps =
    typeof brushEngine.consumeRecentStamps === 'function'
      ? brushEngine.consumeRecentStamps()
      : [];
  const captureState = getAppStoreState();

  captureSequentialStampsForActiveLayer({
    state: captureState,
    stamps:
      emittedStamps.length > 0
        ? emittedStamps
        : [createFallbackSequentialStamp(worldPos, pressure, captureState.tools.brushSettings)],
    customBrushData,
    nowMs: captureNowMs,
  });
};
