import type { ColorCycleGradientSwatch, Layer, Project } from '@/types';
import {
  createDefaultLayerAlignment,
  dedupeLayerIds,
  normalizeProject,
} from '@/utils/layoutDefaults';

const makeLayer = (id: string, order: number): Layer => {
  const framebuffer = document.createElement('canvas');
  framebuffer.width = 4;
  framebuffer.height = 4;

  return {
    id,
    name: id || 'unnamed',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order,
    imageData: null,
    framebuffer,
    alignment: createDefaultLayerAlignment(),
    layerType: 'normal',
  };
};

const makeProject = (layers: Layer[]): Project => ({
  id: 'project-1',
  name: 'Test Project',
  width: 16,
  height: 16,
  layers,
  layerGroups: [],
  backgroundColor: 'transparent',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  customBrushes: [],
});

describe('dedupeLayerIds', () => {
  it('keeps first id and renames later duplicates deterministically', () => {
    const layers = [
      makeLayer('layer-a', 0),
      makeLayer('layer-a', 1),
      makeLayer('layer-a', 2),
      makeLayer('', 3),
      makeLayer('', 4),
    ];

    const deduped = dedupeLayerIds(layers);
    const ids = deduped.map((layer) => layer.id);

    expect(ids).toEqual(['layer-a', 'layer-a-1', 'layer-a-2', 'layer-4', 'layer-5']);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('normalizeProject', () => {
  it('normalizes to unique layer ids to prevent cross-layer updates by id', () => {
    const project = makeProject([
      makeLayer('shared-layer-id', 0),
      makeLayer('shared-layer-id', 1),
      makeLayer('shared-layer-id', 2),
    ]);

    const normalized = normalizeProject(project);
    const ids = normalized.layers.map((layer) => layer.id);

    expect(ids).toEqual(['shared-layer-id', 'shared-layer-id-1', 'shared-layer-id-2']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('normalizes persisted CC gradient swatches and retains the active selection', () => {
    const project = makeProject([]);
    project.palette = {
      foregroundColor: '#111111',
      backgroundColor: '#eeeeee',
      activeSlot: 'foreground',
      colorCycleGradients: [{
        id: 'picked-gradient',
        stops: [
          { position: 1, color: '#ffffff', opacity: 2 },
          { position: 0, color: '#000000', opacity: 0.5 },
        ],
        isRuntimePalette: true,
      } as unknown as ColorCycleGradientSwatch],
      activeColorCycleGradientId: 'picked-gradient',
    };

    const palette = normalizeProject(project).palette;

    expect(palette?.activeColorCycleGradientId).toBe('picked-gradient');
    expect(palette?.colorCycleGradients).toEqual([{
      id: 'picked-gradient',
      stops: [
        { position: 0, color: '#000000', opacity: 0.5 },
        { position: 1, color: '#ffffff', opacity: 1 },
      ],
      runtimeStops: [
        { position: 0, color: '#000000', opacity: 0.5 },
        { position: 1, color: '#ffffff', opacity: 1 },
      ],
    }]);
  });

  it('preserves and sanitizes interlace group settings', () => {
    const layer = { ...makeLayer('interlace-layer', 0), groupId: 'interlace-group' };
    const project = makeProject([layer]);
    project.layerGroups = [{
      id: 'interlace-group',
      name: ' Interlace ',
      kind: 'interlace',
      interlace: {
        cellSize: 500,
        dominance: 0.1,
        patternPreset: 'ripple',
        motionMode: 'travel',
        direction: 'left',
        travelCycles: 20,
        loopDurationSeconds: 0.1,
        seed: -1,
      },
    }];

    expect(normalizeProject(project).layerGroups).toEqual([{
      id: 'interlace-group',
      name: 'Interlace',
      kind: 'interlace',
      interlace: {
        cellSize: 128,
        dominance: 0.5,
        patternPreset: 'ripple',
        motionMode: 'travel',
        direction: 'left',
        travelCycles: 16,
        loopDurationSeconds: 0.25,
        seed: 0xffffffff,
      },
    }]);
  });
});
