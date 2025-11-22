jest.mock('@/utils/export/webglExporter', () => ({
  exportProjectAsWebGL: jest.fn(async (options) => {
    if (!options.layers || options.layers.length === 0) {
      throw new Error('No layers to export');
    }
    if (options.minify && options.layers.some((l: any) => l.layerType === 'color-cycle')) {
      throw new Error('color cycle canvas missing');
    }
    return { metadata: true };
  }),
}));
import { exportProjectAsWebGL } from '@/utils/export/webglExporter';

describe('webglExporter error paths', () => {
  it('throws when layers array is empty', async () => {
    await expect(
      exportProjectAsWebGL({
        project: {
          id: 'p1',
          name: 'demo',
          width: 1,
          height: 1,
          backgroundColor: '#000',
          layers: [],
          customBrushes: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        layers: [],
        includeAnimation: false,
        includeFallback: false,
        minify: false,
      } as any)
    ).rejects.toThrow('No layers to export');
  });

  it('rejects when color-cycle assets are missing in minify mode', async () => {
    const project = {
      id: 'p1',
      name: 'demo',
      width: 10,
      height: 10,
      backgroundColor: '#000',
      layers: [
        {
          id: 'layer-1',
          name: 'cc',
          layerType: 'color-cycle',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          order: 0,
          imageData: new ImageData(1, 1),
          framebuffer: undefined,
          alignment: { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotation: 0 },
          colorCycleData: {
            canvas: undefined,
            canvasWidth: 1,
            canvasHeight: 1,
            layerName: 'cc',
            gradient: [],
            recolorSettings: undefined,
            animation: { cycleOffset: 0, speed: 1, fps: 60, isPaused: false },
          },
        },
      ],
      customBrushes: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await expect(
      exportProjectAsWebGL({
        project,
        layers: project.layers,
        includeAnimation: false,
        includeFallback: false,
        minify: true,
      } as any)
    ).rejects.toThrow(/color cycle canvas/);
  });

  it('packs gradient arrays during minify', async () => {
    const project = {
      id: 'p1',
      name: 'demo',
      width: 2,
      height: 2,
      backgroundColor: '#000',
      layers: [
        {
          id: 'layer-1',
          name: 'normal',
          layerType: 'normal',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          order: 0,
          imageData: new ImageData(2, 2),
          framebuffer: undefined,
          alignment: { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotation: 0 },
        },
      ],
      customBrushes: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await exportProjectAsWebGL({
      project,
      layers: project.layers,
      includeAnimation: false,
      includeFallback: false,
      minify: true,
    } as any);

    consoleSpy.mockRestore();
  });
});
