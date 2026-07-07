#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const sourcePath = path.resolve(projectRoot, 'src/utils/alignment/alignFitResolver.ts');
const targetPaths = [
  path.resolve(projectRoot, 'public/goblet/alignFitResolver.js'),
  path.resolve(projectRoot, 'public/goblet2/alignFitResolver.js')
];
const relativeSource = path.relative(projectRoot, sourcePath).replace(/\\/g, '/');
const check = process.argv.includes('--check');

const source = fs.readFileSync(sourcePath, 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2019,
    module: ts.ModuleKind.ESNext,
    removeComments: false,
    declaration: false
  }
});

let body = outputText.replace(/\r\n/g, '\n').trim();

if (body.startsWith(`'use strict';`)) {
  body = body.slice(`'use strict';`.length).trimStart();
}

const banner = `// Auto-generated from ${relativeSource}. Do not edit directly.\n`;
const contents = `${banner}\n${body}\n`;

let hasDrift = false;

targetPaths.forEach((targetPath) => {
  const relativeTarget = path.relative(projectRoot, targetPath).replace(/\\/g, '/');
  const needsUpdate = !fs.existsSync(targetPath) || fs.readFileSync(targetPath, 'utf8') !== contents;

  if (!needsUpdate) {
    console.log(`${relativeTarget} already up to date.`);
    return;
  }

  if (check) {
    console.error(`${relativeTarget} is out of date. Run: npm run build:align-fit`);
    hasDrift = true;
    return;
  }

  fs.writeFileSync(targetPath, contents);
  console.log(`Wrote ${relativeTarget}`);
});

if (hasDrift) {
  process.exitCode = 1;
}
