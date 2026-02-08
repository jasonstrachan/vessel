import { useCallback, useRef } from 'react';
import type { ContourLinesState, Lines2DefaultsCache } from './utils/types';
import { createDefaultContourLinesState } from './handlers/pointerHandlers';

export const useCanvasEventHandlerRefs = () => {
  const snapStrokeStartRef = useRef<{ x: number; y: number } | null>(null);
  const snapShiftAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const snapLastBrushSampleRef = useRef<{ x: number; y: number } | null>(null);

  const contourLinesStateRef = useRef<ContourLinesState>(createDefaultContourLinesState());
  const contourLinesDefaultsCacheRef = useRef<Lines2DefaultsCache | null>(null);
  const contourLinesFinalizingRef = useRef<boolean>(false);
  const previewSessionIdRef = useRef<number>(0);

  const newPreviewSession = useCallback(() => {
    previewSessionIdRef.current += 1;
    contourLinesFinalizingRef.current = false;
    return previewSessionIdRef.current;
  }, []);

  const isCurrentPreviewSession = useCallback(
    (sessionId: number) => sessionId === previewSessionIdRef.current,
    []
  );

  return {
    snapStrokeStartRef,
    snapShiftAnchorRef,
    snapLastBrushSampleRef,
    contourLinesStateRef,
    contourLinesDefaultsCacheRef,
    contourLinesFinalizingRef,
    previewSessionIdRef,
    newPreviewSession,
    isCurrentPreviewSession,
  };
};
