import { useEffect, useRef } from 'react';
import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import {
  subscribeCcGradientSourceResetController,
} from '@/hooks/canvas/handlers/colorCycle/ccGradientSamplingController';

export const useCcGradientSourceResetEffect = ({
  storeRef,
  activeLayerIdRef,
  isPointerDownRef,
  resetCcGradientSample,
  clearBrushSamplingPreview,
  ccSampledPointsRef,
  ccSampledLastUpdateRef,
  ccGradientSampleCountRef,
  ccGradientSampleCountLastUpdateRef,
}: {
  storeRef: React.MutableRefObject<AppState>;
  activeLayerIdRef: React.MutableRefObject<string | null>;
  isPointerDownRef: React.MutableRefObject<boolean>;
  resetCcGradientSample: () => void;
  clearBrushSamplingPreview: () => void;
  ccSampledPointsRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
  ccSampledLastUpdateRef: React.MutableRefObject<number>;
  ccGradientSampleCountRef: React.MutableRefObject<number>;
  ccGradientSampleCountLastUpdateRef: React.MutableRefObject<number>;
}): void => {
  const clearBrushSamplingPreviewRef = useRef(clearBrushSamplingPreview);
  const resetCcGradientSampleRef = useRef(resetCcGradientSample);

  useEffect(() => {
    clearBrushSamplingPreviewRef.current = clearBrushSamplingPreview;
  }, [clearBrushSamplingPreview]);

  useEffect(() => {
    resetCcGradientSampleRef.current = resetCcGradientSample;
  }, [resetCcGradientSample]);

  useEffect(() => {
    const unsubscribe = subscribeCcGradientSourceResetController({
      storeRef,
      activeLayerIdRef,
      isPointerDownRef,
      resetCcGradientSample: () => resetCcGradientSampleRef.current(),
      clearBrushSamplingPreview: () => clearBrushSamplingPreviewRef.current(),
      ccSampledPointsRef,
      ccSampledLastUpdateRef,
      ccGradientSampleCountRef,
      ccGradientSampleCountLastUpdateRef,
    });

    return () => unsubscribe();
  }, [
    activeLayerIdRef,
    ccGradientSampleCountLastUpdateRef,
    ccGradientSampleCountRef,
    ccSampledLastUpdateRef,
    ccSampledPointsRef,
    isPointerDownRef,
    storeRef,
  ]);
};
