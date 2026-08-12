import { getVesselMultiplayerSnapshot } from './vesselMultiplayerSession';
import { getAppStoreState } from '@/stores/appStoreAccess';

export type VesselMultiplayerHumanGesturePhase = 'start' | 'move' | 'end' | 'cancel';

export interface VesselMultiplayerHumanGestureEvent {
  eventId: string;
  type: 'human-gesture';
  actor: 'human';
  phase: VesselMultiplayerHumanGesturePhase;
  sessionId: string;
  projectId: string;
  projectRevision: number;
  gestureId: string;
  humanLayerId: string;
  tool: 'brush' | 'eraser';
  shapeMode: boolean;
  pointerType: string;
  point: { x: number; y: number; pressure?: number };
  path: Array<{ x: number; y: number; pressure?: number }>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  pointCount: number;
  occurredAt: number;
  committed: boolean;
  committedAt?: number;
  elapsedMs: number;
}

interface HumanPointerInput {
  phase: VesselMultiplayerHumanGesturePhase;
  pointerId: number;
  pointerType: string;
  point: { x: number; y: number; pressure?: number };
  tool: 'brush' | 'eraser';
  shapeMode: boolean;
  occurredAt?: number;
}

interface ActiveHumanGesture {
  gestureId: string;
  sessionId: string;
  humanLayerId: string;
  projectId: string;
  startedAt: number;
  lastPublishedAt: number;
  pointCount: number;
  path: VesselMultiplayerHumanGestureEvent['path'];
  bounds: VesselMultiplayerHumanGestureEvent['bounds'];
}

const MOVE_PUBLISH_INTERVAL_MS = 50;
const MAX_GESTURE_PATH_POINTS = 64;
const listeners = new Set<(event: VesselMultiplayerHumanGestureEvent) => void>();
const activeGestures = new Map<number, ActiveHumanGesture>();
let fallbackId = 0;

export const isVesselMultiplayerHumanPointerRelevant = (
  phase: VesselMultiplayerHumanGesturePhase,
  pointerId: number,
) => {
  const snapshot = getVesselMultiplayerSnapshot();
  return snapshot.status === 'active' && (
    phase === 'start' || activeGestures.has(pointerId)
  );
};

const createId = (prefix: string) => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  fallbackId += 1;
  return `${prefix}-${Date.now().toString(36)}-${fallbackId.toString(36)}`;
};

const finitePoint = (point: HumanPointerInput['point']) => (
  Number.isFinite(point.x) && Number.isFinite(point.y)
);

const extendBounds = (
  bounds: VesselMultiplayerHumanGestureEvent['bounds'],
  point: HumanPointerInput['point'],
) => ({
  minX: Math.min(bounds.minX, point.x),
  minY: Math.min(bounds.minY, point.y),
  maxX: Math.max(bounds.maxX, point.x),
  maxY: Math.max(bounds.maxY, point.y),
});

const clonePoint = (point: HumanPointerInput['point']) => ({
  x: point.x,
  y: point.y,
  ...(Number.isFinite(point.pressure) ? { pressure: point.pressure } : {}),
});

const appendPathPoint = (
  path: VesselMultiplayerHumanGestureEvent['path'],
  point: HumanPointerInput['point'],
) => {
  if (path.length >= MAX_GESTURE_PATH_POINTS) {
    const decimated = path.filter((_, index) => index === 0 || index % 2 === 1);
    path.splice(0, path.length, ...decimated);
  }
  path.push(clonePoint(point));
};

const publish = (
  input: HumanPointerInput,
  active: ActiveHumanGesture,
  occurredAt: number,
) => {
  const event: VesselMultiplayerHumanGestureEvent = {
    eventId: createId('human-event'),
    type: 'human-gesture',
    actor: 'human',
    phase: input.phase,
    sessionId: active.sessionId,
    projectId: active.projectId,
    projectRevision: getAppStoreState().autosave.dirtyRevision,
    gestureId: active.gestureId,
    humanLayerId: active.humanLayerId,
    tool: input.tool,
    shapeMode: input.shapeMode,
    pointerType: input.pointerType,
    point: clonePoint(input.point),
    path: active.path.map(clonePoint),
    bounds: { ...active.bounds },
    pointCount: active.pointCount,
    occurredAt,
    committed: false,
    elapsedMs: Math.max(0, occurredAt - active.startedAt),
  };
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Collaboration telemetry must never interrupt Jason's local pointer path.
    }
  }
};

export const recordVesselMultiplayerHumanPointer = (input: HumanPointerInput) => {
  if (!finitePoint(input.point)) return;
  const snapshot = getVesselMultiplayerSnapshot();
  const appState = getAppStoreState();
  const occurredAt = input.occurredAt ?? Date.now();

  if (
    snapshot.status !== 'active' ||
    !snapshot.sessionId ||
    !snapshot.humanLayerId ||
    !snapshot.projectId ||
    appState.project?.id !== snapshot.projectId
  ) {
    activeGestures.delete(input.pointerId);
    return;
  }

  if (input.phase === 'start') {
    const active: ActiveHumanGesture = {
      gestureId: createId('human-gesture'),
      sessionId: snapshot.sessionId,
      humanLayerId: snapshot.humanLayerId,
      projectId: snapshot.projectId,
      startedAt: occurredAt,
      lastPublishedAt: occurredAt,
      pointCount: 1,
      path: [clonePoint(input.point)],
      bounds: {
        minX: input.point.x,
        minY: input.point.y,
        maxX: input.point.x,
        maxY: input.point.y,
      },
    };
    activeGestures.set(input.pointerId, active);
    publish(input, active, occurredAt);
    return;
  }

  const active = activeGestures.get(input.pointerId);
  if (!active || active.sessionId !== snapshot.sessionId) return;
  active.pointCount += 1;
  active.bounds = extendBounds(active.bounds, input.point);
  appendPathPoint(active.path, input.point);

  if (input.phase === 'move' && occurredAt - active.lastPublishedAt < MOVE_PUBLISH_INTERVAL_MS) {
    return;
  }

  active.lastPublishedAt = occurredAt;
  publish(input, active, occurredAt);
  if (input.phase === 'end' || input.phase === 'cancel') {
    activeGestures.delete(input.pointerId);
  }
};

export const subscribeVesselMultiplayerHumanGestures = (
  listener: (event: VesselMultiplayerHumanGestureEvent) => void,
) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const hasActiveVesselMultiplayerHumanGesture = () => activeGestures.size > 0;

export const resetVesselMultiplayerHumanInputForTests = () => {
  activeGestures.clear();
  listeners.clear();
  fallbackId = 0;
};
