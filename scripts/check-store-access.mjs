#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const srcRoot = join(root, 'src');
const mode = process.argv.includes('--strict') ? 'strict' : 'report';
const storeAccessPattern = /\buseAppStore\.getState\s*\(/g;

const allowedPathParts = [
  '/__tests__/',
  '/stores/',
  '/history/',
  '/lib/',
  '/debug/',
  '/testing/',
];

const allowedPathPrefixes = [
  'src/utils/',
];

const isSourceFile = (filePath) => /\.(ts|tsx)$/.test(filePath) && !filePath.endsWith('.d.ts');

const shouldSkip = (filePath) => {
  const relativePath = relative(root, filePath).replaceAll('\\', '/');
  const normalized = `/${relativePath}`;
  if (normalized.includes('.test.') || normalized.includes('.spec.')) {
    return true;
  }
  if (allowedPathPrefixes.some((prefix) => relativePath.startsWith(prefix))) {
    return true;
  }
  return allowedPathParts.some((part) => normalized.includes(part));
};

const walk = (dir, files = []) => {
  for (const entry of readdirSync(dir)) {
    const filePath = join(dir, entry);
    const stats = statSync(filePath);
    if (stats.isDirectory()) {
      walk(filePath, files);
    } else if (isSourceFile(filePath) && !shouldSkip(filePath)) {
      files.push(filePath);
    }
  }
  return files;
};

const findings = [];

for (const filePath of walk(srcRoot)) {
  const relativePath = relative(root, filePath);
  const lines = readFileSync(filePath, 'utf8').split('\n');
  lines.forEach((line, index) => {
    storeAccessPattern.lastIndex = 0;
    if (storeAccessPattern.test(line)) {
      findings.push({
        path: relativePath,
        line: index + 1,
        text: line.trim(),
      });
    }
  });
}

console.log('[architecture:store-access]');
console.log(`${findings.length} direct useAppStore.getState() call(s) found in React/canvas scan.`);

const previewLimit = 60;
for (const finding of findings.slice(0, previewLimit)) {
  console.log(`${finding.path}:${finding.line} ${finding.text}`);
}
if (findings.length > previewLimit) {
  console.log(`... ${findings.length - previewLimit} additional finding(s) omitted.`);
}

if (findings.length > 0 && mode === 'strict') {
  console.error('FAIL direct store access is blocking in strict mode.');
  process.exitCode = 1;
} else if (findings.length > 0) {
  console.log('WARN direct store access is currently report-only.');
}
