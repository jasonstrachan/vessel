import { extractAutoConvertRegions } from '@/utils/colorCycle/autoConvertRegions';

const createSplitImage = (width: number, height: number): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const isLeft = x < width / 2;
      pixels[offset] = isLeft ? 240 : 20;
      pixels[offset + 1] = 20;
      pixels[offset + 2] = isLeft ? 20 : 240;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
};

const createFlatAndDetailedImage = (width: number, height: number): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const isDetailed = x >= width / 2;
      const detailedValue = (x + y) % 2 === 0 ? 245 : 10;
      const value = isDetailed ? detailedValue : 128;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
};

describe('extractAutoConvertRegions', () => {
  it('turns visible image areas into bounded painted-region contours', () => {
    const width = 16;
    const height = 8;
    const result = extractAutoConvertRegions({
      pixels: createSplitImage(width, height),
      width,
      height,
      targetShapes: 2,
      detail: 50,
      maxColors: 4,
    });

    expect(result.regions).toHaveLength(2);
    expect(result.regions.reduce((total, region) => total + region.pixelCount, 0)).toBe(
      result.analysisWidth * result.analysisHeight,
    );
    result.regions.forEach((region) => {
      expect(region.points.length).toBeGreaterThanOrEqual(3);
      expect(region.sampledStops.length).toBeGreaterThanOrEqual(2);
      expect(region.sampledStops[0].position).toBe(0);
      expect(region.sampledStops[region.sampledStops.length - 1].position).toBe(1);
      expect(region.linearGradientSpan).toBeGreaterThan(0);
      expect(region.detailScore).toBeGreaterThanOrEqual(0);
      expect(region.detailScore).toBeLessThanOrEqual(1);
      region.points.forEach((point) => {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(width);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(height);
      });
    });
  });

  it('returns no regions for a fully transparent image', () => {
    const result = extractAutoConvertRegions({
      pixels: new Uint8ClampedArray(12 * 8 * 4),
      width: 12,
      height: 8,
      targetShapes: 24,
      detail: 50,
    });

    expect(result.regions).toEqual([]);
  });

  it('enforces the 100-shape maximum in the owning algorithm', () => {
    const width = 512;
    const height = 512;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      pixels[index * 4] = (index * 29) % 255;
      pixels[index * 4 + 1] = (index * 47) % 255;
      pixels[index * 4 + 2] = (index * 71) % 255;
      pixels[index * 4 + 3] = 255;
    }

    const result = extractAutoConvertRegions({
      pixels,
      width,
      height,
      targetShapes: 500,
      detail: 100,
    });

    expect(result.regions).toHaveLength(100);
  });

  it('keeps every repeated-color island assigned to a connected painted region', () => {
    const width = 18;
    const height = 12;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const isLight = (x + y) % 2 === 0;
        pixels[offset] = isLight ? 240 : 20;
        pixels[offset + 1] = isLight ? 240 : 20;
        pixels[offset + 2] = isLight ? 240 : 20;
        pixels[offset + 3] = 255;
      }
    }

    const result = extractAutoConvertRegions({
      pixels,
      width,
      height,
      targetShapes: 12,
      detail: 75,
      maxColors: 6,
    });

    expect(result.regions).toHaveLength(12);
    expect(result.regions.reduce((total, region) => total + region.pixelCount, 0)).toBe(
      result.analysisWidth * result.analysisHeight,
    );
    result.regions.forEach((region) => {
      expect(region.sampledStops[0].position).toBe(0);
      expect(region.sampledStops[region.sampledStops.length - 1].position).toBe(1);
    });
  });

  it('allocates more of the fixed shape budget to locally detailed image areas', () => {
    const width = 64;
    const height = 32;
    const pixels = createFlatAndDetailedImage(width, height);
    const lowDetail = extractAutoConvertRegions({
      pixels,
      width,
      height,
      targetShapes: 20,
      detail: 0,
      maxColors: 4,
    });
    const highDetail = extractAutoConvertRegions({
      pixels,
      width,
      height,
      targetShapes: 20,
      detail: 100,
      maxColors: 4,
    });
    const countDetailedRegions = (result: typeof highDetail) => result.regions.filter((region) => {
      const meanX = region.points.reduce((total, point) => total + point.x, 0)
        / region.points.length;
      return meanX >= width / 2;
    }).length;
    const meanRegionDetail = (isDetailed: boolean) => {
      const matchingRegions = highDetail.regions.filter((region) => {
        const meanX = region.points.reduce((total, point) => total + point.x, 0)
          / region.points.length;
        return (meanX >= width / 2) === isDetailed;
      });
      return matchingRegions.reduce((total, region) => total + region.detailScore, 0)
        / matchingRegions.length;
    };

    expect(countDetailedRegions(highDetail)).toBeGreaterThan(countDetailedRegions(lowDetail));
    expect(countDetailedRegions(highDetail)).toBeGreaterThanOrEqual(13);
    expect(meanRegionDetail(true)).toBeGreaterThan(meanRegionDetail(false));
    expect(highDetail.regions).toHaveLength(20);
  });

  it('raises the analysis ceiling to preserve fine features at Detail 100', () => {
    const width = 512;
    const height = 16;
    const pixels = createSplitImage(width, height);

    const result = extractAutoConvertRegions({
      pixels,
      width,
      height,
      targetShapes: 2,
      detail: 100,
    });

    expect(result.analysisWidth).toBe(384);
  });
});
