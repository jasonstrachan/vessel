const pendingHistoryCommits = new Set<Promise<void>>();

export const trackPendingHistoryCommit = (commitPromise: Promise<void>): void => {
  pendingHistoryCommits.add(commitPromise);
  commitPromise.finally(() => {
    pendingHistoryCommits.delete(commitPromise);
  });
};

export const waitForPendingHistoryCommits = async (): Promise<void> => {
  while (pendingHistoryCommits.size > 0) {
    const pending = Array.from(pendingHistoryCommits);
    if (pending.length === 0) {
      break;
    }
    await Promise.allSettled(pending);
  }
};
