import { spawn } from 'node:child_process';

const child = spawn('npm', ['run', 'build:next'], {
  stdio: 'inherit',
  shell: false,
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
