import { isFeatureFlagEnabled } from '@/config/featureFlags';
import { logError } from '@/utils/debug';

import type { PixelQueue } from './types';

type PixelQueueTask = {
  kind: 'paint';
  mergeable: false;
  run: () => void;
};

export function createPixelQueue(): PixelQueue {
  const tasks: PixelQueueTask[] = [];
  let taskHead = 0;
  let rafId: number | null = null;
  const idleListeners: Array<() => void> = [];
  let idleHead = 0;
  const hasWindow = typeof window !== 'undefined';
  const requestFrame = hasWindow && typeof window.requestAnimationFrame === 'function'
    ? window.requestAnimationFrame.bind(window)
    : null;
  const cancelFrame = hasWindow && typeof window.cancelAnimationFrame === 'function'
    ? window.cancelAnimationFrame.bind(window)
    : null;

  let dirtyRect: { x: number; y: number; w: number; h: number } | null = null;
  let pendingDirtyFrame: number | null = null;
  let pendingDirtyTimeout: ReturnType<typeof setTimeout> | null = null;

  const now = () => {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  };

  const BUDGET_MS = 6;
  const MAX_TASKS = 512;
  const MAX_PENDING_PIXEL_TASKS = 2048;
  const QUEUE_COMPACT_INTERVAL = 1024;
  const debtControlEnabled = isFeatureFlagEnabled('enableSequentialTypedQueueDebtControl');

  const taskCount = () => tasks.length - taskHead;

  const compactTasksIfNeeded = () => {
    if (taskHead <= QUEUE_COMPACT_INTERVAL || taskHead <= tasks.length / 2) {
      return;
    }
    tasks.splice(0, taskHead);
    taskHead = 0;
  };

  const shiftTask = (): PixelQueueTask | null => {
    if (taskHead >= tasks.length) {
      return null;
    }
    const task = tasks[taskHead];
    taskHead += 1;
    compactTasksIfNeeded();
    return task;
  };

  const runTask = (task: PixelQueueTask) => {
    try {
      task.run();
    } catch (error) {
      logError('[PixelQueue] Task execution failed:', error);
    }
  };

  const notifyIdle = () => {
    if (taskCount() > 0 || rafId != null) {
      return;
    }
    if (idleHead >= idleListeners.length) {
      return;
    }
    const callbacks = idleListeners.slice(idleHead);
    idleHead = idleListeners.length;
    if (idleHead > QUEUE_COMPACT_INTERVAL && idleHead > idleListeners.length / 2) {
      idleListeners.splice(0, idleHead);
      idleHead = 0;
    }
    for (const cb of callbacks) {
      try {
        cb();
      } catch (error) {
        logError('[PixelQueue] Idle callback failed:', error);
      }
    }
  };

  const dispatchDirtyRect = () => {
    pendingDirtyFrame = null;
    if (pendingDirtyTimeout != null) {
      clearTimeout(pendingDirtyTimeout);
      pendingDirtyTimeout = null;
    }
    if (!dirtyRect || !hasWindow) {
      dirtyRect = null;
      return;
    }
    const rect = dirtyRect;
    dirtyRect = null;
    try {
      window.dispatchEvent(
        new CustomEvent('colorCycleFrameUpdate', {
          detail: {
            onlyActiveLayer: true,
            roi: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
          },
        }),
      );
    } catch (error) {
      logError('[PixelQueue] Failed to dispatch dirty rect:', error);
    }
  };

  const scheduleDirtyDispatch = () => {
    if (!dirtyRect || !hasWindow) {
      return;
    }
    if (pendingDirtyFrame != null) {
      return;
    }
    if (requestFrame) {
      pendingDirtyFrame = requestFrame(dispatchDirtyRect);
    } else {
      pendingDirtyTimeout = setTimeout(dispatchDirtyRect, 0);
    }
  };

  const tick = () => {
    rafId = null;
    if (taskCount() === 0) {
      if (dirtyRect) {
        scheduleDirtyDispatch();
      }
      notifyIdle();
      return;
    }

    const start = now();
    let processed = 0;
    while (taskCount() > 0 && processed < MAX_TASKS) {
      const nextTask = shiftTask();
      if (!nextTask) {
        break;
      }
      runTask(nextTask);
      processed++;
      if (now() - start >= BUDGET_MS) {
        break;
      }
    }

    if (dirtyRect) {
      scheduleDirtyDispatch();
    }

    if (taskCount() > 0) {
      if (requestFrame) {
        rafId = requestFrame(tick);
      } else {
        tick();
      }
    } else {
      notifyIdle();
    }
  };

  const enqueue = (fn: () => void) => {
    tasks.push({ kind: 'paint', mergeable: false, run: fn });
    if (debtControlEnabled && taskCount() > MAX_PENDING_PIXEL_TASKS) {
      const catchUpStart = now();
      while (taskCount() > MAX_PENDING_PIXEL_TASKS / 2) {
        const task = shiftTask();
        if (!task) {
          break;
        }
        runTask(task);
        if (now() - catchUpStart >= BUDGET_MS * 3) {
          break;
        }
      }
    }
    if (rafId != null) {
      return;
    }
    if (requestFrame) {
      rafId = requestFrame(tick);
    } else {
      tick();
    }
  };

  const flushNow = () => {
    if (rafId != null && cancelFrame) {
      cancelFrame(rafId);
    }
    if (pendingDirtyFrame != null) {
      if (cancelFrame) {
        cancelFrame(pendingDirtyFrame);
      }
      pendingDirtyFrame = null;
    }
    if (pendingDirtyTimeout != null) {
      clearTimeout(pendingDirtyTimeout);
      pendingDirtyTimeout = null;
    }
    rafId = null;
    while (taskCount() > 0) {
      const task = shiftTask();
      if (!task) {
        break;
      }
      runTask(task);
    }
    if (dirtyRect) {
      dispatchDirtyRect();
    }
    notifyIdle();
  };

  const onIdle = (cb: () => void) => {
    if (typeof cb !== 'function') {
      return;
    }
    if (taskCount() === 0 && rafId == null) {
      Promise.resolve().then(() => {
        try {
          cb();
        } catch (error) {
          logError('[PixelQueue] Idle callback failed:', error);
        }
      });
      return;
    }
    idleListeners.push(cb);
  };

  const addDirtyRect = (x: number, y: number, width: number, height: number) => {
    if (width <= 0 || height <= 0) {
      return;
    }
    const rect = dirtyRect;
    if (!rect) {
      dirtyRect = { x, y, w: width, h: height };
      return;
    }
    const minX = Math.min(rect.x, x);
    const minY = Math.min(rect.y, y);
    const maxX = Math.max(rect.x + rect.w, x + width);
    const maxY = Math.max(rect.y + rect.h, y + height);
    dirtyRect = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  };

  return {
    initialized: false,
    lastDrawnX: 0,
    lastDrawnY: 0,
    waitingPixelX: 0,
    waitingPixelY: 0,
    spacingCounter: 0,
    lastStrokePosition: { x: 0, y: 0 },
    accumulatedDistance: 0,
    lastLiftPosition: null,
    stampedGridPositions: new Set<string>(),
    dashPhasePx: 0,
    dashVelocityEma: 0,
    dashStampCounter: 0,
    drawnPixels: new Set<string>(),
    enqueue,
    flushNow,
    onIdle,
    addDirtyRect,
  };
}

export const resetPixelQueue = (queue: PixelQueue): void => {
  queue.flushNow();
  queue.initialized = false;
  queue.lastDrawnX = 0;
  queue.lastDrawnY = 0;
  queue.waitingPixelX = 0;
  queue.waitingPixelY = 0;
  queue.spacingCounter = 0;
  queue.lastStrokePosition = { x: 0, y: 0 };
  queue.accumulatedDistance = 0;
  queue.lastLiftPosition = null;
  queue.stampedGridPositions.clear();
  queue.dashPhasePx = 0;
  queue.dashVelocityEma = 0;
  queue.dashStampCounter = 0;
  queue.drawnPixels.clear();
};
