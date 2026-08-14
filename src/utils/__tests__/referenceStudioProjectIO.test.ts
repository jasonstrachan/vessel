import type { Project, ReferenceAsset } from '@/types';
import { deserializeProject, serializeProject } from '@/utils/projectIO';

describe('Reference Studio project persistence', () => {
  it('round-trips reference assets and the explicit sampling source', async () => {
    const reference: ReferenceAsset = {
      id: 'reference-portrait',
      name: 'Portrait',
      dataUrl: 'data:image/png;base64,AAAA',
      naturalWidth: 40,
      naturalHeight: 60,
      visible: true,
      locked: true,
      opacity: 0.75,
      x: -12,
      y: 8,
      scale: 1.5,
      crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 },
      flipX: true,
      flipY: false,
      createdAt: 1,
      updatedAt: 2,
    };
    const project: Project = {
      id: 'reference-project',
      name: 'Reference project',
      width: 100,
      height: 120,
      backgroundColor: 'transparent',
      layers: [],
      customBrushes: [],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      referenceAssets: [reference],
      referenceSamplingSource: { kind: 'asset', assetId: reference.id },
    };

    const restored = await deserializeProject(await serializeProject(project));

    expect(restored.referenceAssets).toEqual([reference]);
    expect(restored.referenceSamplingSource).toEqual({
      kind: 'asset',
      assetId: reference.id,
    });
  });
});
