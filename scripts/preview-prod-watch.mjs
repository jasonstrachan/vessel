#!/usr/bin/env node

import { execSync, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const WATCH_LOCK_PATH = '.preview-prod-watch.lock.json';

const WATCH_ROOTS = [
  'src',
  'public',
  'scripts',
  'docs',
];

const WATCH_FILES = [
  'package.json',
  'next.config.ts',
  'tsconfig.json',
  'postcss.config.mjs',
  'tailwind.config.ts',
];

const IGNORE_DIRS = new Set([
  '.git',
  '.next',
  '.next-build',
  'node_modules',
  'out',
  'dist',
  'coverage',
  '.turbo',
]);

const POLL_INTERVAL_MS = 1200;
const BUILD_DEBOUNCE_MS = 500;
const PREVIEW_PORT = process.env.PORT || '3001';

const projectRoot = process.cwd();
const watchLockFile = path.join(projectRoot, WATCH_LOCK_PATH);

let previewProcess = null;
let buildProcess = null;
let buildQueued = false;
let debounceTimer = null;
let shuttingDown = false;
let snapshot = new Map();

const log = (message) => {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[preview:prod:watch ${timestamp}] ${message}`);
};

const writeWatchLock = async () => {
  const payload = {
    pid: process.pid,
    port: PREVIEW_PORT,
    startedAt: new Date().toISOString(),
  };
  await fs.writeFile(watchLockFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
};

const removeWatchLock = async () => {
  try {
    await fs.unlink(watchLockFile);
  } catch {}
};

const spawnCommand = (command, args, envOverrides = {}) =>
  spawn(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      ...envOverrides,
    },
  });

const readListeningPids = (port) => {
  try {
    const raw = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN 2>/dev/null || true`, {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
    return raw ? raw.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
};

const readCommandForPid = (pid) => {
  try {
    return execSync(`ps -p ${pid} -o command=`, {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
};

const ensurePreviewPortAvailable = () => {
  const pids = readListeningPids(PREVIEW_PORT);
  if (pids.length === 0) {
    return;
  }

  for (const pid of pids) {
    const command = readCommandForPid(pid);
    if (command.includes('scripts/preview-server.mjs')) {
      log(`stopping existing preview server on port ${PREVIEW_PORT} (pid ${pid})`);
      try {
        process.kill(Number.parseInt(pid, 10), 'SIGTERM');
      } catch {}
      continue;
    }

    log(`port ${PREVIEW_PORT} is already in use by: ${command || pid}`);
    process.exit(1);
  }
};

const startPreviewServer = () => {
  if (previewProcess || shuttingDown) {
    return;
  }

  ensurePreviewPortAvailable();
  previewProcess = spawnCommand('node', ['scripts/preview-server.mjs'], {
    PORT: PREVIEW_PORT,
  });

  previewProcess.on('exit', (code, signal) => {
    previewProcess = null;
    if (shuttingDown) {
      return;
    }
    log(`preview server exited (${signal ?? code ?? 'unknown'})`);
    process.exit(code ?? 1);
  });
};

const statKey = (stats) => `${stats.mtimeMs}:${stats.size}`;

const walk = async (relativePath, nextSnapshot) => {
  const absolutePath = path.join(projectRoot, relativePath);
  let stats;
  try {
    stats = await fs.stat(absolutePath);
  } catch {
    return;
  }

  if (stats.isDirectory()) {
    const baseName = path.basename(relativePath);
    if (IGNORE_DIRS.has(baseName)) {
      return;
    }

    let entries = [];
    try {
      entries = await fs.readdir(absolutePath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const childRelativePath = path.join(relativePath, entry.name);
      if (entry.isDirectory()) {
        await walk(childRelativePath, nextSnapshot);
      } else if (entry.isFile()) {
        let childStats;
        try {
          childStats = await fs.stat(path.join(projectRoot, childRelativePath));
        } catch {
          continue;
        }
        nextSnapshot.set(childRelativePath, statKey(childStats));
      }
    }
    return;
  }

  nextSnapshot.set(relativePath, statKey(stats));
};

const collectSnapshot = async () => {
  const nextSnapshot = new Map();

  for (const root of WATCH_ROOTS) {
    await walk(root, nextSnapshot);
  }

  for (const file of WATCH_FILES) {
    await walk(file, nextSnapshot);
  }

  return nextSnapshot;
};

const diffSnapshots = (previousSnapshot, nextSnapshot) => {
  for (const [filePath, fingerprint] of nextSnapshot) {
    if (previousSnapshot.get(filePath) !== fingerprint) {
      return filePath;
    }
  }

  for (const filePath of previousSnapshot.keys()) {
    if (!nextSnapshot.has(filePath)) {
      return filePath;
    }
  }

  return null;
};

const queueBuild = (reason) => {
  if (shuttingDown) {
    return;
  }

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (buildProcess) {
      buildQueued = true;
      return;
    }

    log(`rebuilding after change in ${reason}`);
    buildProcess = spawnCommand('npm', ['run', 'build'], {
      VESSEL_PREVIEW_PROD_WATCH: '1',
    });

    buildProcess.on('exit', (code, signal) => {
      buildProcess = null;
      if (shuttingDown) {
        return;
      }
      if (code === 0) {
        log('build complete; refresh http://localhost:3001/vessel/');
      } else {
        log(`build failed (${signal ?? code ?? 'unknown'})`);
      }
      if (buildQueued) {
        buildQueued = false;
        queueBuild('queued changes');
      }
    });
  }, BUILD_DEBOUNCE_MS);
};

const stopChild = (child, signal = 'SIGTERM') =>
  new Promise((resolve) => {
    if (!child) {
      resolve();
      return;
    }

    child.once('exit', () => resolve());
    child.kill(signal);
  });

const shutdown = async () => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  await removeWatchLock();
  await stopChild(buildProcess);
  await stopChild(previewProcess);
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

log('starting initial production build');
await writeWatchLock();
buildProcess = spawnCommand('npm', ['run', 'build'], {
  VESSEL_PREVIEW_PROD_WATCH: '1',
});
buildProcess.on('exit', async (code, signal) => {
  buildProcess = null;
  if (shuttingDown) {
    return;
  }
  if (code !== 0) {
    await removeWatchLock();
    log(`initial build failed (${signal ?? code ?? 'unknown'})`);
    process.exit(code ?? 1);
  }

  snapshot = await collectSnapshot();
  startPreviewServer();
  log('watching for changes');

  setInterval(async () => {
    if (shuttingDown) {
      return;
    }
    const nextSnapshot = await collectSnapshot();
    const changedPath = diffSnapshots(snapshot, nextSnapshot);
    snapshot = nextSnapshot;
    if (changedPath) {
      queueBuild(changedPath);
    }
  }, POLL_INTERVAL_MS);
});
