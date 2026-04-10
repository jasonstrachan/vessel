import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PREVIEW_WATCH_LOCK = '.preview-prod-watch.lock.json';

export const ensureBuildAllowed = (env = process.env) => {
  const allowConcurrentBuild =
    env.VESSEL_PREVIEW_PROD_WATCH === '1' ||
    env.VESSEL_ALLOW_CONCURRENT_BUILD === '1';
  const previewWatchLockPath = path.join(process.cwd(), PREVIEW_WATCH_LOCK);

  if (allowConcurrentBuild || !existsSync(previewWatchLockPath)) {
    return;
  }

  let watchDetails = PREVIEW_WATCH_LOCK;
  try {
    watchDetails = readFileSync(previewWatchLockPath, 'utf8').trim() || PREVIEW_WATCH_LOCK;
  } catch {}

  console.error(
    [
      'Refusing to run `npm run build` while `npm run preview:prod:watch` owns the production build pipeline.',
      `Active watcher lock: ${watchDetails}`,
      'Use the watcher-managed build, stop `preview:prod:watch`, or set `VESSEL_ALLOW_CONCURRENT_BUILD=1` if you intentionally want a concurrent manual build.',
    ].join('\n')
  );
  process.exit(2);
};

ensureBuildAllowed();
