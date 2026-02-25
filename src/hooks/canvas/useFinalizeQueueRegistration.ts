import { useEffect } from 'react';
import type React from 'react';
import type { FinalizeQueue } from '@/lib/canvas';
import { registerFinalizeQueue } from '@/stores/pendingColorCycleSaves';

export const useFinalizeQueueRegistration = ({
  finalizeQueueRef,
}: {
  finalizeQueueRef: React.MutableRefObject<FinalizeQueue>;
}): void => {
  useEffect(() => {
    registerFinalizeQueue(finalizeQueueRef.current);
    return () => {
      registerFinalizeQueue(null);
    };
  }, [finalizeQueueRef]);
};
