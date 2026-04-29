import { runExport } from '@/utils/export/exportService';
import { exportProjectAsWebGL } from '@/utils/export/webglExporter';
import type { ExportRequest } from '@/utils/export/types';

jest.mock('@/utils/export/webglExporter', () => ({
  exportProjectAsWebGL: jest.fn(async (request) => {
    if (request.signal?.aborted) {
      throw new DOMException('Export cancelled', 'AbortError');
    }
    return { layers: [] };
  }),
}));

const createWebglRequest = (): ExportRequest => {
  const project = {
    id: 'project-1',
    name: 'Demo',
    width: 8,
    height: 8,
    backgroundColor: '#000000',
    layers: [],
    customBrushes: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    kind: 'webgl',
    filenameBase: 'demo',
    options: {
      bundleFormat: 'json',
      gobletVersion: 'goblet2',
      htmlTitle: 'Goblet',
      request: {
        project,
        layers: [],
        layout: {
          flow: 'row',
          justify: 'start',
          align: 'start',
          wrap: false,
          gap: 0,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          sizeMode: 'fill',
        },
        viewport: {
          mode: 'fit',
          designWidth: 8,
          designHeight: 8,
        },
        fps: 24,
        totalFrames: 1,
        durationSeconds: 1,
        perfectLoop: true,
        includeHiddenLayers: true,
        embedCanvasFallback: false,
        minify: false,
        filenameBase: 'demo',
      },
    },
  };
};

describe('runExport webgl cancellation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes the abort signal to the Goblet exporter', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runExport(createWebglRequest(), jest.fn(), controller.signal)
    ).rejects.toThrow('Export cancelled');

    expect(exportProjectAsWebGL).toHaveBeenCalledWith(expect.objectContaining({
      signal: controller.signal,
    }));
  });
});
