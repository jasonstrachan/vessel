import JSZip from 'jszip';

import { deserializeProject, serializeProject } from '@/utils/projectIO';
import { encodeRgbaToBase64 } from '@/utils/colorCycle/ccCustomTilePattern';
import { localDitherPatternRegistry } from '@/utils/ditherPatterns/ditherPatternRegistry';
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
  afterEach(() => {
    localDitherPatternRegistry.clear();
  });

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

  it('round-trips only an opaque local pattern reference without embedding library content', async () => {
    localDitherPatternRegistry.register({
      definition: {
        id: 'local-threshold',
        name: 'Synthetic Local Pattern Name',
        kind: 'cumulative-threshold',
        width: 3,
        height: 1,
        coveragePolicy: 'local-tone',
        payloadHash: `sha256:${'1'.repeat(64)}`,
        storageScope: 'local-library',
      },
      thresholds: Uint8Array.from([17, 89, 233]),
    });
    const project = makeProject();
    project.brushSpecificSettings = {
      'dither-gradient': {
        ditherAlgorithm: 'pattern',
        patternStyle: 'image-tile',
        patternTileId: 'local-threshold',
      },
    };

    const data = await serializeProject(project);
    const zip = await JSZip.loadAsync(data);
    const projectJson = await zip.file('project.json')?.async('string');
    const restored = await deserializeProject(data);

    expect(projectJson).toContain('local-threshold');
    expect(projectJson).not.toContain('Synthetic Local Pattern Name');
    expect(projectJson).not.toContain('17,89,233');
    expect(restored.brushSpecificSettings?.['dither-gradient']?.patternTileId).toBe('local-threshold');
  });
});
