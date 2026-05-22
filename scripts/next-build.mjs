import { rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { normalizeNodeOptionsWithLocalStorage } = require('./node-options.cjs');

const env = { ...process.env };
env.NODE_OPTIONS = normalizeNodeOptionsWithLocalStorage({
  nodeOptions: env.NODE_OPTIONS,
  storagePath: env.LOCALSTORAGE_FILE_PATH,
  scope: 'next-build',
});
env.NEXT_DIST_DIR = env.NEXT_DIST_DIR || '.next-build';
env.VESSEL_STATIC_EXPORT = '1';

// Next 15 still writes some internal route state under .next during custom
// export-output builds, so clear it alongside the requested output directory.
rmSync(env.NEXT_DIST_DIR, { recursive: true, force: true });
rmSync('.next', { recursive: true, force: true });

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
