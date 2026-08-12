import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import test from 'node:test';
import sharp from 'sharp';

import {
  appendVesselCollaborationJournal,
  getVesselCollaborationJournalPath,
  getVesselCollaborationResultPath,
  readVesselCollaborationJournal,
  writeVesselCollaborationJournalResult,
} from '../../scripts/vessel-collab-journal.mjs';

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

const claimRuntime = (url, headers, runtimeInstanceId) => fetchJson(
  `${url}/v1/clients/claim`,
  {
    method: 'POST',
    headers,
    body: JSON.stringify({
      protocolVersion: 6,
      runtimeBuildId: 'transport-test-build',
      runtimeInstanceId,
    }),
  },
);

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

const waitForNextCommand = (state) => waitFor(async () => {
  const delivered = await fetchJson(`${state.url}/v1/commands/next?wait=0`, {
    headers: {
      Authorization: `Bearer ${state.token}`,
      'Content-Type': 'application/json',
      ...(state.clientId ? { 'X-Vessel-Collab-Client': state.clientId } : {}),
    },
  });
  return delivered.response.status === 200 ? delivered.value : undefined;
});

test('one-use pairing resolves the bridge URL from state without exposing its token', async (t) => {
  const session = `collab-pair-${crypto.randomUUID().slice(0, 8)}`;
  const port = await reservePort();
  const statePath = path.join(os.tmpdir(), `vessel-collab-${session}.json`);
  const server = spawn(process.execPath, [
    SCRIPT_PATH,
    'serve',
    '--session', session,
    '--port', String(port),
    '--no-multiplayer-ai',
    '--quiet',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    await fs.rm(statePath, { force: true });
  });

  const state = JSON.parse(await waitForFile(statePath));
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.url, `http://127.0.0.1:${port}`);
  const pairing = await fetchJson(`${state.url}/v1/pairings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${state.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ targetUrl: 'http://localhost:3001/' }),
  });
  assert.equal(pairing.response.status, 201);
  assert.doesNotMatch(pairing.value.url, new RegExp(state.token));
  const credentialTarget = await fetchJson(`${state.url}/v1/pairings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${state.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ targetUrl: 'http://user@localhost:3001/' }),
  });
  assert.equal(credentialTarget.response.status, 400);
  assert.match(credentialTarget.value.error, /localhost Vessel URL/);

  const connected = await fetch(pairing.value.url, { redirect: 'manual' });
  assert.equal(connected.status, 302);
  const location = new URL(connected.headers.get('location'));
  assert.equal(location.origin, 'http://localhost:3001');
  const fragment = new URLSearchParams(location.hash.slice(1));
  assert.equal(fragment.get('vesselCollabUrl'), state.url);
  assert.equal(fragment.get('vesselCollabToken'), state.token);

  const reused = await fetch(pairing.value.url, { redirect: 'manual' });
  assert.equal(reused.status, 410);
});

test('human gestures and canonical canvas frames stream through the multiplayer bridge', async (t) => {
  const session = `collab-runtime-events-${crypto.randomUUID().slice(0, 8)}`;
  const port = await reservePort();
  const statePath = path.join(os.tmpdir(), `vessel-collab-${session}.json`);
  const server = spawn(process.execPath, [
    SCRIPT_PATH,
    'serve',
    '--session', session,
    '--port', String(port),
    '--no-multiplayer-ai',
    '--quiet',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    await fs.rm(statePath, { force: true });
  });

  const state = JSON.parse(await waitForFile(statePath));
  const clientId = 'runtime-event-client';
  const runtimeInstanceId = 'runtime-events-instance';
  const headers = {
    Authorization: `Bearer ${state.token}`,
    'Content-Type': 'application/json',
    'X-Vessel-Collab-Client': clientId,
  };
  const claimed = await claimRuntime(state.url, headers, runtimeInstanceId);
  assert.equal(claimed.response.status, 200);
  assert.deepEqual(claimed.value.multiplayerAi, {
    enabled: false,
    model: 'qwen2.5vl:3b',
    state: 'disabled',
  });
  const runtime = {
    protocolVersion: 6,
    runtimeBuildId: 'transport-test-build',
    runtimeInstanceId,
    leaseEpoch: claimed.value.leaseEpoch,
  };
  const event = {
    eventId: 'human-event-1',
    type: 'human-gesture',
    actor: 'human',
    phase: 'end',
    sessionId: 'portrait-together',
    projectId: 'project-1',
    projectRevision: 7,
    gestureId: 'human-gesture-1',
    humanLayerId: 'jason-layer',
    tool: 'brush',
    shapeMode: false,
    pointerType: 'pen',
    point: { x: 22, y: 18, pressure: 0.5 },
    path: [
      { x: 10, y: 9, pressure: 0.4 },
      { x: 14, y: 12, pressure: 0.55 },
      { x: 18, y: 15, pressure: 0.6 },
      { x: 22, y: 18, pressure: 0.5 },
    ],
    bounds: { minX: 10, minY: 9, maxX: 22, maxY: 18 },
    pointCount: 4,
    occurredAt: 1000,
    committed: true,
    committedAt: 1080,
    elapsedMs: 70,
  };
  const frame = {
    frameId: 'frame-1',
    sessionId: event.sessionId,
    projectId: event.projectId,
    projectRevision: event.projectRevision,
    aiLayerType: 'normal',
    capturedAt: 1100,
    width: 256,
    height: 128,
    sourceWidth: 512,
    sourceHeight: 256,
    mimeType: 'image/webp',
    gestureId: event.gestureId,
    gesturePhase: 'end',
    gesturePointCount: event.pointCount,
    runtime,
  };
  const frameUrl = (metadata) => {
    const target = new URL(`${state.url}/v1/multiplayer-frame`);
    target.searchParams.set('metadata', JSON.stringify(metadata));
    return target;
  };

  const acceptedFrame = await fetchJson(frameUrl(frame), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'image/webp' },
    body: Buffer.from([0, 0, 0]),
  });
  assert.equal(acceptedFrame.response.status, 202);
  assert.equal(acceptedFrame.value.capturedAt, 1100);
  const health = await fetchJson(`${state.url}/v1/health`, {
    headers: { Authorization: `Bearer ${state.token}` },
  });
  assert.equal(health.value.multiplayerAi.state, 'disabled');
  assert.equal(health.value.latestMultiplayerFrameAt, 1100);
  const oversizedFrame = await fetchJson(frameUrl({ ...frame, width: 2048 }), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'image/webp' },
    body: Buffer.from([0, 0, 0]),
  });
  assert.equal(oversizedFrame.response.status, 400);
  assert.match(oversizedFrame.value.error, /safety limit/);

  const accepted = await fetchJson(`${state.url}/v1/runtime-events`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ event, runtime }),
  });
  assert.equal(accepted.response.status, 202);
  assert.equal(accepted.value.sequence, 1);

  const streamed = await fetchJson(`${state.url}/v1/runtime-events?after=0&wait=0`, {
    headers: { Authorization: `Bearer ${state.token}` },
  });
  assert.equal(streamed.response.status, 200);
  assert.equal(streamed.value.next, 1);
  assert.deepEqual(streamed.value.events[0], {
    ...event,
    sequence: 1,
    receivedAt: streamed.value.events[0].receivedAt,
  });
  assert.equal(Number.isFinite(streamed.value.events[0].receivedAt), true);

  const eventReader = spawn(process.execPath, [
    SCRIPT_PATH,
    'events',
    '--session', session,
    '--once',
    '--after', '0',
    '--wait', '0',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const eventReaderOutput = [];
  eventReader.stdout.on('data', (chunk) => eventReaderOutput.push(chunk));
  const eventReaderExit = await new Promise((resolve) => eventReader.once('exit', resolve));
  assert.equal(eventReaderExit, 0);
  assert.equal(JSON.parse(Buffer.concat(eventReaderOutput).toString('utf8')).sequence, 1);

  const duplicate = await fetchJson(`${state.url}/v1/runtime-events`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ event, runtime }),
  });
  assert.equal(duplicate.value.reused, true);
  assert.equal(duplicate.value.sequence, 1);

  const conflictingDuplicate = await fetchJson(`${state.url}/v1/runtime-events`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      event: { ...event, point: { ...event.point, x: event.point.x + 1 } },
      runtime,
    }),
  });
  assert.equal(conflictingDuplicate.response.status, 400);
  assert.match(conflictingDuplicate.value.error, /already used for different data/);

  const stale = await fetchJson(`${state.url}/v1/runtime-events`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ event: { ...event, eventId: 'human-event-2' }, runtime: {
      ...runtime,
      leaseEpoch: runtime.leaseEpoch + 1,
    } }),
  });
  assert.equal(stale.response.status, 409);
});

test('multiplayer model hot-swap preserves the bridge and active runtime', async (t) => {
  const session = `collab-model-swap-${crypto.randomUUID().slice(0, 8)}`;
  const port = await reservePort();
  const ollamaPort = await reservePort();
  const statePath = path.join(os.tmpdir(), `vessel-collab-${session}.json`);
  const ollamaRequests = [];
  const ollama = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    ollamaRequests.push(body);
    if (body.model === 'broken-vision:latest') {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'model failed to load' }));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: { content: 'OK' } }));
  });
  await new Promise((resolve, reject) => {
    ollama.once('error', reject);
    ollama.listen(ollamaPort, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => ollama.close(resolve)));

  const server = spawn(process.execPath, [
    SCRIPT_PATH,
    'serve',
    '--session', session,
    '--port', String(port),
    '--multiplayer-model', 'qwen2.5vl:3b',
    '--multiplayer-ollama-url', `http://127.0.0.1:${ollamaPort}/api/chat`,
    '--quiet',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    await fs.rm(statePath, { force: true });
  });

  const state = JSON.parse(await waitForFile(statePath));
  const headers = {
    Authorization: `Bearer ${state.token}`,
    'Content-Type': 'application/json',
    'X-Vessel-Collab-Client': 'model-swap-client',
  };
  const claimed = await claimRuntime(state.url, headers, 'model-swap-runtime');
  assert.equal(claimed.response.status, 200);
  await waitFor(async () => {
    const health = await fetchJson(`${state.url}/v1/health`, { headers });
    return health.value.multiplayerAi.state === 'watching' ? health.value : undefined;
  });
  const activeBefore = await fetchJson(`${state.url}/v1/clients/active`, { headers });

  const modelCommand = spawn(process.execPath, [
    SCRIPT_PATH,
    'multiplayer-model',
    '--session', session,
    '--model', 'qwen3-vl:8b-instruct',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const modelOutput = [];
  modelCommand.stdout.on('data', (chunk) => modelOutput.push(chunk));
  const modelExit = await new Promise((resolve) => modelCommand.once('exit', resolve));
  assert.equal(modelExit, 0);
  const changed = JSON.parse(Buffer.concat(modelOutput).toString('utf8'));
  assert.equal(changed.changed, true);
  assert.equal(changed.multiplayerAi.model, 'qwen3-vl:8b-instruct');
  assert.equal(changed.multiplayerAi.state, 'watching');

  const activeAfter = await fetchJson(`${state.url}/v1/clients/active`, { headers });
  assert.deepEqual(activeAfter.value, activeBefore.value);
  const healthAfter = await fetchJson(`${state.url}/v1/health`, { headers });
  assert.equal(healthAfter.value.multiplayerAi.model, 'qwen3-vl:8b-instruct');
  assert.equal(healthAfter.value.activeRuntime.runtimeInstanceId, 'model-swap-runtime');
  assert.deepEqual(ollamaRequests.map((request) => request.model), [
    'qwen2.5vl:3b',
    'qwen3-vl:8b-instruct',
  ]);

  const failed = await fetchJson(`${state.url}/v1/multiplayer-ai/model`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: 'broken-vision:latest' }),
  });
  assert.equal(failed.response.status, 502);
  assert.match(failed.value.error, /warmup failed/);
  const healthAfterFailure = await fetchJson(`${state.url}/v1/health`, { headers });
  assert.equal(healthAfterFailure.value.multiplayerAi.model, 'qwen3-vl:8b-instruct');
  assert.equal(healthAfterFailure.value.multiplayerAi.state, 'watching');
});

test('resumed bridge reclaims the existing page runtime without a reload', async (t) => {
  const session = `collab-resume-${crypto.randomUUID().slice(0, 8)}`;
  const port = await reservePort();
  const statePath = path.join(os.tmpdir(), `vessel-collab-${session}.json`);
  const resumePath = path.join(os.tmpdir(), `vessel-collab-resume-${crypto.randomUUID()}.json`);
  const spawnBridge = (extraArgs = []) => spawn(process.execPath, [
    SCRIPT_PATH,
    'serve',
    '--session', session,
    '--port', String(port),
    '--no-multiplayer-ai',
    '--quiet',
    ...extraArgs,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let server = spawnBridge();
  t.after(async () => {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    await fs.rm(statePath, { force: true });
    await fs.rm(resumePath, { force: true });
  });

  const firstState = JSON.parse(await waitForFile(statePath));
  const headers = {
    Authorization: `Bearer ${firstState.token}`,
    'Content-Type': 'application/json',
    'X-Vessel-Collab-Client': 'resumed-page-client',
  };
  const claimed = await claimRuntime(firstState.url, headers, 'resumed-page-runtime');
  assert.equal(claimed.response.status, 200);
  const runtime = {
    protocolVersion: 6,
    runtimeBuildId: 'transport-test-build',
    runtimeInstanceId: 'resumed-page-runtime',
    leaseEpoch: claimed.value.leaseEpoch,
  };
  const claimedState = JSON.parse(await waitForFile(statePath));
  assert.deepEqual(claimedState.activeClient, {
    clientId: 'resumed-page-client',
    ...runtime,
  });
  await fs.copyFile(statePath, resumePath);
  server.kill('SIGTERM');
  await new Promise((resolve) => server.once('exit', resolve));

  server = spawnBridge(['--resume-state', resumePath]);
  const resumedState = JSON.parse(await waitForFile(statePath));
  assert.equal(resumedState.token, firstState.token);
  assert.notEqual(resumedState.pid, firstState.pid);

  const health = await fetchJson(`${resumedState.url}/v1/health`, { headers });
  assert.equal(health.value.clientReady, true);
  assert.deepEqual(health.value.activeRuntime, runtime);
});

test('pairing rejects malformed bridge state without constructing an undefined URL', async (t) => {
  const session = `collab-invalid-state-${crypto.randomUUID().slice(0, 8)}`;
  const statePath = path.join(os.tmpdir(), `vessel-collab-${session}.json`);
  await fs.writeFile(statePath, JSON.stringify({ token: 'test-token-without-url' }));
  t.after(() => fs.rm(statePath, { force: true }));

  const pairing = spawn(process.execPath, [
    SCRIPT_PATH,
    'pair',
    '--session', session,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const stderr = [];
  pairing.stderr.on('data', (chunk) => stderr.push(chunk));
  const exitCode = await new Promise((resolve) => pairing.once('exit', resolve));
  const message = Buffer.concat(stderr).toString('utf8');
  assert.equal(exitCode, 1);
  assert.match(message, /missing a valid bridge URL/);
  assert.doesNotMatch(message, /undefined/);
});

test('durable journal reconciles accepted, delivered, cancelled, and completed commands', async (t) => {
  const session = `collab-journal-${crypto.randomUUID().slice(0, 8)}`;
  const journalPath = getVesselCollaborationJournalPath(session);
  const statePath = path.join(os.tmpdir(), `vessel-collab-${session}.json`);
  t.after(async () => {
    await fs.rm(journalPath, { force: true });
    await fs.rm(getVesselCollaborationResultPath(session, commandId), { force: true });
    await fs.rm(statePath, { force: true });
  });
  const commandId = crypto.randomUUID();
  const commandSignatureHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ action: 'observe', runtimeFence: {} }))
    .digest('hex');
  await appendVesselCollaborationJournal(session, {
    type: 'accepted',
    commandId,
    requestId: 'portrait-primary',
    action: 'observe',
    runtimeFence: {
      expectedProjectId: 'project-1',
      expectedProjectRevision: 4,
      expectedCheckpointId: null,
    },
    commandSignatureHash,
  });
  await appendVesselCollaborationJournal(session, { type: 'delivered', commandId });
  await appendVesselCollaborationJournal(session, { type: 'cancel-requested', commandId });
  const storedResult = {
    ok: true,
    commandId,
    action: 'observe',
    revision: 5,
    state: { project: { id: 'project-1', width: 100, height: 120 } },
  };
  await writeVesselCollaborationJournalResult(session, commandId, storedResult);
  await appendVesselCollaborationJournal(session, {
    type: 'completed',
    commandId,
    ok: true,
    revision: 5,
    projectId: 'project-1',
    outcome: { execution: 'cancelled', evidence: 'valid' },
  });

  const recovered = await readVesselCollaborationJournal(session);
  assert.deepEqual(recovered.commands, [{
    commandId,
    requestId: 'portrait-primary',
    action: 'observe',
    runtimeFence: {
      expectedProjectId: 'project-1',
      expectedProjectRevision: 4,
      expectedCheckpointId: null,
    },
    commandSignatureHash,
    status: 'completed',
    ok: true,
    revision: 5,
    projectId: 'project-1',
    outcome: { execution: 'cancelled', evidence: 'valid' },
  }]);
  const journalText = await fs.readFile(journalPath, 'utf8');
  assert.doesNotMatch(journalText, /Bearer|data:image|token/i);

  const port = await reservePort();
  const restartedServer = spawn(process.execPath, [
    SCRIPT_PATH,
    'serve',
    '--session', session,
    '--port', String(port),
    '--no-multiplayer-ai',
    '--quiet',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => restartedServer.kill('SIGTERM'));
  const restartedState = JSON.parse(await waitForFile(statePath));
  const health = await fetchJson(`${restartedState.url}/v1/health`, {
    headers: { Authorization: `Bearer ${restartedState.token}` },
  });
  assert.equal(health.value.recovery[0].commandId, commandId);
  assert.equal(health.value.recovery[0].status, 'completed');
  const headers = {
    Authorization: `Bearer ${restartedState.token}`,
    'Content-Type': 'application/json',
  };
  assert.equal((await claimRuntime(
    restartedState.url,
    { ...headers, 'X-Vessel-Collab-Client': 'journal-restart-client' },
    'journal-restart-runtime',
  )).response.status, 200);
  const duplicate = await fetchJson(`${restartedState.url}/v1/commands`, {
    method: 'POST',
    headers: { ...headers, 'Idempotency-Key': 'portrait-primary' },
    body: JSON.stringify({ action: 'observe' }),
  });
  assert.equal(duplicate.response.status, 202);
  assert.equal(duplicate.value.id, commandId);
  assert.equal(duplicate.value.reused, true);
  const recoveredResult = await fetchJson(
    `${restartedState.url}/v1/results/${commandId}`,
    { headers },
  );
  assert.equal(recoveredResult.response.status, 200);
  assert.deepEqual(recoveredResult.value, storedResult);
  const conflicting = await fetchJson(`${restartedState.url}/v1/commands`, {
    method: 'POST',
    headers: { ...headers, 'Idempotency-Key': 'portrait-primary' },
    body: JSON.stringify({ action: 'observe', capture: 'full' }),
  });
  assert.equal(conflicting.response.status, 400);
  assert.match(conflicting.value.error, /different command/);
});

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
    '--no-multiplayer-ai',
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
  const clientId = 'transport-client-current';
  const headers = {
    Authorization: `Bearer ${state.token}`,
    'Content-Type': 'application/json',
    'X-Vessel-Collab-Client': clientId,
  };
  const staleHeaders = {
    ...headers,
    'X-Vessel-Collab-Client': 'transport-client-stale',
  };
  assert.equal((await claimRuntime(state.url, staleHeaders, 'transport-runtime-stale')).response.status, 200);
  assert.equal((await claimRuntime(state.url, headers, 'transport-runtime-current')).response.status, 200);
  const stalePoll = await fetchJson(`${state.url}/v1/commands/next?wait=0`, {
    headers: staleHeaders,
  });
  assert.equal(stalePoll.response.status, 409);
  assert.match(stalePoll.value.error, /not active/);
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

  const queuedTakeover = await claimRuntime(
    state.url,
    { ...headers, 'X-Vessel-Collab-Client': 'transport-client-reloaded' },
    'transport-runtime-reloaded',
  );
  assert.equal(queuedTakeover.response.status, 409);
  assert.match(queuedTakeover.value.error, /unfinished commands/);

  const concurrentDeliveries = await Promise.all([
    fetchJson(`${state.url}/v1/commands/next?wait=0`, { headers }),
    fetchJson(`${state.url}/v1/commands/next?wait=0`, { headers }),
  ]);
  const delivered = concurrentDeliveries.find(({ response }) => response.status === 200);
  assert.equal(concurrentDeliveries.filter(({ response }) => response.status === 200).length, 1);
  assert.equal(concurrentDeliveries.filter(({ response }) => response.status === 204).length, 1);
  assert.equal(delivered.value.id, accepted.value.commandId);
  assert.equal(delivered.value.operations.length, 6);

  const completedResult = {
    ok: true,
    commandId: accepted.value.commandId,
    action: 'batch',
    revision: 42,
    completedOperations: 6,
    runtime: delivered.value.runtimeFence,
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
  const staleResultWrite = await fetchJson(
    `${state.url}/v1/commands/${accepted.value.commandId}/result`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...completedResult,
        runtime: { ...completedResult.runtime, leaseEpoch: 0 },
      }),
    },
  );
  assert.equal(staleResultWrite.response.status, 409);
  assert.match(staleResultWrite.value.error, /stale collaboration runtime/);
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
  assert.ok(Buffer.byteLength(completed.line) < 1536);
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
    runtime: observeDelivered.value.runtimeFence,
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
      runtime: referenceDelivered.value.runtimeFence,
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

test('artwork jobs load from one plan file, stream events, and cancel without reloading Vessel', async (t) => {
  const session = `collab-job-${crypto.randomUUID().slice(0, 8)}`;
  const port = await reservePort();
  const statePath = path.join(os.tmpdir(), `vessel-collab-${session}.json`);
  const resultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vessel-collab-job-'));
  const planPath = path.join(resultDir, 'portrait-plan.json');
  const invalidPlanPath = path.join(resultDir, 'invalid-plan.json');
  const unphasedPlanPath = path.join(resultDir, 'unphased-plan.json');
  const selfIntersectingPlanPath = path.join(resultDir, 'self-intersecting-plan.json');
  const stagedCachePath = path.join(resultDir, 'staged-cache.json');
  const operations = [
    ...Array.from({ length: 120 }, () => ({ action: 'set-tool', tool: 'brush' })),
    { action: 'checkpoint', name: 'primary-masses' },
  ];
  await fs.writeFile(planPath, JSON.stringify({
    action: 'artwork-job',
    runtimeFence: {
      expectedProjectId: 'project-1',
      expectedProjectRevision: 0,
      expectedCheckpointId: null,
    },
    operations,
  }));
  await fs.writeFile(invalidPlanPath, JSON.stringify([
    { action: 'replace-project-state' },
  ]));
  await fs.writeFile(unphasedPlanPath, JSON.stringify([
    { action: 'stroke', points: [{ x: 1, y: 1 }] },
    { action: 'checkpoint', name: 'must-not-dispatch' },
  ]));
  await fs.writeFile(selfIntersectingPlanPath, JSON.stringify({
    canvas: { width: 10, height: 10 },
    operations: [
      {
        action: 'shape',
        id: 'self-intersecting-shape',
        phase: 'establish',
        points: [
          { x: 1, y: 1 },
          { x: 8, y: 8 },
          { x: 1, y: 8 },
          { x: 8, y: 1 },
        ],
      },
      { action: 'checkpoint', name: 'must-not-dispatch' },
    ],
  }));
  await fs.writeFile(stagedCachePath, JSON.stringify({
    schemaVersion: 4,
    workflowId: 'general-artwork-v1',
    cacheIdentity: {
      referenceContentFingerprint: 'sha256:reference-1',
      referenceTransformFingerprint: 'sha256:contain-transform-1',
      plannerSchemaVersion: 'mass-planner-v3',
      coordinateConvention: 'vessel-canvas-pixels-v1',
    },
    massObservationPlan: {
      schemaVersion: 3,
      checkpointId: 'reference-observation-1',
      fingerprint: 'mass-plan-sha256-1',
      observedMassCount: 1,
    },
    project: { id: 'project-1', width: 512, height: 640 },
    stages: [{
      id: 'close-review',
      capture: 'full',
      gestureBudget: 0,
      pointBudget: 0,
      payloadByteBudget: 500000,
      candidates: [],
    }],
  }));
  const server = spawn(process.execPath, [
    SCRIPT_PATH,
    'serve',
    '--session', session,
    '--port', String(port),
    '--no-multiplayer-ai',
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
  const clientId = 'artwork-job-browser';
  const browserHeaders = {
    Authorization: `Bearer ${state.token}`,
    'Content-Type': 'application/json',
    'X-Vessel-Collab-Client': clientId,
  };
  const callerHeaders = {
    Authorization: `Bearer ${state.token}`,
    'Content-Type': 'application/json',
  };
  assert.equal((await claimRuntime(
    state.url,
    browserHeaders,
    'artwork-job-runtime',
  )).response.status, 200);

  const client = spawn(process.execPath, [
    SCRIPT_PATH,
    'client',
    '--session', session,
    '--result-dir', resultDir,
    '--frame-dir', resultDir,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  const output = createJsonLineReader(client.stdout);
  t.after(() => client.kill('SIGTERM'));

  client.stdin.write(`${JSON.stringify({
    requestId: 'invalid-job-from-file',
    action: 'artwork-job',
    planFile: invalidPlanPath,
    runtimeFence: {
      expectedProjectId: 'project-1',
      expectedProjectRevision: 0,
      expectedCheckpointId: null,
    },
  })}\n`);
  const rejected = await output.next();
  assert.equal(rejected.value.type, 'unknown');
  assert.match(rejected.value.error, /unsupported action/);
  const healthAfterRejection = await fetchJson(`${state.url}/v1/health`, {
    headers: callerHeaders,
  });
  assert.equal(healthAfterRejection.value.queued, 0);

  client.stdin.write(`${JSON.stringify({
    requestId: 'unphased-job-from-file',
    action: 'artwork-job',
    planFile: unphasedPlanPath,
    runtimeFence: {
      expectedProjectId: 'project-1',
      expectedProjectRevision: 0,
      expectedCheckpointId: null,
    },
  })}\n`);
  const phaseRejection = await output.next();
  assert.equal(phaseRejection.value.type, 'unknown');
  assert.match(phaseRejection.value.error, /gesture 0 requires a construction phase/);

  client.stdin.write(`${JSON.stringify({
    requestId: 'self-intersecting-job-from-file',
    action: 'artwork-job',
    planFile: selfIntersectingPlanPath,
    runtimeFence: {
      expectedProjectId: 'project-1',
      expectedProjectRevision: 0,
      expectedCheckpointId: null,
    },
  })}\n`);
  const geometryRejection = await output.next();
  assert.equal(geometryRejection.value.type, 'unknown');
  assert.match(geometryRejection.value.error, /gesture 0\.points must not self-intersect/);
  const healthAfterGeometryRejection = await fetchJson(`${state.url}/v1/health`, {
    headers: callerHeaders,
  });
  assert.equal(healthAfterGeometryRejection.value.queued, 0);

  const request = JSON.stringify({
    requestId: 'portrait-job-from-file',
    action: 'artwork-job',
    planFile: planPath,
  });
  assert.ok(Buffer.byteLength(request) < 512);
  client.stdin.write(`${request}\n`);

  const accepted = await output.next();
  assert.equal(accepted.value.type, 'accepted');
  const commandId = accepted.value.commandId;
  const delivered = await waitForNextCommand({ ...state, clientId });
  assert.equal(delivered.action, 'artwork-job');
  assert.equal(delivered.operations.length, 121);
  assert.equal(delivered.planFile, undefined);

  const postEvent = (eventId, event) => fetchJson(
    `${state.url}/v1/commands/${commandId}/events`,
    {
      method: 'POST',
      headers: browserHeaders,
      body: JSON.stringify({
        commandId,
        eventId,
        event,
        runtime: delivered.runtimeFence,
      }),
    },
  );
  assert.equal((await postEvent(`${commandId}:1`, {
    type: 'validated',
    totalOperations: 121,
  })).response.status, 202);
  assert.equal((await postEvent(`${commandId}:2`, {
    type: 'progress',
    completedOperations: 10,
    totalOperations: 121,
    revision: 4,
  })).response.status, 202);
  assert.equal((await postEvent(`${commandId}:3`, {
    type: 'checkpoint',
    operationIndex: 120,
    checkpointName: 'primary-masses',
    checkpointId: `${commandId}:primary-masses`,
    completedOperations: 121,
    totalOperations: 121,
    revision: 5,
    checkpointId: `${commandId}:primary-masses`,
    frame: {
      mimeType: 'image/png',
      kind: 'thumbnail',
      width: 512,
      height: 640,
      sourceWidth: 512,
      sourceHeight: 640,
      dataUrl: 'data:image/png;base64,Y2hlY2twb2ludA==',
    },
  })).response.status, 202);

  const validated = await output.next();
  const progress = await output.next();
  const checkpoint = await output.next();
  assert.equal(validated.value.type, 'validated');
  assert.equal(progress.value.type, 'progress');
  assert.equal(progress.value.completedOperations, 10);
  assert.equal(checkpoint.value.type, 'checkpoint');
  assert.equal(checkpoint.value.checkpointName, 'primary-masses');
  assert.ok(checkpoint.value.frame.path.endsWith('.png'));

  const cancel = await fetchJson(`${state.url}/v1/commands/${commandId}/cancel`, {
    method: 'POST',
    headers: callerHeaders,
  });
  assert.equal(cancel.value.cancelRequested, true);
  const control = await fetchJson(`${state.url}/v1/commands/${commandId}/control`, {
    headers: browserHeaders,
  });
  assert.equal(control.value.cancelRequested, true);

  const completedResult = {
    ok: true,
    commandId,
    action: 'artwork-job',
    revision: 5,
    completedOperations: 121,
    cancelled: true,
    runtime: delivered.runtimeFence,
  };
  assert.equal((await fetchJson(`${state.url}/v1/commands/${commandId}/result`, {
    method: 'POST',
    headers: browserHeaders,
    body: JSON.stringify(completedResult),
  })).response.status, 202);
  const completed = await output.next();
  assert.equal(completed.value.type, 'completed');
  assert.equal(completed.value.action, 'artwork-job');
  assert.equal(completed.value.cancelled, true);

  const lateCancel = await fetchJson(`${state.url}/v1/commands/${commandId}/cancel`, {
    method: 'POST',
    headers: callerHeaders,
  });
  assert.equal(lateCancel.value.completed, true);
  assert.equal(lateCancel.value.cancelRequested, false);

  client.stdin.write(`${JSON.stringify({
    requestId: 'staged-review',
    action: 'artwork-stage',
    cacheFile: stagedCachePath,
    stageId: 'close-review',
    runtimeFence: {
      expectedProjectId: 'project-1',
      expectedProjectRevision: 5,
      expectedCheckpointId: `${commandId}:primary-masses`,
    },
    decision: {
      status: 'advance',
      basedOnRevision: 5,
      basedOnCheckpointId: `${commandId}:primary-masses`,
    },
  })}\n`);
  const preparedStage = await output.next();
  assert.equal(preparedStage.value.type, 'stage-prepared');
  assert.equal(preparedStage.value.workflowId, 'general-artwork-v1');
  assert.equal(preparedStage.value.stageId, 'close-review');
  assert.equal(preparedStage.value.gestureCount, 0);
  assert.equal(preparedStage.value.capture, 'full');
  const stageAccepted = await output.next();
  assert.equal(stageAccepted.value.type, 'accepted');
  const deliveredStage = await waitForNextCommand({ ...state, clientId });
  assert.equal(deliveredStage.action, 'artwork-job');
  assert.equal(deliveredStage.operations.length, 1);
  assert.deepEqual(deliveredStage.operations[0], {
    action: 'checkpoint',
    name: 'close-review',
    capture: 'full',
    thumbnailMaxSize: 512,
  });
  assert.equal((await fetchJson(
    `${state.url}/v1/commands/${stageAccepted.value.commandId}/events`,
    {
      method: 'POST',
      headers: browserHeaders,
      body: JSON.stringify({
        commandId: stageAccepted.value.commandId,
        eventId: `${stageAccepted.value.commandId}:1`,
        event: {
          type: 'checkpoint',
          operationIndex: 0,
          checkpointName: 'close-review',
          completedOperations: 1,
          totalOperations: 1,
          revision: 5,
          frame: {
            mimeType: 'image/png',
            kind: 'full',
            width: 512,
            height: 640,
            sourceWidth: 512,
            sourceHeight: 640,
            dataUrl: 'data:image/png;base64,c3RhZ2Vk',
          },
        },
        runtime: deliveredStage.runtimeFence,
      }),
    },
  )).response.status, 202);
  const streamedStage = await output.next();
  assert.equal(streamedStage.value.type, 'checkpoint');
  assert.equal(streamedStage.value.frame.kind, 'full');
  assert.ok(streamedStage.value.frame.path.endsWith('.png'));
  assert.equal((await fetchJson(
    `${state.url}/v1/commands/${stageAccepted.value.commandId}/result`,
    {
      method: 'POST',
      headers: browserHeaders,
      body: JSON.stringify({
        ok: true,
        commandId: stageAccepted.value.commandId,
        action: 'artwork-job',
        revision: 5,
        completedOperations: 1,
        runtime: deliveredStage.runtimeFence,
        state: { project: { id: 'project-1', width: 512, height: 640 } },
      }),
    },
  )).response.status, 202);
  const stageCompleted = await output.next();
  assert.equal(stageCompleted.value.type, 'completed');
  assert.equal(stageCompleted.value.revision, 5);
});

test('reference preparation applies the selected Stroke profile through one bounded process', async (t) => {
  const session = `collab-prepare-${crypto.randomUUID().slice(0, 8)}`;
  const port = await reservePort();
  const statePath = path.join(os.tmpdir(), `vessel-collab-${session}.json`);
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vessel-collab-prepare-'));
  const referencePath = path.join(artifactDir, 'reference.png');
  const gatePath = path.join(artifactDir, 'gate.json');
  const framePath = path.join(artifactDir, 'gate-frame.png');
  const referenceBytes = await sharp({
    create: {
      width: 4,
      height: 5,
      channels: 4,
      background: { r: 120, g: 80, b: 60, alpha: 1 },
    },
  }).png().toBuffer();
  const gate = {
    action: 'stroke',
    points: [
      { x: 12, y: 14 },
      { x: 74, y: 12 },
      { x: 80, y: 70 },
      { x: 10, y: 76 },
    ],
  };
  await fs.writeFile(referencePath, referenceBytes);
  await fs.writeFile(gatePath, `${JSON.stringify(gate)}\n`);

  const server = spawn(process.execPath, [
    SCRIPT_PATH,
    'serve',
    '--session', session,
    '--port', String(port),
    '--no-multiplayer-ai',
    '--quiet',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    await fs.rm(artifactDir, { recursive: true, force: true });
    await fs.rm(statePath, { force: true });
  });

  const state = JSON.parse(await waitForFile(statePath));
  const browserClientId = 'reference-preparation-browser';
  const browserHeaders = {
    Authorization: `Bearer ${state.token}`,
    'Content-Type': 'application/json',
    'X-Vessel-Collab-Client': browserClientId,
  };
  assert.equal((await claimRuntime(
    state.url,
    browserHeaders,
    'reference-preparation-runtime',
  )).response.status, 200);
  const preparation = spawn(process.execPath, [
    SCRIPT_PATH,
    'prepare-reference',
    '--session', session,
    '--file', referencePath,
    '--gate-file', gatePath,
    '--brush-preset', 'color-cycle-stroke',
    '--width', '512',
    '--name', 'Reference Test',
    '--layer-name', 'Portrait paint',
    '--max-ready-ms', '10000',
    '--frame', framePath,
    '--result-dir', artifactDir,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => preparation.kill('SIGTERM'));
  const stdout = [];
  const stderr = [];
  preparation.stdout.on('data', (chunk) => stdout.push(chunk));
  preparation.stderr.on('data', (chunk) => stderr.push(chunk));
  const exitPromise = new Promise((resolve) => preparation.once('exit', (code) => resolve(code)));

  const commands = [];
  const expectedActions = [
    'observe',
    'new-project',
    'import-reference-image',
    'create-layer',
    'batch',
    'stroke',
    'set-layer-visibility',
  ];
  const readyState = {
    project: { id: 'project-1', name: 'Reference Test', width: 512, height: 640 },
    activeLayerId: 'paint-layer',
    referenceLayerId: 'reference-layer',
    preferReferenceSampling: true,
    currentTool: 'brush',
    currentBrushPresetId: 'color-cycle-stroke',
    currentBrushCapabilities: { canDither: false, forceDither: false },
    availableBrushPresets: [{
      id: 'color-cycle-stroke',
      name: 'Color Cycle Stroke',
      category: 'Color Cycle',
      isCustomBrush: false,
      artworkProfile: {
        schemaVersion: 1,
        markType: 'stroke',
        gradientSource: 'sampled',
        baseSettings: {
          size: 4,
          opacity: 1,
          spacing: 4,
          gradientBands: 64,
          ccGradientRangeContrast: 100,
          ccSampledSoftSeamEnabled: false,
          colorCycleStampShape: 'square',
          colorCycleStampDitherEnabled: true,
          ditherAlgorithm: 'sierra-lite',
          colorCycleStampDitherPressureLinked: false,
          colorCycleStampDitherBgFill: true,
          pressureEnabled: false,
          rotationEnabled: false,
          lostEdge: 0,
          dashedEnabled: false,
          gridSnapEnabled: false,
          gridSnapSize: 16,
          shapeEnabled: false,
        },
        preparation: { colorCycleSpeed: 0.01, stampDitherPixelSize: 3 },
        speed: {
          absoluteMaximum: 0.08,
          tiers: {
            quiet: { min: 0.005, max: 0.01, values: [0.005, 0.01] },
            secondary: { min: 0.015, max: 0.02, values: [0.015, 0.02] },
            foreground: { min: 0.03, max: 0.045, values: [0.03, 0.045] },
            focal: { min: 0.055, max: 0.06, values: [0.055, 0.06] },
          },
          phaseTier: {
            establish: 'quiet',
            develop: 'secondary',
            deepen: 'foreground',
          },
        },
        strokeSize: { pixels: 4, canvasShortEdge: 512, consistentWithinArtwork: true },
      },
    }],
    palette: { foreground: '#000000', background: '#ffffff', activeSlot: 'foreground' },
    gradient: {
      source: 'sampled',
      stops: [{ position: 0, color: '#111111' }, { position: 1, color: '#eeeeee' }],
      foreground: { lightness: 50, hueShift: 0, saturationShift: 0, opacity: 100, stopCount: 3 },
      sampleCount: 0,
    },
    brush: {
      size: 4,
      opacity: 1,
      spacing: 4,
      gradientBands: 64,
      ccGradientRangeContrast: 100,
      ccSampledSoftSeamEnabled: false,
      colorCycleStampShape: 'square',
      colorCycleStampDitherEnabled: true,
      ditherAlgorithm: 'sierra-lite',
      colorCycleStampDitherPixelSize: 3,
      colorCycleStampDitherPressureLinked: false,
      colorCycleStampDitherBgFill: true,
      pressureEnabled: false,
      rotationEnabled: false,
      lostEdge: 0,
      dashedEnabled: false,
      gridSnapEnabled: false,
      gridSnapSize: 16,
      shapeEnabled: false,
      colorCycleSpeed: 0.01,
    },
    eraser: { size: 4, opacity: 1, linkSizeToBrush: true, tip: 'square' },
    layers: [
      {
        id: 'reference-layer',
        name: 'reference.png',
        type: 'normal',
        visible: true,
        locked: false,
        opacity: 1,
      },
      {
        id: 'paint-layer',
        name: 'Portrait paint',
        type: 'color-cycle',
        visible: true,
        locked: false,
        opacity: 1,
      },
    ],
  };
  const sampledReadyState = {
    ...readyState,
    colorCycle: {
      hasContent: true,
      gradientDefinitionCount: 1,
      sampledGradientDefinitionCount: 1,
      sampledPaintedPixelCount: 2194,
      latestSampledGradient: {
        id: 1,
        stopCount: 3,
        uniqueColorCount: 3,
        stops: [
          { position: 0, color: '#6f89bd' },
          { position: 0.5, color: '#91aed2' },
          { position: 1, color: '#d5d0c8' },
        ],
      },
    },
    gradient: {
      ...readyState.gradient,
      stops: [
        { position: 0, color: '#6f89bd' },
        { position: 0.5, color: '#91aed2' },
        { position: 1, color: '#d5d0c8' },
      ],
    },
    layers: readyState.layers.map((layer) => layer.id === 'reference-layer'
      ? { ...layer, visible: false }
      : layer),
  };

  for (let index = 0; index < expectedActions.length; index += 1) {
    const command = await Promise.race([
      waitForNextCommand({ ...state, clientId: browserClientId }),
      exitPromise.then((code) => {
        throw new Error(
          `Reference preparation exited before command ${index + 1} (${code}): ` +
          Buffer.concat(stderr).toString('utf8').trim(),
        );
      }),
    ]);
    commands.push(command);
    assert.equal(command.action, expectedActions[index]);
    const result = {
      ok: true,
      commandId: command.id,
      action: command.action,
      revision: index + 1,
      runtime: command.runtimeFence,
      state: command.action === 'set-layer-visibility' ? sampledReadyState : readyState,
      profile: { mutationMs: 1, presentationMs: 1, captureMs: 0, totalMs: 2 },
      ...(command.action === 'set-layer-visibility' ? {
        frame: {
          mimeType: 'image/png',
          kind: 'thumbnail',
          width: 410,
          height: 512,
          sourceWidth: 512,
          sourceHeight: 640,
          dataUrl: 'data:image/png;base64,ZnJhbWU=',
        },
      } : {}),
    };
    const completed = await fetchJson(`${state.url}/v1/commands/${command.id}/result`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${state.token}`,
        'Content-Type': 'application/json',
        'X-Vessel-Collab-Client': browserClientId,
      },
      body: JSON.stringify(result),
    });
    assert.equal(completed.response.status, 202);
  }

  assert.equal(await exitPromise, 0, Buffer.concat(stderr).toString('utf8'));
  const prepared = JSON.parse(Buffer.concat(stdout).toString('utf8'));
  assert.equal(prepared.type, 'reference-ready');
  assert.equal(prepared.ok, true);
  assert.equal(prepared.tab, 'already-connected');
  assert.ok(prepared.elapsedMs <= prepared.maxReadyMs);
  assert.deepEqual(
    prepared.phases.map((phase) => phase.name),
    ['attach', 'project', 'reference', 'layer', 'configure', 'gate', 'hide-reference'],
  );
  assert.equal(prepared.frame.path, framePath);
  assert.equal(prepared.frame.sourceWidth, 512);
  assert.equal(prepared.frame.sourceHeight, 640);
  assert.deepEqual(prepared.reference, {
    sourceWidth: 4,
    sourceHeight: 5,
    fit: 'contain',
    transform: {
      scaleX: 128,
      scaleY: 128,
      offsetX: 0,
      offsetY: 0,
      renderWidth: 512,
      renderHeight: 640,
    },
  });
  assert.equal(await fs.readFile(framePath, 'utf8'), 'frame');
  assert.equal(commands[2].dataBase64, referenceBytes.toString('base64'));
  assert.equal(commands[2].filePath, undefined);
  assert.equal(commands[3].layerType, 'color-cycle');
  assert.equal(commands[3].name, 'Portrait paint');
  assert.deepEqual(commands[5].points[0], gate.points[0]);
  assert.equal(commands[5].capture, 'none');
  assert.equal(commands[6].layerId, 'reference-layer');
  assert.equal(commands[6].visible, false);
  assert.equal(commands[6].capture, 'final-thumbnail');
  const brushSettings = commands[4].operations.find((operation) => operation.action === 'set-brush');
  assert.deepEqual(brushSettings.settings, {
    ...readyState.availableBrushPresets[0].artworkProfile.baseSettings,
    colorCycleSpeed: readyState.availableBrushPresets[0].artworkProfile.preparation.colorCycleSpeed,
    colorCycleStampDitherPixelSize:
      readyState.availableBrushPresets[0].artworkProfile.preparation.stampDitherPixelSize,
  });
  assert.equal(brushSettings.settings.ditherAlgorithm, 'sierra-lite');
  assert.equal(brushSettings.settings.colorCycleStampDitherPixelSize, 3);
  assert.equal(brushSettings.settings.ccGradientRangeContrast, 100);
  assert.equal(brushSettings.settings.colorCycleSpeed, 0.01);
  assert.equal(brushSettings.settings.gradientBands, 64);
  assert.equal(brushSettings.settings.ccSampledSoftSeamEnabled, false);
});

test('reference preparation rejects an accidental project aspect mismatch before attaching', async (t) => {
  const session = `collab-aspect-${crypto.randomUUID().slice(0, 8)}`;
  const statePath = path.join(os.tmpdir(), `vessel-collab-${session}.json`);
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vessel-collab-aspect-'));
  const referencePath = path.join(artifactDir, 'reference.png');
  const gatePath = path.join(artifactDir, 'gate.json');
  const referenceBytes = await sharp({
    create: {
      width: 4,
      height: 5,
      channels: 4,
      background: { r: 120, g: 80, b: 60, alpha: 1 },
    },
  }).png().toBuffer();
  await fs.writeFile(referencePath, referenceBytes);
  await fs.writeFile(gatePath, JSON.stringify({
    action: 'shape',
    points: [{ x: 1, y: 1 }, { x: 20, y: 1 }, { x: 20, y: 20 }],
    direction: [{ x: 2, y: 2 }, { x: 18, y: 18 }],
  }));
  await fs.writeFile(statePath, JSON.stringify({
    url: 'http://127.0.0.1:1',
    token: 'unused-test-token',
  }));
  t.after(async () => {
    await fs.rm(artifactDir, { recursive: true, force: true });
    await fs.rm(statePath, { force: true });
  });

  const preparation = spawn(process.execPath, [
    SCRIPT_PATH,
    'prepare-reference',
    '--session', session,
    '--skip-attach',
    '--file', referencePath,
    '--gate-file', gatePath,
    '--width', '512',
    '--height', '512',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const stderr = [];
  preparation.stderr.on('data', (chunk) => stderr.push(chunk));
  const exitCode = await new Promise((resolve) => preparation.once('exit', resolve));

  assert.equal(exitCode, 1);
  assert.match(
    Buffer.concat(stderr).toString('utf8'),
    /Reference aspect requires 512 x 640/,
  );
});
