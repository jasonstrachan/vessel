import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import test from 'node:test';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts/vessel-collab.mjs');

const reservePort = async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  return address.port;
};

const waitFor = async (predicate, timeoutMs = 5000) => {
  const timeoutAt = Date.now() + timeoutMs;
  while (Date.now() < timeoutAt) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for collaboration test condition');
};

const waitForFile = (filePath) => waitFor(async () => {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
});

const fetchJson = async (url, options) => {
  const response = await fetch(url, options);
  const value = response.status === 204 ? undefined : await response.json();
  return { response, value };
};

const createJsonLineReader = (stream) => {
  const lines = readline.createInterface({ input: stream });
  const queued = [];
  const waiters = [];
  lines.on('line', (line) => {
    const item = { line, value: JSON.parse(line) };
    const waiter = waiters.shift();
    if (waiter) waiter(item);
    else queued.push(item);
  });
  return {
    next: () => {
      const item = queued.shift();
      if (item) return Promise.resolve(item);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out waiting for client output')), 5000);
        waiters.push((value) => {
          clearTimeout(timeout);
          resolve(value);
        });
      });
    },
  };
};

test('persistent client accepts large batches, emits compact results, and recovers idempotently', async (t) => {
  const session = `collab-test-${crypto.randomUUID().slice(0, 8)}`;
  const port = await reservePort();
  const statePath = path.join(os.tmpdir(), `vessel-collab-${session}.json`);
  const resultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vessel-collab-results-'));
  const referencePath = path.join(resultDir, 'reference.png');
  const referenceBytes = Buffer.from('reference-image-bytes');
  await fs.writeFile(referencePath, referenceBytes);
  const server = spawn(process.execPath, [
    SCRIPT_PATH,
    'serve',
    '--session', session,
    '--port', String(port),
    '--quiet',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  t.after(async () => {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    await fs.rm(resultDir, { recursive: true, force: true });
    await fs.rm(statePath, { force: true });
  });

  const state = JSON.parse(await waitForFile(statePath));
  const headers = {
    Authorization: `Bearer ${state.token}`,
    'Content-Type': 'application/json',
  };
  const client = spawn(process.execPath, [
    SCRIPT_PATH,
    'client',
    '--session', session,
    '--result-dir', resultDir,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  const output = createJsonLineReader(client.stdout);
  t.after(() => client.kill('SIGTERM'));

  const requestId = 'large-six-shape-test';
  const points = Array.from({ length: 64 }, (_, index) => ({
    x: index * 3,
    y: index * 5,
  }));
  const command = {
    requestId,
    action: 'batch',
    capture: 'final-thumbnail',
    operations: Array.from({ length: 6 }, () => ({ action: 'shape', points })),
  };
  const encodedCommand = `${JSON.stringify(command)}\n`;
  assert.ok(Buffer.byteLength(encodedCommand) > 4096);

  client.stdin.write(encodedCommand);
  const accepted = await output.next();
  assert.equal(accepted.value.type, 'accepted');
  assert.equal(accepted.value.requestId, requestId);
  assert.equal(accepted.value.reused, false);

  const delivered = await fetchJson(`${state.url}/v1/commands/next?wait=0`, { headers });
  assert.equal(delivered.response.status, 200);
  assert.equal(delivered.value.id, accepted.value.commandId);
  assert.equal(delivered.value.operations.length, 6);

  const completedResult = {
    ok: true,
    commandId: accepted.value.commandId,
    action: 'batch',
    revision: 42,
    completedOperations: 6,
    state: {
      palette: { foreground: '#ffffff', background: '#000000', activeSlot: 'foreground' },
    },
    frames: [
      {
        operationIndex: 2,
        revision: 20,
        checkpointName: 'landscape',
        frame: {
          mimeType: 'image/png',
          kind: 'thumbnail',
          width: 640,
          height: 480,
          sourceWidth: 2000,
          sourceHeight: 2000,
          dataUrl: 'data:image/png;base64,ZnJhbWUtMQ==',
        },
      },
      {
        operationIndex: 5,
        revision: 42,
        checkpointName: 'final-hat',
        frame: {
          mimeType: 'image/png',
          kind: 'thumbnail',
          width: 640,
          height: 480,
          sourceWidth: 2000,
          sourceHeight: 2000,
          dataUrl: 'data:image/png;base64,ZnJhbWUtMg==',
        },
      },
    ],
    profile: {
      mutationMs: 6000,
      presentationMs: 40,
      captureMs: 10,
      totalMs: 6050,
      operations: Array.from({ length: 6 }, (_, index) => ({
        index,
        action: 'shape',
        mutationMs: 1000,
        revision: index + 1,
      })),
    },
  };
  const firstResultWrite = await fetchJson(`${state.url}/v1/commands/${accepted.value.commandId}/result`, {
    method: 'POST',
    headers,
    body: JSON.stringify(completedResult),
  });
  assert.equal(firstResultWrite.value.reused, false);
  const completed = await output.next();
  assert.equal(completed.value.type, 'completed');
  assert.equal(completed.value.revision, 42);
  assert.equal(completed.value.profile.totalMs, 6050);
  assert.equal(completed.value.state.palette.foreground, '#ffffff');
  assert.deepEqual(
    completed.value.frames.map((frame) => frame.checkpointName),
    ['landscape', 'final-hat'],
  );
  assert.ok(completed.value.frames.every((frame) => frame.path.endsWith('.png')));
  assert.ok(Buffer.byteLength(completed.line) < 1024);
  assert.equal(JSON.parse(await fs.readFile(completed.value.resultPath, 'utf8')).profile.operations.length, 6);

  const repeatedResultWrite = await fetchJson(`${state.url}/v1/commands/${accepted.value.commandId}/result`, {
    method: 'POST',
    headers,
    body: JSON.stringify(completedResult),
  });
  assert.equal(repeatedResultWrite.value.reused, true);
  const conflictingResultWrite = await fetchJson(`${state.url}/v1/commands/${accepted.value.commandId}/result`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...completedResult, revision: 43 }),
  });
  assert.equal(conflictingResultWrite.response.status, 400);
  assert.match(conflictingResultWrite.value.error, /different data/);

  const observeCommand = {
    requestId: 'painting-settings-readback',
    action: 'observe',
    capture: 'none',
  };
  client.stdin.write(`${JSON.stringify(observeCommand)}\n`);
  const observeAccepted = await output.next();
  const observeDelivered = await fetchJson(`${state.url}/v1/commands/next?wait=0`, { headers });
  const observeResult = {
    ok: true,
    commandId: observeAccepted.value.commandId,
    action: 'observe',
    revision: 42,
    state: {
      project: { id: 'project-1', name: 'Portrait', width: 512, height: 640 },
      activeLayerId: 'layer-1',
      currentTool: 'brush',
      currentBrushPresetId: 'color-cycle-flat-dither',
      currentBrushCapabilities: { canDither: true, forceDither: true },
      availableBrushPresets: [{
        id: 'color-cycle-flat-dither',
        name: 'CC Flat Dither',
        category: 'Color Cycle',
        isCustomBrush: false,
      }],
      palette: { foreground: '#ffffff', background: '#000000', activeSlot: 'foreground' },
      gradient: {
        source: 'fg',
        stops: [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }],
        foreground: { lightness: 50, hueShift: 0, saturationShift: 0, opacity: 100, stopCount: 3 },
        sampleCount: 0,
      },
      brush: { size: 12, ditherEnabled: true, ditherAlgorithm: 'sierra-lite' },
      eraser: { size: 12, opacity: 1, linkSizeToBrush: true, tip: 'square' },
      layers: [{ id: 'layer-1', name: 'CC Layer 1', type: 'color-cycle' }],
    },
  };
  assert.equal(observeDelivered.value.id, observeAccepted.value.commandId);
  await fetchJson(`${state.url}/v1/commands/${observeAccepted.value.commandId}/result`, {
    method: 'POST',
    headers,
    body: JSON.stringify(observeResult),
  });
  const observed = await output.next();
  assert.equal(observed.value.state.palette.foreground, '#ffffff');
  assert.equal(observed.value.state.gradient.source, 'fg');
  assert.equal(observed.value.state.eraser.tip, 'square');
  assert.equal(observed.value.state.availableBrushPresets[0].id, 'color-cycle-flat-dither');

  client.stdin.write(`${JSON.stringify({
    requestId: 'local-reference-image',
    action: 'import-reference-image',
    filePath: referencePath,
    fit: 'contain',
  })}\n`);
  const referenceAccepted = await output.next();
  const referenceDelivered = await fetchJson(`${state.url}/v1/commands/next?wait=0`, { headers });
  assert.equal(referenceDelivered.value.id, referenceAccepted.value.commandId);
  assert.equal(referenceDelivered.value.filePath, undefined);
  assert.equal(referenceDelivered.value.fileName, 'reference.png');
  assert.equal(referenceDelivered.value.mimeType, 'image/png');
  assert.equal(referenceDelivered.value.dataBase64, referenceBytes.toString('base64'));
  assert.equal(referenceDelivered.value.fit, 'contain');
  await fetchJson(`${state.url}/v1/commands/${referenceAccepted.value.commandId}/result`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ok: true,
      commandId: referenceAccepted.value.commandId,
      action: 'import-reference-image',
      revision: 43,
    }),
  });
  const referenceCompleted = await output.next();
  assert.equal(referenceCompleted.value.action, 'import-reference-image');
  assert.equal(referenceCompleted.value.revision, 43);

  client.stdin.write(encodedCommand);
  const retryAccepted = await output.next();
  assert.equal(retryAccepted.value.commandId, accepted.value.commandId);
  assert.equal(retryAccepted.value.reused, true);
  const retryCompleted = await output.next();
  assert.equal(retryCompleted.value.revision, 42);

  const noDuplicate = await fetchJson(`${state.url}/v1/commands/next?wait=0`, { headers });
  assert.equal(noDuplicate.response.status, 204);

  const conflictingRetry = await fetchJson(`${state.url}/v1/commands`, {
    method: 'POST',
    headers: { ...headers, 'Idempotency-Key': requestId },
    body: JSON.stringify({ action: 'observe' }),
  });
  assert.equal(conflictingRetry.response.status, 400);
  assert.match(conflictingRetry.value.error, /different command/);

  const recoveredOnce = await fetchJson(`${state.url}/v1/results/${accepted.value.commandId}`, { headers });
  const recoveredTwice = await fetchJson(`${state.url}/v1/results/${accepted.value.commandId}`, { headers });
  assert.equal(recoveredOnce.response.status, 200);
  assert.equal(recoveredTwice.response.status, 200);
  assert.deepEqual(recoveredTwice.value, completedResult);

  client.stdin.write(`${JSON.stringify({
    action: 'get-result',
    commandId: accepted.value.commandId,
  })}\n`);
  const recoveredByClient = await output.next();
  assert.equal(recoveredByClient.value.type, 'completed');
  assert.equal(recoveredByClient.value.commandId, accepted.value.commandId);
  assert.equal(recoveredByClient.value.revision, 42);
});
