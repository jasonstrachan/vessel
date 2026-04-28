import { useEffect } from 'react';
import { registerToolFlush, unregisterToolFlush } from '@/utils/toolFlushRegistry';

export const useDrawingCanvasShapeFlushRegistration = ({
  finalizeActiveShape,
}: {
  finalizeActiveShape: () => Promise<unknown>;
}) => {
  useEffect(() => {
    const key = 'drawing-canvas:finalize-shapes';
    registerToolFlush(key, async () => {
      await finalizeActiveShape();
    }, {
      passive: false,
    });
    return () => unregisterToolFlush(key);
  }, [finalizeActiveShape]);
};
