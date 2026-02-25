import { useCallback, useEffect } from 'react';
import type React from 'react';
import {
  cancelMarkGradientSession,
  registerMarkGradientPointerDownRef,
} from '@/hooks/canvas/utils/colorCycleMarkSession';

export const useMarkGradientLifecycle = ({
  isPointerDownRef,
  activeLayerIdRef,
}: {
  isPointerDownRef: React.MutableRefObject<boolean>;
  activeLayerIdRef: React.MutableRefObject<string | null>;
}): void => {
  useEffect(() => {
    registerMarkGradientPointerDownRef(isPointerDownRef);
    return () => {
      registerMarkGradientPointerDownRef(null);
    };
  }, [isPointerDownRef]);

  const cancelActiveMarkGradientSessionOnUnmount = useCallback(() => {
    const layerId = activeLayerIdRef.current;
    if (layerId) {
      isPointerDownRef.current = false;
      cancelMarkGradientSession(layerId);
    }
  }, [activeLayerIdRef, isPointerDownRef]);

  useEffect(() => {
    return () => {
      cancelActiveMarkGradientSessionOnUnmount();
    };
  }, [cancelActiveMarkGradientSessionOnUnmount]);
};
