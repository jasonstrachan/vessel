#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const artifactsOnly = process.argv.includes('--artifacts-only');
const sourceRoots = ['src', 'public', 'assets', 'scripts'];
const artifactRoots = ['out', '.next-build'];
const denylistPath = path.join(projectRoot, '.private-pattern-denylist');
const forbiddenExtensions = ['.vpatternpack', '.thresholds.bin'];
const forbiddenDirectoryNames = new Set([
  '.private-pattern-packs',
  'private-pattern-packs',
  '.vessel-studio',
]);
const allowedLocalScopeFiles = new Set([
  'scripts/check-public-pattern-release.mjs',
  'src/utils/ditherPatterns/cumulativeThresholdPattern.ts',
  'src/utils/ditherPatterns/localPatternPack.ts',
]);

const failures = [];

if (process.env.VESSEL_STUDIO === '1') {
  failures.push('VESSEL_STUDIO: studio mode cannot pass the public release check');
}

const toRelative = (filePath) => path.relative(projectRoot, filePath).split(path.sep).join('/');

const walk = async (root) => {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'coverage'].includes(entry.name)) continue;
      files.push(...await walk(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
};

const readDenylist = async () => {
  if (!existsSync(denylistPath)) return [];
  return (await readFile(denylistPath, 'utf8'))
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !entry.startsWith('#'));
};

const inspectFile = async (filePath, denylist, { isSource }) => {
  const relative = toRelative(filePath);
  const lowerRelative = relative.toLowerCase();
  if (forbiddenExtensions.some((extension) => lowerRelative.endsWith(extension))) {
    failures.push(`${relative}: private pattern payload file`);
    return;
  }
  const bytes = await readFile(filePath);
  for (let index = 0; index < denylist.length; index += 1) {
    if (bytes.includes(Buffer.from(denylist[index], 'utf8'))) {
      failures.push(`${relative}: private denylist entry ${index + 1}`);
    }
  }
  if (!isSource || bytes.includes(0)) return;
  const source = bytes.toString('utf8');
  if (
    /(?:from\s*|import\s*\(|require\s*\()['"][^'"]+(?:\.vpatternpack|\.thresholds\.bin)['"]/i.test(source)
  ) {
    failures.push(`${relative}: static private-pattern payload import`);
  }
  if (
    source.includes("storageScope: 'local-library'") &&
    !allowedLocalScopeFiles.has(relative) &&
    !relative.includes('/__tests__/') &&
    !relative.endsWith('.test.ts') &&
    !relative.endsWith('.test.tsx')
  ) {
    failures.push(`${relative}: built-in local-library descriptor`);
  }
};

let trackedPaths = [];
if (!artifactsOnly) {
  trackedPaths = execFileSync('git', ['ls-files', '-z'], {
    cwd: projectRoot,
    encoding: 'utf8',
  }).split('\0').filter(Boolean);
  for (const trackedPath of trackedPaths) {
    const lower = trackedPath.toLowerCase();
    const segments = lower.split('/');
    if (
      forbiddenExtensions.some((extension) => lower.endsWith(extension)) ||
      segments.some((segment) => forbiddenDirectoryNames.has(segment))
    ) {
      failures.push(`${trackedPath}: tracked private pattern content`);
    }
  }
}

const denylist = await readDenylist();
if (!artifactsOnly) {
  for (const trackedPath of trackedPaths) {
    const normalized = trackedPath.split(path.sep).join('/');
    const isCoveredBySourceScan = sourceRoots.some((root) => (
      normalized === root || normalized.startsWith(`${root}/`)
    ));
    if (isCoveredBySourceScan) continue;
    const absolutePath = path.join(projectRoot, trackedPath);
    if (existsSync(absolutePath)) {
      await inspectFile(absolutePath, denylist, { isSource: false });
    }
  }
}
const roots = artifactsOnly ? artifactRoots : [...sourceRoots, ...artifactRoots];
for (const root of roots) {
  const absoluteRoot = path.join(projectRoot, root);
  for (const filePath of await walk(absoluteRoot)) {
    await inspectFile(filePath, denylist, { isSource: sourceRoots.includes(root) });
  }
}

if (failures.length > 0) {
  console.error('Public pattern release check failed:');
  for (const failure of [...new Set(failures)]) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Public pattern release check passed (${denylist.length > 0 ? 'private denylist active' : 'generic checks only'}).`,
);
