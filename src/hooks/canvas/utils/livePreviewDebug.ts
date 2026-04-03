import { debugLog, isDebugEnabled, recordBreadcrumb } from '@/utils/debug';

const LIVE_PREVIEW_SCOPE = 'live-preview';

type LivePreviewPayload = Record<string, unknown>;

export const isLivePreviewDebugEnabled = (): boolean => isDebugEnabled(LIVE_PREVIEW_SCOPE);

export const logLivePreview = (
  event: string,
  payload?: LivePreviewPayload,
): void => {
  if (!isLivePreviewDebugEnabled()) {
    return;
  }

  const data = payload ? { event, ...payload } : { event };
  debugLog(LIVE_PREVIEW_SCOPE, data);
  recordBreadcrumb(LIVE_PREVIEW_SCOPE, data);
};
