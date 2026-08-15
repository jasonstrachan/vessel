import type { ReferenceAsset, ReferenceSamplingSource } from '@/types';

export const REFERENCE_STUDIO_CHANNEL_NAME = 'vessel-reference-studio-v1';
const REFERENCE_STUDIO_SESSION_PARAM = 'session';
const REFERENCE_STUDIO_SESSION_STORAGE_KEY = 'vessel-reference-studio-session-v1';
let mainWindowSessionId: string | null = null;

const createSessionId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
};

const readStoredSessionId = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(REFERENCE_STUDIO_SESSION_STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
};

const storeSessionId = (sessionId: string): void => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(REFERENCE_STUDIO_SESSION_STORAGE_KEY, sessionId);
  } catch {
    // Named-window reuse still works until this Vessel tab reloads.
  }
};

export const getReferenceStudioSessionId = (): string => {
  if (mainWindowSessionId) return mainWindowSessionId;
  mainWindowSessionId = readStoredSessionId() ?? createSessionId();
  storeSessionId(mainWindowSessionId);
  return mainWindowSessionId;
};

export const getReferenceStudioSessionIdFromLocation = (): string | null => {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get(REFERENCE_STUDIO_SESSION_PARAM);
  return value?.trim() || null;
};

export interface ReferenceStudioSnapshot {
  project: {
    id: string;
    name: string;
    width: number;
    height: number;
  } | null;
  grid: {
    enabled: boolean;
    rows: number;
    columns: number;
  };
  layers: Array<{
    id: string;
    name: string;
    visible: boolean;
    layerType?: string;
  }>;
  referenceAssets: ReferenceAsset[];
  samplingSource: ReferenceSamplingSource;
}

export type ReferenceStudioMainMessage = {
  type: 'snapshot';
  snapshot: ReferenceStudioSnapshot;
};

export type ReferenceStudioCommand =
  | { type: 'studio-ready' }
  | { type: 'add-reference'; asset: ReferenceAsset }
  | { type: 'update-reference'; id: string; updates: Partial<ReferenceAsset> }
  | { type: 'remove-reference'; id: string }
  | { type: 'reorder-references'; orderedIds: string[] }
  | { type: 'set-sampling-source'; source: ReferenceSamplingSource }
  | { type: 'set-grid'; grid: Partial<ReferenceStudioSnapshot['grid']> };

export const createReferenceStudioChannel = (sessionId: string): BroadcastChannel | null => {
  if (typeof BroadcastChannel === 'undefined') return null;
  return new BroadcastChannel(`${REFERENCE_STUDIO_CHANNEL_NAME}:${sessionId}`);
};

export const openReferenceStudioWindow = (): boolean => {
  if (typeof window === 'undefined') return false;
  const sessionId = getReferenceStudioSessionId();
  const basePath = process.env.VESSEL_BASE_PATH ?? '';
  const url = new URL(`${basePath}/reference-studio/`, window.location.origin);
  url.searchParams.set(REFERENCE_STUDIO_SESSION_PARAM, sessionId);
  const studioWindow = window.open(
    url.toString(),
    `vessel-reference-studio-${sessionId}`,
    'popup=yes,width=1200,height=820,resizable=yes,scrollbars=yes',
  );
  studioWindow?.focus();
  return studioWindow !== null;
};
