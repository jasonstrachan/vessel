type FlushTask = () => Promise<void> | void;

const registry = new Map<string, FlushTask>();

export const registerToolFlush = (key: string, task: FlushTask): void => {
  registry.set(key, task);
};

export const unregisterToolFlush = (key: string): void => {
  registry.delete(key);
};

export const flushPendingToolWork = async (): Promise<void> => {
  for (const [, task] of registry) {
    try {
      await task();
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[toolFlushRegistry] flush failed', error);
      }
    }
  }
};
