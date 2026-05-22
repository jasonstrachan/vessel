#!/usr/bin/env node

import { access, cp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(process.cwd());
const sourceDir = path.join(projectRoot, '.next-build');
const outDir = path.join(projectRoot, 'out');
const notFoundPath = path.join(sourceDir, '404.html');

try {
  await access(notFoundPath);
} catch {
  console.error(`Missing static export artifact: ${notFoundPath}`);
  process.exit(1);
}

await rm(outDir, { recursive: true, force: true });
await cp(sourceDir, outDir, { recursive: true, force: true });
await writeFile(path.join(outDir, '.nojekyll'), '', 'utf8');

console.log(`Prepared GitHub Pages artifact at ${outDir}`);
