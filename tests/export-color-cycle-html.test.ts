import { exportProjectAsWebGL } from '@/utils/export/webglExporter';
import { createDefaultLayerAlignment, createDefaultExportLayout } from '@/utils/layoutDefaults';
import type { Layer, Project } from '@/types';

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
              palette: ['#ffd700', '#adff2f', '#1e90ff']
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
      canvas,
      colorCycleBrush: mockBrush as unknown as Layer['colorCycleData']['colorCycleBrush']
    },
    version: 1
  };
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

    expect(metadata.layers).toHaveLength(1);
    const exportedLayer = metadata.layers[0];
    expect(exportedLayer.id).toBe('cc-brush-layer');
    expect(exportedLayer.colorCycle).toBeDefined();
    expect(exportedLayer.colorCycle?.mode).toBe('brush');
    expect(exportedLayer.colorCycle?.brushState).toBeDefined();
    expect(exportedLayer.colorCycle?.brushState?.indexBuffer).toBeDefined();
    expect(exportedLayer.colorCycle?.brushState?.gradientStops).toHaveLength(3);
    expect(exportedLayer.colorCycle?.brushState?.alphaMode).toBe('opaque-indices');
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
      bundleFormat: 'single-html'
    });

    expect(fetchMock).toHaveBeenCalledTimes(5);
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

});
