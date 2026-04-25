import {
  resolveDisplayFilterPixelSize,
  resolveDisplayFilterRadius,
  resolveDisplayNoiseTileStep,
  resolveDownsampledDisplayFilterRadius,
  resolveFilmNoiseSampleStep,
} from '@/lib/displayFilterPipeline';

describe('display filter source-pixel sizing', () => {
  it('keeps the minimum noise grain at one source pixel regardless of viewport scale', () => {
    expect(resolveDisplayNoiseTileStep(1)).toBe(1);
  });

  it('rounds filter scale directly instead of folding zoom or DPR into the grain size', () => {
    expect(resolveDisplayNoiseTileStep(1.5)).toBe(2);
    expect(resolveDisplayNoiseTileStep(3)).toBe(3);
  });

  it('rounds pixel-sized filter controls directly in source pixels', () => {
    expect(resolveDisplayFilterPixelSize(1)).toBe(1);
    expect(resolveDisplayFilterPixelSize(3.25)).toBe(3);
    expect(resolveDisplayFilterPixelSize(3.75)).toBe(4);
  });

  it('preserves radius controls directly in source pixels with optional floors', () => {
    expect(resolveDisplayFilterRadius(0.25)).toBe(0.25);
    expect(resolveDisplayFilterRadius(4)).toBe(4);
    expect(resolveDisplayFilterRadius(0, 0, 0.5)).toBe(0.5);
  });

  it('compensates radii used on downsampled intermediate canvases', () => {
    expect(resolveDownsampledDisplayFilterRadius(24, 0, 4)).toBe(6);
    expect(resolveDownsampledDisplayFilterRadius(4, 0, 4)).toBe(1);
    expect(resolveDownsampledDisplayFilterRadius(0, 0, 4, 0.5)).toBe(0.5);
  });

  it('uses the resolved grain tile as the film-noise sampling stride', () => {
    expect(resolveFilmNoiseSampleStep(1)).toBe(1);
    expect(resolveFilmNoiseSampleStep(2)).toBe(2);
    expect(resolveFilmNoiseSampleStep(8)).toBe(4);
  });
});
