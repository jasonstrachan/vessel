import { spawn } from 'node:child_process';

const LOCALSTORAGE_FLAG = '--localstorage-file';

const stripLocalStorageFlag = (value) => {
  if (!value) return '';
  const parts = value.split(/\s+/).filter(Boolean);
  const cleaned = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part === LOCALSTORAGE_FLAG) {
      // Drop the flag and any dangling value.
      continue;
    }
    if (part.startsWith(`${LOCALSTORAGE_FLAG}=`)) {
      continue;
    }
    cleaned.push(part);
  }
  return cleaned.join(' ');
};

const env = { ...process.env };
const baseOptions = stripLocalStorageFlag(env.NODE_OPTIONS);
const storagePath = env.LOCALSTORAGE_FILE_PATH || '/tmp/vessel-localstorage';
env.NODE_OPTIONS = [baseOptions, `${LOCALSTORAGE_FLAG}=${storagePath}`]
  .filter(Boolean)
  .join(' ');
env.NEXT_DIST_DIR = env.NEXT_DIST_DIR || '.next-build';

const child = spawn('next', ['build'], {
  stdio: 'inherit',
  env,
  shell: false,
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
