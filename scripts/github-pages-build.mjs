#!/usr/bin/env node

import { cp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { normalizeNodeOptionsWithLocalStorage } = require('./node-options.cjs');
const { createRuntimeLogger } = require('./runtime-logger.cjs');

const logger = createRuntimeLogger('github-pages-build');
const projectRoot = path.resolve(process.cwd());
const staticDistDirName = '.next-build';
const finalStaticDir = path.join(projectRoot, staticDistDirName);
const finalOutDir = path.join(projectRoot, 'out');
const workspaceHash = createHash('sha1').update(projectRoot).digest('hex').slice(0, 12);
const tempWorkspace = path.join(os.tmpdir(), `vessel-github-pages-build-${workspaceHash}`);

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
  'out',
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

const assertNodeVersion = async () => {
  const expectedVersion = (await readFile(path.join(projectRoot, '.nvmrc'), 'utf8')).trim();
  const expectedMajor = expectedVersion.split('.')[0];
  const actualVersion = process.versions.node;
  const actualMajor = actualVersion.split('.')[0];

  if (actualMajor !== expectedMajor) {
    logger.error(
      `Vessel build requires Node ${expectedVersion} from .nvmrc; current Node is ${actualVersion}.`,
    );
    logger.error('Run `nvm use` or `mise exec node@18.20.8 -- npm run build:github` before building.');
    process.exit(1);
  }
};

const runBuild = async (cwd) => {
  const env = { ...process.env };
  env.NODE_OPTIONS = normalizeNodeOptionsWithLocalStorage({
    nodeOptions: env.NODE_OPTIONS,
    storagePath: env.LOCALSTORAGE_FILE_PATH,
    scope: 'github-pages-build',
  });
  env.VESSEL_STATIC_EXPORT = '1';
  env.NEXT_DIST_DIR = staticDistDirName;

  const nextBin = path.resolve(projectRoot, 'node_modules/next/dist/bin/next');

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [nextBin, 'build'], {
      cwd,
      env,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: false,
    });

    logger.attachChild(child, 'github-pages-next-build');

    child.on('error', (error) => reject(error));
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`GitHub Pages build failed with exit code ${code ?? 'unknown'}`));
    });
  });
};

const assertStaticArtifact = async (artifactDir) => {
  const requiredFiles = [
    '404.html',
    'index.html',
    path.join('_next', 'static'),
    path.join('goblet', 'index.html'),
    path.join('goblet2', 'index.html'),
  ];

  for (const relativePath of requiredFiles) {
    const target = path.join(artifactDir, relativePath);
    if (!existsSync(target)) {
      throw new Error(`Missing static export artifact: ${target}`);
    }
  }
};

logger.installProcessHandlers('github-pages-build');

await assertNodeVersion();

logger.log(`Runtime log file: ${logger.filePath}`);
logger.log(`Preparing isolated GitHub Pages build workspace at ${tempWorkspace}`);

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

  const workspaceStaticDir = path.join(tempWorkspace, staticDistDirName);
  await assertStaticArtifact(workspaceStaticDir);

  logger.log(`Copying static export artifact to ${finalStaticDir}`);
  await rm(finalStaticDir, { recursive: true, force: true });
  await cp(workspaceStaticDir, finalStaticDir, { recursive: true, force: true });

  logger.log(`Copying GitHub Pages artifact to ${finalOutDir}`);
  await rm(finalOutDir, { recursive: true, force: true });
  await cp(workspaceStaticDir, finalOutDir, { recursive: true, force: true });
  await writeFile(path.join(finalOutDir, '.nojekyll'), '', 'utf8');

  logger.log('GitHub Pages build completed successfully.');
} finally {
  logger.log(`Cleaning isolated GitHub Pages workspace ${tempWorkspace}`);
  await rm(tempWorkspace, { recursive: true, force: true });
}
