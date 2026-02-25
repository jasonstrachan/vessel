type ColorCyclePixelQueue = {
  onIdle?: (callback: () => void) => void;
  flushNow?: () => void;
};

export const flushColorCycleQueueBeforeFinalize = async ({
  queue,
  shouldAwait,
}: {
  queue: ColorCyclePixelQueue | null;
  shouldAwait: boolean;
}): Promise<void> => {
  if (shouldAwait && queue?.onIdle) {
    await new Promise<void>((resolve) => {
      queue.onIdle?.(resolve);
    });
    return;
  }

  try {
    queue?.flushNow?.();
  } catch {}
};
