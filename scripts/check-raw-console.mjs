#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const srcRoot = join(root, 'src');
const mode = process.argv.includes('--strict') ? 'strict' : 'report';
const consolePattern = /\bconsole\.(log|warn|error|info|debug|trace)\s*\(/g;

const allowedPathParts = [
  '/__tests__/',
  '/app/dev-tests/',
  '/app/api/',
  '/debug/',
  '/examples/',
  '/testing/',
];

const allowedFiles = new Set([
  'src/utils/debug.ts',
  'src/utils/devLog.ts',
  'src/components/GlobalErrorBoundary.tsx',
  'src/components/GlobalErrorHooks.tsx',
]);

const isSourceFile = (filePath) => /\.(ts|tsx)$/.test(filePath) && !filePath.endsWith('.d.ts');

const shouldSkip = (filePath) => {
  const normalized = `/${relative(root, filePath).replaceAll('\\', '/')}`;
  if (allowedFiles.has(normalized.slice(1))) {
    return true;
  }
  if (normalized.includes('.test.') || normalized.includes('.spec.')) {
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
    consolePattern.lastIndex = 0;
    if (consolePattern.test(line)) {
      findings.push({
        path: relativePath,
        line: index + 1,
        text: line.trim(),
      });
    }
  });
}

console.log('[architecture:raw-console]');
console.log(`${findings.length} raw console call(s) found in production src scan.`);

const previewLimit = 40;
for (const finding of findings.slice(0, previewLimit)) {
  console.log(`${finding.path}:${finding.line} ${finding.text}`);
}
if (findings.length > previewLimit) {
  console.log(`... ${findings.length - previewLimit} additional finding(s) omitted.`);
}

if (findings.length > 0 && mode === 'strict') {
  console.error('FAIL raw console usage is blocking in strict mode.');
  process.exitCode = 1;
} else if (findings.length > 0) {
  console.log('WARN raw console usage is currently report-only.');
}
