#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = process.cwd();
const sourceExtensionPattern = /\.[cm]?[jt]sx?$/i;

export const selectRelatedTestInputs = (files, root = projectRoot) =>
  files.filter((file) => {
    if (!sourceExtensionPattern.test(file) || file.startsWith('public/')) {
      return false;
    }
    return existsSync(path.resolve(root, file));
  });

const readOption = (args, name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

export const resolveChangedFiles = ({ base, head = 'HEAD', root = projectRoot }) => {
  if (!base) {
    throw new Error('Missing required --base SHA.');
  }

  const output = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMRT', '-z', `${base}...${head}`],
    {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );

  return output.split('\0').filter(Boolean);
};

export const runRelatedTests = ({ base, head, root = projectRoot }) => {
  const changedFiles = resolveChangedFiles({ base, head, root });
  const relatedInputs = selectRelatedTestInputs(changedFiles, root);

  if (relatedInputs.length === 0) {
    console.log('No changed source files require related Jest tests.');
    return 0;
  }

  console.log(`Finding Jest tests related to ${relatedInputs.length} changed source file(s).`);
  const jestBin = path.join(root, 'node_modules', 'jest', 'bin', 'jest.js');
  const result = spawnSync(
    process.execPath,
    [
      jestBin,
      '--runInBand',
      '--findRelatedTests',
      '--passWithNoTests',
      ...relatedInputs,
    ],
    {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    },
  );

  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const filesIndex = args.indexOf('--files');
  if (args.includes('--list')) {
    const changedFiles =
      filesIndex >= 0
        ? args.slice(filesIndex + 1)
        : resolveChangedFiles({
            base: readOption(args, '--base'),
            head: readOption(args, '--head') || 'HEAD',
            root: projectRoot,
          });
    console.log(JSON.stringify(selectRelatedTestInputs(changedFiles, projectRoot)));
    process.exit(0);
  }
  const status = runRelatedTests({
    base: readOption(args, '--base'),
    head: readOption(args, '--head') || 'HEAD',
  });
  process.exitCode = status;
}
