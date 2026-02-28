import { floodSelect } from '@/utils/floodSelect';

describe('floodSelect', () => {
  it('does not cross into very different hue when threshold is small', () => {
    const imageData = new ImageData(3, 1);
    const data = imageData.data;
    data.set([255, 0, 0, 255], 0);   // red
    data.set([240, 20, 20, 255], 4); // near red
    data.set([0, 255, 0, 255], 8);   // green

    const result = floodSelect(imageData, 0, 0, { threshold: 25, contiguous: false });
    expect(result).toBeTruthy();
    if (!result) return;

    expect(result.bounds).toEqual({ x: 0, y: 0, width: 2, height: 1 });
    expect(result.mask.data[3]).toBe(255);
    expect(result.mask.data[7]).toBe(255);
  });

  it('includes all matching pixels when non-contiguous mode is enabled', () => {
    const imageData = new ImageData(3, 1);
    const data = imageData.data;
    data.set([255, 0, 0, 255], 0);
    data.set([0, 0, 255, 255], 4);
    data.set([255, 0, 0, 255], 8);

    const result = floodSelect(imageData, 0, 0, { threshold: 0, contiguous: false });
    expect(result).toBeTruthy();
    if (!result) return;

    expect(result.bounds).toEqual({ x: 0, y: 0, width: 3, height: 1 });
    expect(result.mask.data[3]).toBe(255);
    expect(result.mask.data[7]).toBe(0);
    expect(result.mask.data[11]).toBe(255);
  });
});
