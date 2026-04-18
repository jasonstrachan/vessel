import {
  appendDevDebugOverlayEntry,
  DEV_DEBUG_OVERLAY_EVENT,
  readDevDebugOverlayEntries,
  type DevDebugOverlayEntry,
  type DevDebugOverlayLevel,
} from '@/utils/dev/debugOverlayStore';

export type CCDebugOverlayLevel = DevDebugOverlayLevel;

export type CCDebugOverlayEntry = DevDebugOverlayEntry;

export const CC_DEBUG_OVERLAY_EVENT = DEV_DEBUG_OVERLAY_EVENT;

export const appendCCDebugOverlayEntry = (
  level: CCDebugOverlayLevel,
  message: string,
  data?: unknown,
): void => {
  appendDevDebugOverlayEntry({
    source: 'cc',
    level,
    message,
    data,
  });
};

export const readCCDebugOverlayEntries = (): CCDebugOverlayEntry[] =>
  readDevDebugOverlayEntries().filter((entry) => entry.source === 'cc');
