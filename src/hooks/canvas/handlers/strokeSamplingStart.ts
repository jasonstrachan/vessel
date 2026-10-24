import { usesCcSampledGradient } from '@/utils/colorCycle/ccColourPickup';
import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import { BrushShape } from '@/types';

export const initializeStrokeSamplingState = ({
  currentState,
  ccFlags,
  worldPos,
  autoSamplePointsRef,
  autoSampleLastUpdateRef,
  autoSampleForkRef,
  brushSamplingPreviewActiveRef,
  renderBrushSamplingPreview,
  ccSampledPointsRef,
  ccSampledLastUpdateRef,
  updateCcSampledGradient,
}: {
  currentState: AppState;
  ccFlags: { isAny: boolean };
  worldPos: { x: number; y: number };
  autoSamplePointsRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
  autoSampleLastUpdateRef: React.MutableRefObject<number>;
  autoSampleForkRef: React.MutableRefObject<boolean>;
  brushSamplingPreviewActiveRef: React.MutableRefObject<boolean>;
  renderBrushSamplingPreview: (points: Array<{ x: number; y: number }>) => void;
  ccSampledPointsRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
  ccSampledLastUpdateRef: React.MutableRefObject<number>;
  updateCcSampledGradient: (
    points: Array<{ x: number; y: number }>,
    options?: { layerId?: string | null; markKind?: 'stroke' | 'shape' }
  ) => void;
}): void => {
  const isCCStroke = ccFlags.isAny;
  const autoSampleOneShot = !!currentState.tools.brushSettings.autoSampleGradient;
  const autoSampleRealtime = !!currentState.tools.brushSettings.autoSampleGradientRealtime;
  const isMosaicSample = !isCCStroke && currentState.tools.brushSettings.brushShape === BrushShape.MOSAIC && autoSampleOneShot;
  if (isMosaicSample || (isCCStroke && !currentState.tools.brushSettings.colorCyclePickupEnabled && (autoSampleOneShot || autoSampleRealtime))) {
    autoSamplePointsRef.current = [worldPos];
    autoSampleLastUpdateRef.current = 0;
    if (isCCStroke) {
      autoSampleForkRef.current = true;
    }
    brushSamplingPreviewActiveRef.current = isCCStroke && autoSampleOneShot;
    if (brushSamplingPreviewActiveRef.current) {
      renderBrushSamplingPreview(autoSamplePointsRef.current);
    }
  }

  const isSampledStroke =
    ccFlags.isAny &&
    usesCcSampledGradient(currentState.tools.brushSettings, currentState.tools.ccGradientSource);
  if (isSampledStroke) {
    ccSampledPointsRef.current = [worldPos];
    ccSampledLastUpdateRef.current = 0;
    updateCcSampledGradient(ccSampledPointsRef.current, { markKind: 'stroke' });
  }
};
