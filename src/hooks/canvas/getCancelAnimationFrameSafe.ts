export const getCancelAnimationFrameSafe = (): ((handle: number) => void) =>
  typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function'
    ? window.cancelAnimationFrame.bind(window)
    : () => {};
