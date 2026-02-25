import { CC_DEBUG } from '@/debug/ccDebug';
import { createPerfDebug } from '@/hooks/canvas/utils/perfDebug';

export const BRUSH_HISTORY_COALESCE_WINDOW_MS = 250;
export const STOP_COOLDOWN_MS = 200;
export const START_CC_TRACE_THROTTLE_MS = 2000;
export const SYNTHETIC_STOP_THROTTLE_MS = 200;
export const START_CC_COOLDOWN_MS = 200;
export const SKIP_CC_LOG_THROTTLE_MS = 1000;
export const HISTORY_FINALIZE_LANE = '__history__';
export const CC_SAMPLE_COUNT_WRITE_MS = 150;
export const CC_SAMPLED_RUNTIME_FLUSH_THROTTLE_MS = 90;
export const ROI_PADDING_PX = 2;

export const SYNTHETIC_CC_STOP_REASONS = new Set<string>([
  'shape-tool-start',
  'shape-tool-drag',
  'pointer-drag',
  'layer-create',
  'layer-switch',
  'overlay-reinit',
  'unknown',
  'event',
]);

export const createDrawingHandlersPerf = ({
  perfMark,
  perfMeasure,
  timeAsync,
}: {
  perfMark: (name: string) => void;
  perfMeasure: (name: string, start: string, end: string) => void;
  timeAsync: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
}) =>
  createPerfDebug({
    perfMark,
    perfMeasure,
    timeAsync,
    debugEnabled: () => CC_DEBUG.on,
    debugTimingEnabled: () => CC_DEBUG.timing,
    debugVerboseEnabled: () => CC_DEBUG.verbose,
  });
