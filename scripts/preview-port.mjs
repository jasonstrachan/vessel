#!/usr/bin/env node

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_PREVIEW_PORT = 3001;
const projectRoot = path.resolve(process.cwd());
const port = Number.parseInt(process.env.PORT ?? '', 10) || DEFAULT_PREVIEW_PORT;
const command = process.argv[2] ?? 'status';

const run = async (file, args, options = {}) => {
  const allowedExitCodes = options.allowedExitCodes ?? [];

  try {
    const result = await execFileAsync(file, args, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    return result.stdout.trim();
  } catch (error) {
    if (allowedExitCodes.includes(error?.code)) {
      return typeof error?.stdout === 'string' ? error.stdout.trim() : '';
    }

    if (error?.code === 'ENOENT') {
      throw new Error(`Required command "${file}" was not found; cannot inspect port ${port}.`);
    }

    if (typeof error?.stdout === 'string' && error.stdout.trim()) {
      throw new Error(`Command "${file} ${args.join(' ')}" failed: ${error.stdout.trim()}`);
    }

    const detail = typeof error?.stderr === 'string' && error.stderr.trim()
      ? error.stderr.trim()
      : error.message;
    throw new Error(`Command "${file} ${args.join(' ')}" failed: ${detail}`);
  }
};

const readListeningPids = async () => {
  const raw = await run('lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN'], {
    allowedExitCodes: [1],
  });
  return raw ? raw.split('\n').map((pid) => pid.trim()).filter(Boolean) : [];
};

const readCwdForPid = async (pid) => {
  const raw = await run('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], {
    allowedExitCodes: [1],
  });
  const cwdLine = raw.split('\n').find((line) => line.startsWith('n'));
  return cwdLine ? cwdLine.slice(1) : '';
};

const readCommandForPid = async (pid) => {
  try {
    const raw = await run('ps', ['-p', pid, '-o', 'command=']);
    return raw || 'unknown command';
  } catch (error) {
    return 'unknown command';
  }
};

const readListeners = async () => {
  const pids = await readListeningPids();
  return Promise.all(
    pids.map(async (pid) => ({
      pid,
      cwd: await readCwdForPid(pid),
      command: await readCommandForPid(pid),
    })),
  );
};

const isProjectListener = (listener) => (
  listener.cwd === projectRoot || listener.command.includes(projectRoot)
);

const stopPid = async (pid, signal) => {
  try {
    process.kill(Number(pid), signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      throw error;
    }
  }
};

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const assertOnlyProjectListeners = (listeners) => {
  const foreign = listeners.filter((listener) => !isProjectListener(listener));
  if (foreign.length === 0) {
    return;
  }

  const details = foreign.map((listener) => (
    `PID ${listener.pid}: ${listener.command} (${listener.cwd || 'unknown cwd'})`
  )).join('\n');

  throw new Error(
    `Port ${port} is in use by a non-Vessel process. Refusing to stop it.\n${details}`,
  );
};

const printStatus = async () => {
  const listeners = await readListeners();
  if (listeners.length === 0) {
    console.log(`No process is listening on port ${port}.`);
    return;
  }

  for (const listener of listeners) {
    const owner = isProjectListener(listener) ? 'Vessel' : 'external';
    console.log(
      `${owner} listener on port ${port}: PID ${listener.pid} | ${listener.command} | cwd=${listener.cwd || 'unknown'}`,
    );
  }
};

const stopProjectListeners = async () => {
  const listeners = await readListeners();
  if (listeners.length === 0) {
    console.log(`No process is listening on port ${port}.`);
    return;
  }

  assertOnlyProjectListeners(listeners);

  for (const listener of listeners) {
    console.log(`Stopping Vessel preview listener PID ${listener.pid} on port ${port}.`);
    await stopPid(listener.pid, 'SIGTERM');
  }

  await sleep(1500);

  const remaining = await readListeners();
  assertOnlyProjectListeners(remaining);
  for (const listener of remaining) {
    console.log(`Force-stopping Vessel preview listener PID ${listener.pid} on port ${port}.`);
    await stopPid(listener.pid, 'SIGKILL');
  }

  const finalListeners = await readListeners();
  if (finalListeners.length > 0) {
    const details = finalListeners.map((listener) => `PID ${listener.pid}`).join(', ');
    throw new Error(`Port ${port} is still in use after stop: ${details}`);
  }

  console.log(`Port ${port} is clear.`);
};

try {
  if (command === 'status') {
    await printStatus();
  } else if (command === 'stop') {
    await stopProjectListeners();
  } else {
    throw new Error(`Unknown command "${command}". Use "status" or "stop".`);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
