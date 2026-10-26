import type { Layer, Project } from '@/types';
import { buildProjectGobletArtifact } from '@/utils/export/goblet/gobletExporter';
import { GOBLET_PROPERTY_MINIFY_MAP } from '@/utils/export/goblet/gobletMetadataSchema';

const readBlobText = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result ?? ''));
  reader.onerror = () => reject(reader.error);
  reader.readAsText(blob);
});

const fixture = (positioning: 'anchor' | 'auto') => {
  const image = new ImageData(64, 32);
  for (let y = 6; y < 10; y++) for (let x = 10; x < 18; x++) image.data.set([255, 0, 0, 255], (y * 64 + x) * 4);
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 32;
  const context = canvas.getContext('2d')!;
  jest.spyOn(context, 'getImageData').mockReturnValue(image);
  const layer: Layer = {
    id: 'aligned', name: 'Aligned', visible: true, opacity: 1, blendMode: 'source-over', locked: false,
    order: 0, imageData: image, framebuffer: canvas, layerType: 'normal',
    alignment: { fit: 'none', horizontal: 'left', vertical: 'top', positioning,
      offsetPx: { x: 7.5, y: -5.25 }, offsetPercent: { x: 90, y: 80 } },
  };
  const project: Project = { id: 'alignment-project', name: 'Alignment', width: 64, height: 32,
    layers: [layer], backgroundColor: 'transparent', createdAt: new Date(0), updatedAt: new Date(0), customBrushes: [] };
  return { layer, project, image };
};

beforeEach(() => {
  // Encoding is the I/O boundary. Real export metadata/layout/normalization remains unmocked.
  jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => {
    callback(new Blob([new Uint8Array([1])], { type: type ?? 'image/png' }));
  });
});
afterEach(() => jest.restoreAllMocks());

describe('real Goblet alignment export', () => {
  it.each(['goblet1', 'goblet2'] as const)('transports signed fractional anchor nudges and layout in %s without touching source', async gobletVersion => {
    const { layer, project, image } = fixture('anchor');
    const before = Array.from(image.data), alignment = JSON.parse(JSON.stringify(layer.alignment));
    const result = await buildProjectGobletArtifact({ project, layers: [layer], layout: { flow: 'row', justify: 'center',
      align: 'center', wrap: false, gap: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 },
      sizeMode: 'fixed', width: 64, height: 32 }, viewport: { mode: 'fit', designWidth: 64, designHeight: 32 },
    fps: 24, totalFrames: 1, durationSeconds: 1, perfectLoop: true, includeHiddenLayers: true,
    embedCanvasFallback: false, minify: true, filenameBase: 'alignment', gobletVersion, bundleFormat: 'json' });
    expect(result.metadata.layers[0].alignment).toMatchObject({ positioning: 'anchor', offsetPx: { x: 7.5, y: -5.25 } });
    expect(result.metadata.layers[0].alignment.offsetPx).not.toBe(layer.alignment.offsetPx);
    expect(result.metadata.layers[0].layoutPlacement?.transform).toMatchObject({ translateX: 7.5, translateY: -5.25 });
    const packed = JSON.parse(await readBlobText(result.blob));
    expect(packed[GOBLET_PROPERTY_MINIFY_MAP.layers][0][GOBLET_PROPERTY_MINIFY_MAP.alignment][GOBLET_PROPERTY_MINIFY_MAP.offsetPx])
      .toEqual({ x: 7.5, y: -5.25 });
    expect(layer.alignment).toEqual(alignment); expect(Array.from(image.data)).toEqual(before);
  });

  it('keeps Auto derived from painted bounds instead of transporting stale pixel nudges', async () => {
    const { layer, project } = fixture('auto');
    const result = await buildProjectGobletArtifact({ project, layers: [layer],
      layout: { flow: 'row', justify: 'center', align: 'center', wrap: false, gap: 0,
        padding: { top: 0, right: 0, bottom: 0, left: 0 }, sizeMode: 'fixed', width: 64, height: 32 },
      viewport: { mode: 'fit', designWidth: 64, designHeight: 32 },
      fps: 24, totalFrames: 1, durationSeconds: 1, perfectLoop: true, includeHiddenLayers: true,
      embedCanvasFallback: false, minify: false, filenameBase: 'alignment-auto', gobletVersion: 'goblet2', bundleFormat: 'json' });
    expect(result.metadata.layers[0].alignment).not.toHaveProperty('offsetPx');
    expect(result.metadata.layers[0].alignment.offsetPercent).toEqual({ x: 10 / 56 * 100, y: 6 / 28 * 100 });
  });
});
