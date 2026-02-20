import historyManager from '@/history/historyService';
import { commitStrokeHistoryIfNeeded } from '@/hooks/canvas/handlers/colorCycle/colorCycleStrokeHistory';
import {
  captureSequentialStampsForActiveLayer,
  createSequentialEventBufferRuntime,
  createSequentialStampCapRuntime,
  flushBufferedSequentialEvents,
} from '@/hooks/canvas/handlers/sequential/sequentialCapture';
import { getSequentialLayerRenderCanvas } from '@/lib/sequential/SequentialLayerRenderer';
import { useAppStore } from '@/stores/useAppStore';
import { exportProjectAsWebGL } from '@/utils/export/webglExporter';
import { isFeatureFlagEnabled, setFeatureFlag } from '@/config/featureFlags';
import { createDefaultExportLayout, createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import {
  BrushShape,
  type BrushSettings,
  type Layer,
  type Project,
  type SequentialBrushSnapshot,
} from '@/types';

const mockBlobUrl = 'blob:vessel-plugin-sequential';

const createSequentialLayer = (): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 48;

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
          strokeId: 'stroke-before',
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
            color: '#222222',
            customStampId: null,
          },
          stamps: [{ x: 6, y: 6, pressure: 1, rotation: 0, size: 8, alpha: 1 }],
        },
      ],
    },
  };
};

const imageSignature = (canvas: HTMLCanvasElement | OffscreenCanvas): number => {
  const ctx = canvas.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings
  ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) {
    return 0;
  }
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    sum = (sum + data[i] * (i + 1)) >>> 0;
  }
  return sum;
};

const createProject = (layer: Layer): Project => ({
  id: 'project-seq-plugins',
  name: 'Plugin Sequential Workflow',
  width: 48,
  height: 48,
  layers: [layer],
  backgroundColor: '#000000',
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
  customBrushes: [],
});

const historyDeps = {
  scheduleDeferredColorCycleSave: jest.fn(async () => {}),
  scheduleHistoryCommit: jest.fn(async () => {}),
  captureColorCycleBrushState: jest.fn(() => null),
  perfMark: jest.fn(),
  perfMeasure: jest.fn(),
  debugTime: jest.fn(),
  debugTimeEnd: jest.fn(),
  debugVerbose: jest.fn(),
};

const pluginCases: Array<{
  label: string;
  pluginBrushId: 'dither-brush' | 'particle-brush' | 'spam-brush';
  settings: Partial<BrushSettings>;
  assertConfig: (config: SequentialBrushSnapshot['pluginConfig'] | undefined) => void;
}> = [
  {
    label: 'dither',
    pluginBrushId: 'dither-brush',
    settings: {
      ditherAlgorithm: 'pattern',
      ditherPaletteSpread: 37,
      fillResolution: 4,
    },
    assertConfig: (config) => {
      expect(config?.ditherAlgorithm).toBe('pattern');
      expect(config?.ditherIntensity).toBe(37);
      expect(config?.ditherBayerMatrixSize).toBe(4);
    },
  },
  {
    label: 'particle',
    pluginBrushId: 'particle-brush',
    settings: {
      particleDensity: 41,
      particleScatterRadius: 2.75,
    },
    assertConfig: (config) => {
      expect(config?.particleDensity).toBe(41);
      expect(config?.particleScatterRadius).toBe(2.75);
    },
  },
  {
    label: 'spam',
    pluginBrushId: 'spam-brush',
    settings: {
      spamFont: 'consolas',
      spamContentType: 'crypto',
      spamCustomText: 'ALPHA-TEST',
    },
    assertConfig: (config) => {
      expect(config?.spamFont).toBe('consolas');
      expect(config?.spamContentType).toBe('crypto');
      expect(config?.spamCustomText).toBe('ALPHA-TEST');
    },
  },
];

let previousSequentialRecordFlag = false;
let previousTemporalDistributionFlag = true;

describe('plugin sequential workflow parity', () => {
  beforeAll(() => {
    if (typeof HTMLCanvasElement !== 'undefined') {
      Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
        configurable: true,
        writable: true,
        value: function toBlob(callback: BlobCallback, type?: string): void {
          const blob = new Blob([''], { type: type ?? 'image/png' });
          setTimeout(() => callback(blob), 0);
        },
      });
    }
    if (typeof HTMLAnchorElement !== 'undefined') {
      Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
        configurable: true,
        writable: true,
        value: () => {},
      });
    }
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn(() => mockBlobUrl),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn(),
    });
  });

  afterAll(() => {
    delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
  });

  beforeEach(() => {
    historyManager.clear();
    previousSequentialRecordFlag = isFeatureFlagEnabled('enableSequentialRecordMode');
    previousTemporalDistributionFlag = isFeatureFlagEnabled('enableSequentialTemporalDistribution');
    setFeatureFlag('enableSequentialRecordMode', true);
    setFeatureFlag('enableSequentialTemporalDistribution', true);
  });

  afterEach(() => {
    historyManager.clear();
    setFeatureFlag('enableSequentialRecordMode', previousSequentialRecordFlag);
    setFeatureFlag('enableSequentialTemporalDistribution', previousTemporalDistributionFlag);
  });

  jest.setTimeout(20000);

  it.each(pluginCases)(
    'captures $label plugin settings and preserves replay/export across undo/redo',
    async ({ pluginBrushId, settings, assertConfig }) => {
      const layer = createSequentialLayer();
      useAppStore.setState((state) => ({
        ...state,
        layers: [layer],
        activeLayerId: layer.id,
        project: state.project
          ? { ...state.project, width: 48, height: 48, layers: [layer] }
          : state.project,
        tools: {
          ...state.tools,
          currentTool: 'brush',
          brushSettings: {
            ...state.tools.brushSettings,
            size: 14,
            opacity: 1,
            spacing: 1,
            color: '#00ff66',
            blendMode: 'source-over',
            ...settings,
          },
        },
        sequentialRecord: {
          ...state.sequentialRecord,
          sessionStartMs: 1000,
          isPointerDown: true,
          fps: 12,
          frameCount: 12,
          durationMs: 1000,
          currentFrame: 1,
          timeSmear: 1,
        },
        history: {
          ...state.history,
          undoStack: [],
          redoStack: [],
        },
      }));

      const runtime = createSequentialStampCapRuntime();
      const eventBufferRuntime = createSequentialEventBufferRuntime();
      const state = useAppStore.getState();
      const accepted = captureSequentialStampsForActiveLayer({
        state,
        runtime,
        eventBufferRuntime,
        pluginBrushId,
        nowMs: 1200,
        stamps: [
          { x: 24, y: 24, pressure: 1, rotation: 0, size: 14, alpha: 1 },
          { x: 26, y: 24, pressure: 1, rotation: 0, size: 14, alpha: 1 },
        ],
      });
      expect(accepted).toBeGreaterThan(0);
      flushBufferedSequentialEvents({ state, runtime: eventBufferRuntime });

      const postCaptureLayer = useAppStore
        .getState()
        .layers.find((entry) => entry.id === layer.id);
      const pluginEvent = postCaptureLayer?.sequentialData?.events.at(-1);
      const pluginEventSnapshot = pluginEvent ? JSON.parse(JSON.stringify(pluginEvent)) : null;
      expect(pluginEvent?.brush.pluginBrushId).toBe(pluginBrushId);
      assertConfig(pluginEvent?.brush.pluginConfig);

      const renderedBefore = getSequentialLayerRenderCanvas({
        layer: postCaptureLayer as Layer,
        width: 48,
        height: 48,
        frameIndex: 1,
      });
      expect(renderedBefore).not.toBeNull();
      const signatureBefore = imageSignature(renderedBefore as HTMLCanvasElement | OffscreenCanvas);
      expect(signatureBefore).toBeGreaterThan(0);

      const handled = await commitStrokeHistoryIfNeeded({
        shouldCommit: true,
        activeLayerId: layer.id,
        layerBeforeImage: null,
        layerBeforeColorState: null,
        actionType: 'brush',
        description: 'Plugin sequential stroke',
        tool: 'brush',
        coalesce: {
          key: `seq-${pluginBrushId}`,
          maxIntervalMs: 500,
          pointerSession: {
            pointerId: 1,
            startedAt: 1000,
            endedAt: 1200,
          },
        },
        historyBitmapRoi: undefined,
        shouldSkipBitmapDelta: false,
        isColorCycleLayer: false,
        isColorCycleBrush: false,
        deferredLayerCanvas: null,
        strokeCaptureRoi: undefined,
      }, historyDeps);
      expect(handled).toBe(true);
      expect(historyManager.entries()).toHaveLength(1);
      expect(historyManager.entries()[0]?.action).toBe('sequential-stroke');

      await historyManager.undo();
      const undoLayer = useAppStore.getState().layers.find((entry) => entry.id === layer.id);
      expect(undoLayer?.sequentialData?.events).toHaveLength(1);
      const renderedAfterUndo = getSequentialLayerRenderCanvas({
        layer: undoLayer as Layer,
        width: 48,
        height: 48,
        frameIndex: 1,
      });
      const signatureAfterUndo = imageSignature(
        renderedAfterUndo as HTMLCanvasElement | OffscreenCanvas
      );
      expect(signatureAfterUndo).toBeGreaterThan(0);

      await historyManager.redo();
      const redoLayer = useAppStore.getState().layers.find((entry) => entry.id === layer.id);
      const redoPluginEvent = redoLayer?.sequentialData?.events.at(-1);
      expect(redoPluginEvent?.brush.pluginBrushId).toBe(pluginBrushId);
      assertConfig(redoPluginEvent?.brush.pluginConfig);
      expect(redoPluginEvent).toEqual(pluginEventSnapshot);

      const renderedAfterRedo = getSequentialLayerRenderCanvas({
        layer: redoLayer as Layer,
        width: 48,
        height: 48,
        frameIndex: 1,
      });
      const signatureAfterRedo = imageSignature(
        renderedAfterRedo as HTMLCanvasElement | OffscreenCanvas
      );
      expect(signatureAfterRedo).toBeGreaterThan(0);

      const project = createProject(redoLayer as Layer);
      const metadata = await exportProjectAsWebGL({
        project,
        layers: [redoLayer as Layer],
        layout: createDefaultExportLayout(),
        viewport: { mode: 'fit', designWidth: project.width, designHeight: project.height },
        fps: 12,
        totalFrames: 12,
        durationSeconds: 1,
        perfectLoop: false,
        includeHiddenLayers: true,
        embedCanvasFallback: false,
        minify: false,
        filenameBase: `plugin-${pluginBrushId}-seq`,
        bundleFormat: 'json',
        gobletVersion: 'goblet2',
      });

      expect(metadata.layers).toHaveLength(1);
      const exportedLayer = metadata.layers[0];
      expect(exportedLayer.type).toBe('sequential');
      expect(Array.isArray(exportedLayer.assets?.textureFrames)).toBe(true);
      expect((exportedLayer.assets?.textureFrames?.length ?? 0)).toBeGreaterThan(0);
      expect(exportedLayer.sequential?.fps).toBe(12);
      expect(exportedLayer.sequential?.totalFrames).toBe(12);
    }
  );
});
