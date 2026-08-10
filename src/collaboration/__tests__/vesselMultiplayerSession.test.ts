import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import { commitColorCycleLayerStroke } from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';
import { getAppStoreState } from '@/stores/appStoreAccess';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type { AppState } from '@/stores/useAppStore';
import type { Layer } from '@/types';

import {
  __resetVesselMultiplayerSessionForTests,
  executeVesselMultiplayerGesture,
  getVesselMultiplayerSnapshot,
  startVesselMultiplayerSession,
} from '../vesselMultiplayerSession';

jest.mock('@/history/helpers/colorCycle', () => ({ captureColorCycleBrushState: jest.fn() }));
jest.mock('@/hooks/canvas/handlers/colorCycle/colorCycleCommit', () => ({
  commitColorCycleLayerStroke: jest.fn(),
}));
jest.mock('@/hooks/brushEngine/colorCycleBrushSettingsController', () => ({
  applyColorCycleBrushSettingsPatch: jest.fn(),
}));
jest.mock('@/stores/appStoreAccess', () => ({ getAppStoreState: jest.fn() }));
jest.mock('@/stores/colorCycleBrushManager', () => ({ getColorCycleBrushManager: jest.fn() }));

const mockedGetAppStoreState = getAppStoreState as jest.MockedFunction<typeof getAppStoreState>;
const mockedGetColorCycleBrushManager = getColorCycleBrushManager as jest.MockedFunction<
  typeof getColorCycleBrushManager
>;
const mockedCaptureColorCycleBrushState = captureColorCycleBrushState as jest.MockedFunction<
  typeof captureColorCycleBrushState
>;
const mockedCommitColorCycleLayerStroke = commitColorCycleLayerStroke as jest.MockedFunction<
  typeof commitColorCycleLayerStroke
>;

const createLayer = (id: string, name: string): Layer => ({
  id,
  name,
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  order: 0,
  imageData: null,
  framebuffer: document.createElement('canvas'),
  alignment: {
    fit: 'contain',
    positioning: 'auto',
    horizontal: 'center',
    vertical: 'center',
    offsetPx: { x: 0, y: 0 },
  },
  layerType: 'color-cycle',
  colorCycleData: {
    canvas: document.createElement('canvas'),
    isAnimating: true,
  },
});

const createState = () => {
  const humanLayer = createLayer('human-layer', 'Jason');
  const state = {
    project: { id: 'project-1', name: 'Portrait', width: 100, height: 120 },
    activeLayerId: humanLayer.id,
    layers: [humanLayer],
    tools: {
      brushSettings: {
        size: 12,
        opacity: 1,
        spacing: 2,
        brushShape: 'color-cycle',
        colorCycleGradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
      },
    },
    addLayer: jest.fn(() => {
      state.layers.push(createLayer('ai-layer', 'AI'));
      state.activeLayerId = 'ai-layer';
      return 'ai-layer';
    }),
    ensureColorCycleLayerRuntime: jest.fn(async () => true),
    setActiveLayer: jest.fn((layerId: string) => {
      state.activeLayerId = layerId;
    }),
    updateLayer: jest.fn(),
  };
  return state as unknown as AppState;
};

describe('vesselMultiplayerSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetVesselMultiplayerSessionForTests();
    global.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof requestAnimationFrame;
    mockedCaptureColorCycleBrushState.mockReturnValue({ layers: [] } as never);
    mockedGetColorCycleBrushManager.mockReturnValue({
      getSettingsPatchBrush: jest.fn(() => ({})),
      getStrokeLifecycleBrush: jest.fn(() => ({ endStroke: jest.fn() })),
      getDrawBrush: jest.fn(() => null),
      getFillBrush: jest.fn(() => ({
        fillShapeDispatch: jest.fn(),
        endStroke: jest.fn(),
      })),
      getSurfaceBrush: jest.fn(() => ({ renderDirectToCanvas: jest.fn() })),
      getCommitBrush: jest.fn(() => ({})),
    } as unknown as ReturnType<typeof getColorCycleBrushManager>);
  });

  it('restores Jason\'s active layer when AI runtime preparation fails', async () => {
    const state = createState();
    (state.ensureColorCycleLayerRuntime as jest.Mock).mockRejectedValueOnce(
      new Error('runtime unavailable'),
    );
    mockedGetAppStoreState.mockReturnValue(state);

    await expect(startVesselMultiplayerSession({ sessionId: 'portrait' }))
      .rejects.toThrow('runtime unavailable');

    expect(state.setActiveLayer).toHaveBeenCalledWith('human-layer');
    expect(state.activeLayerId).toBe('human-layer');
  });

  it('does not commit cursor-only shape work when cancellation arrives before fill', async () => {
    const state = createState();
    mockedGetAppStoreState.mockReturnValue(state);
    await startVesselMultiplayerSession({ sessionId: 'portrait' });
    const controller = new AbortController();
    controller.abort('stop');

    await executeVesselMultiplayerGesture({
      sessionId: 'portrait',
      gestureId: 'shape-1',
      actor: 'ai',
      kind: 'shape',
      points: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }],
    }, {
      compositeCanvasDirtyRef: { current: false },
      rebuildStaticComposite: jest.fn(async () => true),
      requestRedraw: jest.fn(),
      scheduleHistoryCommit: jest.fn(async () => undefined),
    }, controller.signal);

    expect(mockedCommitColorCycleLayerStroke).not.toHaveBeenCalled();
    expect(getVesselMultiplayerSnapshot()).toMatchObject({
      status: 'active',
      activeGestureId: null,
    });
  });

  it('commits a multiplayer shape through the canonical queue with a relative direction vector', async () => {
    const state = createState();
    const fillShapeDispatch = jest.fn();
    mockedGetColorCycleBrushManager.mockReturnValue({
      getSettingsPatchBrush: jest.fn(() => ({})),
      getStrokeLifecycleBrush: jest.fn(() => ({ endStroke: jest.fn() })),
      getFillBrush: jest.fn(() => ({ fillShapeDispatch, endStroke: jest.fn() })),
      getSurfaceBrush: jest.fn(() => ({ renderDirectToCanvas: jest.fn() })),
      getCommitBrush: jest.fn(() => ({})),
    } as unknown as ReturnType<typeof getColorCycleBrushManager>);
    mockedGetAppStoreState.mockReturnValue(state);
    mockedCommitColorCycleLayerStroke.mockResolvedValue({ deferredLayerCanvas: null });
    await startVesselMultiplayerSession({ sessionId: 'portrait' });
    const scheduleHistoryCommit = jest.fn(async () => undefined);

    await executeVesselMultiplayerGesture({
      sessionId: 'portrait',
      gestureId: 'shape-linear',
      actor: 'ai',
      kind: 'shape',
      points: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }],
      direction: [{ x: 12, y: 14 }, { x: 32, y: 44 }],
    }, {
      compositeCanvasDirtyRef: { current: false },
      rebuildStaticComposite: jest.fn(async () => true),
      requestRedraw: jest.fn(),
      scheduleHistoryCommit,
    });

    expect(fillShapeDispatch).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'linear',
      direction: { x: 20, y: 30 },
    }));
    expect(scheduleHistoryCommit).toHaveBeenCalledWith(expect.objectContaining({
      layerId: 'ai-layer',
      description: 'AI multiplayer shape',
      skipBitmapDelta: true,
    }));
  });
});
