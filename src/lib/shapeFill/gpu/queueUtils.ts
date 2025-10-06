export const waitForQueueIdle = async (queue: GPUQueue): Promise<void> => {
  const extended = queue as GPUQueue & { onSubmittedWorkDone?: () => Promise<void> };
  if (typeof extended.onSubmittedWorkDone === 'function') {
    await extended.onSubmittedWorkDone();
  }
};
