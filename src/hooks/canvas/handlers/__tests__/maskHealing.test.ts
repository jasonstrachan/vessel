import { BrushShape } from '@/types';
import { beginMaskHealingStroke, type MaskHealState } from '@/hooks/canvas/handlers/maskHealing';
import type { MaskManager } from '@/layers/MaskManager';
import type { AppState } from '@/stores/useAppStore';
import type { BrushStampSource } from '@/tools/stamps/BrushStampSource';

describe('maskHealing', () => {
  const createHarness = (
    brushSettings: Partial<AppState['tools']['brushSettings']>,
    options: { enabled?: boolean } = {}
  ) => {
    const ctx = {
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      closePath: jest.fn(),
      fillRect: jest.fn(),
      globalCompositeOperation: 'source-over',
      globalAlpha: 1,
      imageSmoothingEnabled: true,
    } as unknown as CanvasRenderingContext2D;

    const stampSource = {
      begin: jest.fn(),
      draw: jest.fn(),
      end: jest.fn(),
    };
    const createBrushStampSource = jest.fn(
      () => stampSource as unknown as BrushStampSource
    );
    const maskCanvas = {
      getContext: jest.fn(() => ctx),
    } as unknown as HTMLCanvasElement;
    const maskHealStateRef = { current: null as MaskHealState | null };
    const debugWarn = jest.fn();
    const getState = () =>
      ({
        globalBrushSize: 12,
        tools: {
          brushSettings: {
            brushShape: BrushShape.COLOR_CYCLE_SHAPE,
            colorCycleStampShape: 'square',
            size: 12,
            pressureEnabled: false,
            minPressure: 50,
            maxPressure: 150,
            ...brushSettings,
          },
        },
      }) as unknown as AppState;

    beginMaskHealingStroke(
      {
        layerId: 'layer-1',
        startPoint: { x: 4, y: 5 },
        pressure: 0.9,
        maskHealStateRef,
      },
      {
        createBrushStampSource,
        maskManager: {
          getMask: jest.fn(() => maskCanvas),
          bumpVersion: jest.fn(),
        } as unknown as MaskManager,
        debugWarn,
        isEnabled: options.enabled ?? true,
        getState,
      }
    );

    return { ctx, createBrushStampSource, stampSource, maskHealStateRef, debugWarn };
  };

  it('requests opaque source and skips generic first brush stamp', () => {
    const { ctx, createBrushStampSource, stampSource, maskHealStateRef } = createHarness({
      colorCycleStampShape: 'round',
    });

    expect(createBrushStampSource).toHaveBeenCalledWith({ forceOpaque: true });
    expect(stampSource.begin).toHaveBeenCalledWith(ctx, { x: 4, y: 5 }, 0.9, { skipInitialStamp: true });
    expect(maskHealStateRef.current).not.toBeNull();
  });

  it('draws round tip at stroke start when CC tip is round', () => {
    const { ctx } = createHarness({ colorCycleStampShape: 'round' });

    expect(ctx.arc).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('draws square tip at stroke start when CC tip is square', () => {
    const { ctx } = createHarness({ colorCycleStampShape: 'square' });

    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.arc).not.toHaveBeenCalled();
  });

  it('draws diamond tip at stroke start when CC tip is diamond', () => {
    const { ctx } = createHarness({ colorCycleStampShape: 'diamond' });

    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.moveTo).toHaveBeenCalledTimes(1);
    expect(ctx.lineTo).toHaveBeenCalledTimes(3);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('forces triangle tip when active brush shape is COLOR_CYCLE_TRIANGLE', () => {
    const { ctx } = createHarness({
      brushShape: BrushShape.COLOR_CYCLE_TRIANGLE,
      colorCycleStampShape: 'round',
    });

    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.moveTo).toHaveBeenCalledTimes(1);
    expect(ctx.lineTo).toHaveBeenCalledTimes(2);
    expect(ctx.arc).not.toHaveBeenCalled();
  });

  it('does not begin mask healing when feature is disabled', () => {
    const { createBrushStampSource, maskHealStateRef } = createHarness(
      { colorCycleStampShape: 'diamond' },
      { enabled: false }
    );

    expect(createBrushStampSource).not.toHaveBeenCalled();
    expect(maskHealStateRef.current).toBeNull();
  });
});
