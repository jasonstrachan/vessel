import { exportProjectAsWebGL } from '@/utils/export/webglExporter';
import type { ExportContainerLayout, Project } from '@/types';

const mockBlobUrl = 'blob:tinybrush-test';

beforeAll(() => {
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
});
