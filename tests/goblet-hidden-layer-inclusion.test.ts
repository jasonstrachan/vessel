import { exportProjectAsWebGL } from '@/utils/export/webglExporter';
import { createDefaultExportLayout, createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer, Project } from '@/types';

const makeCanvas = (color: string): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
};

const makeRasterLayer = (id: string, visible: boolean, color: string, order: number): Layer => {
  const canvas = makeCanvas(color);
  return {
    id,
    name: id,
    visible,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    transparencyLocked: false,
    order,
    imageData: null,
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType: 'normal',
    version: 1,
  };
};

const makeProject = (layers: Layer[]): Project => ({
  id: 'hidden-layer-parity-project',
  name: 'Hidden Layer Parity Project',
  width: 8,
  height: 8,
  layers,
  backgroundColor: '#00000000',
  createdAt: new Date('2026-07-07T00:00:00.000Z'),
  updatedAt: new Date('2026-07-07T00:00:00.000Z'),
  customBrushes: [],
  viewState: { zoom: 1 },
});

const exportHiddenLayerFixture = (layers: Layer[], includeHiddenLayers: boolean) => exportProjectAsWebGL({
  project: makeProject(layers),
  layers,
  layout: createDefaultExportLayout(),
  viewport: { designWidth: 8, designHeight: 8, mode: 'fixed' },
  fps: 30,
  totalFrames: 1,
  durationSeconds: 1 / 30,
  perfectLoop: false,
  includeHiddenLayers,
  embedCanvasFallback: false,
  minify: false,
  filenameBase: includeHiddenLayers ? 'hidden-included' : 'hidden-excluded',
  bundleFormat: 'json',
  gobletVersion: 'goblet2',
});

describe('Goblet hidden-layer inclusion export contract', () => {
  beforeAll(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn(() => 'blob:hidden-layer-inclusion'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn(),
    });
    Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
      configurable: true,
      writable: true,
      value: jest.fn(),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
      configurable: true,
      writable: true,
      value(callback: BlobCallback, type?: string): void {
        callback(new Blob(['vessel-hidden-layer-fixture'], { type: type ?? 'image/png' }));
      },
    });
  });

  afterAll(() => {
    delete (URL as Record<string, unknown>).createObjectURL;
    delete (URL as Record<string, unknown>).revokeObjectURL;
  });

  it('excludes or includes hidden layers according to the Goblet export request', async () => {
    const visibleLayer = makeRasterLayer('visible-layer', true, '#00ff00', 0);
    const hiddenLayer = makeRasterLayer('hidden-layer', false, '#ff0000', 1);
    const layers = [visibleLayer, hiddenLayer];

    const excluded = await exportHiddenLayerFixture(layers, false);
    const included = await exportHiddenLayerFixture(layers, true);

    expect(excluded.settings.includeHiddenLayers).toBe(false);
    expect(excluded.layers.map((layer) => layer.id)).toEqual(['visible-layer']);
    expect(excluded.layers.some((layer) => layer.id === 'hidden-layer')).toBe(false);

    expect(included.settings.includeHiddenLayers).toBe(true);
    expect(included.layers.map((layer) => layer.id)).toEqual(['visible-layer', 'hidden-layer']);
    expect(included.layers.find((layer) => layer.id === 'hidden-layer')?.visible).toBe(false);
  });
});
