#!/usr/bin/env node

import { cp, rename, rm, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { stripLocalStorageFlag } = require('./node-options.cjs');
const { createRuntimeLogger } = require('./runtime-logger.cjs');

const logger = createRuntimeLogger('preview-build');
const projectRoot = path.resolve(process.cwd());
const previewDistDirName = '.next-preview';
const previewDistDir = path.join(projectRoot, previewDistDirName);
const previewDistDirPrev = path.join(projectRoot, `${previewDistDirName}-prev`);
const previewDistDirNext = path.join(projectRoot, `${previewDistDirName}-next`);
const workspaceHash = createHash('sha1').update(projectRoot).digest('hex').slice(0, 12);
const tempWorkspace = path.join(os.tmpdir(), `vessel-preview-build-${workspaceHash}`);

const EXCLUDED_NAMES = new Set([
  '.git',
  '.next',
  '.next-build',
  '.next-preview',
  '.next-preview-prev',
  '.next-preview-next',
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
  env.NODE_OPTIONS = stripLocalStorageFlag(env.NODE_OPTIONS);
  env.NEXT_DIST_DIR = previewDistDirName;

  const nextBin = path.resolve(projectRoot, 'node_modules/next/dist/bin/next');

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [nextBin, 'build'], {
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

  logger.log(`Staging isolated preview artifact at ${previewDistDirNext}`);
  await rm(previewDistDirNext, { recursive: true, force: true });
  await cp(path.join(tempWorkspace, previewDistDirName), previewDistDirNext, {
    recursive: true,
    force: true,
  });

  logger.log(`Swapping staged preview artifact into ${previewDistDir}`);
  await rm(previewDistDirPrev, { recursive: true, force: true });
  if (existsSync(previewDistDir)) {
    await rename(previewDistDir, previewDistDirPrev);
  }
  await rename(previewDistDirNext, previewDistDir);
  logger.log('Preview build completed successfully.');
} finally {
  await rm(previewDistDirNext, { recursive: true, force: true });
  logger.log(`Cleaning isolated preview workspace ${tempWorkspace}`);
  await rm(tempWorkspace, { recursive: true, force: true });
}
