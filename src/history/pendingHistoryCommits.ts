const pendingHistoryCommits = new Set<Promise<void>>();

export const trackPendingHistoryCommit = (commitPromise: Promise<void>): void => {
  pendingHistoryCommits.add(commitPromise);
  const settle = () => {
    pendingHistoryCommits.delete(commitPromise);
  };
  void commitPromise.then(settle, settle);
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
