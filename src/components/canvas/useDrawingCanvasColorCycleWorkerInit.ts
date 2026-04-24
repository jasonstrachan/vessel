import { debugWarn } from '@/utils/debug';
import { useEffect, type MutableRefObject } from 'react';
import { getColorCycleCompositorClient } from '@/workers/colorCycleCompositorClient';

interface UseDrawingCanvasColorCycleWorkerInitOptions {
  shouldUseColorCycleWorker: boolean;
  hasWarnedColorCycleWorkerRef: MutableRefObject<boolean>;
}

export const useDrawingCanvasColorCycleWorkerInit = ({
  shouldUseColorCycleWorker,
  hasWarnedColorCycleWorkerRef,
}: UseDrawingCanvasColorCycleWorkerInitOptions) => {
  useEffect(() => {
    if (!shouldUseColorCycleWorker) {
      return;
    }

    let cancelled = false;
    getColorCycleCompositorClient()
      .then((client) => {
        if (cancelled) {
          return;
        }
        return client.ping();
      })
      .catch((error) => {
        if (!hasWarnedColorCycleWorkerRef.current) {
          hasWarnedColorCycleWorkerRef.current = true;
          if (process.env.NODE_ENV !== 'production') {
            debugWarn('raw-console',
              '[ColorCycleWorker] init failed; falling back to main-thread compositing.',
              error
            );
          }
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hasWarnedColorCycleWorkerRef, shouldUseColorCycleWorker]);
};
