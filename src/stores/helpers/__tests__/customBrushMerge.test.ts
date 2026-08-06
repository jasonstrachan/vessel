import type { CustomBrush, CustomBrushColorCycleV3 } from '@/types';
import { mergeCustomBrushCollections } from '@/stores/helpers/customBrushMerge';

const makeBrush = (
  id: string,
  overrides: Partial<CustomBrush> = {}
): CustomBrush => ({
  id,
  name: id,
  imageData: new ImageData(1, 1),
  thumbnail: '',
  width: 1,
  height: 1,
  createdAt: 1,
  ...overrides,
});

describe('mergeCustomBrushCollections', () => {
  it('preserves stored indexed-tip data when an older project copy omits it', () => {
    const colorCycle: CustomBrushColorCycleV3 = {
      schemaVersion: 3,
      payloadKind: 'indexed-tip',
      sourceCycleLength: 256,
      mapWidth: 1,
      mapHeight: 1,
      paintIndexMap: new Uint16Array([23]),
      alphaMask: new Uint8Array([128]),
    };
    const storedBrush = makeBrush('shared', {
      name: 'Stored',
      colorCycle,
    });
    const projectBrush = makeBrush('shared', {
      name: 'Project',
      createdAt: 2,
    });

    const [merged] = mergeCustomBrushCollections([projectBrush], [storedBrush]);

    expect(merged).toEqual(expect.objectContaining({
      id: 'shared',
      name: 'Project',
      createdAt: 2,
      colorCycle,
    }));
  });

  it('keeps explicit project indexed-tip data authoritative', () => {
    const storedColorCycle: CustomBrushColorCycleV3 = {
      schemaVersion: 3,
      payloadKind: 'indexed-tip',
      sourceCycleLength: 256,
      mapWidth: 1,
      mapHeight: 1,
      paintIndexMap: new Uint16Array([4]),
    };
    const projectColorCycle: CustomBrushColorCycleV3 = {
      ...storedColorCycle,
      paintIndexMap: new Uint16Array([9]),
    };

    const [merged] = mergeCustomBrushCollections(
      [makeBrush('shared', { colorCycle: projectColorCycle })],
      [makeBrush('shared', { colorCycle: storedColorCycle })]
    );

    expect(merged.colorCycle).toBe(projectColorCycle);
  });
});
