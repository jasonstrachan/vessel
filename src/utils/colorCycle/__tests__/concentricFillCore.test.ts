import { fillConcentricToBuffer } from '@/utils/colorCycle/concentricFillCore';

describe('fillConcentricToBuffer', () => {
  it('produces higher indices near the center of a square polygon', async () => {
    const vertices = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    const bbox = { minX: 0, minY: 0, width: 5, height: 5 };
    const buffer = await fillConcentricToBuffer({
      vertices,
      bbox,
      bands: 4,
      baseOffset: 0,
      maxDist: 10,
      ditherEnabled: false,
      ditherStrength: 0,
      ditherPixelSize: 1,
      noiseSeed: 0.5,
    });

    expect(buffer).toHaveLength(bbox.width * bbox.height);
    const centerIndex = buffer[2 * bbox.width + 2];
    const uniqueValues = new Set(buffer);
    expect(centerIndex).toBeGreaterThan(0);
    expect(uniqueValues.size).toBeGreaterThan(1);
  });
});
