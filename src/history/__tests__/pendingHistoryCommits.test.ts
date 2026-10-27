import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { trackPendingHistoryCommit, waitForPendingHistoryCommits } from '../pendingHistoryCommits';

it('waits for newly registered work while an earlier commit settles', async () => {
  let release!: () => void;
  const later = new Promise<void>(done => { release = done; });
  const earlier = Promise.resolve().then(() => { trackPendingHistoryCommit(later); });
  trackPendingHistoryCommit(earlier);
  let settled = false;
  const idle = waitForPendingHistoryCommits().then(() => { settled = true; });
  await Promise.resolve(); await Promise.resolve();
  const beforeRelease = settled;
  release(); await idle;
  expect(beforeRelease).toBe(false);
  expect(settled).toBe(true);
});

it('cleans up rejected tracked work without creating a second unhandled rejected promise', () => {
  // Isolate Node's unhandled-rejection observation from Jest's own listeners.
  const url = pathToFileURL(resolve(__dirname, '../pendingHistoryCommits.ts')).href;
  const source = `import { trackPendingHistoryCommit, waitForPendingHistoryCommits } from ${JSON.stringify(url)};
    const unhandled = []; process.on('unhandledRejection', error => unhandled.push(error.message));
    const original = Promise.reject(new Error('finalize rejected')); original.catch(() => {});
    trackPendingHistoryCommit(original); await waitForPendingHistoryCommits();
    await new Promise(setImmediate); await waitForPendingHistoryCommits();
    console.log(JSON.stringify({ unhandled, idle: true }));`;
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', source], { encoding: 'utf8' });
  expect(child.status).toBe(0);
  expect(JSON.parse(child.stdout.trim())).toEqual({ unhandled: [], idle: true });
});
