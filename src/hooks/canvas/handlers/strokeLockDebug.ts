import { debugLog, isDebugEnabled } from '@/utils/debug';

type StrokeLockTraceEntry = {
  t: number;
  event: string;
  payload?: Record<string, unknown>;
};

const STORAGE_KEY = 'vessel.debug.strokeLock';
const MAX_TRACE = 2000;

type StrokeLockGlobal = typeof globalThis & {
  __STROKE_LOCK_DEBUG__?: boolean;
  __STROKE_LOCK_TRACE__?: StrokeLockTraceEntry[];
  __setStrokeLockDebug?: (enabled: boolean) => void;
  __dumpStrokeLockTrace?: (limit?: number) => StrokeLockTraceEntry[];
  __clearStrokeLockTrace?: () => void;
  localStorage?: Storage;
};

const getGlobal = (): StrokeLockGlobal => globalThis as StrokeLockGlobal;

const readStorageFlag = (): boolean => {
  try {
    return getGlobal().localStorage?.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const isEnabled = (): boolean => {
  const g = getGlobal();
  if (typeof g.__STROKE_LOCK_DEBUG__ === 'boolean') {
    return g.__STROKE_LOCK_DEBUG__;
  }
  return isDebugEnabled('stroke-lock') || readStorageFlag();
};

const ensureTraceBuffer = (): StrokeLockTraceEntry[] => {
  const g = getGlobal();
  if (!Array.isArray(g.__STROKE_LOCK_TRACE__)) {
    g.__STROKE_LOCK_TRACE__ = [];
  }
  return g.__STROKE_LOCK_TRACE__;
};

const installBridge = () => {
  const g = getGlobal();
  if (!g.__setStrokeLockDebug) {
    g.__setStrokeLockDebug = (enabled: boolean) => {
      g.__STROKE_LOCK_DEBUG__ = enabled;
      try {
        g.localStorage?.setItem(STORAGE_KEY, enabled ? '1' : '0');
      } catch {
        // ignore storage failures
      }
    };
  }
  if (!g.__dumpStrokeLockTrace) {
    g.__dumpStrokeLockTrace = (limit = 200) => {
      const trace = ensureTraceBuffer();
      return trace.slice(Math.max(0, trace.length - Math.max(1, limit)));
    };
  }
  if (!g.__clearStrokeLockTrace) {
    g.__clearStrokeLockTrace = () => {
      const trace = ensureTraceBuffer();
      trace.length = 0;
    };
  }
};

installBridge();

export const traceStrokeLock = (
  event: string,
  payload?: Record<string, unknown>
): void => {
  if (!isEnabled()) {
    return;
  }
  const trace = ensureTraceBuffer();
  trace.push({
    t: Date.now(),
    event,
    payload,
  });
  if (trace.length > MAX_TRACE) {
    trace.splice(0, trace.length - MAX_TRACE);
  }
  debugLog('stroke-lock', event, payload ?? {});
};

