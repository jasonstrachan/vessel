import JSZip from 'jszip';

import { exportProjectAsWebGL } from '@/utils/export/webglExporter';
import type { DisplayFilterConfig, ExportContainerLayout, Project } from '@/types';

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
  delete (URL as unknown as Record<string, unknown>).createObjectURL;
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
  delete (global as Record<string, unknown>).fetch;
  jest.restoreAllMocks();
});

describe('webglExporter bundle contracts', () => {
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
      'index.html',
      'num.js',
    ]);

    const json = await zip.file('bundle-contract-goblet.json')?.async('string');
    expect(json).toContain('"format": "vessel-goblet2"');
    expect(json).toContain('"bundleFormat": "zip"');

    const html = await zip.file('index.html')?.async('string');
    expect(html).toContain('<title>Custom &lt;Goblet&gt;</title>');
    expect(html).toContain('bundle-contract-goblet.json');
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
