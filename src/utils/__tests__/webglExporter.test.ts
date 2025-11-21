import { packArrayToB64Z } from '@/utils/export/b64z';
import * as webglExporter from '@/utils/export/webglExporter';

describe('webglExporter error paths', () => {
  it('throws when layers array is empty', async () => {
    await expect(
      webglExporter.exportToWebGLBundle({
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
      webglExporter.exportToWebGLBundle({ project, includeAnimation: false, includeFallback: false, minify: true } as any)
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

    const spy = jest.spyOn(webglExporter as any, 'packArrayToB64Z' in webglExporter ? 'packArrayToB64Z' : 'default');
    jest.spyOn(global, 'console').mockImplementation(() => {} as any);

    await webglExporter.exportToWebGLBundle({ project, includeAnimation: false, includeFallback: false, minify: true } as any);

    expect(spy).toHaveBeenCalled();
    (console as any).mockRestore?.();
  });
});
