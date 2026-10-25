import type { ColorCycleRecolorSettings, Layer, Project } from '@/types';
import { serializeColorCycleDataFromResolvedLayer } from '@/utils/export/goblet/gobletColorCycleSerializer';

const project: Project = {
  id: 'recolor-animation-export', name: 'Recolor animation export',
  width: 2, height: 2, layers: [], backgroundColor: '#000000',
  createdAt: new Date(0), updatedAt: new Date(0), customBrushes: [],
};

const flows: ColorCycleRecolorSettings['animation']['flowDirection'][] = [
  'forward', 'reverse', 'pingpong', 'bounce',
];

describe('Recolor animation export', () => {
  it.each(flows)('preserves requested %s playback and its captured state', async (flowDirection) => {
    const settings: ColorCycleRecolorSettings = {
      quantizationMode: 'rgb332', ditherMode: 'off',
      indexBuffer: Uint8Array.from([43, 236, 89, 167]),
      palette: Uint32Array.from([0xff0000ff, 0xffff0000]),
      animation: {
        speed: 0.75, fps: 15, ticksPerFrame: 0.8, isPlaying: true,
        currentTick: 7.25, flowDirection,
      },
      cycleColors: 16,
      gradient: [
        { position: 0, color: '#ff0000', opacity: 0.5 },
        { position: 1, color: '#0000ff', opacity: 1 },
      ],
      mappingMode: 'continuous', flowMapping: 'palette', currentLOD: 'full',
      originalImageData: new ImageData(Uint8ClampedArray.from([
        255, 0, 0, 255, 0, 0, 255, 128, 0, 255, 0, 0, 255, 255, 0, 255,
      ]), 2, 2),
    };
    const layer: Layer = {
      id: 'recolor', name: 'Recolor', visible: true, opacity: 1,
      blendMode: 'source-over', locked: false, transparencyLocked: false,
      order: 0, imageData: settings.originalImageData ?? null,
      framebuffer: document.createElement('canvas'), layerType: 'color-cycle', version: 1,
      alignment: { fit: 'none', horizontal: 'left', vertical: 'top', positioning: 'anchor' },
      colorCycleData: { mode: 'recolor', isAnimating: true, hasContent: true, recolorSettings: settings },
    };
    const beforeAnimation = { ...settings.animation };
    const beforeGradient = settings.gradient.map((stop) => ({ ...stop }));
    const beforeIndices = Array.from(settings.indexBuffer ?? []);
    const beforePixels = Array.from(settings.originalImageData?.data ?? []);
    const result = await serializeColorCycleDataFromResolvedLayer(layer, project, undefined, {
      resolvedSource: 'recolor-runtime', playbackClock: null,
    });
    const exported = result?.colorCycle?.recolorSettings;
    expect(exported?.animation).toEqual(beforeAnimation);
    expect(exported).toMatchObject({
      cycleColors: 16, mappingMode: 'continuous', flowMapping: 'palette',
      gradient: beforeGradient, quantizationMode: 'rgb332', ditherMode: 'off',
      palette: [0xff0000ff, 0xffff0000],
    });
    expect(settings.animation).toEqual(beforeAnimation);
    expect(settings.gradient).toEqual(beforeGradient);
    expect(Array.from(settings.indexBuffer ?? [])).toEqual(beforeIndices);
    expect(Array.from(settings.originalImageData?.data ?? [])).toEqual(beforePixels);
    expect(layer.colorCycleData?.recolorSettings).toBe(settings);
  });
});
