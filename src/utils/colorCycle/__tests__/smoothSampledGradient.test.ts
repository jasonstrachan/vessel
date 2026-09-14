import { smoothSampledGradient } from '../smoothSampledGradient';

const channels = (color: string) => color.match(/\d+/g)!.map(Number);

describe('smoothSampledGradient', () => {
  it('softens a sharp transition and loop seam while retaining broad colour regions', () => {
    const samples = Array.from({ length: 256 }, (_, i) => ({
      rgba: (i < 128 ? [255, 0, 0, 255] : [0, 0, 255, 255]) as [number, number, number, number],
    }));
    const original = structuredClone(samples);
    const stops = smoothSampledGradient(samples);
    expect(stops).toHaveLength(256);
    expect(stops[0].color).toBe(stops[255].color);
    expect(channels(stops[64].color)).toEqual([255, 0, 0]);
    expect(channels(stops[192].color)).toEqual([0, 0, 255]);
    let largestJump = 0;
    for (let i = 1; i < stops.length; i++) {
      const previous = channels(stops[i - 1].color);
      channels(stops[i].color).forEach((value, channel) => {
        largestJump = Math.max(largestJump, Math.abs(value - previous[channel]));
      });
    }
    // A short softened edge, not the former broad blur or an unfiltered 255 jump.
    expect(largestJump).toBeGreaterThan(20);
    expect(largestJump).toBeLessThan(75);
    const edge = stops.slice(112, 144).map(stop => channels(stop.color)[0]);
    expect(edge.filter(value => value > 10 && value < 245).length).toBeLessThanOrEqual(6);
    const seamJump = Math.max(...stops.slice(0, 5).map((stop, i) =>
      Math.abs(channels(stop.color)[0] - channels(stops[i + 1].color)[0])));
    expect(seamJump).toBeLessThan(largestJump);
    expect(samples).toEqual(original);
  });

  it('retains a narrow bright stripe instead of smearing it into the background', () => {
    const stops = smoothSampledGradient(Array.from({ length: 256 }, (_, i) => ({
      rgba: [i >= 80 && i < 88 ? 255 : 0, 0, 0, 255] as [number, number, number, number],
    })));
    expect(channels(stops[83].color)[0]).toBeGreaterThan(245);
    expect(channels(stops[73].color)[0]).toBe(0);
    expect(channels(stops[94].color)[0]).toBe(0);
  });

  it('keeps short two-colour samples animated and closes their loop', () => {
    const stops = smoothSampledGradient([{ rgba: [255, 0, 0, 255] }, { rgba: [0, 0, 255, 255] }]);
    expect(stops[0].color).toBe(stops.at(-1)?.color);
    expect(stops[1].color).not.toBe(stops[0].color);
  });

  it('preserves constant colours and avoids dark fringes around transparency', () => {
    const solid = smoothSampledGradient(Array.from({ length: 20 }, () => ({ rgba: [120, 60, 30, 255] as [number, number, number, number] })));
    expect(new Set(solid.map(stop => stop.color))).toEqual(new Set(['rgb(120, 60, 30)']));
    const transparent = smoothSampledGradient([{ rgba: [255, 0, 0, 255] }, { rgba: [0, 0, 0, 0] }]);
    expect(transparent.every(stop => stop.color === 'rgb(255, 0, 0)')).toBe(true);
    expect(transparent.every(stop => (stop.opacity ?? 1) < 1)).toBe(true);
  });
});
