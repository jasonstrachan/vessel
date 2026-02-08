import type React from 'react';
import type { AppState } from '@/stores/useAppStore';

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
  if (isCCStroke && (autoSampleOneShot || autoSampleRealtime)) {
    autoSamplePointsRef.current = [worldPos];
    autoSampleLastUpdateRef.current = 0;
    autoSampleForkRef.current = true;
    brushSamplingPreviewActiveRef.current = autoSampleOneShot;
    if (autoSampleOneShot) {
      renderBrushSamplingPreview(autoSamplePointsRef.current);
    }
  }

  const isSampledStroke =
    ccFlags.isAny &&
    currentState.tools.ccGradientSource === 'sampled';
  if (isSampledStroke) {
    ccSampledPointsRef.current = [worldPos];
    ccSampledLastUpdateRef.current = 0;
    updateCcSampledGradient(ccSampledPointsRef.current, { markKind: 'stroke' });
  }
};
