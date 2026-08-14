import {
  mapProjectPointToReferencePixel,
  normalizeReferenceAssets,
  normalizeReferenceSamplingSource,
} from '@/referenceStudio/referenceAssets';
import type { Layer, ReferenceAsset } from '@/types';

const createAsset = (overrides: Partial<ReferenceAsset> = {}): ReferenceAsset => ({
  id: 'reference-1',
  name: 'Portrait',
  dataUrl: 'data:image/png;base64,AAAA',
  naturalWidth: 100,
  naturalHeight: 200,
  visible: true,
  locked: false,
  opacity: 1,
  x: 10,
  y: 20,
  scale: 2,
  crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
  flipX: false,
  flipY: false,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('Reference Studio asset contract', () => {
  it('normalizes persisted values and removes duplicate ids', () => {
    const normalized = normalizeReferenceAssets([
      createAsset({ opacity: 4, scale: 0, crop: { x: 0.9, y: 0.9, width: 1, height: 1 } }),
      createAsset({ name: 'Duplicate' }),
    ]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({ opacity: 1, scale: 0.01 });
    expect(normalized[0].crop.x).toBe(0.9);
    expect(normalized[0].crop.y).toBe(0.9);
    expect(normalized[0].crop.width).toBeCloseTo(0.1);
    expect(normalized[0].crop.height).toBeCloseTo(0.1);
  });

  it('maps project coordinates through crop, scale, and flips', () => {
    const asset = createAsset();
    expect(mapProjectPointToReferencePixel(asset, 10, 20)).toEqual({ x: 25, y: 50 });
    expect(mapProjectPointToReferencePixel(asset, 109, 219)).toEqual({ x: 74, y: 149 });
    expect(mapProjectPointToReferencePixel({ ...asset, flipX: true }, 10, 20)).toEqual({ x: 75, y: 50 });
    expect(mapProjectPointToReferencePixel(asset, 110, 220)).toBeNull();
  });

  it('preserves the legacy marked artwork layer as the initial source', () => {
    const layers = [{ id: 'layer-1' }] as Layer[];
    expect(normalizeReferenceSamplingSource({
      assets: [],
      layers,
      legacyReferenceLayerId: 'layer-1',
    })).toEqual({ kind: 'layer', layerId: 'layer-1' });
  });
});
