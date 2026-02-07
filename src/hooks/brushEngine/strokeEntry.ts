import type { Rect } from './engineShared';

export const beginStrokeIfNeeded = ({
  strokeBoundsRef,
  strokePhaseOriginRef,
  x,
  y,
  resetPressureDitherState,
}: {
  strokeBoundsRef: { current: Rect | null };
  strokePhaseOriginRef: { current: { x: number; y: number } | null };
  x: number;
  y: number;
  resetPressureDitherState: () => void;
}): void => {
  if (!strokeBoundsRef.current) {
    resetPressureDitherState();
    strokePhaseOriginRef.current = { x: Math.floor(x), y: Math.floor(y) };
  }
};
