import type { MutableRefObject } from 'react';
import type { CCReason } from '@/stores/useAppStore';

interface LogDrawingPlaybackSkipWithThrottleOptions {
  reason: CCReason;
  lastLogAtRef: MutableRefObject<Record<string, number>>;
  throttleMs: number;
  ccLog: (label: string, payload?: Record<string, unknown>) => void;
  label: string;
  payload: Record<string, unknown>;
}

export const logDrawingPlaybackSkipWithThrottle = ({
  reason,
  lastLogAtRef,
  throttleMs,
  ccLog,
  label,
  payload,
}: LogDrawingPlaybackSkipWithThrottleOptions): void => {
  const current =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  const lastAt = lastLogAtRef.current[reason] ?? 0;
  if (current - lastAt >= throttleMs) {
    lastLogAtRef.current[reason] = current;
    ccLog(label, payload);
  }
};
