import { exportProjectAsWebGL } from '@/utils/export/webglExporter';
import { createDefaultLayerAlignment, createDefaultExportLayout } from '@/utils/layoutDefaults';
import { buildForegroundDerivedGradientSpec, deriveForegroundGradientStops } from '@/utils/colorCycleGradients';
import { FLOW_SLOT_MASK } from '@/lib/colorCycle/flowEncoding';
import { hashStops } from '@/utils/colorCycleGradientDefs';
import { BrushShape, type Layer, type Project } from '@/types';

jest.mock('@/stores/colorCycleBrushManager', () => {
  const mockManager = {
    brushes: new Map(),
    brushMetadata: new Map(),
    activeResources: new Set(),
    createBrush: jest.fn(),
    getBrush: jest.fn(),
    updateBrush: jest.fn(),
    deleteBrush: jest.fn(),
    setActiveState: jest.fn(),
    cleanupInactive: jest.fn(),
    cleanupAll: jest.fn(),
    initColorCycleForLayer: jest.fn(() => true),
    getLayerColorCycleBrush: jest.fn(() => null),
    validateColorCycleBrush: jest.fn(() => true),
    removeColorCycleBrush: jest.fn(),
    cleanupOrphanedBrushes: jest.fn(),
    transferColorCycleBrush: jest.fn(() => true),
    setCanvasImplementation: jest.fn()
  } as const;

  return {
    getColorCycleBrushManager: () => mockManager,
    setColorCycleStoreStateGetter: jest.fn(),
    setLayerIdGetter: jest.fn()
  };
});

const mockBlobUrl = 'blob:vessel-test';

jest.setTimeout(15000);

beforeAll(() => {
  if (typeof HTMLCanvasElement !== 'undefined') {
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
      configurable: true,
      writable: true,
      value: function toBlob(callback: BlobCallback, type?: string, quality?: number): void {
        const mime = type ?? 'image/png';
        const blob = new Blob([''], { type: mime });
        setTimeout(() => callback(blob), 0);
      }
    });
  }

  if (typeof HTMLAnchorElement !== 'undefined') {
    Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
      configurable: true,
      writable: true,
      value: () => {}
    });
  }

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: jest.fn(() => mockBlobUrl)
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: jest.fn()
  });
});

afterAll(() => {
  delete (URL as Record<string, unknown>).createObjectURL;
  delete (URL as Record<string, unknown>).revokeObjectURL;
});

const createColorCycleLayer = (canvas: HTMLCanvasElement): Layer => {
  const indexBuffer = new Uint8Array([
    0, 4, 8, 12,
    16, 20, 24, 28,
    32, 36, 40, 44,
    48, 52, 56, 60
  ]);

  const gradientStops = [
    { position: 0, color: '#ff0000' },
    { position: 0.5, color: '#00ff00' },
    { position: 1, color: '#0000ff' }
  ];

  return {
    id: 'cc-layer',
    name: 'Color Cycle Layer',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    transparencyLocked: false,
    order: 0,
    imageData: null,
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType: 'color-cycle',
    colorCycleData: {
      mode: 'recolor',
      isAnimating: true,
      brushSpeed: 0.25,
      gradient: gradientStops,
      canvas,
      recolorSettings: {
        quantizationMode: 'rgb332',
        ditherMode: 'off',
        animation: {
          speed: 0.25,
          fps: 30,
          ticksPerFrame: 1,
          isPlaying: true,
          currentTick: 0,
          flowDirection: 'forward'
        },
        cycleColors: 16,
        gradient: gradientStops,
        mappingMode: 'banded',
        flowMapping: 'palette',
        indexBuffer,
        palette: new Uint32Array([0xff0000ff, 0x00ff00ff, 0x0000ffff]),
        currentLOD: 'full'
      }
    },
    version: 1
  };
};

const createBrushModeLayer = (canvas: HTMLCanvasElement): Layer => {
  const gradientStops = [
    { position: 0, color: '#ffd700' },
    { position: 0.5, color: '#adff2f' },
    { position: 1, color: '#1e90ff' }
  ];

  const brushIndices = new Uint8Array(Array.from({ length: 64 }, (_, idx) => idx % 16));
  const gradientIdBuffer = new Uint8Array(Array.from({ length: 64 }, (_, idx) => idx % 2));
  const slotPalettes = [
    {
      slot: 0,
      stops: gradientStops
    },
    {
      slot: 1,
      stops: [
        { position: 0, color: '#ff69b4' },
        { position: 0.5, color: '#ffa500' },
        { position: 1, color: '#7fffd4' }
      ]
    }
  ];
  const gradientDefStore = [
    {
      id: 1,
      kind: 'linear' as const,
      stops: gradientStops,
      hash: hashStops(gradientStops, 'linear'),
      source: 'manual' as const,
      createdAtMs: Date.now(),
      slot: 0,
      speedCps: 0.25
    },
    {
      id: 2,
      kind: 'linear' as const,
      stops: slotPalettes[1].stops,
      hash: hashStops(slotPalettes[1].stops, 'linear'),
      source: 'manual' as const,
      createdAtMs: Date.now(),
      slot: 1,
      speedCps: 0.5
    }
  ];

  const mockBrush = {
    serialize: () => ({
      layers: [
        {
          layerId: 'cc-brush-layer',
          data: {
            indexBuffer: {
              width: 8,
              height: 8,
              data: brushIndices,
              palette: ['#ffd700', '#adff2f', '#1e90ff'],
              gradientId: gradientIdBuffer
            },
            gradient: {
              gradientStops
            },
            animation: {
              offset: 2,
              stats: {
                targetFPS: 24
              }
            }
          }
        }
      ],
      cycleSpeed: 0.35,
      fps: 24,
      brushSize: 14
    }),
    commitCurrentStroke: jest.fn(),
    getCanvas: () => canvas,
    isPlaying: () => true
  };

  return {
    id: 'cc-brush-layer',
    name: 'Color Cycle Brush',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    transparencyLocked: false,
    order: 1,
    imageData: null,
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType: 'color-cycle',
    colorCycleData: {
      mode: 'brush',
      isAnimating: true,
      brushSpeed: 0.35,
      gradient: gradientStops,
      slotPalettes,
      gradientDefStore,
      canvas,
      colorCycleBrush: mockBrush as unknown as Layer['colorCycleData']['colorCycleBrush']
    },
    version: 1
  };
};

const createForegroundDerivedLayer = (canvas: HTMLCanvasElement): {
  layer: Layer;
  derivedStops: Array<{ position: number; color: string }>;
  fgSlot: number;
} => {
  const baseStops = [
    { position: 0, color: '#222222' },
    { position: 0.5, color: '#666666' },
    { position: 1, color: '#aaaaaa' }
  ];

  const derivedSpec = buildForegroundDerivedGradientSpec({
    baseColor: '#33ccff',
    lightness: 52,
    hueShift: 10,
    saturationShift: 8,
    opacity: 90,
    bands: 4
  });
  const derivedStops = deriveForegroundGradientStops(derivedSpec);
  const fgSlot = 5;

  const brushIndices = new Uint8Array(Array.from({ length: 64 }, (_, idx) => idx % 16));
  const gradientIdBuffer = new Uint8Array(Array.from({ length: 64 }, () => fgSlot));

  const mockBrush = {
    serialize: () => ({
      layers: [
        {
          layerId: 'cc-fg-layer',
          data: {
            indexBuffer: {
              width: 8,
              height: 8,
              data: brushIndices,
              palette: ['#222222', '#666666', '#aaaaaa'],
              gradientId: gradientIdBuffer
            },
            gradient: {
              gradientStops: []
            },
            animation: {
              offset: 0,
              stats: {
                targetFPS: 24
              }
            }
          }
        }
      ],
      cycleSpeed: 0.2,
      fps: 24,
      brushSize: 10
    }),
    commitCurrentStroke: jest.fn(),
    getCanvas: () => canvas,
    isPlaying: () => true
  };

  const layer: Layer = {
    id: 'cc-fg-layer',
    name: 'Color Cycle FG Derived',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    transparencyLocked: false,
    order: 2,
    imageData: null,
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType: 'color-cycle',
    colorCycleData: {
      mode: 'brush',
      isAnimating: true,
      brushSpeed: 0.2,
      gradientDefs: [{ id: 'g0', currentSlot: 0 }],
      slotPalettes: [
        { slot: 0, stops: baseStops }
      ],
      fgActiveSlot: fgSlot,
      fgDerivedKey: derivedSpec.key,
      fgDerivedGradients: [{ key: derivedSpec.key, slot: fgSlot, spec: derivedSpec }],
      canvas,
      colorCycleBrush: mockBrush as unknown as Layer['colorCycleData']['colorCycleBrush']
    },
    version: 1
  };

  return { layer, derivedStops, fgSlot };
};

const createProject = (layer: Layer): Project => ({
  id: 'project-cc',
  name: 'Color Cycle Export',
  width: 128,
  height: 128,
  layers: [layer],
  backgroundColor: '#101010',
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-02T00:00:00Z'),
  customBrushes: [],
  viewState: { zoom: 1 }
});

const createSequentialLayer = (
  canvas: HTMLCanvasElement,
  options?: { includeSecondFrameEvent?: boolean }
): Layer => ({
  id: 'seq-layer',
  name: 'Sequential Layer',
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  transparencyLocked: false,
  order: 0,
  imageData: null,
  framebuffer: canvas,
  alignment: createDefaultLayerAlignment(),
  layerType: 'sequential',
  sequentialData: {
    frameCount: 2,
    fps: 12,
    durationMs: Math.round((2 * 1000) / 12),
    events: [
      {
        id: 'seq-event-0',
        layerId: 'seq-layer',
        strokeId: 'seq-stroke-0',
        timestampMs: 0,
        frameIndex: 0,
        brush: {
          tool: 'brush',
          brushShape: BrushShape.ROUND,
          size: 6,
          opacity: 1,
          blendMode: 'source-over',
          rotation: 0,
          spacing: 1,
          color: '#ff0000'
        },
        stamps: [
          {
            x: 16,
            y: 16,
            pressure: 1,
            rotation: 0,
            size: 6,
            alpha: 1
          }
        ]
      },
      ...(options?.includeSecondFrameEvent
        ? [{
            id: 'seq-event-1',
            layerId: 'seq-layer',
            strokeId: 'seq-stroke-1',
            timestampMs: 83,
            frameIndex: 1,
            brush: {
              tool: 'brush',
              brushShape: BrushShape.SQUARE,
              size: 8,
              opacity: 1,
              blendMode: 'source-over' as const,
              rotation: 0,
              spacing: 1,
              color: '#00ff00'
            },
            stamps: [
              {
                x: 44,
                y: 44,
                pressure: 1,
                rotation: 0,
                size: 8,
                alpha: 1
              }
            ]
          }]
        : [])
    ]
  },
  version: 1
});

const createEraseMaskData = (
  width: number,
  height: number,
  shouldErase: (x: number, y: number) => boolean
): ImageData => {
  const mask = new ImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4 + 3;
      mask.data[idx] = shouldErase(x, y) ? 255 : 0;
    }
  }
  return mask;
};

describe('exportProjectAsWebGL color cycle integration', () => {
  it('includes recolor metadata for color-cycle layers in single HTML exports', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;

    const layer = createColorCycleLayer(canvas);
    const project = createProject(layer);
    const layout = createDefaultExportLayout();

    const metadata = await exportProjectAsWebGL({
      project,
      layers: [layer],
      layout,
      viewport: { designWidth: project.width, designHeight: project.height, mode: 'fixed' },
      fps: 30,
      totalFrames: 60,
      durationSeconds: 2,
      perfectLoop: false,
      includeHiddenLayers: true,
      embedCanvasFallback: false,
      minify: false,
      filenameBase: 'color-cycle-export',
      bundleFormat: 'json'
    });

    expect(metadata.format).toBe('vessel-goblet2');
    expect(metadata.colorCycle?.schemaVersion).toBe(2);
    expect(metadata.layers).toHaveLength(1);
    const exportedLayer = metadata.layers[0];
    expect(exportedLayer.id).toBe('cc-layer');
    expect(exportedLayer.colorCycle).toBeDefined();
    expect(exportedLayer.colorCycle?.mode).toBe('recolor');
    expect(exportedLayer.colorCycle?.recolorSettings).toBeDefined();
    expect(exportedLayer.colorCycle?.recolorSettings?.indexBuffer).toBeDefined();
    expect(exportedLayer.colorCycle?.recolorSettings?.gradient).toHaveLength(3);
  });

  it('serializes brush state metadata for brush-mode color-cycle layers', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;

    const layer = createBrushModeLayer(canvas);
    const project = createProject(layer);
    const layout = createDefaultExportLayout();

    const metadata = await exportProjectAsWebGL({
      project,
      layers: [layer],
      layout,
      viewport: { designWidth: project.width, designHeight: project.height, mode: 'fixed' },
      fps: 24,
      totalFrames: 48,
      durationSeconds: 2,
      perfectLoop: false,
      includeHiddenLayers: true,
      embedCanvasFallback: false,
      minify: false,
      filenameBase: 'color-cycle-brush-export',
      bundleFormat: 'json'
    });

    expect(metadata.format).toBe('vessel-goblet2');
    expect(metadata.colorCycle?.schemaVersion).toBe(2);
    expect(metadata.layers).toHaveLength(1);
    const exportedLayer = metadata.layers[0];
    expect(exportedLayer.id).toBe('cc-brush-layer');
    expect(exportedLayer.colorCycle).toBeDefined();
    expect(exportedLayer.colorCycle?.mode).toBe('brush');
    expect(exportedLayer.colorCycle?.brushState).toBeDefined();
    expect(exportedLayer.colorCycle?.brushState?.indexBuffer).toBeDefined();
    expect(exportedLayer.colorCycle?.brushState?.gradientStops).toHaveLength(3);
    expect(exportedLayer.colorCycle?.brushState?.alphaMode).toBe('source');
  });

  it('exports sequential layer frame textures for Goblet playback', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const sequentialLayer = createSequentialLayer(canvas);
    const project = createProject(sequentialLayer);

    const metadata = await exportProjectAsWebGL({
      project,
      layers: [sequentialLayer],
      layout: createDefaultExportLayout(),
      viewport: {
        mode: 'fit',
        designWidth: project.width,
        designHeight: project.height
      },
      fps: 12,
      totalFrames: 2,
      durationSeconds: 2 / 12,
      perfectLoop: true,
      includeHiddenLayers: false,
      embedCanvasFallback: false,
      minify: false,
      filenameBase: 'sequential-goblet',
      bundleFormat: 'json',
      gobletVersion: 'goblet2'
    });

    const exportedLayer = metadata.layers[0];
    expect(exportedLayer.type).toBe('sequential');
    expect(Array.isArray(exportedLayer.assets?.textureFrames)).toBe(true);
    expect(exportedLayer.assets?.textureFrames).toHaveLength(1);
    expect(exportedLayer.assets?.textureFrameMap).toEqual([0, -1]);
    expect(exportedLayer.assets?.texture).toBe(exportedLayer.assets?.textureFrames?.[0]);
    expect(exportedLayer.sequential?.fps).toBe(12);
    expect(exportedLayer.sequential?.totalFrames).toBe(2);
  });

  it('maps all populated sequential frames for Goblet playback', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const sequentialLayer = createSequentialLayer(canvas, { includeSecondFrameEvent: true });
    const project = createProject(sequentialLayer);

    const metadata = await exportProjectAsWebGL({
      project,
      layers: [sequentialLayer],
      layout: createDefaultExportLayout(),
      viewport: {
        mode: 'fit',
        designWidth: project.width,
        designHeight: project.height
      },
      fps: 12,
      totalFrames: 2,
      durationSeconds: 2 / 12,
      perfectLoop: true,
      includeHiddenLayers: false,
      embedCanvasFallback: false,
      minify: false,
      filenameBase: 'sequential-goblet-animated',
      bundleFormat: 'json',
      gobletVersion: 'goblet2'
    });

    const exportedLayer = metadata.layers[0];
    expect(exportedLayer.type).toBe('sequential');
    const frameMap = exportedLayer.assets?.textureFrameMap ?? [];
    expect(frameMap).toHaveLength(2);
    expect(frameMap[0]).toBeGreaterThanOrEqual(0);
    expect(frameMap[1]).toBeGreaterThanOrEqual(0);
    expect(exportedLayer.assets?.textureFrames?.length ?? 0).toBeGreaterThan(0);
  });

  it('emits minified sequential frame metadata keys in JSON bundles', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const sequentialLayer = createSequentialLayer(canvas);
    const project = createProject(sequentialLayer);

    let capturedBlob: Blob | null = null;
    (URL.createObjectURL as jest.Mock).mockImplementation((blob: Blob) => {
      capturedBlob = blob;
      return mockBlobUrl;
    });

    await exportProjectAsWebGL({
      project,
      layers: [sequentialLayer],
      layout: createDefaultExportLayout(),
      viewport: {
        mode: 'fit',
        designWidth: project.width,
        designHeight: project.height
      },
      fps: 12,
      totalFrames: 2,
      durationSeconds: 2 / 12,
      perfectLoop: true,
      includeHiddenLayers: false,
      embedCanvasFallback: false,
      minify: true,
      filenameBase: 'sequential-goblet-min',
      bundleFormat: 'json',
      gobletVersion: 'goblet2'
    });

    expect(capturedBlob).not.toBeNull();
    const minifiedJson = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.readAsText(capturedBlob!);
    });
    const payload = JSON.parse(minifiedJson) as {
      l?: Array<{ as?: { txf?: string[]; txfm?: number[] }; sq?: { fps?: number; tfm?: number } }>;
    };
    expect(Array.isArray(payload.l)).toBe(true);
    const firstLayer = payload.l?.[0];
    expect(Array.isArray(firstLayer?.as?.txf)).toBe(true);
    expect(firstLayer?.as?.txf).toHaveLength(1);
    expect(firstLayer?.as?.txfm).toEqual([0, -1]);
    expect(firstLayer?.sq?.fps).toBe(12);
    expect(firstLayer?.sq?.tfm).toBe(2);

    (URL.createObjectURL as jest.Mock).mockImplementation(() => mockBlobUrl);
  });

  it('exports slot palettes and gradient id buffers for brush-mode color-cycle layers', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;

    const layer = createBrushModeLayer(canvas);
    const project = createProject(layer);
    const layout = createDefaultExportLayout();

    const metadata = await exportProjectAsWebGL({
      project,
      layers: [layer],
      layout,
      viewport: { designWidth: project.width, designHeight: project.height, mode: 'fixed' },
      fps: 24,
      totalFrames: 48,
      durationSeconds: 2,
      perfectLoop: false,
      includeHiddenLayers: true,
      embedCanvasFallback: false,
      minify: false,
      filenameBase: 'color-cycle-brush-slots',
      bundleFormat: 'json',
      gobletVersion: 'goblet1'
    });

    const exportedLayer = metadata.layers[0];
    const slotPalettes = exportedLayer.colorCycle?.slotPalettes ?? [];
    expect(slotPalettes).toHaveLength(2);
    expect(slotPalettes[0]?.slot).toBe(0);
    expect(slotPalettes[0]?.stops).toHaveLength(3);
    expect(slotPalettes[1]?.slot).toBe(1);
    expect(slotPalettes[1]?.stops).toHaveLength(3);

    const gradientIdBuffer = exportedLayer.colorCycle?.brushState?.gradientIdBuffer;
    expect(gradientIdBuffer).toBeDefined();
    if (typeof gradientIdBuffer === 'string') {
      expect(gradientIdBuffer.length).toBeGreaterThan(0);
    } else if (Array.isArray(gradientIdBuffer)) {
      expect(gradientIdBuffer.length).toBeGreaterThan(0);
    }

    expect(exportedLayer.colorCycle?.speedMode).toBe('slot');
    const slotSpeeds = exportedLayer.colorCycle?.slotSpeeds ?? [];
    expect(slotSpeeds).toHaveLength(2);
    const speedBySlot = new Map(slotSpeeds.map((entry) => [entry.slot, entry.speed]));
    expect(speedBySlot.get(0)).toBeCloseTo(0.25, 5);
    expect(speedBySlot.get(1)).toBeCloseTo(0.5, 5);
  });

  it('preserves 8-bit gradient id buffers during export', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;

    const gradientStops = [
      { position: 0, color: '#ffd700' },
      { position: 0.5, color: '#adff2f' },
      { position: 1, color: '#1e90ff' }
    ];

    const brushIndices = new Uint8Array(Array.from({ length: 64 }, (_, idx) => idx % 16));
    const gradientIdBuffer = new Uint8Array(
      Array.from({ length: 64 }, (_, idx) => (idx * 4) % 256)
    );

    const mockBrush = {
      serialize: () => ({
        layers: [
          {
            layerId: 'cc-flow-layer',
            data: {
              indexBuffer: {
                width: 8,
                height: 8,
                data: brushIndices,
                palette: ['#ffd700', '#adff2f', '#1e90ff'],
                gradientId: gradientIdBuffer
              },
              gradient: {
                gradientStops
              },
              animation: {
                offset: 2,
                stats: {
                  targetFPS: 24
                }
              }
            }
          }
        ],
        cycleSpeed: 0.35,
        fps: 24,
        brushSize: 14
      }),
      commitCurrentStroke: jest.fn(),
      getCanvas: () => canvas,
      isPlaying: () => true
    };

    const layer: Layer = {
      id: 'cc-flow-layer',
      name: 'Color Cycle Flow',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 1,
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        mode: 'brush',
        isAnimating: true,
        brushSpeed: 0.35,
        gradient: gradientStops,
        slotPalettes: [{ slot: 0, stops: gradientStops }],
        canvas,
        colorCycleBrush: mockBrush as unknown as Layer['colorCycleData']['colorCycleBrush']
      },
      version: 1
    };

    const project = createProject(layer);
    const layout = createDefaultExportLayout();

    const metadata = await exportProjectAsWebGL({
      project,
      layers: [layer],
      layout,
      viewport: { designWidth: project.width, designHeight: project.height, mode: 'fixed' },
      fps: 24,
      totalFrames: 48,
      durationSeconds: 2,
      perfectLoop: false,
      includeHiddenLayers: true,
      embedCanvasFallback: false,
      minify: false,
      filenameBase: 'color-cycle-flow',
      bundleFormat: 'json'
    });

    const exportedLayer = metadata.layers[0];
    const exportedGradientIds = exportedLayer.colorCycle?.brushState?.gradientIdBuffer;
    expect(Array.isArray(exportedGradientIds)).toBe(true);
    if (Array.isArray(exportedGradientIds)) {
      const max = Math.max(...exportedGradientIds);
      expect(max).toBeGreaterThan(63);
      expect(max).toBeLessThanOrEqual(FLOW_SLOT_MASK);
    }
  });

  it('embeds brush-mode color cycle data in single-file HTML bundle', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;

    const layer = createBrushModeLayer(canvas);
    const project = createProject(layer);
    const layout = createDefaultExportLayout();

    const templateHtml = [
      '<!DOCTYPE html>',
      '<html>',
      '<body>',
      '<canvas id="app"></canvas>',
      '<script type="module">',
      'console.log("placeholder viewer");',
      '</script>',
      '</body>',
      '</html>'
    ].join('\n');

    const gobletRuntime = [
      "import './alignFitResolver.js';",
      "import './num.js';",
      "import './fflate-inflate.js';",
      'export const expandVesselMetadata = (meta) => meta;',
      'export async function renderVesselWebGL(metadata) {',
      '  return { layerCount: metadata.layers?.length ?? 0 };',
      '}'
    ].join('\n');

    const alignRuntime = [
      'export const normalizeAlignment = () => ({ fit: "contain", horizontal: "center", vertical: "center" });',
      'export const computeLayerTransform = () => ({ scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 });',
      'export const computeLayerDestination = () => ({ width: 1, height: 1 });'
    ].join('\n');

    const numRuntime = [
      'export const posInt = (value) => value | 0;',
      'export const round3 = (value) => value;',
      'export const toNum = (value, fallback = 0) => {',
      '  const n = Number(value);',
      '  return Number.isFinite(n) ? n : fallback;',
      '};'
    ].join('\n');

    const inflateRuntime = 'export const inflateRaw = () => new Uint8Array();';

    const originalFetch = (globalThis as unknown as { fetch?: typeof fetch }).fetch;
    const fetchMock = jest.fn(async (url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url.toString();
      if (target.endsWith('index.html')) {
        return { ok: true, text: async () => templateHtml, status: 200 } as Response;
      }
      if (target.endsWith('goblet.js')) {
        return { ok: true, text: async () => gobletRuntime, status: 200 } as Response;
      }
      if (target.endsWith('alignFitResolver.js')) {
        return { ok: true, text: async () => alignRuntime, status: 200 } as Response;
      }
      if (target.endsWith('num.js')) {
        return { ok: true, text: async () => numRuntime, status: 200 } as Response;
      }
      if (target.endsWith('fflate-inflate.js')) {
        return { ok: true, text: async () => inflateRuntime, status: 200 } as Response;
      }
      throw new Error(`Unexpected asset request: ${target}`);
    });
    (globalThis as unknown as { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    let capturedBlob: Blob | null = null;
    (URL.createObjectURL as jest.Mock).mockImplementation((blob: Blob) => {
      capturedBlob = blob;
      return mockBlobUrl;
    });

    await exportProjectAsWebGL({
      project,
      layers: [layer],
      layout,
      viewport: { designWidth: project.width, designHeight: project.height, mode: 'fixed' },
      fps: 24,
      totalFrames: 24,
      durationSeconds: 1,
      perfectLoop: false,
      includeHiddenLayers: true,
      embedCanvasFallback: false,
      minify: false,
      filenameBase: 'color-cycle-single',
      bundleFormat: 'single-html',
      gobletVersion: 'goblet1'
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(capturedBlob).not.toBeNull();
    const htmlOutput = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.readAsText(capturedBlob!);
    });
    expect(htmlOutput).toContain('cc-brush-layer');
    expect(htmlOutput).toContain('colorCycle');
    expect(htmlOutput).toContain('brushState');
    expect(htmlOutput).toContain('alphaMode');

    if (originalFetch) {
      (globalThis as unknown as { fetch?: typeof fetch }).fetch = originalFetch;
    } else {
      delete (globalThis as unknown as { fetch?: typeof fetch }).fetch;
    }
    (URL.createObjectURL as jest.Mock).mockImplementation(() => mockBlobUrl);
  });

  it('exports foreground-derived gradients as slot palettes for Goblet', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;

    const { layer, derivedStops, fgSlot } = createForegroundDerivedLayer(canvas);
    const project = createProject(layer);
    const layout = createDefaultExportLayout();

    const metadata = await exportProjectAsWebGL({
      project,
      layers: [layer],
      layout,
      viewport: { designWidth: project.width, designHeight: project.height, mode: 'fixed' },
      fps: 24,
      totalFrames: 48,
      durationSeconds: 2,
      perfectLoop: false,
      includeHiddenLayers: true,
      embedCanvasFallback: false,
      minify: false,
      filenameBase: 'color-cycle-fg-derived',
      bundleFormat: 'json'
    });

    const exportedLayer = metadata.layers[0];
    const slotPalettes = exportedLayer.colorCycle?.slotPalettes ?? [];
    const fgPalette = slotPalettes.find((entry) => entry.slot === fgSlot);
    expect(fgPalette).toBeDefined();
    expect(fgPalette?.stops).toEqual(derivedStops);
    const gradientRef = exportedLayer.colorCycle?.gradientRef;
    expect(typeof gradientRef).toBe('number');
    if (typeof gradientRef === 'number') {
      expect(metadata.gradients?.[gradientRef]).toEqual(derivedStops);
    }
  });

  it('synthesizes a fallback texture for brush-mode layers without drawable canvases', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;

    const layer = createBrushModeLayer(canvas);
    const project = createProject(layer);
    const layout = createDefaultExportLayout();

    const metadata = await exportProjectAsWebGL({
      project,
      layers: [layer],
      layout,
      viewport: { designWidth: project.width, designHeight: project.height, mode: 'fixed' },
      fps: 24,
      totalFrames: 24,
      durationSeconds: 1,
      perfectLoop: false,
      includeHiddenLayers: true,
      embedCanvasFallback: false,
      minify: false,
      filenameBase: 'color-cycle-brush-synth-texture',
      bundleFormat: 'json'
    });

    const exportedLayer = metadata.layers[0];
    expect(exportedLayer.assets?.texture).toMatch(/^data:image\//);
    expect(exportedLayer.source.width).toBe(8);
    expect(exportedLayer.source.height).toBe(8);
    expect(exportedLayer.source.width).toBe(exportedLayer.contentBounds.width);
    expect(exportedLayer.source.height).toBe(exportedLayer.contentBounds.height);
  });

  it('shrinks brush coverage and layout bounds after applying erase masks', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;

    const layer = createBrushModeLayer(canvas);
    const mask = createEraseMaskData(8, 8, (x) => x < 4);
    layer.colorCycleData!.eraseMaskImageData = mask;

    const project = createProject(layer);
    const layout = createDefaultExportLayout();

    const metadata = await exportProjectAsWebGL({
      project,
      layers: [layer],
      layout,
      viewport: { designWidth: project.width, designHeight: project.height, mode: 'fixed' },
      fps: 24,
      totalFrames: 24,
      durationSeconds: 1,
      perfectLoop: false,
      includeHiddenLayers: true,
      embedCanvasFallback: false,
      minify: false,
      filenameBase: 'color-cycle-brush-mask',
      bundleFormat: 'json'
    });

    const exportedLayer = metadata.layers[0];
    expect(exportedLayer.colorCycle?.coverageBoundsPx).toEqual({ x: 64, y: 0, width: 64, height: 128 });
    expect(exportedLayer.documentBoundsPx).toEqual(exportedLayer.colorCycle?.coverageBoundsPx);
  });

  it('derives recolor coverage from indices while respecting erase masks', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;

    const layer = createColorCycleLayer(canvas);
    layer.colorCycleData!.eraseMaskImageData = createEraseMaskData(4, 4, (_x, y) => y === 0);

    const project = createProject(layer);
    project.width = 40;
    project.height = 40;
    const layout = createDefaultExportLayout();

    const metadata = await exportProjectAsWebGL({
      project,
      layers: [layer],
      layout,
      viewport: { designWidth: project.width, designHeight: project.height, mode: 'fixed' },
      fps: 30,
      totalFrames: 60,
      durationSeconds: 2,
      perfectLoop: false,
      includeHiddenLayers: true,
      embedCanvasFallback: false,
      minify: false,
      filenameBase: 'color-cycle-recolor-mask',
      bundleFormat: 'json'
    });

    const exportedLayer = metadata.layers[0];
    expect(exportedLayer.colorCycle?.coverageBoundsPx).toEqual({ x: 0, y: 10, width: 40, height: 30 });
    expect(exportedLayer.documentBoundsPx).toEqual(exportedLayer.colorCycle?.coverageBoundsPx);
  });

});
