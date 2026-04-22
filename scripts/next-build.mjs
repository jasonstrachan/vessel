import { rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { stripLocalStorageFlag } = require('./node-options.cjs');

const env = { ...process.env };
env.NODE_OPTIONS = stripLocalStorageFlag(env.NODE_OPTIONS);
env.NEXT_DIST_DIR = env.NEXT_DIST_DIR || '.next-build';

// Next 15 occasionally leaves a partially valid dist tree behind after
// interrupted/failed builds, which can break later route manifest resolution.
rmSync(env.NEXT_DIST_DIR, { recursive: true, force: true });

const nextBin = path.resolve('node_modules/next/dist/bin/next');

const child = spawn(process.execPath, [nextBin, 'build'], {
  stdio: 'inherit',
  env,
  shell: false,
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
