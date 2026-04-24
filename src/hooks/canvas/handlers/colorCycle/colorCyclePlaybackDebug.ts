import { debugLog } from '@/utils/debug';
import type { MutableRefObject } from 'react';

export interface ColorCycleTraceState {
  lastByReason: Record<string, number>;
  suppressedByReason: Record<string, number>;
}

interface CcDebugFlags {
  on: boolean;
  verbose: boolean;
}

interface RunStopTraceOptions {
  reason: string;
  ccDebug: CcDebugFlags;
  runStopCore: (reason: string) => void;
}

export const runStopContinuousColorCycleWithTrace = ({
  reason,
  ccDebug,
  runStopCore,
}: RunStopTraceOptions) => {
  if (ccDebug.on && ccDebug.verbose) {
    try {
      console.groupCollapsed('[CC:TRACE] stopContinuousColorCycleAnimation', { reason });
      debugLog('raw-console', new Error('stopContinuousColorCycleAnimation').stack);
      console.groupEnd();
    } catch {
      // no-op
    }
  }
  return runStopCore(reason);
};

interface RunStartTraceOptions {
  reason: string;
  ccDebug: CcDebugFlags;
  startingRef: MutableRefObject<boolean>;
  animationHandleRef: MutableRefObject<number | null>;
  traceStateRef: MutableRefObject<ColorCycleTraceState>;
  throttleMs: number;
  runStartCore: (reason: string) => void;
}

export const runStartContinuousColorCycleWithTrace = ({
  reason,
  ccDebug,
  startingRef,
  animationHandleRef,
  traceStateRef,
  throttleMs,
  runStartCore,
}: RunStartTraceOptions) => {
  if (startingRef.current) {
    return;
  }
  if (animationHandleRef.current != null) {
    return;
  }

  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

  const traceState = traceStateRef.current;
  const lastLoggedAt = traceState.lastByReason[reason];
  const elapsed = lastLoggedAt === undefined ? Number.POSITIVE_INFINITY : now - lastLoggedAt;
  const shouldAttemptLog = elapsed >= throttleMs;

  if (ccDebug.on && ccDebug.verbose && shouldAttemptLog) {
    const suppressedCount = traceState.suppressedByReason[reason] ?? 0;
    traceState.lastByReason[reason] = now;
    traceState.suppressedByReason[reason] = 0;
    try {
      console.groupCollapsed('[CC:TRACE] startContinuousColorCycleAnimation', {
        reason,
        suppressedCount,
      });
      if (suppressedCount > 0) {
        debugLog('raw-console', `suppressed ${suppressedCount} rapid calls`);
      }
      debugLog('raw-console', new Error('startContinuousColorCycleAnimation').stack);
      console.groupEnd();
    } catch {
      // no-op
    }
  } else if (ccDebug.on && ccDebug.verbose && !shouldAttemptLog) {
    traceState.suppressedByReason[reason] = (traceState.suppressedByReason[reason] ?? 0) + 1;
  } else if (shouldAttemptLog) {
    traceState.lastByReason[reason] = now;
    traceState.suppressedByReason[reason] = 0;
  }

  return runStartCore(reason);
};
