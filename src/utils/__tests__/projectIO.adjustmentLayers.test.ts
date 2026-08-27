import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { deserializeProject, serializeProject } from '@/utils/projectIO';
import type { Layer, Project } from '@/types';

const originalOffscreenCanvas = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;

class TestOffscreenCanvas {
  constructor(public width: number, public height: number) {}

  getContext() {
    return null;
  }
}

beforeAll(() => {
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = TestOffscreenCanvas;
});

afterAll(() => {
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = originalOffscreenCanvas;
});

const makeAdjustmentLayer = (): Layer => ({
  id: 'adjustment-1',
  name: 'Hue/Sat 1',
  visible: true,
  opacity: 0.65,
  blendMode: 'source-over',
  locked: false,
  transparencyLocked: false,
  order: 0,
  imageData: null,
  framebuffer: new TestOffscreenCanvas(8, 8) as unknown as OffscreenCanvas,
  alignment: createDefaultLayerAlignment(),
  layerType: 'adjustment',
  adjustmentData: {
    targetLayerIds: ['paint-1', 'paint-2'],
    effect: {
      id: 'hue-sat',
      settings: {
        hue: 45,
        saturation: 12,
        vibrance: 3,
        lightness: -4,
        contrast: 5,
        red: 0,
        green: 0,
        blue: 0,
        hueRangeEnabled: true,
        hueRangeStart: 20,
        hueRangeEnd: 200,
      },
    },
  },
});

describe('projectIO adjustment layers', () => {
  it('round-trips effect settings without a raster payload', async () => {
    const layer = makeAdjustmentLayer();
    const project: Project = {
      id: 'project-1',
      name: 'Adjustments',
      width: 8,
      height: 8,
      layers: [layer],
      layerGroups: [],
      backgroundColor: 'transparent',
      createdAt: new Date('2026-08-16T00:00:00.000Z'),
      updatedAt: new Date('2026-08-16T00:00:00.000Z'),
      customBrushes: [],
    };

    const restored = await deserializeProject(await serializeProject(project));

    expect(restored.layers[0]).toMatchObject({
      id: layer.id,
      layerType: 'adjustment',
      opacity: 0.65,
      adjustmentData: layer.adjustmentData,
    });
    expect(restored.layers[0]?.imageData).toBeNull();
  });

  it('rejects adjustment membership in an Interlace group', async () => {
    const layer = { ...makeAdjustmentLayer(), groupId: 'interlace-1' };
    const project: Project = {
      id: 'project-1',
      name: 'Invalid Adjustment Scope',
      width: 8,
      height: 8,
      layers: [layer],
      layerGroups: [{
        id: 'interlace-1',
        name: 'Interlace',
        kind: 'interlace',
        interlace: {
          cellSize: 10,
          dominance: 0.92,
          patternPreset: 'classic',
          motionMode: 'fixed',
          direction: 'right',
          travelCycles: 1,
          loopDurationSeconds: 10,
          seed: 1,
        },
      }],
      backgroundColor: 'transparent',
      createdAt: new Date('2026-08-16T00:00:00.000Z'),
      updatedAt: new Date('2026-08-16T00:00:00.000Z'),
      customBrushes: [],
    };

    await expect(deserializeProject(await serializeProject(project))).rejects.toThrow(
      'cannot belong to an Interlace group',
    );
  });
});
