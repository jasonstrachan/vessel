import { ColorCycleAnimator } from '../ColorCycleAnimator';
import * as sampled from '../colorCycle/sampledPathPalette';
import { createDefPaletteCache } from '@/hooks/brushEngine/colorCycleDefPaletteCache';

it('reuses held palettes but refreshes them for motion, speed, new indices and source edits', () => {
  const animator = new ColorCycleAnimator({ width: 2, height: 1, forceCanvas2D: true, autoStart: false });
  const spy = jest.spyOn(sampled, 'renderSampledPathPalette');
  const cache = (r: number) => createDefPaletteCache([{ id: 1, hash: `source:${r}`,
    stops: [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }],
    sampledPath: { rgba: sampled.encodeSampledPathColors(new Uint8Array([r, 40, 60, 255, 180, 200, 220, 255])), offset: 0 },
  }], 1);
  const buffers = (speed: number, index = 1) => {
    animator.setIndexBufferFromArray(new Uint8Array([index, 2]), new Uint8Array(2),
      new Uint8Array(2).fill(speed), new Uint8Array(2).fill(5), new Uint8Array(2));
    animator.setDefIdData(new Uint16Array([1, 1]));
  };
  const render = (seconds: number) => (animator as unknown as { renderFrame(offset: number, time: number): void }).renderFrame(0, seconds);
  try {
    buffers(17); animator.setDefPaletteCache(cache(20)); spy.mockClear();
    render(0);
    const first = animator.getImageData().data.slice();
    expect(spy).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) render(0);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(animator.getImageData().data).toEqual(first);
    buffers(17, 2); render(0);
    expect(spy).toHaveBeenCalledTimes(1);
    expect([...animator.getImageData().data.slice(0, 4)]).toEqual([180, 200, 220, 255]);
    render(1); expect(spy).toHaveBeenCalledTimes(2);
    buffers(50); render(1); expect(spy).toHaveBeenCalledTimes(3);
    buffers(50, 1); render(0);
    expect(spy).toHaveBeenCalledTimes(4);
    animator.setDefPaletteCache(cache(99)); render(0);
    expect(spy).toHaveBeenCalledTimes(5);
    buffers(50, 1); render(0);
    expect([...animator.getImageData().data.slice(0, 4)]).toEqual([99, 40, 60, 255]);

    const expandedCache = cache(99);
    const newPath = cache(70).sampledPaths.get(1)!;
    expandedCache.sampledPaths.set(2, newPath);
    animator.setIndexBufferFromArray(new Uint8Array([1, 1]), new Uint8Array(2),
      new Uint8Array(2).fill(50), new Uint8Array(2).fill(5), new Uint8Array(2));
    animator.setDefIdData(new Uint16Array([1, 2]));
    animator.setDefPaletteCache(expandedCache);
    render(0);
    expect(spy).toHaveBeenCalledTimes(7);
    expect([...animator.getImageData().data]).toEqual([99, 40, 60, 255, 70, 40, 60, 255]);
    render(0);
    expect(spy).toHaveBeenCalledTimes(7);
  } finally { spy.mockRestore(); animator.cleanup(); }
});
