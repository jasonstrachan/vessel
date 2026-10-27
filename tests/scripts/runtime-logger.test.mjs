import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const loggerPath = path.resolve('scripts/runtime-logger.cjs');
const limit = 5 * 1024 * 1024;
const setup = `const { createRuntimeLogger } = require(${JSON.stringify(loggerPath)});`;

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-runtime-logger-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function run(directory, source) {
  return spawnSync(process.execPath, ['-e', setup + source], {
    cwd: directory,
    stdio: 'ignore',
    timeout: 3000,
  });
}

test('closed stdout and stderr do not become recursive uncaught errors', async (t) => {
  const directory = workspace(t);
  const child = spawn(process.execPath, ['-e', setup + `
    const logger = createRuntimeLogger('closed-pipes');
    logger.installProcessHandlers('closed-pipes');
    let exceptions = 0;
    process.on('uncaughtExceptionMonitor', () => exceptions++);
    process.on('message', () => {
      logger.log('stdout disconnected');
      logger.error('stderr disconnected');
      setTimeout(() => {
        logger.writeRaw('child: ', 'still running', true);
        process.send({ exceptions });
        setTimeout(() => process.exit(0), 20);
      }, 100);
    });
    process.send('ready');
  `], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(() => child.kill('SIGKILL'));
  const exited = once(child, 'exit');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 3000);
  t.after(() => clearTimeout(timeout));
  await once(child, 'message');
  child.stdout.destroy();
  child.stderr.destroy();
  const response = Promise.race([
    once(child, 'message'),
    exited.then(() => { throw new Error('child exited before reporting'); }),
  ]);
  child.send('write');
  const [result] = await response;
  assert.equal(result.exceptions, 0);
  assert.deepEqual(await exited, [0, null]);
  const text = fs.readFileSync(path.join(directory, 'logs/runtime/closed-pipes.log'), 'utf8');
  assert.match(text, /still running/);
  assert.doesNotMatch(text, /uncaught/);
});

test('every logging entrypoint stays within 5 MiB, including oversized UTF-8 chunks', (t) => {
  const directory = workspace(t);
  const result = run(directory, `
    const logger = createRuntimeLogger('bounded');
    const fs = require('node:fs');
    const huge = '🖌'.repeat(2 * 1024 * 1024);
    for (const write of [
      () => logger.log(huge),
      () => logger.warn(huge),
      () => logger.error(huge),
      () => logger.writeRaw('child: ', huge),
      () => logger.writeRaw('child: ', huge, true),
    ]) {
      write();
      if (fs.statSync(logger.filePath).size > ${limit}) process.exit(2);
      if (fs.readFileSync(logger.filePath, 'utf8').includes('\\uFFFD')) process.exit(3);
    }
    logger.log('latest entry');
  `);
  assert.equal(result.status, 0);
  const text = fs.readFileSync(path.join(directory, 'logs/runtime/bounded.log'), 'utf8');
  assert.match(text, /latest entry/);
  assert.ok(Buffer.byteLength(text) <= limit);
  assert.doesNotMatch(text, /\uFFFD/);
});

test('repeated small entries cannot accumulate beyond the cap', (t) => {
  const directory = workspace(t);
  const result = run(directory, `
    const fs = require('node:fs');
    const logger = createRuntimeLogger('repeated');
    for (let i = 0; i < 1500; i++) {
      logger.writeRaw('child: ', 'x'.repeat(8192));
      if (fs.statSync(logger.filePath).size > ${limit}) process.exit(2);
    }
    logger.log('last entry');
  `);
  assert.equal(result.status, 0);
  assert.match(fs.readFileSync(path.join(directory, 'logs/runtime/repeated.log'), 'utf8'), /last entry/);
});

test('an oversized log from a previous run is cleared on startup', (t) => {
  const directory = workspace(t);
  const logPath = path.join(directory, 'logs/runtime/existing.log');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, Buffer.alloc(limit + 1));
  assert.equal(run(directory, "createRuntimeLogger('existing');").status, 0);
  assert.ok(fs.statSync(logPath).size <= limit);
});

test('disk logging failures do not throw or create an error loop', (t) => {
  const directory = workspace(t);
  fs.mkdirSync(path.join(directory, 'logs/runtime/unwritable.log'), { recursive: true });
  const result = run(directory, `
    const logger = createRuntimeLogger('unwritable');
    logger.log('one');
    logger.error('two');
    logger.writeRaw('child: ', 'three');
  `);
  assert.equal(result.status, 0);
});

for (const failure of ['throw new Error("fatal-test")', 'Promise.reject(new Error("fatal-test"))']) {
  test(`real fatal errors exit instead of being swallowed: ${failure}`, (t) => {
    const directory = workspace(t);
    const result = run(directory, `
      const logger = createRuntimeLogger('fatal');
      logger.installProcessHandlers('fatal');
      setInterval(() => {}, 1000);
      setImmediate(() => { ${failure}; });
    `);
    assert.equal(result.status, 1);
    assert.equal(result.signal, null);
    assert.match(fs.readFileSync(path.join(directory, 'logs/runtime/fatal.log'), 'utf8'), /fatal-test/);
  });
}
