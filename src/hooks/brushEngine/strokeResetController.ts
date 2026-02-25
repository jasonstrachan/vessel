export const runStrokeReset = ({
  brushEngine,
  strokeBoundsRef,
  strokePhaseOriginRef,
  clearLiveStrokeBuffers,
  clearCoverageMaps,
  clearBgOffHoleCanvas,
  resetPressureDitherRuntime,
}: {
  brushEngine: { resetStroke: () => void };
  strokeBoundsRef: { current: unknown };
  strokePhaseOriginRef: { current: unknown };
  clearLiveStrokeBuffers: () => void;
  clearCoverageMaps: () => void;
  clearBgOffHoleCanvas: () => void;
  resetPressureDitherRuntime: () => void;
}): void => {
  brushEngine.resetStroke();
  strokeBoundsRef.current = null;
  strokePhaseOriginRef.current = null;
  clearLiveStrokeBuffers();
  clearCoverageMaps();
  clearBgOffHoleCanvas();
  resetPressureDitherRuntime();
};
