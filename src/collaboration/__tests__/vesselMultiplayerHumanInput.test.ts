import { getVesselMultiplayerSnapshot } from '../vesselMultiplayerSession';
import { getAppStoreState } from '@/stores/appStoreAccess';
import {
  hasActiveVesselMultiplayerHumanGesture,
  recordVesselMultiplayerHumanPointer,
  resetVesselMultiplayerHumanInputForTests,
  subscribeVesselMultiplayerHumanGestures,
} from '../vesselMultiplayerHumanInput';

jest.mock('../vesselMultiplayerSession', () => ({
  getVesselMultiplayerSnapshot: jest.fn(),
}));
jest.mock('@/stores/appStoreAccess', () => ({ getAppStoreState: jest.fn() }));

const mockedSnapshot = getVesselMultiplayerSnapshot as jest.MockedFunction<
  typeof getVesselMultiplayerSnapshot
>;
const mockedAppState = getAppStoreState as jest.MockedFunction<typeof getAppStoreState>;

describe('vesselMultiplayerHumanInput', () => {
  beforeEach(() => {
    resetVesselMultiplayerHumanInputForTests();
    mockedAppState.mockReturnValue({
      project: { id: 'project-1' },
      autosave: { dirtyRevision: 7 },
    } as never);
    mockedSnapshot.mockReturnValue({
      sessionId: 'portrait-together',
      projectId: 'project-1',
      status: 'active',
      humanLayerId: 'jason-layer',
      aiLayerId: 'ai-layer',
      activeGestureId: null,
      aiCursor: null,
      stopReason: null,
      error: null,
      bridgeStatus: 'connected',
      aiState: 'watching',
      aiModel: 'test-model',
      lastObservationAt: null,
      bridgeError: null,
    });
  });

  it('publishes a bounded, throttled human gesture lifecycle', () => {
    const events: Array<{
      phase: string;
      pointCount: number;
      bounds: unknown;
      path: Array<{ x: number; y: number; pressure?: number }>;
    }> = [];
    subscribeVesselMultiplayerHumanGestures((event) => events.push(event));

    recordVesselMultiplayerHumanPointer({
      phase: 'start',
      pointerId: 4,
      pointerType: 'pen',
      point: { x: 10, y: 12, pressure: 0.5 },
      tool: 'brush',
      shapeMode: false,
      occurredAt: 1000,
    });
    expect(hasActiveVesselMultiplayerHumanGesture()).toBe(true);
    recordVesselMultiplayerHumanPointer({
      phase: 'move',
      pointerId: 4,
      pointerType: 'pen',
      point: { x: 14, y: 9, pressure: 0.6 },
      tool: 'brush',
      shapeMode: false,
      occurredAt: 1020,
    });
    recordVesselMultiplayerHumanPointer({
      phase: 'move',
      pointerId: 4,
      pointerType: 'pen',
      point: { x: 20, y: 16, pressure: 0.7 },
      tool: 'brush',
      shapeMode: false,
      occurredAt: 1050,
    });
    recordVesselMultiplayerHumanPointer({
      phase: 'end',
      pointerId: 4,
      pointerType: 'pen',
      point: { x: 22, y: 18, pressure: 0 },
      tool: 'brush',
      shapeMode: false,
      occurredAt: 1070,
    });
    expect(hasActiveVesselMultiplayerHumanGesture()).toBe(false);

    expect(events.map((event) => event.phase)).toEqual(['start', 'move', 'end']);
    expect(events.at(-1)).toMatchObject({
      projectId: 'project-1',
      projectRevision: 7,
      committed: false,
      pointCount: 4,
      bounds: { minX: 10, minY: 9, maxX: 22, maxY: 18 },
      path: [
        { x: 10, y: 12, pressure: 0.5 },
        { x: 14, y: 9, pressure: 0.6 },
        { x: 20, y: 16, pressure: 0.7 },
        { x: 22, y: 18, pressure: 0 },
      ],
    });
  });

  it('keeps a bounded path while preserving its first and latest samples', () => {
    const events: Array<{ phase: string; path: Array<{ x: number; y: number }> }> = [];
    subscribeVesselMultiplayerHumanGestures((event) => events.push(event));

    recordVesselMultiplayerHumanPointer({
      phase: 'start',
      pointerId: 9,
      pointerType: 'pen',
      point: { x: 0, y: 0 },
      tool: 'brush',
      shapeMode: false,
      occurredAt: 1000,
    });
    for (let index = 1; index <= 130; index += 1) {
      recordVesselMultiplayerHumanPointer({
        phase: index === 130 ? 'end' : 'move',
        pointerId: 9,
        pointerType: 'pen',
        point: { x: index, y: index % 7 },
        tool: 'brush',
        shapeMode: false,
        occurredAt: 1000 + index * 50,
      });
    }

    const path = events.at(-1)?.path ?? [];
    expect(path.length).toBeLessThanOrEqual(64);
    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path.at(-1)).toEqual({ x: 130, y: 4 });
  });

  it('does not publish outside an active multiplayer session', () => {
    mockedSnapshot.mockReturnValue({
      ...mockedSnapshot(),
      status: 'stopped',
    });
    const listener = jest.fn();
    subscribeVesselMultiplayerHumanGestures(listener);

    recordVesselMultiplayerHumanPointer({
      phase: 'start',
      pointerId: 7,
      pointerType: 'mouse',
      point: { x: 2, y: 3 },
      tool: 'eraser',
      shapeMode: false,
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it('never lets a bridge listener interrupt the local pointer path', () => {
    subscribeVesselMultiplayerHumanGestures(() => {
      throw new Error('bridge unavailable');
    });

    expect(() => recordVesselMultiplayerHumanPointer({
      phase: 'start',
      pointerId: 8,
      pointerType: 'mouse',
      point: { x: 4, y: 5 },
      tool: 'brush',
      shapeMode: false,
    })).not.toThrow();
  });
});
