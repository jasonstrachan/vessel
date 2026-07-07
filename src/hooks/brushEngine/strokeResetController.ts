export const runStrokeReset = ({
  resetStroke,
  strokeBoundsRef,
  strokePhaseOriginRef,
  clearLiveStrokeBuffers,
  clearCoverageMaps,
  clearBgOffHoleCanvas,
  resetPressureDitherRuntime,
}: {
  resetStroke: () => void;
  strokeBoundsRef: { current: unknown };
  strokePhaseOriginRef: { current: unknown };
  clearLiveStrokeBuffers: () => void;
  clearCoverageMaps: () => void;
  clearBgOffHoleCanvas: () => void;
  resetPressureDitherRuntime: () => void;
}): void => {
  resetStroke();
  strokeBoundsRef.current = null;
  strokePhaseOriginRef.current = null;
  clearLiveStrokeBuffers();
  clearCoverageMaps();
  clearBgOffHoleCanvas();
  resetPressureDitherRuntime();
};
