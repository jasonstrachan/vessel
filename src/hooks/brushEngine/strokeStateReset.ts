import {
  createInitialStrokePresResPressureState,
  createInitialStrokePressureState,
  type StrokePresResPressureState,
  type StrokePressureState,
} from './strokePressure';

export const resetStrokePressureDitherRuntime = ({
  strokePressureRef,
  lastPressureDitherTimeRef,
  lastPressureDitherPixelSizeRef,
  committedPixelSizeRef,
  pendingPixelSizeRef,
  pendingSinceRef,
  strokePressureResStateRef,
  createPressureResolutionState,
  strokePresResPressureRef,
  presResLastLogAtRef,
  presResLastLoggedPixelSizeRef,
  resetCommittedAndPending,
}: {
  strokePressureRef: { current: StrokePressureState };
  lastPressureDitherTimeRef: { current: number };
  lastPressureDitherPixelSizeRef: { current: number | null };
  committedPixelSizeRef: { current: number | null };
  pendingPixelSizeRef: { current: number | null };
  pendingSinceRef: { current: number };
  strokePressureResStateRef: { current: unknown };
  createPressureResolutionState: (value: number) => unknown;
  strokePresResPressureRef: { current: StrokePresResPressureState };
  presResLastLogAtRef: { current: number };
  presResLastLoggedPixelSizeRef: { current: number | null };
  resetCommittedAndPending: boolean;
}): void => {
  strokePressureRef.current = createInitialStrokePressureState();
  lastPressureDitherTimeRef.current = 0;
  lastPressureDitherPixelSizeRef.current = null;
  if (resetCommittedAndPending) {
    committedPixelSizeRef.current = null;
    pendingPixelSizeRef.current = null;
    pendingSinceRef.current = 0;
  }
  strokePressureResStateRef.current = createPressureResolutionState(1);
  strokePresResPressureRef.current = createInitialStrokePresResPressureState();
  presResLastLogAtRef.current = 0;
  presResLastLoggedPixelSizeRef.current = null;
};
