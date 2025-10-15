import { useAppStore } from '@/stores/useAppStore';
import type { AppState } from '@/stores/useAppStore';
import type { HistoryDelta, HistoryDirection } from '../actionTypes';

type ShapeSession = AppState['shapeFill']['session'];

const cloneSession = (session: ShapeSession): ShapeSession => {
  if (!session) {
    return null;
  }
  return {
    ...session,
    points: session.points?.map((point) => ({ ...point })) ?? [],
    params: { ...(session.params ?? {}) },
    paramQueue: [...(session.paramQueue ?? [])],
    shape: session.shape
      ? {
          ...session.shape,
          points: session.shape.points.map((point) => ({ ...point })),
          centroid: { ...session.shape.centroid },
          bounds: { ...session.shape.bounds },
        }
      : undefined,
    cursorAnchorDirection: session.cursorAnchorDirection
      ? { ...session.cursorAnchorDirection }
      : undefined,
    lastCursor: session.lastCursor ? { ...session.lastCursor } : undefined,
  };
};

export interface ShapeSessionDeltaOptions {
  forward: ShapeSession;
  backward: ShapeSession;
}

export class ShapeSessionDelta implements HistoryDelta {
  readonly _tag = 'shape-session';

  private readonly forward: ShapeSession;
  private readonly backward: ShapeSession;

  constructor(options: ShapeSessionDeltaOptions) {
    this.forward = cloneSession(options.forward);
    this.backward = cloneSession(options.backward);
  }

  apply(direction: HistoryDirection): void {
    const session = direction === 'forward' ? this.forward : this.backward;
    useAppStore.setState((state) => ({
      shapeFill: {
        ...state.shapeFill,
        session: cloneSession(session)
      }
    }));
  }
}

export const createShapeSessionDelta = (
  options: ShapeSessionDeltaOptions
): HistoryDelta | null => {
  if (!options.forward && !options.backward) {
    return null;
  }
  return new ShapeSessionDelta(options);
};
