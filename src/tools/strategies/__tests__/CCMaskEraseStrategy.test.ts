import type { MaskManager } from '@/layers/MaskManager';
import type { BrushStampSource } from '@/tools/stamps/BrushStampSource';
import { CCMaskEraseStrategy } from '@/tools/strategies/CCMaskEraseStrategy';
import type { Layer } from '@/types';
import { registerCanvasAuthoringObserver } from '@/utils/canvasAuthoringObserver';

describe('CCMaskEraseStrategy', () => {
  it('draws each shared source segment once on the canonical mask at alpha one', () => {
    const mask = document.createElement('canvas');
    mask.width = 12;
    mask.height = 12;
    const ctx = mask.getContext('2d')!;
    ctx.globalAlpha = 0.25;
    ctx.globalCompositeOperation = 'destination-out';
    const save = jest.spyOn(ctx, 'save');
    const restore = jest.spyOn(ctx, 'restore');
    const manager = { getMask: jest.fn(() => mask), bumpVersion: jest.fn() };
    const strategy = new CCMaskEraseStrategy(manager as unknown as MaskManager, 'layer-1');
    const draw = jest.fn((target: CanvasRenderingContext2D) => {
      expect(target).toBe(ctx);
      expect(target.globalAlpha).toBe(1);
      expect(target.globalCompositeOperation).toBe('source-over');
    });
    const source = { draw } as unknown as BrushStampSource;
    const from = { x: 2, y: 4 };
    const to = { x: 7, y: 9 };

    expect(strategy.begin({ id: 'layer-1', layerType: 'color-cycle' } as Layer)).toBe(ctx);
    strategy.stamp(from, to, 0.25, source);
    strategy.stamp(to, from, 0.75, source);
    strategy.end();

    expect(draw).toHaveBeenCalledTimes(2);
    expect(draw).toHaveBeenNthCalledWith(1, ctx, from, to, { pressure: 0.25 });
    expect(draw).toHaveBeenNthCalledWith(2, ctx, to, from, { pressure: 0.75 });
    expect(save).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(manager.bumpVersion).toHaveBeenCalledTimes(1);
    expect(manager.bumpVersion).toHaveBeenCalledWith('layer-1');
    strategy.stamp(from, to, 1, source);
    strategy.end();
    expect(draw).toHaveBeenCalledTimes(2);
    expect(manager.bumpVersion).toHaveBeenCalledTimes(1);
  });

  it('preserves prior mask pixels without adding a direct fallback stamp', () => {
    const mask = document.createElement('canvas');
    mask.width = 12;
    mask.height = 12;
    const ctx = mask.getContext('2d')!;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, 0, 12, 12);
    const before = ctx.getImageData(0, 0, 12, 12).data;
    const strategy = new CCMaskEraseStrategy({
      getMask: () => mask, bumpVersion: jest.fn(),
    } as unknown as MaskManager, 'layer-1');

    strategy.begin({ id: 'layer-1', layerType: 'color-cycle' } as Layer);
    strategy.stamp({ x: 2, y: 2 }, { x: 6, y: 6 }, 1, null);
    strategy.end();

    expect(ctx.getImageData(0, 0, 12, 12).data).toEqual(before);
  });

  it.each([false, true])('finishes observation after restoring the mask when cancelled=%s', (cancelled) => {
    const mask = document.createElement('canvas');
    const ctx = mask.getContext('2d')!;
    const restore = jest.spyOn(ctx, 'restore');
    const finish = jest.fn(() => expect(restore).toHaveBeenCalledTimes(1));
    const observe = jest.fn(() => ({ context: ctx, finish }));
    const unregister = registerCanvasAuthoringObserver(observe);
    try {
      const strategy = new CCMaskEraseStrategy({
        getMask: () => mask, bumpVersion: jest.fn(),
      } as unknown as MaskManager, 'layer-1');
      strategy.begin({ id: 'layer-1', layerType: 'color-cycle' } as Layer);
      strategy.end(cancelled);
      expect(observe).toHaveBeenCalledWith(ctx, {
        layerId: 'layer-1', operation: 'destination-out',
      });
      expect(finish).toHaveBeenCalledWith(cancelled);
    } finally {
      unregister();
    }
  });
});
