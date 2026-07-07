import { runStrokeReset } from './strokeResetController';

import type { Rect } from './engineShared';

export const resetStrokeCurrent = ({
  resetStroke,
  strokeBoundsRef,
  strokePhaseOriginRef,
  clearLiveStrokeBuffers,
  clearCoverageMaps,
  clearBgOffHoleCanvas,
  runResetPressureDitherRuntime,
}: {
  resetStroke: () => void;
  strokeBoundsRef: { current: Rect | null };
  strokePhaseOriginRef: { current: { x: number; y: number } | null };
  clearLiveStrokeBuffers: () => void;
  clearCoverageMaps: () => void;
  clearBgOffHoleCanvas: () => void;
  runResetPressureDitherRuntime: (resetCommittedAndPending: boolean) => void;
}): void => {
  runStrokeReset({
    resetStroke,
    strokeBoundsRef,
    strokePhaseOriginRef,
    clearLiveStrokeBuffers,
    clearCoverageMaps,
    clearBgOffHoleCanvas,
    resetPressureDitherRuntime: () => runResetPressureDitherRuntime(true),
  });
};
