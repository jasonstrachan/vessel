export interface RevisionedFileWriteOrder {
  projectId: string;
  revision: number;
}

export type RevisionedFileWriteResult<T> =
  | { status: 'written'; value: T }
  | { status: 'superseded' };

type FileWriteQueue = {
  tail: Promise<void>;
  highestRevisionByProject: Map<string, number>;
};

const queues = new WeakMap<FileSystemFileHandle, FileWriteQueue>();
const knownQueues: Array<{ handle: FileSystemFileHandle; queue: FileWriteQueue }> = [];
let queueResolutionTail = Promise.resolve();

const getQueue = async (handle: FileSystemFileHandle): Promise<FileWriteQueue> => {
  const existing = queues.get(handle);
  if (existing) {
    return existing;
  }

  let resolved: FileWriteQueue | undefined;
  const resolution = queueResolutionTail.then(async () => {
    const direct = queues.get(handle);
    if (direct) {
      resolved = direct;
      return;
    }
    for (const candidate of knownQueues) {
      try {
        if (
          candidate.handle === handle ||
          (typeof handle.isSameEntry === 'function' && await handle.isSameEntry(candidate.handle))
        ) {
          queues.set(handle, candidate.queue);
          resolved = candidate.queue;
          return;
        }
      } catch {
        // A revoked handle cannot be compared; give it an independent queue.
      }
    }

    resolved = {
      tail: Promise.resolve(),
      highestRevisionByProject: new Map(),
    };
    queues.set(handle, resolved);
    knownQueues.push({ handle, queue: resolved });
  });
  queueResolutionTail = resolution.then(() => undefined, () => undefined);
  await resolution;
  return resolved!;
};

/**
 * Serializes writes to one file handle and suppresses an older project revision
 * if a newer revision has already been scheduled for that handle.
 */
export const writeFileInRevisionOrder = async <T>(
  handle: FileSystemFileHandle,
  order: RevisionedFileWriteOrder | undefined,
  write: () => Promise<T>,
): Promise<RevisionedFileWriteResult<T>> => {
  const queue = await getQueue(handle);
  if (order) {
    const highest = queue.highestRevisionByProject.get(order.projectId) ?? -1;
    if (order.revision < highest) {
      return { status: 'superseded' };
    }
    queue.highestRevisionByProject.set(order.projectId, Math.max(highest, order.revision));
  }

  const task = queue.tail.then(async (): Promise<RevisionedFileWriteResult<T>> => {
    if (order) {
      const highest = queue.highestRevisionByProject.get(order.projectId) ?? order.revision;
      if (order.revision < highest) {
        return { status: 'superseded' };
      }
    }
    try {
      return { status: 'written', value: await write() };
    } catch (error) {
      if (order) {
        const highest = queue.highestRevisionByProject.get(order.projectId) ?? order.revision;
        if (order.revision < highest) {
          return { status: 'superseded' };
        }
      }
      throw error;
    }
  });
  queue.tail = task.then(() => undefined, () => undefined);
  return task;
};
