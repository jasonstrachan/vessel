import { unwrapAngle } from '@/utils/angles';

const ROTATION_DISTANCE_EPSILON = 1e-3;

export const resolveBrushRotation = (
  rotationEnabled: boolean,
  dx: number,
  dy: number,
  distance: number,
  previousRotation: number | undefined
): { rotation: number; nextRotation: number | undefined } => {
  if (!rotationEnabled) {
    return { rotation: 0, nextRotation: undefined };
  }
  const baseRotation = Math.atan2(dy, dx);
  const rotation =
    distance >= ROTATION_DISTANCE_EPSILON
      ? unwrapAngle(previousRotation, baseRotation)
      : previousRotation ?? baseRotation;
  return { rotation, nextRotation: rotation };
};
