#!/usr/bin/env node

import { cp, rm, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { LOCALSTORAGE_FLAG, mergeNodeOptions, stripLocalStorageFlag } = require('./node-options.cjs');
const { createRuntimeLogger } = require('./runtime-logger.cjs');

const logger = createRuntimeLogger('preview-build');
const projectRoot = path.resolve(process.cwd());
const previewDistDirName = '.next-preview';
const previewDistDir = path.join(projectRoot, previewDistDirName);
const workspaceHash = createHash('sha1').update(projectRoot).digest('hex').slice(0, 12);
const tempWorkspace = path.join(os.tmpdir(), `vessel-preview-build-${workspaceHash}`);

const EXCLUDED_NAMES = new Set([
  '.git',
  '.next',
  '.next-build',
  '.next-preview',
  'node_modules',
  'coverage',
  'dist',
  '.turbo',
]);

const EXCLUDED_PREFIXES = [
  `${path.sep}logs${path.sep}runtime`,
];

const shouldCopyPath = (source) => {
  const relative = path.relative(projectRoot, source);
  if (!relative || relative === '') {
    return true;
  }

  const segments = relative.split(path.sep);
  if (segments.some((segment) => EXCLUDED_NAMES.has(segment))) {
    return false;
  }

  return !EXCLUDED_PREFIXES.some((prefix) => relative.startsWith(prefix.slice(1)));
};

const runBuild = async (cwd) => {
  const env = { ...process.env };
  const baseOptions = stripLocalStorageFlag(env.NODE_OPTIONS);
  const storagePath = env.LOCALSTORAGE_FILE_PATH || '/tmp/vessel-localstorage';

  env.NODE_OPTIONS = mergeNodeOptions(baseOptions, `${LOCALSTORAGE_FLAG}=${storagePath}`);
  env.NEXT_DIST_DIR = previewDistDirName;

  const nextBin = path.resolve(projectRoot, 'node_modules/.bin/next');

  await new Promise((resolve, reject) => {
    const child = spawn(nextBin, ['build'], {
      cwd,
      env,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: false,
    });

    logger.attachChild(child, 'preview-next-build');

    child.on('error', (error) => reject(error));
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Preview build failed with exit code ${code ?? 'unknown'}`));
    });
  });
};

logger.installProcessHandlers('preview-build');
logger.log(`Runtime log file: ${logger.filePath}`);
logger.log(`Preparing isolated preview build workspace at ${tempWorkspace}`);

await rm(tempWorkspace, { recursive: true, force: true });
await cp(projectRoot, tempWorkspace, {
  recursive: true,
  filter: shouldCopyPath,
  force: true,
});

const sourceNodeModules = path.join(projectRoot, 'node_modules');
const workspaceNodeModules = path.join(tempWorkspace, 'node_modules');

if (!existsSync(sourceNodeModules)) {
  logger.error(`Missing node_modules at ${sourceNodeModules}`);
  process.exit(1);
}

await symlink(sourceNodeModules, workspaceNodeModules, 'junction');

try {
  await runBuild(tempWorkspace);

  logger.log(`Copying isolated preview artifact back to ${previewDistDir}`);
  await rm(previewDistDir, { recursive: true, force: true });
  await cp(path.join(tempWorkspace, previewDistDirName), previewDistDir, {
    recursive: true,
    force: true,
  });
  logger.log('Preview build completed successfully.');
} finally {
  logger.log(`Cleaning isolated preview workspace ${tempWorkspace}`);
  await rm(tempWorkspace, { recursive: true, force: true });
}
