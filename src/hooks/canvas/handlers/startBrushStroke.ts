import type React from 'react';
import { BrushShape } from '@/types';
import type { AppState } from '@/stores/useAppStore';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';

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
      options: { pressure: number; customBrushData?: CustomBrushStrokeData }
    ) => void;
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
  let customBrushData: CustomBrushStrokeData | undefined = resolveCustomBrushData(currentState);

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

  brushEngine.drawBrush(drawCtx, worldPos, worldPos, { pressure, customBrushData });
};
