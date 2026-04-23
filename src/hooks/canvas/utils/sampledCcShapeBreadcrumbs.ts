import { debugLog, isDebugEnabled, recordBreadcrumb } from '@/utils/debug';

const SAMPLED_CC_SHAPE_SCOPE = 'sampled-cc-shape';

const EVENT_MIN_INTERVAL_MS: Record<string, number> = {
  'preview-frame-start': 250,
  'sampled-preview-dispatch': 150,
  'sampled-worker-begin': 0,
  'sampled-publish': 0,
  'pointer-down': 0,
  'pointer-up': 0,
  'finalize-begin': 0,
  'finalize-end': 0,
};

type SampledCcShapeBreadcrumbPayload = {
  event: string;
  [key: string]: unknown;
};

const lastBreadcrumbByEvent = new Map<string, { at: number; signature: string }>();

const shouldRecordBreadcrumb = (event: string, signature: string, now: number): boolean => {
  const previous = lastBreadcrumbByEvent.get(event);
  if (previous?.signature === signature) {
    return false;
  }

  const minIntervalMs = EVENT_MIN_INTERVAL_MS[event] ?? 0;
  if (previous && minIntervalMs > 0 && now - previous.at < minIntervalMs) {
    return false;
  }

  lastBreadcrumbByEvent.set(event, { at: now, signature });
  return true;
};

export const recordSampledCcShapeBreadcrumb = (
  payload: SampledCcShapeBreadcrumbPayload,
): void => {
  const entry = { ...payload };
  const signature = JSON.stringify(entry);
  const now = Date.now();
  if (!shouldRecordBreadcrumb(payload.event, signature, now)) {
    return;
  }

  if (isDebugEnabled(SAMPLED_CC_SHAPE_SCOPE)) {
    debugLog(SAMPLED_CC_SHAPE_SCOPE, entry);
  }
  recordBreadcrumb(SAMPLED_CC_SHAPE_SCOPE, entry);
};

export const resetSampledCcShapeBreadcrumbState = (): void => {
  lastBreadcrumbByEvent.clear();
};
