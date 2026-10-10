import { defaultBrushSettings } from '@/presets/brushPresets';
import { BrushShape } from '@/types';

import { CustomBrushCycleReplayService } from '../customBrushCycleReplay';
import { renderSmoothStroke } from '../smoothStrokeRenderer';
import { createPixelQueue, resetPixelQueue, shouldDrawStamp } from '../strokeProcessor';

const createArgs = () => {
  const brushSettings = { ...defaultBrushSettings, dashedEnabled: false };
  return {
    ctx: document.createElement('canvas').getContext('2d')!,
    from: { x: 20, y: 20 },
    to: { x: 20, y: 20 },
    settings: {
      size: 16,
      opacity: 0.5,
      color: '#c02030',
      antiAliasing: true,
      pixelAlignment: false,
      spacing: 4,
      rotation: 0,
      shape: BrushShape.ROUND,
      risographIntensity: 0,
    },
    brushSettings,
    pixelQueue: createPixelQueue(),
    strokeProcessor: { shouldDrawStamp },
    customBrushCycleReplay: new CustomBrushCycleReplayService(brushSettings),
    shapeDrawer: jest.fn(),
    canDrawAt: jest.fn(() => true),
    shouldSkipNearDuplicateFinalStamp: jest.fn(() => false),
  };
};

describe('smooth stroke initial stamp', () => {
  it.each([BrushShape.ROUND, BrushShape.SQUARE])('stamps a stationary %s only once until reset', (shape) => {
    const args = createArgs();
    args.settings.shape = shape;
    renderSmoothStroke(args);
    renderSmoothStroke(args);
    expect(args.shapeDrawer).toHaveBeenCalledTimes(1);
    expect(args.shapeDrawer).toHaveBeenCalledWith(
      args.ctx, 20, 20, 16, shape, true, 0, 0, undefined, undefined, undefined,
    );
    resetPixelQueue(args.pixelQueue);
    renderSmoothStroke(args);
    expect(args.shapeDrawer).toHaveBeenCalledTimes(2);
  });

  it('measures spacing from the initial stamp across pointer segments', () => {
    const args = createArgs();
    renderSmoothStroke(args);
    renderSmoothStroke({ ...args, to: { x: 22, y: 20 } });
    expect(args.shapeDrawer).toHaveBeenCalledTimes(1);
    renderSmoothStroke({ ...args, from: { x: 22, y: 20 }, to: { x: 28, y: 20 } });
    expect(args.shapeDrawer.mock.calls.map((call) => call.slice(1, 3))).toEqual([
      [20, 20], [24, 20], [28, 20],
    ]);
  });

  it('also emits the start when the first input segment has travel', () => {
    const args = createArgs();
    renderSmoothStroke({ ...args, to: { x: 28, y: 20 } });
    expect(args.shapeDrawer.mock.calls.map((call) => call.slice(1, 3))).toEqual([
      [20, 20], [24, 20], [28, 20],
    ]);
  });

  it('starts a dashed stroke without advancing its distance phase', () => {
    const args = createArgs();
    args.brushSettings.dashedEnabled = true;
    renderSmoothStroke(args);
    renderSmoothStroke(args);
    expect(args.shapeDrawer).toHaveBeenCalledTimes(1);
    expect(args.pixelQueue.dashPhasePx).toBe(0);
    expect(args.pixelQueue.dashStampCounter).toBe(1);
  });

  it('respects admission at the initial point and resumes at the next spaced point', () => {
    const args = createArgs();
    args.canDrawAt.mockReturnValueOnce(false);
    renderSmoothStroke(args);
    expect(args.shapeDrawer).not.toHaveBeenCalled();
    renderSmoothStroke({ ...args, to: { x: 24, y: 20 } });
    expect(args.shapeDrawer).toHaveBeenCalledTimes(1);
    expect(args.shapeDrawer.mock.calls[0].slice(1, 3)).toEqual([24, 20]);
  });

  it('replays captured custom colour at the first stamp without advancing stationary repeats', () => {
    const args = createArgs();
    args.settings.shape = BrushShape.CUSTOM;
    const pattern = new ImageData(new Uint8ClampedArray([255, 0, 0, 128]), 1, 1);
    const customBrushData = {
      imageData: pattern,
      width: 1,
      height: 1,
      colorCycleMode: 'captured-data' as const,
    };
    const phase = jest.spyOn(args.customBrushCycleReplay, 'getNextPhase');
    jest.spyOn(args.customBrushCycleReplay, 'getCapturedDataPattern').mockReturnValue(pattern);
    renderSmoothStroke({ ...args, customBrushData });
    renderSmoothStroke({ ...args, customBrushData });
    expect(phase).toHaveBeenCalledTimes(1);
    expect(args.shapeDrawer).toHaveBeenCalledWith(
      args.ctx, 20, 20, 16, BrushShape.CUSTOM, true, 0, 0, pattern, false, undefined,
    );
  });
});
