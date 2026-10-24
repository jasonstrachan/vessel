import { debugWarn } from '@/utils/debug';
type FlushTask = () => Promise<void> | void;

type FlushRegistration = {
  task: FlushTask;
  passive: boolean;
};

type RegisterToolFlushOptions = {
  passive?: boolean;
};

type FlushPendingToolWorkOptions = {
  passiveOnly?: boolean;
};

const registry = new Map<string, FlushRegistration>();

export const registerToolFlush = (
  key: string,
  task: FlushTask,
  options: RegisterToolFlushOptions = {}
): void => {
  registry.set(key, {
    task,
    passive: options.passive ?? true,
  });
};

export const unregisterToolFlush = (key: string): void => {
  registry.delete(key);
};

export const runToolFlush = async (key: string): Promise<boolean> => {
  const registration = registry.get(key);
  if (!registration) {
    return false;
  }
  await registration.task();
  return true;
};

export const flushPendingToolWork = async (
  options: FlushPendingToolWorkOptions = {}
): Promise<void> => {
  for (const [, registration] of registry) {
    if (options.passiveOnly && !registration.passive) {
      continue;
    }
    try {
      await registration.task();
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        debugWarn('raw-console', '[toolFlushRegistry] flush failed', error);
      }
    }
  }
};
