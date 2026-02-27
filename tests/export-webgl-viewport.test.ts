import { exportProjectAsWebGL } from '@/utils/export/webglExporter';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { ExportContainerLayout, Layer, Project } from '@/types';

const mockBlobUrl = 'blob:tinybrush-test';

beforeAll(() => {
  if (typeof HTMLCanvasElement !== 'undefined') {
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
      configurable: true,
      writable: true,
      value: function toBlob(callback: BlobCallback, type?: string): void {
        callback(new Blob([''], { type: type ?? 'image/png' }));
      },
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
  delete (URL as Record<string, unknown>).createObjectURL;
  delete (URL as Record<string, unknown>).revokeObjectURL;
});

const createProject = (): Project => ({
  id: 'project-1',
  name: 'Viewport Smoke Test',
  width: 800,
  height: 600,
  layers: [],
  backgroundColor: '#000000',
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
  width: 800,
  height: 600,
};

describe('exportProjectAsWebGL viewport smoke test', () => {
  it('preserves fill viewport mode in metadata', async () => {
    const project = createProject();
    const metadata = await exportProjectAsWebGL({
      project,
      layers: [],
      layout,
      viewport: { designWidth: project.width, designHeight: project.height, mode: 'fill' },
      fps: 24,
      totalFrames: 1,
      durationSeconds: 1,
      perfectLoop: false,
      includeHiddenLayers: true,
      embedCanvasFallback: false,
      minify: false,
      filenameBase: 'viewport-smoke-test',
      bundleFormat: 'json',
    });

    expect(metadata.viewport).toMatchObject({
      designWidth: project.width,
      designHeight: project.height,
      mode: 'fill',
    });
  });

  it('falls back to project mode when unspecified', async () => {
    const project = createProject();
    const metadata = await exportProjectAsWebGL({
      project,
      layers: [],
      layout,
      viewport: { designWidth: project.width, designHeight: project.height },
      fps: 24,
      totalFrames: 1,
      durationSeconds: 1,
      perfectLoop: false,
      includeHiddenLayers: true,
      embedCanvasFallback: false,
      minify: false,
      filenameBase: 'viewport-smoke-test',
      bundleFormat: 'json',
    });

    expect(metadata.viewport).toMatchObject({
      designWidth: project.width,
      designHeight: project.height,
      mode: 'fixed',
    });
  });

  it('does not force identity-stack metadata for fixed half-scale', async () => {
    const project = createProject();
    const layerCanvas = document.createElement('canvas');
    layerCanvas.width = project.width;
    layerCanvas.height = project.height;

    const layer: Layer = {
      id: 'layer-1',
      name: 'Layer 1',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: layerCanvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal',
    };

    project.layers = [layer];

    const metadata = await exportProjectAsWebGL({
      project,
      layers: [layer],
      layout,
      viewport: { designWidth: project.width / 2, designHeight: project.height / 2, mode: 'fixed' },
      fps: 24,
      totalFrames: 1,
      durationSeconds: 1,
      perfectLoop: false,
      includeHiddenLayers: true,
      embedCanvasFallback: false,
      minify: false,
      pixelPerfectStack: true,
      filenameBase: 'viewport-fixed-half-scale',
      bundleFormat: 'json',
    });

    expect(metadata.viewport).toMatchObject({
      designWidth: project.width / 2,
      designHeight: project.height / 2,
      mode: 'fixed',
    });
    expect(metadata.settings.pixelPerfectStack).toBe(true);
    expect(metadata.layers).toHaveLength(1);

    const exportedLayer = metadata.layers[0];
    expect(exportedLayer.alignment.fit).toBe('contain');
    expect(exportedLayer.alignment.positioning).toBe('auto');
    expect(exportedLayer.documentBoundsPx).toEqual({
      x: 0,
      y: 0,
      width: project.width,
      height: project.height,
    });
  });
});
