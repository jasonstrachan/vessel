import { resetStrokeCurrent } from '../strokeResetEntryController';
import { runStrokeReset } from '../strokeResetController';

jest.mock('../strokeResetController', () => ({
  runStrokeReset: jest.fn(),
}));

describe('strokeResetEntryController', () => {
  it('forwards reset dependencies to runStrokeReset and maps runtime reset callback', () => {
    const runResetPressureDitherRuntime = jest.fn();

    resetStrokeCurrent({
      brushEngine: { resetStroke: jest.fn() },
      strokeBoundsRef: { current: null },
      strokePhaseOriginRef: { current: null },
      clearLiveStrokeBuffers: jest.fn(),
      clearCoverageMaps: jest.fn(),
      clearBgOffHoleCanvas: jest.fn(),
      runResetPressureDitherRuntime,
    });

    expect(runStrokeReset).toHaveBeenCalledTimes(1);
    const args = (runStrokeReset as jest.Mock).mock.calls[0][0];
    expect(args).toEqual(expect.objectContaining({
      brushEngine: expect.any(Object),
      strokeBoundsRef: expect.any(Object),
      strokePhaseOriginRef: expect.any(Object),
      clearLiveStrokeBuffers: expect.any(Function),
      clearCoverageMaps: expect.any(Function),
      clearBgOffHoleCanvas: expect.any(Function),
      resetPressureDitherRuntime: expect.any(Function),
    }));

    args.resetPressureDitherRuntime();
    expect(runResetPressureDitherRuntime).toHaveBeenCalledWith(true);
  });
});
