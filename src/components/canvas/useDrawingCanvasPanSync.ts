import { useCallback, useEffect, useRef } from 'react';
import { viewPerformanceTracker } from '@/utils/viewPerformanceTracker';
import type { PanEvent, PanSnapshot } from '@/hooks/useSimplePan';

interface UseDrawingCanvasPanSyncOptions {
  canvasOffsetX: number;
  canvasOffsetY: number;
  getPanState: () => PanSnapshot;
  setPan: (
    offsetX: number,
    offsetY: number,
    options?: { silent?: boolean; isPanning?: boolean; source?: string }
  ) => void;
  subscribeToPan: (listener: (state: PanSnapshot, event: PanEvent) => void) => () => void;
  setCanvasOffset: (x: number, y: number) => void;
  viewTransformRef: React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }>;
}

export const useDrawingCanvasPanSync = ({
  canvasOffsetX,
  canvasOffsetY,
  getPanState,
  setPan,
  subscribeToPan,
  setCanvasOffset,
  viewTransformRef,
}: UseDrawingCanvasPanSyncOptions) => {
  const lastCommittedPanRef = useRef<{ x: number; y: number }>({ x: canvasOffsetX, y: canvasOffsetY });
  const pendingPanCommitRef = useRef<number | null>(null);
  const pendingPanStateRef = useRef<PanSnapshot | null>(null);

  const commitPanToStore = useCallback(
    (state: PanSnapshot) => {
      setCanvasOffset(state.offsetX, state.offsetY);
      lastCommittedPanRef.current = { x: state.offsetX, y: state.offsetY };
    },
    [setCanvasOffset]
  );

  useEffect(() => {
    const current = getPanState();
    if (current.isPanning) {
      return;
    }
    if (current.offsetX === canvasOffsetX && current.offsetY === canvasOffsetY) {
      return;
    }
    setPan(canvasOffsetX, canvasOffsetY, { silent: true });
    viewTransformRef.current.offsetX = canvasOffsetX;
    viewTransformRef.current.offsetY = canvasOffsetY;
  }, [canvasOffsetX, canvasOffsetY, getPanState, setPan, viewTransformRef]);

  useEffect(() => {
    lastCommittedPanRef.current = { x: canvasOffsetX, y: canvasOffsetY };
  }, [canvasOffsetX, canvasOffsetY]);

  useEffect(() => {
    const handlePanEvent = (state: PanSnapshot, event: PanEvent) => {
      viewTransformRef.current.offsetX = state.offsetX;
      viewTransformRef.current.offsetY = state.offsetY;

      if (event === 'start') {
        viewPerformanceTracker.startSession('pan');
      }

      if (event === 'change' || event === 'set') {
        pendingPanStateRef.current = state;
        if (pendingPanCommitRef.current != null) {
          return;
        }
        pendingPanCommitRef.current = requestAnimationFrame(() => {
          pendingPanCommitRef.current = null;
          if (pendingPanStateRef.current) {
            commitPanToStore(pendingPanStateRef.current);
          }
        });
        return;
      }

      if (event === 'end' || event === 'reset') {
        if (pendingPanCommitRef.current != null) {
          cancelAnimationFrame(pendingPanCommitRef.current);
          pendingPanCommitRef.current = null;
        }
        pendingPanStateRef.current = null;

        if (
          lastCommittedPanRef.current.x !== state.offsetX ||
          lastCommittedPanRef.current.y !== state.offsetY
        ) {
          commitPanToStore(state);
        }

        viewPerformanceTracker.endSession('pan');
      }
    };

    const unsubscribe = subscribeToPan(handlePanEvent);

    return () => {
      if (pendingPanCommitRef.current != null) {
        cancelAnimationFrame(pendingPanCommitRef.current);
        pendingPanCommitRef.current = null;
      }
      pendingPanStateRef.current = null;
      viewPerformanceTracker.endSession('pan');
      unsubscribe();
    };
  }, [commitPanToStore, subscribeToPan, viewTransformRef]);
};
