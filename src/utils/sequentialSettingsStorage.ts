import { debugWarn } from '@/utils/debug';
const STORAGE_KEY = 'vessel:sequential-settings';

export interface SequentialSettingsPayload {
  timeSmear?: number;
  temporalSpreadFrames?: number;
  trailFalloff?: number;
  burstFrames?: number;
  gapFrames?: number;
}

let storageOverride: Storage | null = null;

export const __setSequentialSettingsStorageOverride = (storage: Storage | null): void => {
  storageOverride = storage;
};

const isValidStorage = (candidate: Storage | null | undefined): candidate is Storage =>
  Boolean(
    candidate &&
    typeof candidate.getItem === 'function' &&
    typeof candidate.setItem === 'function'
  );

const getLocalStorage = (): Storage | null => {
  if (storageOverride) {
    return isValidStorage(storageOverride) ? storageOverride : null;
  }
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return isValidStorage(window.localStorage) ? window.localStorage : null;
  } catch {
    return null;
  }
};

const sanitizeTimeSmear = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0.1, Math.min(160, value));
};

const sanitizeNumber = (
  value: unknown,
  min: number,
  max: number,
  integer = false,
): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const clamped = Math.max(min, Math.min(max, value));
  return integer ? Math.round(clamped) : clamped;
};

export const loadSequentialSettings = (): SequentialSettingsPayload | null => {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as SequentialSettingsPayload;
    const payload: SequentialSettingsPayload = {};
    const timeSmear = sanitizeTimeSmear(parsed?.timeSmear);
    const temporalSpreadFrames = sanitizeNumber(parsed?.temporalSpreadFrames, 1, 32, true);
    const trailFalloff = sanitizeNumber(parsed?.trailFalloff, 0, 1);
    const burstFrames = sanitizeNumber(parsed?.burstFrames, 1, 32, true);
    const gapFrames = sanitizeNumber(parsed?.gapFrames, 0, 64, true);
    if (typeof timeSmear === 'number') payload.timeSmear = timeSmear;
    if (typeof temporalSpreadFrames === 'number') payload.temporalSpreadFrames = temporalSpreadFrames;
    if (typeof trailFalloff === 'number') payload.trailFalloff = trailFalloff;
    if (typeof burstFrames === 'number') payload.burstFrames = burstFrames;
    if (typeof gapFrames === 'number') payload.gapFrames = gapFrames;
    return Object.keys(payload).length > 0 ? payload : null;
  } catch (error) {
    debugWarn('raw-console', '[SequentialSettingsStorage] Failed to load settings', error);
    return null;
  }
};

export const saveSequentialSettings = (payload: SequentialSettingsPayload): void => {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  try {
    const sanitized: SequentialSettingsPayload = {};
    const timeSmear = sanitizeTimeSmear(payload.timeSmear);
    if (typeof timeSmear === 'number') {
      sanitized.timeSmear = timeSmear;
    }
    const temporalSpreadFrames = sanitizeNumber(payload.temporalSpreadFrames, 1, 32, true);
    const trailFalloff = sanitizeNumber(payload.trailFalloff, 0, 1);
    const burstFrames = sanitizeNumber(payload.burstFrames, 1, 32, true);
    const gapFrames = sanitizeNumber(payload.gapFrames, 0, 64, true);
    if (typeof temporalSpreadFrames === 'number') sanitized.temporalSpreadFrames = temporalSpreadFrames;
    if (typeof trailFalloff === 'number') sanitized.trailFalloff = trailFalloff;
    if (typeof burstFrames === 'number') sanitized.burstFrames = burstFrames;
    if (typeof gapFrames === 'number') sanitized.gapFrames = gapFrames;
    storage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  } catch (error) {
    debugWarn('raw-console', '[SequentialSettingsStorage] Failed to save settings', error);
  }
};
