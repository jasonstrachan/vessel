#!/usr/bin/env node

import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const DEFAULT_PORT = 4317;
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_PROJECT_FILE_BYTES = 18 * 1024 * 1024;
const MAX_RETAINED_COMMANDS = 32;
const COMMAND_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

const parseArgs = (argv) => {
  const positional = [];
  const flags = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    const name = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      flags.set(name, true);
      continue;
    }
    flags.set(name, next);
    index += 1;
  }
  return { positional, flags };
};

const requireSafeSession = (value) => {
  const session = value || 'default';
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(session)) {
    throw new Error('Session must use 1-64 letters, numbers, dashes, or underscores');
  }
  return session;
};

const requireSafeRequestId = (value) => {
  const requestId = String(value ?? crypto.randomUUID());
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error('Request ID must use 1-128 letters, numbers, dots, colons, dashes, or underscores');
  }
  return requestId;
};

const getStatePath = (session) =>
  path.join(os.tmpdir(), `vessel-collab-${session}.json`);

const readJsonBody = (request) => new Promise((resolve, reject) => {
  const chunks = [];
  let bytes = 0;
  request.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      reject(new Error('Request body exceeds 32 MB'));
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on('end', () => {
    try {
      resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch {
      reject(new Error('Request body must be valid JSON'));
    }
  });
  request.on('error', reject);
});

const writeJson = (response, status, value, origin) => {
  const body = value === undefined ? '' : JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
  });
  response.end(body);
};

const allowedOrigin = (origin) => {
  if (!origin) return undefined;
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin) ? origin : undefined;
};

const tokenMatches = (request, expectedToken) => {
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expectedToken);
  return suppliedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
};

const serve = async ({ flags }) => {
  const session = requireSafeSession(flags.get('session'));
  const port = Number(flags.get('port') ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Port must be an integer between 1024 and 65535');
  }

  const token = crypto.randomBytes(24).toString('hex');
  const queue = [];
  const commandRecords = new Map();
  const commandIdsByRequestId = new Map();
  const completedCommandIds = [];
  const waiters = [];

  const pruneCompletedCommands = () => {
    while (completedCommandIds.length > MAX_RETAINED_COMMANDS) {
      const id = completedCommandIds.shift();
      const record = commandRecords.get(id);
      if (!record || record.result === undefined) continue;
      commandRecords.delete(id);
      if (record.requestId) commandIdsByRequestId.delete(record.requestId);
    }
  };

  const deliver = () => {
    while (queue.length > 0 && waiters.length > 0) {
      const command = queue.shift();
      const waiter = waiters.shift();
      clearTimeout(waiter.timeout);
      writeJson(waiter.response, 200, command, waiter.origin);
    }
  };

  const server = http.createServer(async (request, response) => {
    const origin = allowedOrigin(request.headers.origin);
    if (request.headers.origin && !origin) {
      writeJson(response, 403, { error: 'Origin is not allowed' });
      return;
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Max-Age': '600',
      });
      response.end();
      return;
    }
    if (!tokenMatches(request, token)) {
      writeJson(response, 401, { error: 'Unauthorized' }, origin);
      return;
    }

    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    try {
      if (request.method === 'GET' && url.pathname === '/v1/health') {
        writeJson(response, 200, { ok: true, session, queued: queue.length }, origin);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/commands') {
        const body = await readJsonBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw new Error('Command must be a JSON object');
        }
        const requestId = requireSafeRequestId(request.headers['idempotency-key']);
        const commandSignature = JSON.stringify(body);
        const existingId = commandIdsByRequestId.get(requestId);
        if (existingId) {
          const existingRecord = commandRecords.get(existingId);
          if (existingRecord?.commandSignature !== commandSignature) {
            throw new Error('Request ID was already used for a different command');
          }
          writeJson(response, 202, { id: existingId, requestId, reused: true }, origin);
          return;
        }
        const id = crypto.randomUUID();
        commandRecords.set(id, { requestId, commandSignature, result: undefined });
        commandIdsByRequestId.set(requestId, id);
        queue.push({ ...body, id });
        deliver();
        writeJson(response, 202, { id, requestId, reused: false }, origin);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/commands/next') {
        const command = queue.shift();
        if (command) {
          writeJson(response, 200, command, origin);
          return;
        }
        const requestedWait = Number(url.searchParams.get('wait') ?? 25000);
        const wait = Math.min(30000, Math.max(0, Number.isFinite(requestedWait) ? requestedWait : 25000));
        const waiter = { response, origin, timeout: undefined };
        waiter.timeout = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          writeJson(response, 204, undefined, origin);
        }, wait);
        waiters.push(waiter);
        request.on('close', () => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) {
            waiters.splice(index, 1);
            clearTimeout(waiter.timeout);
          }
        });
        return;
      }

      const resultMatch = /^\/v1\/commands\/([^/]+)\/result$/.exec(url.pathname);
      if (request.method === 'POST' && resultMatch) {
        const id = decodeURIComponent(resultMatch[1]);
        const record = commandRecords.get(id);
        if (!record) {
          writeJson(response, 404, { error: 'Command was not found' }, origin);
          return;
        }
        const body = await readJsonBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw new Error('Command result must be a JSON object');
        }
        if (body.commandId !== id) {
          throw new Error('Command result ID does not match the accepted command');
        }
        const resultSignature = JSON.stringify(body);
        if (record.result !== undefined) {
          if (record.resultSignature !== resultSignature) {
            throw new Error('Command result was already recorded with different data');
          }
          writeJson(response, 202, { ok: true, reused: true }, origin);
          return;
        }
        completedCommandIds.push(id);
        record.result = body;
        record.resultSignature = resultSignature;
        pruneCompletedCommands();
        writeJson(response, 202, { ok: true, reused: false }, origin);
        return;
      }

      const readResultMatch = /^\/v1\/results\/([^/]+)$/.exec(url.pathname);
      if (request.method === 'GET' && readResultMatch) {
        const id = decodeURIComponent(readResultMatch[1]);
        const record = commandRecords.get(id);
        if (!record) {
          writeJson(response, 404, { error: 'Command was not found' }, origin);
          return;
        }
        if (record.result === undefined) {
          writeJson(response, 202, { pending: true }, origin);
          return;
        }
        writeJson(response, 200, record.result, origin);
        return;
      }

      writeJson(response, 404, { error: 'Not found' }, origin);
    } catch (error) {
      writeJson(response, 400, {
        error: error instanceof Error ? error.message : 'Request failed',
      }, origin);
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  const statePath = getStatePath(session);
  const state = {
    session,
    url: `http://127.0.0.1:${port}`,
    token,
    pid: process.pid,
  };
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });

  const vesselUrl = new URL(String(flags.get('vessel-url') ?? 'http://127.0.0.1:3001/vessel/'));
  vesselUrl.hash = new URLSearchParams({
    vesselCollabUrl: state.url,
    vesselCollabToken: token,
  }).toString();
  if (flags.has('quiet')) {
    process.stdout.write(`Vessel collaboration bridge ready: ${session}\n`);
  } else {
    process.stdout.write(`${JSON.stringify({
      session,
      url: state.url,
      pid: state.pid,
      statePath,
      openCommand: `npm run collab:open -- --session ${session}`,
    }, null, 2)}\n`);
  }

  const shutdown = async () => {
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      clearTimeout(waiter.timeout);
      writeJson(waiter.response, 503, { error: 'Bridge is shutting down' }, waiter.origin);
    }
    await new Promise((resolve) => server.close(resolve));
    await fs.unlink(statePath).catch(() => undefined);
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
};

const fetchJson = async (url, options) => {
  const response = await fetch(url, options);
  const value = await response.json();
  if (!response.ok && response.status !== 202) {
    throw new Error(value.error ?? `Request failed (${response.status})`);
  }
  return { response, value };
};

const createBridgeClient = (state) => {
  const headers = {
    Authorization: `Bearer ${state.token}`,
    'Content-Type': 'application/json',
  };

  const getResult = async (commandId) => {
    const pending = await fetchJson(`${state.url}/v1/results/${encodeURIComponent(commandId)}`, {
      headers,
    });
    return pending.response.status === 200
      ? { pending: false, result: pending.value }
      : { pending: true };
  };

  const enqueue = async (input, requestId) => {
    const command = { ...input };
    delete command.id;
    delete command.requestId;
    const safeRequestId = requireSafeRequestId(requestId);
    const queued = await fetchJson(`${state.url}/v1/commands`, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': safeRequestId },
      body: JSON.stringify(command),
    });
    return {
      commandId: queued.value.id,
      requestId: safeRequestId,
      reused: Boolean(queued.value.reused),
    };
  };

  const waitForResult = async (commandId, timeoutMs = 120000) => {
    const timeoutAt = Date.now() + timeoutMs;
    while (Date.now() < timeoutAt) {
      const pending = await getResult(commandId);
      if (!pending.pending) return pending.result;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const error = new Error(`Timed out waiting for Vessel command ${commandId}; result status is unknown`);
    error.commandId = commandId;
    throw error;
  };

  return {
    headers,
    enqueue,
    getResult,
    waitForResult,
    send: async (input, { timeoutMs = 120000, requestId, onAccepted } = {}) => {
      const accepted = await enqueue(input, requestId ?? input.requestId);
      onAccepted?.(accepted);
      const result = await waitForResult(accepted.commandId, timeoutMs);
      return { accepted, result };
    },
  };
};

const decodePngDataUrl = (dataUrl) => {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('Vessel returned an invalid PNG frame');
  return Buffer.from(match[1], 'base64');
};

const withIndexedFramePath = (framePath, suffix) => {
  const extension = path.extname(framePath) || '.png';
  const base = extension === framePath ? framePath : framePath.slice(0, -extension.length);
  return `${base}-${suffix}${extension}`;
};

const materializeFrames = async (result, { session, framePath, frameDir }) => {
  const defaultFramePath = path.join(os.tmpdir(), `vessel-collab-${session}-latest.png`);
  if (result.frame?.dataUrl) {
    const outputPath = path.resolve(String(framePath ?? defaultFramePath));
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, decodePngDataUrl(result.frame.dataUrl));
    result.frame = { ...result.frame, dataUrl: undefined, path: outputPath };
  }

  if (Array.isArray(result.frames)) {
    const outputDirectory = path.resolve(String(frameDir ?? os.tmpdir()));
    await fs.mkdir(outputDirectory, { recursive: true });
    for (const captured of result.frames) {
      if (!captured.frame?.dataUrl) continue;
      const outputPath = framePath
        ? withIndexedFramePath(path.resolve(String(framePath)), `operation-${captured.operationIndex}`)
        : path.join(
            outputDirectory,
            `vessel-collab-${session}-revision-${captured.revision}-operation-${captured.operationIndex}.png`,
          );
      await fs.writeFile(outputPath, decodePngDataUrl(captured.frame.dataUrl));
      captured.frame = { ...captured.frame, dataUrl: undefined, path: outputPath };
    }
  }
  return result;
};

const compactResultState = (state) => state ? {
  project: state.project,
  activeLayerId: state.activeLayerId,
  currentTool: state.currentTool,
  currentBrushPresetId: state.currentBrushPresetId,
  currentBrushCapabilities: state.currentBrushCapabilities,
  availableBrushPresets: state.availableBrushPresets,
  palette: state.palette,
  gradient: state.gradient,
  brush: state.brush,
  eraser: state.eraser,
  layers: state.layers,
} : undefined;

const compactCollaborationResult = (result, { resultPath } = {}) => ({
  type: 'completed',
  ok: result.ok,
  commandId: result.commandId,
  action: result.action,
  revision: result.revision,
  completedOperations: result.completedOperations,
  timedOut: result.timedOut,
  state: result.action === 'observe' ||
    result.action === 'open-project' ||
    result.action === 'create-layer' ||
    result.action === 'batch'
    ? compactResultState(result.state)
    : undefined,
  frame: result.frame ? {
    kind: result.frame.kind,
    width: result.frame.width,
    height: result.frame.height,
    path: result.frame.path,
  } : undefined,
  frames: Array.isArray(result.frames) ? result.frames.map((captured) => ({
    operationIndex: captured.operationIndex,
    revision: captured.revision,
    checkpointName: captured.checkpointName,
    kind: captured.frame.kind,
    width: captured.frame.width,
    height: captured.frame.height,
    path: captured.frame.path,
  })) : undefined,
  profile: result.profile ? {
    mutationMs: result.profile.mutationMs,
    presentationMs: result.profile.presentationMs,
    captureMs: result.profile.captureMs,
    totalMs: result.profile.totalMs,
  } : undefined,
  error: result.error,
  resultPath,
});

const writeResultArtifact = async (result, { session, resultDir }) => {
  if (!COMMAND_ID_PATTERN.test(String(result.commandId ?? ''))) {
    throw new Error('Vessel returned an invalid command ID');
  }
  const outputDirectory = path.resolve(String(
    resultDir ?? path.join(os.tmpdir(), `vessel-collab-${session}-results`),
  ));
  await fs.mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, `${result.commandId}.json`);
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  return outputPath;
};

const enableRawPersistentInput = (input) => {
  if (!input.isTTY || typeof input.setRawMode !== 'function') return () => undefined;
  const wasRaw = Boolean(input.isRaw);
  input.setRawMode(true);
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    input.off('data', handleInterrupt);
    input.setRawMode(wasRaw);
  };
  const handleInterrupt = (chunk) => {
    if (!Buffer.from(chunk).includes(3)) return;
    restore();
    process.kill(process.pid, 'SIGINT');
  };
  input.on('data', handleInterrupt);
  return restore;
};

const applyCaptureFlags = (command, flags) => {
  if (flags.has('capture')) {
    command.capture = String(flags.get('capture'));
  }
  if (flags.has('thumbnail-size')) {
    command.thumbnailMaxSize = Number(flags.get('thumbnail-size'));
  }
  return command;
};

const buildCommand = async ({ positional, flags }) => {
  const action = positional[1];
  let command;
  if (action === 'open-project') {
    const fileFlag = flags.get('file');
    if (typeof fileFlag !== 'string' || fileFlag.trim().length === 0) {
      throw new Error('open-project requires --file /path/to/project.vs');
    }
    const filePath = path.resolve(fileFlag);
    if (path.extname(filePath).toLowerCase() !== '.vs') {
      throw new Error('open-project currently accepts .vs files only');
    }
    const fileBytes = await fs.readFile(filePath);
    if (fileBytes.byteLength > MAX_PROJECT_FILE_BYTES) {
      throw new Error('Project exceeds the current 18 MB bridge file limit');
    }
    command = {
      action,
      fileName: path.basename(filePath),
      dataBase64: fileBytes.toString('base64'),
    };
  } else if (flags.has('json')) {
    command = JSON.parse(String(flags.get('json')));
  } else if (action) {
    const data = flags.has('data') ? JSON.parse(String(flags.get('data'))) : {};
    command = { ...data, action };
  } else {
    throw new Error('Call requires an action or --json command');
  }
  return applyCaptureFlags(command, flags);
};

const call = async ({ positional, flags }) => {
  const session = requireSafeSession(flags.get('session'));
  const state = JSON.parse(await fs.readFile(getStatePath(session), 'utf8'));
  const command = await buildCommand({ positional, flags });
  const client = createBridgeClient(state);
  const { result } = await client.send(command, {
    timeoutMs: Number(flags.get('timeout') ?? 120000),
    requestId: flags.get('request-id'),
  });
  await materializeFrames(result, {
    session,
    framePath: flags.get('frame'),
    frameDir: flags.get('frame-dir'),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
};

const persistentClient = async ({ flags }) => {
  const session = requireSafeSession(flags.get('session'));
  const state = JSON.parse(await fs.readFile(getStatePath(session), 'utf8'));
  const client = createBridgeClient(state);
  const restoreInput = enableRawPersistentInput(process.stdin);
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const exitForSignal = (exitCode) => {
    restoreInput();
    process.exit(exitCode);
  };
  const handleSigint = () => exitForSignal(130);
  const handleSigterm = () => exitForSignal(143);
  process.once('SIGINT', handleSigint);
  process.once('SIGTERM', handleSigterm);
  let lastRevision = 0;

  try {
    for await (const line of input) {
      if (line.trim().length === 0) continue;
      let requestId;
      try {
        const command = JSON.parse(line);
        if (!command || typeof command !== 'object' || Array.isArray(command)) {
          throw new Error('Client input must be one JSON command per line');
        }
        if (command.action === 'get-result') {
          const commandId = String(command.commandId ?? '');
          if (!COMMAND_ID_PATTERN.test(commandId)) {
            throw new Error('get-result requires a Vessel command UUID');
          }
          const recovered = await client.getResult(commandId);
          if (recovered.pending) {
            process.stdout.write(`${JSON.stringify({
              type: 'pending',
              commandId: command.commandId,
            })}\n`);
            continue;
          }
          const result = recovered.result;
          if (typeof result.revision === 'number') lastRevision = result.revision;
          await materializeFrames(result, {
            session,
            frameDir: flags.get('frame-dir'),
          });
          const resultPath = await writeResultArtifact(result, {
            session,
            resultDir: flags.get('result-dir'),
          });
          process.stdout.write(`${JSON.stringify(compactCollaborationResult(result, { resultPath }))}\n`);
          continue;
        }
        if (command.action === 'wait-for-frame' && command.afterRevision === undefined) {
          command.afterRevision = lastRevision;
        }
        requestId = requireSafeRequestId(command.requestId);
        applyCaptureFlags(command, flags);
        const { result } = await client.send(command, {
          timeoutMs: Number(flags.get('timeout') ?? 120000),
          requestId,
          onAccepted: (accepted) => {
            process.stdout.write(`${JSON.stringify({ type: 'accepted', ...accepted })}\n`);
          },
        });
        if (typeof result.revision === 'number') lastRevision = result.revision;
        await materializeFrames(result, {
          session,
          frameDir: flags.get('frame-dir'),
        });
        const resultPath = await writeResultArtifact(result, {
          session,
          resultDir: flags.get('result-dir'),
        });
        process.stdout.write(`${JSON.stringify(compactCollaborationResult(result, { resultPath }))}\n`);
      } catch (error) {
        process.stdout.write(`${JSON.stringify({
          type: 'unknown',
          ok: false,
          requestId,
          commandId: error?.commandId,
          error: error instanceof Error ? error.message : String(error),
          recovery: error?.commandId
            ? { action: 'get-result', commandId: error.commandId }
            : undefined,
        })}\n`);
      }
    }
  } finally {
    process.off('SIGINT', handleSigint);
    process.off('SIGTERM', handleSigterm);
    restoreInput();
  }
};

const readResult = async ({ flags }) => {
  const session = requireSafeSession(flags.get('session'));
  const commandId = String(flags.get('id') ?? '');
  if (!COMMAND_ID_PATTERN.test(commandId)) {
    throw new Error('Result requires --id with a Vessel command UUID');
  }
  const state = JSON.parse(await fs.readFile(getStatePath(session), 'utf8'));
  const client = createBridgeClient(state);
  const recovered = await client.getResult(commandId);
  if (recovered.pending) {
    process.stdout.write(`${JSON.stringify({ type: 'pending', commandId }, null, 2)}\n`);
    return;
  }
  const result = recovered.result;
  await materializeFrames(result, {
    session,
    framePath: flags.get('frame'),
    frameDir: flags.get('frame-dir'),
  });
  const resultPath = await writeResultArtifact(result, {
    session,
    resultDir: flags.get('result-dir'),
  });
  process.stdout.write(`${JSON.stringify(compactCollaborationResult(result, { resultPath }), null, 2)}\n`);
};

const status = async ({ flags }) => {
  const session = requireSafeSession(flags.get('session'));
  const state = JSON.parse(await fs.readFile(getStatePath(session), 'utf8'));
  const headers = { Authorization: `Bearer ${state.token}` };
  const health = await fetchJson(`${state.url}/v1/health`, { headers });
  process.stdout.write(`${JSON.stringify({ ...health.value, session, url: state.url, pid: state.pid }, null, 2)}\n`);
};

const openVessel = async ({ flags }) => {
  if (process.platform !== 'darwin') {
    throw new Error('collab:open currently requires macOS');
  }
  const session = requireSafeSession(flags.get('session'));
  const state = JSON.parse(await fs.readFile(getStatePath(session), 'utf8'));
  const vesselUrl = new URL(String(flags.get('vessel-url') ?? 'http://127.0.0.1:3001/vessel/'));
  vesselUrl.hash = new URLSearchParams({
    vesselCollabUrl: state.url,
    vesselCollabToken: state.token,
  }).toString();
  const child = spawn('open', ['-g', '-a', 'Google Chrome', vesselUrl.toString()], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  process.stdout.write(`Opened Vessel collaboration session in the background: ${session}\n`);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const operation = args.positional[0];
  if (operation === 'serve') return serve(args);
  if (operation === 'call') return call(args);
  if (operation === 'client') return persistentClient(args);
  if (operation === 'result') return readResult(args);
  if (operation === 'status') return status(args);
  if (operation === 'open') return openVessel(args);
  throw new Error('Usage: vessel-collab.mjs <serve|call|client|result|status|open> [options]');
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
