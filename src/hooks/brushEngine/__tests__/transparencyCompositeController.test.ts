import {
  setBlendModeIfUnlocked,
  setMultiplyIfUnlocked,
  withTransparencyLockComposite,
} from '../transparencyCompositeController';

describe('transparencyCompositeController', () => {
  it('withTransparencyLockComposite applies source-atop during draw when locked', () => {
    const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
    ctx.globalCompositeOperation = 'source-over';

    withTransparencyLockComposite({
      ctx,
      isTransparencyLocked: true,
      draw: () => {
        expect(ctx.globalCompositeOperation).toBe('source-atop');
      },
    });

    expect(ctx.globalCompositeOperation).toBe('source-over');
  });

  it('withTransparencyLockComposite runs draw without changing composite when unlocked', () => {
    const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
    ctx.globalCompositeOperation = 'multiply';
    const draw = jest.fn();

    withTransparencyLockComposite({
      ctx,
      isTransparencyLocked: false,
      draw,
    });

    expect(draw).toHaveBeenCalledTimes(1);
    expect(ctx.globalCompositeOperation).toBe('multiply');
  });

  it('setBlendModeIfUnlocked applies configured mode or source-over fallback', () => {
    const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;

    setBlendModeIfUnlocked({
      ctx,
      isTransparencyLocked: false,
      blendMode: 'screen',
    });
    expect(ctx.globalCompositeOperation).toBe('screen');

    setBlendModeIfUnlocked({
      ctx,
      isTransparencyLocked: false,
    });
    expect(ctx.globalCompositeOperation).toBe('source-over');
  });

  it('setBlendModeIfUnlocked and setMultiplyIfUnlocked no-op when locked', () => {
    const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
    ctx.globalCompositeOperation = 'xor';

    setBlendModeIfUnlocked({
      ctx,
      isTransparencyLocked: true,
      blendMode: 'screen',
    });
    expect(ctx.globalCompositeOperation).toBe('xor');

    setMultiplyIfUnlocked({
      ctx,
      isTransparencyLocked: true,
    });
    expect(ctx.globalCompositeOperation).toBe('xor');
  });

  it('setMultiplyIfUnlocked applies multiply when unlocked', () => {
    const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;

    setMultiplyIfUnlocked({
      ctx,
      isTransparencyLocked: false,
    });

    expect(ctx.globalCompositeOperation).toBe('multiply');
  });
});
