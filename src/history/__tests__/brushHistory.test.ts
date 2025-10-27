import { TextDecoder, TextEncoder } from 'util';

// Polyfill TextEncoder/TextDecoder for environments where they are not defined (e.g., Jest in Node).
(global as unknown as { TextEncoder?: typeof TextEncoder }).TextEncoder = TextEncoder;
(global as unknown as { TextDecoder?: typeof TextDecoder }).TextDecoder = TextDecoder;

import historyManager from '@/history/historyService';
import { commitLayerHistory } from '@/history/helpers/layerHistory';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer, LayerAlignmentSettings } from '@/types';

const DEFAULT_ALIGNMENT: LayerAlignmentSettings = {
  fit: 'none',
  horizontal: 'center',
  vertical: 'center',
  positioning: 'anchor',
};

const CANVAS_SIZE = { width: 2, height: 2 };


const createImage = (pixels: number[]): ImageData => {
  return new ImageData(new Uint8ClampedArray(pixels), CANVAS_SIZE.width, CANVAS_SIZE.height);
};

const cloneImage = (image: ImageData): ImageData =>
  new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);

const createLayer = (id: string, imageData: ImageData): Layer => {
  const framebuffer = document.createElement('canvas');
  framebuffer.width = imageData.width;
  framebuffer.height = imageData.height;
  const ctx = framebuffer.getContext('2d');
  ctx?.putImageData(imageData, 0, 0);

  return {
    id,
    name: 'Layer',
    order: 0,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    layerType: 'normal',
    imageData,
    framebuffer,
    alignment: DEFAULT_ALIGNMENT,
    colorCycleData: undefined,
  };
};

const resetHistoryAndStore = (): void => {
  historyManager.clear();
  useAppStore.setState((state) => ({
    history: {
      ...state.history,
      undoStack: [],
      redoStack: [],
    },
  }));
  useAppStore.setState((state) => ({
    layers: [],
    activeLayerId: null,
    project: state.project
      ? {
          ...state.project,
          layers: [],
        }
      : state.project,
  }));
};

const installLayer = (layer: Layer): void => {
  useAppStore.setState((state) => ({
    layers: [layer],
    activeLayerId: layer.id,
    project: state.project
      ? {
          ...state.project,
          layers: [layer],
          width: layer.imageData?.width ?? state.project.width,
          height: layer.imageData?.height ?? state.project.height,
        }
      : state.project,
  }));
};

const updateLayerImage = (layerId: string, image: ImageData): void => {
  const store = useAppStore.getState();
  const targetLayer = store.layers.find((layer) => layer.id === layerId);
  if (targetLayer?.framebuffer) {
    const ctx = targetLayer.framebuffer.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (ctx && 'putImageData' in ctx) {
      ctx.putImageData(image, 0, 0);
    }
  }

  useAppStore.setState((state) => ({
    layers: state.layers.map((layer) =>
      layer.id === layerId
        ? {
            ...layer,
            imageData: image,
          }
        : layer
    ),
  }));
};

describe('brush history coalescing', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    resetHistoryAndStore();
  });

  afterEach(() => {
    jest.useRealTimers();
    resetHistoryAndStore();
  });

  it('coalesces sequential brush commits sharing the same stroke session', async () => {
    const blank = createImage([
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const strokeA = createImage([
      255, 0, 0, 255,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const strokeB = createImage([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);

    const layer = createLayer('layer-1', cloneImage(blank));
    installLayer(layer);
    const strokeSessionKey = 'session-brush-1';
    const pointerId = 'pen-1';

    updateLayerImage(layer.id, cloneImage(strokeA));
    const sessionStartedAt = Date.now();
    await commitLayerHistory({
      layerId: layer.id,
      beforeImage: cloneImage(blank),
      beforeColorState: null,
      actionType: 'brush',
      description: 'Stroke part A',
      tool: 'brush',
      coalesce: {
        key: strokeSessionKey,
        maxIntervalMs: 500,
        pointerSession: {
          pointerId,
          startedAt: sessionStartedAt,
          endedAt: sessionStartedAt,
        },
      },
    });

    expect(historyManager.entries()).toHaveLength(1);

    jest.advanceTimersByTime(100);

    updateLayerImage(layer.id, cloneImage(strokeB));
    const sessionEndedAt = Date.now();
    await commitLayerHistory({
      layerId: layer.id,
      beforeImage: cloneImage(strokeA),
      beforeColorState: null,
      actionType: 'brush',
      description: 'Stroke part B',
      tool: 'brush',
      coalesce: {
        key: strokeSessionKey,
        maxIntervalMs: 500,
        pointerSession: {
          pointerId,
          startedAt: sessionStartedAt,
          endedAt: sessionEndedAt,
        },
      },
    });

    const entries = historyManager.entries();
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.action).toBe('brush-stroke');

    const meta = (entry.meta ?? {}) as Record<string, unknown>;
    expect(meta.coalescedCount as number).toBe(2);
    expect(meta.coalesceKey as string).toBe(strokeSessionKey);
    const pointerSession = meta.pointerSession as
      | { pointerId: string; startedAt: number; endedAt: number }
      | undefined;
    expect(pointerSession).toMatchObject({
      pointerId,
      startedAt: sessionStartedAt,
      endedAt: sessionEndedAt,
    });
    expect(entry.deltas.length).toBeGreaterThanOrEqual(2);
  });

  it('creates a new history entry when the coalescing window lapses', async () => {
    const blank = createImage([
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const strokeA = createImage([
      0, 0, 0, 0,
      0, 255, 0, 255,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const strokeB = createImage([
      0, 0, 255, 255,
      0, 255, 0, 255,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);

    const layer = createLayer('layer-2', cloneImage(blank));
    installLayer(layer);
    const strokeSessionKey = 'session-brush-2';
    const pointerId = 'pen-2';

    updateLayerImage(layer.id, cloneImage(strokeA));
    const sessionStart = Date.now();
    await commitLayerHistory({
      layerId: layer.id,
      beforeImage: cloneImage(blank),
      beforeColorState: null,
      actionType: 'brush',
      description: 'Stroke initial segment',
      tool: 'brush',
      coalesce: {
        key: strokeSessionKey,
        maxIntervalMs: 100,
        pointerSession: {
          pointerId,
          startedAt: sessionStart,
          endedAt: sessionStart,
        },
      },
    });

    jest.advanceTimersByTime(500);

    updateLayerImage(layer.id, cloneImage(strokeB));
    const resumedAt = Date.now();
    await commitLayerHistory({
      layerId: layer.id,
      beforeImage: cloneImage(strokeA),
      beforeColorState: null,
      actionType: 'brush',
      description: 'Stroke separate segment',
      tool: 'brush',
      coalesce: {
        key: strokeSessionKey,
        maxIntervalMs: 100,
        pointerSession: {
          pointerId,
          startedAt: sessionStart,
          endedAt: resumedAt,
        },
      },
    });

    const entries = historyManager.entries();
    expect(entries).toHaveLength(2);
    const [firstEntry, secondEntry] = entries;
    expect(((firstEntry.meta ?? {}) as Record<string, unknown>).coalescedCount as number).toBe(1);
    expect(((secondEntry.meta ?? {}) as Record<string, unknown>).coalescedCount as number).toBe(1);
    expect(firstEntry.id).not.toBe(secondEntry.id);
  });
});

describe('eraser history persistence', () => {
  beforeEach(() => {
    resetHistoryAndStore();
  });

  afterEach(() => {
    resetHistoryAndStore();
  });

  it('records raster eraser strokes as undoable entries', async () => {
    const filled = createImage([
      255, 0, 0, 255,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const afterErase = createImage([
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const layer = createLayer('eraser-layer', cloneImage(filled));
    installLayer(layer);

    updateLayerImage(layer.id, cloneImage(afterErase));

    await commitLayerHistory({
      layerId: layer.id,
      beforeImage: cloneImage(filled),
      beforeColorState: null,
      actionType: 'eraser',
      description: 'Eraser stroke',
      tool: 'eraser',
      bitmapRoi: { x: 0, y: 0, width: 1, height: 1 },
      skipBitmapDelta: false,
    });

    const entries = historyManager.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe('eraser-stroke');
  });

  it('drops eraser history if bitmap deltas are skipped (regression guard)', async () => {
    const filled = createImage([
      255, 0, 0, 255,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const afterErase = createImage([
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const layer = createLayer('eraser-layer-skip', cloneImage(filled));
    installLayer(layer);

    updateLayerImage(layer.id, cloneImage(afterErase));

    await commitLayerHistory({
      layerId: layer.id,
      beforeImage: cloneImage(filled),
      beforeColorState: null,
      actionType: 'eraser',
      description: 'Skipped bitmap delta',
      tool: 'eraser',
      bitmapRoi: { x: 0, y: 0, width: 1, height: 1 },
      skipBitmapDelta: true,
    });

    expect(historyManager.entries()).toHaveLength(0);
  });
});
