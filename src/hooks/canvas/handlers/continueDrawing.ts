import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import type { BoundingBox } from '@/hooks/canvas/utils/captureRegions';
import {
  alignPointToPixel,
  mergeBoundingBox,
  shouldPixelAlignBrush,
} from '@/hooks/canvas/utils/captureRegions';
import { computeStrokeCapturePadding } from '@/hooks/canvas/utils/strokeCapturePadding';
import { resolveActiveCustomBrushData } from '@/hooks/canvas/utils/customBrushData';

export type ContinueDrawingHandler = (
  rawWorldPos: { x: number; y: number },
  pressure?: number
) => void;

type ContinueDrawingHandlerDeps = {
  storeRef: React.MutableRefObject<AppState>;
  endStrokeSession: () => void;
  processBatchedStrokes: () => void;
  throttleMs: number;
  strokeBatchRef: React.MutableRefObject<Array<{ pos: { x: number; y: number }; pressure: number }>>;
  strokeBatchTimerRef: React.MutableRefObject<number | null>;
  lastProcessedTimeRef: React.MutableRefObject<number>;
  lastStrokePointRef: React.MutableRefObject<{ x: number; y: number } | null>;
  brushSamplingPreviewActiveRef: React.MutableRefObject<boolean>;
  strokeBoundingBoxRef: React.MutableRefObject<BoundingBox | null>;
  strokeCapturePaddingRef: React.MutableRefObject<number>;
  resamplerBrushDataRef: React.MutableRefObject<CustomBrushStrokeData | undefined>;
};

export const createContinueDrawingHandler = ({
  storeRef,
  endStrokeSession,
  processBatchedStrokes,
  throttleMs,
  strokeBatchRef,
  strokeBatchTimerRef,
  lastProcessedTimeRef,
  lastStrokePointRef,
  brushSamplingPreviewActiveRef,
  strokeBoundingBoxRef,
  strokeCapturePaddingRef,
  resamplerBrushDataRef,
}: ContinueDrawingHandlerDeps): ContinueDrawingHandler => (rawWorldPos, pressure = 0.5) => {
  const currentState = storeRef.current;
  const activeLayer = currentState.layers.find((layer) => layer.id === currentState.activeLayerId);
  if (activeLayer && !activeLayer.visible) {
    endStrokeSession();
    return;
  }

  const now = performance.now();
  const brushSettings = currentState.tools.brushSettings;
  const worldPos = alignPointToPixel(rawWorldPos, shouldPixelAlignBrush(brushSettings));
  lastStrokePointRef.current = worldPos;

  if (currentState.tools.currentTool === 'brush' && !brushSamplingPreviewActiveRef.current) {
    strokeBoundingBoxRef.current = mergeBoundingBox(strokeBoundingBoxRef.current, worldPos);
    const activeCustomBrush = resolveActiveCustomBrushData(currentState) ?? resamplerBrushDataRef.current;
    const dynamicPadding = computeStrokeCapturePadding(brushSettings, activeCustomBrush ?? null);
    if (dynamicPadding > strokeCapturePaddingRef.current) {
      strokeCapturePaddingRef.current = dynamicPadding;
    }
  }

  strokeBatchRef.current.push({ pos: worldPos, pressure });

  if (now - lastProcessedTimeRef.current >= throttleMs) {
    processBatchedStrokes();
    lastProcessedTimeRef.current = now;
    return;
  }

  if (!strokeBatchTimerRef.current) {
    strokeBatchTimerRef.current = window.requestAnimationFrame(() => {
      processBatchedStrokes();
      lastProcessedTimeRef.current = performance.now();
    });
  }
};
