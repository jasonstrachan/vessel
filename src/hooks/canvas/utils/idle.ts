export const runIdle = (cb: () => void): void => {
  if (typeof window !== 'undefined') {
    type RequestIdle = (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    const requestIdle = (window as typeof window & { requestIdleCallback?: RequestIdle })
      .requestIdleCallback;
    if (typeof requestIdle === 'function') {
      requestIdle(() => cb(), { timeout: 60 });
      return;
    }
  }
  setTimeout(cb, 0);
};

export const runIdleAsync = <T>(
  task: () => Promise<T> | T,
  runner: (cb: () => void) => void = runIdle
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    runner(() => {
      try {
        Promise.resolve(task()).then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  });
