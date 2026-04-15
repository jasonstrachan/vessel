import { rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { LOCALSTORAGE_FLAG, mergeNodeOptions, stripLocalStorageFlag } = require('./node-options.cjs');

const env = { ...process.env };
const baseOptions = stripLocalStorageFlag(env.NODE_OPTIONS);
const storagePath = env.LOCALSTORAGE_FILE_PATH || '/tmp/vessel-localstorage';
env.NODE_OPTIONS = mergeNodeOptions(baseOptions, `${LOCALSTORAGE_FLAG}=${storagePath}`);
env.NEXT_DIST_DIR = env.NEXT_DIST_DIR || '.next-build';

// Next 15 occasionally leaves a partially valid dist tree behind after
// interrupted/failed builds, which can break later route manifest resolution.
rmSync(env.NEXT_DIST_DIR, { recursive: true, force: true });

const nextBin = path.resolve('node_modules/.bin/next');

const child = spawn(nextBin, ['build'], {
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
