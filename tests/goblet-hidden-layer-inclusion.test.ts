import { exportProjectAsWebGL } from '@/utils/export/webglExporter';
import { createDefaultExportLayout, createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer, Project, TxtShape, UiShape } from '@/types';
import { WINDOWS_31_UI_SHAPE_PALETTE } from '@/utils/uiShape';

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

const makeTxtShape = (layerId: string, id: string): TxtShape => ({
  id,
  layerId,
  x: 0,
  y: 0,
  width: 8,
  height: 8,
  content: id,
  fontFamily: 'mek-mono',
  fontSize: 12,
  lineHeight: 1,
  textAlign: 'left',
  colorSource: 'manual',
  color: '#ffffff',
  selectionColor: '#000000',
  selectionBackgroundColor: '#ffffff',
  selections: [],
  createdAt: 1,
  updatedAt: 1,
});

const makeUiShape = (layerId: string, id: string): UiShape => ({
  id,
  layerId,
  x: 0,
  y: 0,
  width: 8,
  height: 8,
  gridSize: 1,
  theme: 'windows-3.1',
  drawMode: 'place',
  regionKind: 'rectangle',
  componentKinds: [],
  colorSource: 'default',
  palette: { ...WINDOWS_31_UI_SHAPE_PALETTE },
  components: [],
  createdAt: 1,
  updatedAt: 1,
});

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
  txtShapes: layers.map((layer) => makeTxtShape(layer.id, `${layer.id}-txt-shape`)),
  uiShapes: layers.map((layer) => makeUiShape(layer.id, `${layer.id}-ui-shape`)),
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
  const originalFonts = document.fonts;

  beforeAll(() => {
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        load: jest.fn().mockResolvedValue([]),
        check: jest.fn().mockReturnValue(true),
      },
    });
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
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: originalFonts,
    });
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
    expect(excluded.textShapes?.map((shape) => shape.id)).toEqual([
      'visible-layer-txt-shape',
    ]);
    expect(excluded.textShapes?.map((shape) => shape.layerId)).toEqual([
      'visible-layer',
    ]);
    expect(excluded.uiShapes?.map((shape) => shape.id)).toEqual([
      'visible-layer-ui-shape',
    ]);
    expect(excluded.uiShapes?.map((shape) => shape.layerId)).toEqual([
      'visible-layer',
    ]);

    expect(included.settings.includeHiddenLayers).toBe(true);
    expect(included.layers.map((layer) => layer.id)).toEqual(['visible-layer', 'hidden-layer']);
    expect(included.layers.find((layer) => layer.id === 'hidden-layer')?.visible).toBe(false);
    expect(included.textShapes?.map((shape) => shape.id)).toEqual([
      'visible-layer-txt-shape',
      'hidden-layer-txt-shape',
    ]);
    expect(included.textShapes?.map((shape) => shape.layerId)).toEqual([
      'visible-layer',
      'hidden-layer',
    ]);
    expect(included.uiShapes?.map((shape) => shape.id)).toEqual([
      'visible-layer-ui-shape',
      'hidden-layer-ui-shape',
    ]);
    expect(included.uiShapes?.map((shape) => shape.layerId)).toEqual([
      'visible-layer',
      'hidden-layer',
    ]);
  });
});
