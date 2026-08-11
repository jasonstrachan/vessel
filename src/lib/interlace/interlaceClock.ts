let elapsedSeconds = 0;

export const advanceInterlaceClock = (deltaSeconds: number): void => {
  if (Number.isFinite(deltaSeconds) && deltaSeconds > 0 && deltaSeconds < 1) {
    elapsedSeconds += deltaSeconds;
  }
};

export const getInterlaceElapsedSeconds = (): number => elapsedSeconds;

export const resetInterlaceClock = (): void => {
  elapsedSeconds = 0;
};
