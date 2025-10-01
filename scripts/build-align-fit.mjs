#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const sourcePath = path.resolve(projectRoot, 'src/utils/alignment/alignFitResolver.ts');
const targetPath = path.resolve(projectRoot, 'public/goblet/goblet.js');
const relativeSource = path.relative(projectRoot, sourcePath).replace(/\\/g, '/');

const startMarker = '//alignFitResolver';
const endMarker = '//alignFitResolver:end';

const indentBlock = (text, spaces = 2) => {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.length ? pad + line : line))
    .join('\n');
};

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

body = body
  .replace(/export\s+const\s+/g, 'const ')
  .replace(/export\s+function\s+/g, 'function ')
  .replace(/export\s+class\s+/g, 'class ')
  .replace(/export\s+default[^;]*;?\n?/g, '')
  .replace(/export\s*\{[^}]+\};?\n?/g, '');

const generated = `${startMarker}\nconst { normalizeAlignment, computeLayerTransform, computeLayerDestination } = (() => {\n  // Auto-generated from ${relativeSource}. Do not edit directly.\n\n${indentBlock(body)}\n\n  return { normalizeAlignment, computeLayerTransform, computeLayerDestination };\n})();\n${endMarker}\n`;

const targetContents = fs.readFileSync(targetPath, 'utf8');
const startIndex = targetContents.indexOf(startMarker);

if (startIndex === -1) {
  throw new Error(`Start marker "${startMarker}" not found in ${targetPath}`);
}

const endIndex = targetContents.indexOf(endMarker, startIndex);
let before;
let after;

if (endIndex !== -1) {
  before = targetContents.slice(0, startIndex);
  after = targetContents.slice(endIndex + endMarker.length);
} else {
  const closeToken = '})();';
  const closeIndex = targetContents.indexOf(closeToken, startIndex);
  if (closeIndex === -1) {
    throw new Error(`Could not locate closing token for generated block in ${targetPath}`);
  }
  const resumeIndex = targetContents.indexOf('\n', closeIndex + closeToken.length);
  const sliceIndex = resumeIndex === -1 ? closeIndex + closeToken.length : resumeIndex + 1;
  before = targetContents.slice(0, startIndex);
  after = targetContents.slice(sliceIndex);
}

const updated = `${before}${generated}${after}`;

if (updated !== targetContents) {
  fs.writeFileSync(targetPath, updated);
  console.log('Updated alignFitResolver block in public/goblet/goblet.js');
} else {
  console.log('AlignFitResolver block already up to date.');
}
