import historyManager from '@/history/historyService';
import { commitStrokeHistoryIfNeeded } from '@/hooks/canvas/handlers/colorCycle/colorCycleStrokeHistory';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape, type Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const createSequentialLayer = (): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  return {
    id: 'layer-seq',
    name: 'Sequential',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    imageData: null,
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType: 'sequential',
    sequentialData: {
      frameCount: 12,
      fps: 12,
      durationMs: 1000,
      events: [
        {
          id: 'event-before',
          layerId: 'layer-seq',
          strokeId: 'stroke-legacy',
          timestampMs: 1,
          frameIndex: 0,
          brush: {
            tool: 'brush',
            brushShape: BrushShape.ROUND,
            size: 8,
            opacity: 1,
            blendMode: 'source-over',
            rotation: 0,
            spacing: 1,
            color: '#ff0000',
            customStampId: null,
          },
          stamps: [{ x: 1, y: 1, pressure: 1, rotation: 0, size: 8, alpha: 1 }],
        },
        {
          id: 'event-session-a',
          layerId: 'layer-seq',
          strokeId: 'stroke-123',
          timestampMs: 2,
          frameIndex: 1,
          brush: {
            tool: 'brush',
            brushShape: BrushShape.ROUND,
            size: 8,
            opacity: 1,
            blendMode: 'source-over',
            rotation: 0,
            spacing: 1,
            color: '#00ff00',
            customStampId: null,
          },
          stamps: [{ x: 2, y: 2, pressure: 1, rotation: 0, size: 8, alpha: 1 }],
        },
        {
          id: 'event-session-b',
          layerId: 'layer-seq',
          strokeId: 'stroke-123',
          timestampMs: 3,
          frameIndex: 2,
          brush: {
            tool: 'brush',
            brushShape: BrushShape.ROUND,
            size: 8,
            opacity: 1,
            blendMode: 'source-over',
            rotation: 0,
            spacing: 1,
            color: '#00ff00',
            customStampId: null,
          },
          stamps: [{ x: 3, y: 2, pressure: 1, rotation: 0, size: 8, alpha: 1 }],
        },
      ],
    },
  };
};

describe('commitStrokeHistoryIfNeeded sequential branch', () => {
  beforeEach(() => {
    historyManager.clear();
    const layer = createSequentialLayer();
    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      project: state.project
        ? { ...state.project, width: 16, height: 16, layers: [layer] }
        : state.project,
      sequentialRecord: {
        ...state.sequentialRecord,
        sessionStartMs: 123,
      },
      history: {
        ...state.history,
        undoStack: [],
        redoStack: [],
      },
    }));
  });

  afterEach(() => {
    historyManager.clear();
  });

  it('commits sequential delta and supports undo/redo', async () => {
    const handled = await commitStrokeHistoryIfNeeded({
      shouldCommit: true,
      activeLayerId: 'layer-seq',
      layerBeforeImage: null,
      layerBeforeColorState: null,
      actionType: 'brush',
      description: 'Sequential stroke',
      tool: 'brush',
      coalesce: {
        key: 'seq-session',
        maxIntervalMs: 500,
        pointerSession: {
          pointerId: 1,
          startedAt: 123,
          endedAt: 200,
        },
      },
      historyBitmapRoi: undefined,
      shouldSkipBitmapDelta: false,
      isColorCycleLayer: false,
      isColorCycleBrush: false,
      deferredLayerCanvas: null,
      strokeCaptureRoi: undefined,
    }, {
      scheduleDeferredColorCycleSave: jest.fn(async () => {}),
      scheduleHistoryCommit: jest.fn(async () => {}),
      captureColorCycleBrushState: jest.fn(() => null),
      perfMark: jest.fn(),
      perfMeasure: jest.fn(),
      debugTime: jest.fn(),
      debugTimeEnd: jest.fn(),
      debugVerbose: jest.fn(),
    });

    expect(handled).toBe(true);
    expect(historyManager.entries()).toHaveLength(1);
    expect(historyManager.entries()[0]?.action).toBe('sequential-stroke');

    await historyManager.undo();
    let layer = useAppStore.getState().layers.find((entry) => entry.id === 'layer-seq');
    expect(layer?.sequentialData?.events.map((event) => event.id)).toEqual(['event-before']);

    await historyManager.redo();
    layer = useAppStore.getState().layers.find((entry) => entry.id === 'layer-seq');
    expect(layer?.sequentialData?.events.map((event) => event.id)).toEqual([
      'event-before',
      'event-session-a',
      'event-session-b',
    ]);
  });

  it('commits one history entry per segmented sequential stroke id', async () => {
    const layer = createSequentialLayer();
    layer.sequentialData = {
      ...layer.sequentialData!,
      events: [
        layer.sequentialData!.events[0],
        {
          ...layer.sequentialData!.events[1],
          id: 'event-segment-1',
          strokeId: 'stroke-123-0',
        },
        {
          ...layer.sequentialData!.events[2],
          id: 'event-segment-2',
          strokeId: 'stroke-123-1',
        },
      ],
    };
    useAppStore.setState((state) => ({
      ...state,
      layers: [layer],
      activeLayerId: layer.id,
      sequentialRecord: {
        ...state.sequentialRecord,
        sessionStartMs: 123,
      },
    }));

    const handled = await commitStrokeHistoryIfNeeded({
      shouldCommit: true,
      activeLayerId: 'layer-seq',
      layerBeforeImage: null,
      layerBeforeColorState: null,
      actionType: 'brush',
      description: 'Segmented sequential stroke',
      tool: 'brush',
      coalesce: {
        key: 'seq-session',
        maxIntervalMs: 500,
        pointerSession: {
          pointerId: 1,
          startedAt: 123,
          endedAt: 200,
        },
      },
      historyBitmapRoi: undefined,
      shouldSkipBitmapDelta: false,
      isColorCycleLayer: false,
      isColorCycleBrush: false,
      deferredLayerCanvas: null,
      strokeCaptureRoi: undefined,
    }, {
      scheduleDeferredColorCycleSave: jest.fn(async () => {}),
      scheduleHistoryCommit: jest.fn(async () => {}),
      captureColorCycleBrushState: jest.fn(() => null),
      perfMark: jest.fn(),
      perfMeasure: jest.fn(),
      debugTime: jest.fn(),
      debugTimeEnd: jest.fn(),
      debugVerbose: jest.fn(),
    });

    expect(handled).toBe(true);
    expect(historyManager.entries()).toHaveLength(2);
    expect(historyManager.entries().every((entry) => entry.action === 'sequential-stroke')).toBe(true);

    await historyManager.undo();
    let afterUndo = useAppStore.getState().layers.find((entry) => entry.id === 'layer-seq');
    expect(afterUndo?.sequentialData?.events.map((event) => event.id)).toEqual([
      'event-before',
      'event-segment-1',
    ]);

    await historyManager.undo();
    afterUndo = useAppStore.getState().layers.find((entry) => entry.id === 'layer-seq');
    expect(afterUndo?.sequentialData?.events.map((event) => event.id)).toEqual(['event-before']);

    await historyManager.redo();
    await historyManager.redo();
    const afterRedo = useAppStore.getState().layers.find((entry) => entry.id === 'layer-seq');
    expect(afterRedo?.sequentialData?.events.map((event) => event.id)).toEqual([
      'event-before',
      'event-segment-1',
      'event-segment-2',
    ]);
  });

  it('does not wait for deferred color-cycle stroke save before returning', async () => {
    const ccLayer = {
      id: 'layer-cc',
      name: 'CC Layer',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: document.createElement('canvas'),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        canvas: document.createElement('canvas'),
      },
    } as unknown as Layer;

    useAppStore.setState((state) => ({
      ...state,
      layers: [ccLayer],
      activeLayerId: ccLayer.id,
    }));

    let releaseDeferred: (() => void) | undefined;
    const deferredSave = new Promise<void>((resolve) => {
      releaseDeferred = resolve;
    });

    const result = await Promise.race([
      commitStrokeHistoryIfNeeded(
        {
          shouldCommit: true,
          activeLayerId: ccLayer.id,
          layerBeforeImage: null,
          layerBeforeColorState: null,
          actionType: 'brush',
          description: 'CC stroke',
          tool: 'brush',
          coalesce: undefined,
          historyBitmapRoi: undefined,
          shouldSkipBitmapDelta: true,
          isColorCycleLayer: true,
          isColorCycleBrush: true,
          deferredLayerCanvas: document.createElement('canvas'),
          strokeCaptureRoi: undefined,
          brushForCleanup: undefined,
        },
        {
          scheduleDeferredColorCycleSave: jest.fn(() => deferredSave),
          scheduleHistoryCommit: jest.fn(async () => undefined),
          captureColorCycleBrushState: jest.fn(() => null),
          perfMark: jest.fn(),
          perfMeasure: jest.fn(),
          debugTime: jest.fn(),
          debugTimeEnd: jest.fn(),
          debugVerbose: jest.fn(),
        }
      ).then(() => 'resolved'),
      new Promise<'timeout'>((resolve) => {
        setTimeout(() => resolve('timeout'), 0);
      }),
    ]);

    expect(result).toBe('resolved');

    releaseDeferred?.();
    await deferredSave;
  });
});
