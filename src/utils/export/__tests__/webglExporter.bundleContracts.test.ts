import JSZip from 'jszip';

import { registerColorCycleBrushSerializedStateRuntime } from '@/lib/colorCycle/document';
import { exportProjectAsWebGL } from '@/utils/export/webglExporter';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { DisplayFilterConfig, ExportContainerLayout, Layer, Project } from '@/types';

const downloadedBlobs: Blob[] = [];

const readBlobText = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result ?? ''));
  reader.onerror = () => reject(reader.error);
  reader.readAsText(blob);
});

const readBlobArrayBuffer = (blob: Blob): Promise<ArrayBuffer> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as ArrayBuffer);
  reader.onerror = () => reject(reader.error);
  reader.readAsArrayBuffer(blob);
});

const getModuleScriptContent = (html: string): string => {
  const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  return match?.[1] ?? '';
};

const createProject = (): Project => ({
  id: 'project-1',
  name: 'Bundle Contracts',
  width: 64,
  height: 32,
  layers: [],
  backgroundColor: '#102030',
  createdAt: new Date(),
  updatedAt: new Date(),
  customBrushes: [],
});

const layout: ExportContainerLayout = {
  flow: 'row',
  justify: 'center',
  align: 'center',
  wrap: false,
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  sizeMode: 'fixed',
  width: 64,
  height: 32,
};

const createNormalLayer = (id: string, order: number, groupId?: string): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 32;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = order === 0 ? '#ff0000' : '#0000ff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  return {
    id,
    name: id,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order,
    imageData: null,
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    groupId,
    layerType: 'normal',
  };
};

const createDenseBrushLayer = (): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 32;
  const width = 64;
  const height = 32;
  const length = width * height;
  const brushIndices = new Uint8Array(Array.from({ length }, (_, idx) => (idx % 251) + 1));
  const gradientIdBuffer = new Uint8Array(Array.from({ length }, (_, idx) => idx % 2));
  const gradientDefIdBuffer = new Uint16Array(Array.from({ length }, () => 1));
  const speedBuffer = new Uint8Array(Array.from({ length }, () => 128));
  const flowBuffer = new Uint8Array(Array.from({ length }, () => 1));
  const phaseBuffer = new Uint8Array(Array.from({ length }, (_, idx) => idx & 255));
  const gradientStops = [
    { position: 0, color: '#000000' },
    { position: 1, color: '#ffffff' },
  ];
  const colorCycleBrush = {
    getCanvas: () => canvas,
    isPlaying: () => true,
    getColorCycleLayerDocument: () => ({
      read: () => ({
        version: 4,
        snapshot: {
          layerId: 'dense-brush',
          width,
          height,
          paintBuffer: brushIndices.buffer.slice(0),
          gradientIdBuffer: gradientIdBuffer.buffer.slice(0),
          gradientDefIdBuffer: gradientDefIdBuffer.buffer.slice(0),
          speedBuffer: speedBuffer.buffer.slice(0),
          flowBuffer: flowBuffer.buffer.slice(0),
          phaseBuffer: phaseBuffer.buffer.slice(0),
          slotPalettes: [{
            slot: 1,
            stops: gradientStops,
          }],
          gradientDefs: [{ id: 'dense-gradient', currentSlot: 1 }],
          gradientDefStore: [{
            id: 1,
            kind: 'linear' as const,
            stops: gradientStops,
            hash: 'dense-gradient',
            source: 'manual' as const,
            createdAtMs: 1,
            slot: 1,
          }],
          activeGradientId: 'dense-gradient',
          paintSlot: 1,
          fgActiveSlot: 1,
          layerBaseSpeedCps: 1,
          flowMode: 'forward' as const,
          hasContent: true,
          sources: {
            brushStateSnapshot: false,
            topLevelBuffers: false,
            legacyStateRefs: false,
          },
        },
      }),
    }),
  } as unknown as NonNullable<NonNullable<Layer['colorCycleData']>['colorCycleBrush']>;
  registerColorCycleBrushSerializedStateRuntime(colorCycleBrush, {
    read: () => ({
      layers: [
        {
          layerId: 'dense-brush',
          data: {
            indexBuffer: {
              width,
              height,
              data: brushIndices,
              palette: ['#000000', '#ffffff'],
              gradientId: gradientIdBuffer,
              gradientDefId: gradientDefIdBuffer,
              speedData: speedBuffer,
              flowData: flowBuffer,
              phaseData: phaseBuffer,
            },
            gradient: { gradientStops },
            animation: {
              offset: 0,
              stats: { targetFPS: 24 },
            },
          },
        },
      ],
      cycleSpeed: 0.25,
      fps: 24,
    }),
  });

  return {
    id: 'dense-brush',
    name: 'Dense Brush',
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
      mode: 'brush',
      isAnimating: true,
      brushSpeed: 0.25,
      gradient: gradientStops,
      canvas,
      colorCycleBrush,
    },
    version: 1,
  } as Layer;
};

const baseExportRequest = () => {
  const project = createProject();
  return {
    project,
    layers: [],
    layout,
    viewport: {
      designWidth: project.width,
      designHeight: project.height,
      mode: 'fit' as const,
    },
    fps: 24,
    totalFrames: 1,
    durationSeconds: 1,
    perfectLoop: true,
    includeHiddenLayers: true,
    embedCanvasFallback: false,
    minify: false,
    filenameBase: 'bundle-contract',
    gobletVersion: 'goblet2' as const,
    htmlTitle: 'Custom <Goblet>',
    htmlBackgroundColor: '#123abc',
  };
};

const gobletTemplate = `
<!doctype html>
<html>
  <head><title>Goblet</title></head>
  <body style="background:#000000">
    <canvas id="canvas"></canvas>
    <script type="module">
      import { renderVesselWebGL } from './goblet2.js';
      const canvas = document.querySelector('canvas');
      const setStatus = () => {};
      const summarizeMetadata = () => {};
      const computeScale = () => 1;
    </script>
  </body>
</html>`;

const assetContentFor = (target: string): string => {
  if (target.endsWith('index.html')) {
    return gobletTemplate;
  }
  if (target.endsWith('goblet2-inline.js')) {
    return [
      'export const expandVesselMetadata = (metadata) => metadata;',
      'export async function renderVesselWebGL() { return { ok: true }; }',
    ].join('\n');
  }
  if (target.endsWith('goblet2.js')) {
    return [
      "import { createDisplayFilterPipelineState } from './displayFilterPipeline.js';",
      'function clamp01(value) { return Math.max(0, Math.min(1, value)); }',
      'export const expandVesselMetadata = (metadata) => metadata;',
      'export async function renderVesselWebGL() { createDisplayFilterPipelineState(); return { ok: clamp01(1) }; }',
    ].join('\n');
  }
  if (target.endsWith('alignFitResolver.js')) {
    return [
      'export const normalizeAlignment = () => ({});',
      'export const computeLayerTransform = () => ({});',
      'export const computeLayerDestination = () => ({});',
    ].join('\n');
  }
  if (target.endsWith('displayFilterPipeline.js')) {
    return [
      'const clamp01 = (value) => Math.max(0, Math.min(1, value));',
      'export const getSeamlessNoisePatternSize = () => 1;',
      'export const createTileableNoiseGrid = () => [];',
      'export const createDisplayFilterPipelineState = () => ({});',
      'export const getNextFilterWorkCanvas = (currentCanvas, workCanvasA) => workCanvasA ?? currentCanvas;',
      'export const ensureDisplayFilterCanvas = () => null;',
      'export const clearDisplayFilterCanvas = () => null;',
      'export const getDisplayFilterByIdFromList = () => undefined;',
      'export const hasEnabledDisplayFiltersInList = () => false;',
      'export const applyDisplayFilterStack = ({ sourceCanvas }) => clamp01(1) ? sourceCanvas : sourceCanvas;',
    ].join('\n');
  }
  if (target.endsWith('gobletPlaybackMath.js')) {
    return [
      'export const resolveZeroPreservingAlpha = (alpha) => alpha;',
      'export const resolveZeroPreservingAlphaByte = (alpha) => alpha;',
    ].join('\n');
  }
  if (target.endsWith('gobletPayloadContract.js')) {
    return 'export const GOBLET2_SCHEMA_VERSION = 2;';
  }
  if (target.endsWith('num.js')) {
    return 'export const round3 = (value) => value;';
  }
  if (target.endsWith('fflate-inflate.js')) {
    return 'export const inflateRaw = () => new Uint8Array();';
  }
  throw new Error(`Unexpected Goblet asset request: ${target}`);
};

beforeEach(() => {
  downloadedBlobs.length = 0;

  Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
    configurable: true,
    writable: true,
    value: function toBlob(callback: BlobCallback, type?: string): void {
      callback(new Blob([new Uint8Array([1])], { type: type ?? 'image/png' }));
    },
  });
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: jest.fn((blob: Blob) => {
      downloadedBlobs.push(blob);
      return `blob:bundle-contract-${downloadedBlobs.length}`;
    }),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: jest.fn(),
  });
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  global.fetch = jest.fn(async (target: RequestInfo | URL) => {
    const url = String(target);
    return {
      ok: true,
      status: 200,
      text: async () => assetContentFor(url),
    } as Response;
  });
});

afterEach(() => {
  delete (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).toBlob;
  delete (URL as unknown as Record<string, unknown>).createObjectURL;
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
  delete (global as Record<string, unknown>).fetch;
  jest.restoreAllMocks();
});

describe('webglExporter bundle contracts', () => {
  it('serializes ordered Interlace groups into Goblet metadata', async () => {
    const project = createProject();
    const layers = [
      createNormalLayer('pose-a', 0, 'interlace-1'),
      createNormalLayer('pose-b', 1, 'interlace-1'),
    ];
    project.layers = layers;
    project.layerGroups = [{
      id: 'interlace-1',
      name: 'Interlace 1',
      kind: 'interlace',
      interlace: {
        cellSize: 10,
        dominance: 0.92,
        patternPreset: 'sierra-travel',
        motionMode: 'fixed',
        direction: 'right',
        travelCycles: 1,
        loopDurationSeconds: 10,
        seed: 91,
      },
    }];

    const metadata = await exportProjectAsWebGL({
      ...baseExportRequest(),
      project,
      layers,
      bundleFormat: 'json',
      colorCyclePlaybackSpeedScale: 2,
    });

    expect(metadata.interlaceGroups).toEqual([{
      id: 'interlace-1',
      layerIds: ['pose-a', 'pose-b'],
      settings: {
        ...project.layerGroups[0].interlace,
        loopDurationSeconds: 5,
      },
    }]);
  });

  it('embeds metadata, title, and background in single-file HTML exports', async () => {
    const metadata = await exportProjectAsWebGL({
      ...baseExportRequest(),
      bundleFormat: 'single-html',
    });

    expect(metadata.format).toBe('vessel-goblet2');
    expect(downloadedBlobs).toHaveLength(1);
    expect(downloadedBlobs[0].type).toBe('text/html');

    const html = await readBlobText(downloadedBlobs[0]);
    expect(html).toContain('<title>Custom &lt;Goblet&gt;</title>');
    expect(html).toContain('"htmlBackgroundColor": "#123abc"');
    expect(html).toContain('const packagedMetadataRaw = JSON.parse(`');
    expect(html).toContain('"format": "vessel-goblet2"');
    expect(html).toContain('"bundleFormat": "single-html"');
  });

  it('wraps display-filter runtime in legacy single-file fallback', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (target: RequestInfo | URL) => {
      const url = String(target);
      if (url.endsWith('goblet2-inline.js')) {
        return {
          ok: false,
          status: 404,
          text: async () => '',
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        text: async () => assetContentFor(url),
      } as Response;
    });

    await exportProjectAsWebGL({
      ...baseExportRequest(),
      bundleFormat: 'single-html',
    });

    const html = await readBlobText(downloadedBlobs[0]);
    const script = getModuleScriptContent(html);
    expect(script).toContain('const { getSeamlessNoisePatternSize, createTileableNoiseGrid');
    expect(script).not.toContain("from './displayFilterPipeline.js'");
    expect(() => new Function(script)).not.toThrow();
  });

  it('packages the template, runtime assets, and metadata JSON in zip exports', async () => {
    const metadata = await exportProjectAsWebGL({
      ...baseExportRequest(),
      bundleFormat: 'zip',
    });

    expect(metadata.settings.bundleFormat).toBe('zip');
    expect(downloadedBlobs).toHaveLength(1);
    expect(downloadedBlobs[0].type).toBe('application/zip');

    const zip = await JSZip.loadAsync(await readBlobArrayBuffer(downloadedBlobs[0]));
    expect(Object.keys(zip.files).sort()).toEqual([
      'alignFitResolver.js',
      'bundle-contract-goblet.json',
      'displayFilterPipeline.js',
      'fflate-inflate.js',
      'goblet2.js',
      'gobletPayloadContract.js',
      'gobletPlaybackMath.js',
      'index.html',
      'num.js',
    ]);

    const json = await zip.file('bundle-contract-goblet.json')?.async('string');
    expect(json).toContain('"format": "vessel-goblet2"');
    expect(json).toContain('"bundleFormat": "zip"');

    const html = await zip.file('index.html')?.async('string');
    expect(html).toContain('<title>Custom &lt;Goblet&gt;</title>');
    expect(html).toContain('bundle-contract-goblet.json');
    expect(html).not.toContain('"format": "vessel-goblet2"');
  });

  it('keeps diagnostic sidecar zip exports safe without embedded fallback metadata', async () => {
    await exportProjectAsWebGL({
      ...baseExportRequest(),
      bundleFormat: 'zip',
      enableGobletDiagnostics: true,
    });

    const zip = await JSZip.loadAsync(await readBlobArrayBuffer(downloadedBlobs[0]));
    const html = await zip.file('index.html')?.async('string');
    expect(html).toContain('const packagedMetadataRaw = null;');
    expect(html).toContain('packagedMetadata?.layers?.forEach');
    expect(html).not.toContain('packagedMetadata.layers?.forEach');
  });

  it('keeps metadata fallback in compatibility zip exports', async () => {
    await exportProjectAsWebGL({
      ...baseExportRequest(),
      bundleFormat: 'zip-compat',
    });

    const zip = await JSZip.loadAsync(await readBlobArrayBuffer(downloadedBlobs[0]));
    const html = await zip.file('index.html')?.async('string');
    expect(html).toContain('bundle-contract-goblet.json');
    expect(html).toContain('"format": "vessel-goblet2"');
    const json = await zip.file('bundle-contract-goblet.json')?.async('string');
    expect(json).toContain('"bundleFormat": "zip-compat"');
  });

  it('moves large Goblet ZIP numeric payloads into binary sidecars', async () => {
    const layer = createDenseBrushLayer();
    const project = createProject();
    project.layers = [layer];

    await exportProjectAsWebGL({
      ...baseExportRequest(),
      project,
      layers: [layer],
      bundleFormat: 'zip',
      minify: true,
    });

    const zip = await JSZip.loadAsync(await readBlobArrayBuffer(downloadedBlobs[0]));
    const entries = Object.keys(zip.files).sort();
    const sidecars = entries.filter((entry) => entry.startsWith('buffers/'));
    expect(sidecars).toEqual(expect.arrayContaining([
      expect.stringContaining('brush-indexBuffer.bin'),
      expect.stringContaining('brush-gradientIdBuffer.bin'),
      expect.stringContaining('brush-flowBuffer.bin'),
      expect.stringContaining('brush-phaseBuffer.bin'),
    ]));

    const json = await zip.file('bundle-contract-goblet.json')?.async('string');
    expect(json).toContain('"ref":"buffers/');
    expect(json).not.toContain('"indexBuffer":[');

    const indexEntry = sidecars.find((entry) => entry.endsWith('brush-indexBuffer.bin'));
    expect(indexEntry).toBeDefined();
    const bytes = await zip.file(indexEntry!)?.async('uint8array');
    expect(bytes?.byteLength).toBe(64 * 32);
  });

  it('uses explicit snapshot display filters before persisted project view state', async () => {
    const project = createProject();
    project.viewState = {
      zoom: 1,
      displayFilters: [
        { id: 'pixelate', enabled: false, settings: { cellSize: 2 } },
      ],
    };
    const displayFilters: DisplayFilterConfig[] = [
      { id: 'pixelate', enabled: true, settings: { cellSize: 9 } },
    ];

    const metadata = await exportProjectAsWebGL({
      ...baseExportRequest(),
      project,
      displayFilters,
      bundleFormat: 'json',
    });

    expect(metadata.settings.displayFilters[0]).toEqual(displayFilters[0]);
  });

  it('reports static-preview color-cycle layers through Goblet progress', async () => {
    const progress: string[] = [];
    const project = createProject();
    const layer = {
      id: 'cc-static',
      name: 'Static CC',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      layerType: 'color-cycle',
      alignment: {
        fit: 'contain',
        horizontal: 'center',
        vertical: 'center',
        positioning: 'auto',
        offsetPx: { x: 0, y: 0 },
      },
      colorCycleData: {
        repairStatus: {
          ok: false,
          reason: 'missing-canonical-paint',
        },
      },
    };

    await expect(exportProjectAsWebGL({
      ...baseExportRequest(),
      project,
      layers: [layer as Project['layers'][number]],
      bundleFormat: 'json',
      onProgress: (event) => {
        if (event.layer) {
          progress.push(`${event.layer.name}:${event.layer.status}:${event.layer.message ?? ''}`);
        }
      },
    })).rejects.toThrow('missing animated brush data');

    expect(progress).toContain('Static CC:static-preview:missing-canonical-paint');
    expect(progress.some((entry) => (
      entry.startsWith('Static CC:failed:Static preview: missing-canonical-paint.')
    ))).toBe(true);
  });

  it('exports visible color-cycle layers with empty animated paint as static previews', async () => {
    const progress: string[] = [];
    const project = createProject();
    const imageData = new ImageData(
      new Uint8ClampedArray([
        255, 0, 0, 255,
        0, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
      ]),
      2,
      2,
    );
    const gradientStops = [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ];
    const layer = {
      id: 'cc-empty-paint-preview',
      name: 'CC Empty Paint Preview',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      layerType: 'color-cycle',
      imageData,
      alignment: createDefaultLayerAlignment(),
      colorCycleData: {
        mode: 'brush',
        isAnimating: true,
        hasContent: true,
        gradient: gradientStops,
        colorCycleBrush: {
          getColorCycleLayerDocument: () => ({
            read: () => ({
              version: 1,
              snapshot: {
                layerId: 'cc-empty-paint-preview',
                width: 2,
                height: 2,
                paintBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
                gradientIdBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
                gradientDefIdBuffer: new Uint16Array([1, 1, 1, 1]).buffer,
                speedBuffer: Uint8Array.from([128, 128, 128, 128]).buffer,
                flowBuffer: Uint8Array.from([1, 1, 1, 1]).buffer,
                phaseBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
                slotPalettes: [{ slot: 0, stops: gradientStops }],
                hasContent: true,
                sources: {
                  brushStateSnapshot: false,
                  topLevelBuffers: false,
                  legacyStateRefs: false,
                },
              },
            }),
          }),
        },
      },
      version: 1,
    } as unknown as Layer;

    const metadata = await exportProjectAsWebGL({
      ...baseExportRequest(),
      project,
      layers: [layer],
      bundleFormat: 'json',
      onProgress: (event) => {
        if (event.layer) {
          progress.push(`${event.layer.name}:${event.layer.status}:${event.layer.message ?? ''}`);
        }
      },
    });

    expect(metadata.layers).toHaveLength(1);
    expect(metadata.layers[0].assets?.texture).toEqual(expect.stringContaining('data:image/'));
    expect(metadata.layers[0].colorCycle).toBeUndefined();
    expect(progress).toContain('CC Empty Paint Preview:static-preview:empty-paint-with-content');
  });

  it('honors an aborted Goblet export signal before downloading', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(exportProjectAsWebGL({
      ...baseExportRequest(),
      bundleFormat: 'json',
      signal: controller.signal,
    })).rejects.toThrow('Export cancelled');

    expect(downloadedBlobs).toHaveLength(0);
  });
});
