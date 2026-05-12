import { deserializeProject, serializeProject } from '@/utils/projectIO';
import { encodeRgbaToBase64 } from '@/utils/colorCycle/ccCustomTilePattern';
import type { Project } from '@/types';

const makeProject = (): Project => ({
  id: 'project-1',
  name: 'Tile Project',
  width: 8,
  height: 8,
  layers: [],
  layerGroups: [],
  backgroundColor: 'transparent',
  createdAt: new Date('2026-05-11T00:00:00.000Z'),
  updatedAt: new Date('2026-05-11T00:00:00.000Z'),
  customBrushes: [],
  ccCustomTilePatterns: [
    {
      id: 'tile-1',
      name: 'Tile 1',
      width: 1,
      height: 1,
      rgbaBase64: encodeRgbaToBase64(Uint8Array.from([0, 0, 0, 255])),
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  ccCustomTilePatternPacks: [
    {
      id: 'pack-1',
      name: 'Pack 1',
      patternIds: ['tile-1'],
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  defaultCustomBrushId: null,
});

describe('projectIO custom tile patterns', () => {
  it('round-trips project-local CC custom tile patterns', async () => {
    const project = makeProject();
    const data = await serializeProject(project);
    const restored = await deserializeProject(data);

    expect(restored.ccCustomTilePatterns).toEqual(project.ccCustomTilePatterns);
  });

  it('round-trips project-local CC custom tile pattern packs', async () => {
    const project = makeProject();
    const data = await serializeProject(project);
    const restored = await deserializeProject(data);

    expect(restored.ccCustomTilePatternPacks).toEqual(project.ccCustomTilePatternPacks);
  });

  it('prunes missing tile ids from pattern packs on load', async () => {
    const project = makeProject();
    project.ccCustomTilePatternPacks = [
      {
        id: 'pack-1',
        name: 'Pack 1',
        patternIds: ['tile-1', 'missing-tile', 'tile-1'],
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const data = await serializeProject(project);
    const restored = await deserializeProject(data);

    expect(restored.ccCustomTilePatternPacks?.[0]?.patternIds).toEqual(['tile-1']);
  });
});
