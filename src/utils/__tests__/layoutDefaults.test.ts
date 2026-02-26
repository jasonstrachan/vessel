import type { Layer, Project } from '@/types';
import { createDefaultLayerAlignment, dedupeLayerIds, normalizeProject } from '@/utils/layoutDefaults';

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
});
