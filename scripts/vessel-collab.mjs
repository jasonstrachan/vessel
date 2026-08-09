#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import {
  appendVesselCollaborationJournal,
  readVesselCollaborationJournal,
} from './vessel-collab-journal.mjs';
import {
  compactVesselCollaborationResult as compactCollaborationResult,
  compactVesselCollaborationState as compactResultState,
  materializeVesselCollaborationEventFrame as materializeEventFrame,
  materializeVesselCollaborationFrames as materializeFrames,
  writeVesselCollaborationResultArtifact as writeResultArtifact,
} from './vessel-collab-artifacts.mjs';
import {
  createVesselCollaborationBridgeClient as createBridgeClient,
  fetchVesselCollaborationJson as fetchJson,
} from './vessel-collab-client.mjs';

const DEFAULT_PORT = 4317;
const DEFAULT_COMMAND_TIMEOUT_MS = 120000;
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_PROJECT_FILE_BYTES = 18 * 1024 * 1024;
const MAX_REFERENCE_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_RETAINED_COMMANDS = 32;
const MAX_RETAINED_COMMAND_EVENTS = 512;
const MAX_ARTWORK_JOB_OPERATIONS = 2000;
const MAX_ARTWORK_JOB_POINTS = 250000;
const COMMAND_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const CLIENT_ID_HEADER = 'x-vessel-collab-client';
const VESSEL_COLLABORATION_PROTOCOL_VERSION = 2;
const VESSEL_COLLABORATION_STATE_SCHEMA_VERSION = 1;
const PAIRING_TTL_MS = 60_000;

const runtimeMatchesFence = (runtime, fence) => Boolean(
  runtime && fence &&
  runtime.protocolVersion === fence.protocolVersion &&
  runtime.runtimeBuildId === fence.runtimeBuildId &&
  runtime.runtimeInstanceId === fence.runtimeInstanceId &&
  runtime.leaseEpoch === fence.leaseEpoch
);

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

const readSessionState = async (session) => {
  const state = JSON.parse(await fs.readFile(getStatePath(session), 'utf8'));
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('Vessel collaboration state is invalid');
  }
  let url;
  try {
    url = requireLocalVesselUrl(state.url);
  } catch {
    throw new Error('Vessel collaboration state is missing a valid bridge URL');
  }
  if (typeof state.token !== 'string' || state.token.length === 0) {
    throw new Error('Vessel collaboration state is missing its bridge credential');
  }
  return { ...state, url: url.origin };
};

const requireIntegerFlag = (flags, name, { minimum = 1, maximum = 8192 } = {}) => {
  const value = Number(flags.get(name));
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`--${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
};

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

const requireLocalVesselUrl = (value) => {
  const target = new URL(String(value));
  if (
    target.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(target.hostname) ||
    target.username ||
    target.password
  ) {
    throw new Error('Pairing target must be an HTTP localhost Vessel URL');
  }
  return target;
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
  const recoveredJournal = await readVesselCollaborationJournal(session);
  const recoveredCommandsByRequestId = new Map(
    recoveredJournal.commands
      .filter((command) => command.requestId)
      .map((command) => [command.requestId, command]),
  );

  const token = crypto.randomBytes(24).toString('hex');
  const queue = [];
  const commandRecords = new Map();
  const commandIdsByRequestId = new Map();
  const completedCommandIds = [];
  const waiters = [];
  const pairings = new Map();
  let activeClient = null;
  let nextLeaseEpoch = 1;
  let delivering = false;

  const pruneCompletedCommands = () => {
    while (completedCommandIds.length > MAX_RETAINED_COMMANDS) {
      const id = completedCommandIds.shift();
      const record = commandRecords.get(id);
      if (!record || record.result === undefined) continue;
      commandRecords.delete(id);
      if (record.requestId) commandIdsByRequestId.delete(record.requestId);
    }
  };

  const deliver = async () => {
    if (delivering) return;
    delivering = true;
    try {
      while (queue.length > 0 && waiters.length > 0) {
        const command = queue.shift();
        const waiter = waiters.shift();
        clearTimeout(waiter.timeout);
        try {
          await appendVesselCollaborationJournal(session, {
            type: 'delivered',
            commandId: command.id,
          });
        } catch (error) {
          queue.unshift(command);
          if (!waiter.response.writableEnded && !waiter.response.destroyed) {
            writeJson(waiter.response, 503, { error: 'Command delivery journal failed' }, waiter.origin);
          }
          throw error;
        }
        const record = commandRecords.get(command.id);
        if (record) record.deliveryClientId = waiter.clientId;
        writeJson(waiter.response, 200, command, waiter.origin);
      }
    } finally {
      delivering = false;
    }
  };

  const readClientId = (request) => {
    const value = request.headers[CLIENT_ID_HEADER];
    return typeof value === 'string' && REQUEST_ID_PATTERN.test(value) ? value : null;
  };

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    const origin = allowedOrigin(request.headers.origin);
    if (request.headers.origin && !origin) {
      writeJson(response, 403, { error: 'Origin is not allowed' });
      return;
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Vessel-Collab-Client',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Max-Age': '600',
      });
      response.end();
      return;
    }
    const pairingMatch = /^\/connect\/([0-9a-f]+)$/.exec(url.pathname);
    if (request.method === 'GET' && pairingMatch) {
      const nonce = pairingMatch[1];
      const pairing = pairings.get(nonce);
      pairings.delete(nonce);
      if (!pairing || pairing.expiresAt < Date.now()) {
        writeJson(response, 410, { error: 'Pairing URL is expired or already used' }, origin);
        return;
      }
      const target = new URL(pairing.targetUrl);
      const fragment = new URLSearchParams(target.hash.slice(1));
      fragment.set('vesselCollabUrl', `http://127.0.0.1:${port}`);
      fragment.set('vesselCollabToken', token);
      if (pairing.clientId) fragment.set('vesselCollabClient', pairing.clientId);
      target.hash = fragment.toString();
      response.writeHead(302, {
        Location: target.toString(),
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      });
      response.end();
      return;
    }
    if (!tokenMatches(request, token)) {
      writeJson(response, 401, { error: 'Unauthorized' }, origin);
      return;
    }

    try {
      if (request.method === 'POST' && url.pathname === '/v1/pairings') {
        const body = await readJsonBody(request);
        const target = requireLocalVesselUrl(body?.targetUrl ?? 'http://localhost:3001/');
        const clientId = body?.clientId === undefined
          ? undefined
          : requireSafeRequestId(body.clientId);
        for (const [nonce, pairing] of pairings) {
          if (pairing.expiresAt < Date.now()) pairings.delete(nonce);
        }
        const nonce = crypto.randomBytes(18).toString('hex');
        pairings.set(nonce, {
          targetUrl: target.toString(),
          clientId,
          expiresAt: Date.now() + PAIRING_TTL_MS,
        });
        writeJson(response, 201, {
          url: `http://127.0.0.1:${port}/connect/${nonce}`,
          expiresInMs: PAIRING_TTL_MS,
        }, origin);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/health') {
        const journal = await readVesselCollaborationJournal(session);
        writeJson(response, 200, {
          ok: true,
          session,
          queued: queue.length,
          clientReady: activeClient !== null,
          activeRuntime: activeClient ? {
            protocolVersion: activeClient.protocolVersion,
            runtimeBuildId: activeClient.runtimeBuildId,
            runtimeInstanceId: activeClient.runtimeInstanceId,
            leaseEpoch: activeClient.leaseEpoch,
          } : null,
          recovery: journal.commands,
        }, origin);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/clients/claim') {
        const clientId = readClientId(request);
        if (!clientId) {
          writeJson(response, 400, { error: 'A valid collaboration client ID is required' }, origin);
          return;
        }
        const body = await readJsonBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
            body.protocolVersion !== VESSEL_COLLABORATION_PROTOCOL_VERSION ||
            typeof body.runtimeBuildId !== 'string' || !body.runtimeBuildId ||
            typeof body.runtimeInstanceId !== 'string' || !body.runtimeInstanceId) {
          writeJson(response, 409, { error: 'Collaboration runtime is incompatible' }, origin);
          return;
        }
        const changesRuntime = !activeClient ||
          activeClient.clientId !== clientId ||
          activeClient.runtimeBuildId !== body.runtimeBuildId ||
          activeClient.runtimeInstanceId !== body.runtimeInstanceId;
        const hasUnfinishedCommand = [...commandRecords.values()].some((record) => (
          record.result === undefined
        ));
        if (activeClient && changesRuntime && hasUnfinishedCommand) {
          writeJson(response, 409, {
            error: 'Previous collaboration runtime has unfinished commands',
          }, origin);
          return;
        }
        if (changesRuntime) {
          activeClient = {
            clientId,
            protocolVersion: body.protocolVersion,
            runtimeBuildId: body.runtimeBuildId,
            runtimeInstanceId: body.runtimeInstanceId,
            leaseEpoch: nextLeaseEpoch++,
          };
          await appendVesselCollaborationJournal(session, {
            type: 'lease-claimed',
            runtimeBuildId: activeClient.runtimeBuildId,
            runtimeInstanceId: activeClient.runtimeInstanceId,
            leaseEpoch: activeClient.leaseEpoch,
          });
          for (let index = waiters.length - 1; index >= 0; index -= 1) {
            const waiter = waiters[index];
            if (waiter.clientId === clientId) continue;
            waiters.splice(index, 1);
            clearTimeout(waiter.timeout);
            writeJson(waiter.response, 409, { error: 'Collaboration client was superseded' }, waiter.origin);
          }
        }
        writeJson(response, 200, { ok: true, leaseEpoch: activeClient.leaseEpoch }, origin);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/clients/active') {
        const clientId = readClientId(request);
        writeJson(response, 200, {
          ready: Boolean(activeClient && (!clientId || clientId === activeClient.clientId)),
          runtime: activeClient ? {
            protocolVersion: activeClient.protocolVersion,
            runtimeBuildId: activeClient.runtimeBuildId,
            runtimeInstanceId: activeClient.runtimeInstanceId,
            leaseEpoch: activeClient.leaseEpoch,
          } : null,
        }, origin);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/commands') {
        const body = await readJsonBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw new Error('Command must be a JSON object');
        }
        preflightArtworkJob(body);
        if (!activeClient) {
          throw new Error('No compatible Vessel runtime has claimed this bridge');
        }
        const requestedFence = body.runtimeFence && typeof body.runtimeFence === 'object' &&
          !Array.isArray(body.runtimeFence) ? body.runtimeFence : {};
        body.runtimeFence = {
          protocolVersion: activeClient.protocolVersion,
          runtimeBuildId: activeClient.runtimeBuildId,
          runtimeInstanceId: activeClient.runtimeInstanceId,
          leaseEpoch: activeClient.leaseEpoch,
          ...(Object.hasOwn(requestedFence, 'expectedProjectId')
            ? { expectedProjectId: requestedFence.expectedProjectId }
            : {}),
          ...(Object.hasOwn(requestedFence, 'expectedProjectRevision')
            ? { expectedProjectRevision: requestedFence.expectedProjectRevision }
            : {}),
        };
        const requestId = requireSafeRequestId(request.headers['idempotency-key']);
        const recoveredCommand = recoveredCommandsByRequestId.get(requestId);
        if (recoveredCommand) {
          writeJson(response, 409, {
            error: 'Request ID already exists in the durable collaboration journal',
            recovery: recoveredCommand,
          }, origin);
          return;
        }
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
        await appendVesselCollaborationJournal(session, {
          type: 'accepted',
          commandId: id,
          requestId,
          action: body.action,
          runtimeFence: body.runtimeFence,
        });
        commandRecords.set(id, {
          requestId,
          commandSignature,
          result: undefined,
          events: [],
          eventSignaturesById: new Map(),
          cancelRequested: false,
          runtimeFence: body.runtimeFence,
        });
        commandIdsByRequestId.set(requestId, id);
        queue.push({ ...body, id });
        await deliver();
        writeJson(response, 202, { id, requestId, reused: false }, origin);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/commands/next') {
        const clientId = readClientId(request);
        if (activeClient && clientId !== activeClient.clientId) {
          writeJson(response, 409, { error: 'Collaboration client is not active' }, origin);
          return;
        }
        const command = queue.shift();
        if (command) {
          try {
            await appendVesselCollaborationJournal(session, {
              type: 'delivered',
              commandId: command.id,
            });
          } catch (error) {
            queue.unshift(command);
            throw error;
          }
          const record = commandRecords.get(command.id);
          if (record) record.deliveryClientId = clientId;
          writeJson(response, 200, command, origin);
          return;
        }
        const requestedWait = Number(url.searchParams.get('wait') ?? 25000);
        const wait = Math.min(30000, Math.max(0, Number.isFinite(requestedWait) ? requestedWait : 25000));
        const waiter = { response, origin, clientId, timeout: undefined };
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

      const eventMatch = /^\/v1\/commands\/([^/]+)\/events$/.exec(url.pathname);
      if (request.method === 'POST' && eventMatch) {
        const id = decodeURIComponent(eventMatch[1]);
        const record = commandRecords.get(id);
        if (!record) {
          writeJson(response, 404, { error: 'Command was not found' }, origin);
          return;
        }
        const clientId = readClientId(request);
        if (record.deliveryClientId && record.deliveryClientId !== clientId) {
          writeJson(response, 409, { error: 'Command belongs to a different collaboration client' }, origin);
          return;
        }
        const body = await readJsonBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
            body.commandId !== id || !body.event || typeof body.event !== 'object' ||
            Array.isArray(body.event)) {
          throw new Error('Command event must include its command ID and an event object');
        }
        if (!runtimeMatchesFence(body.runtime, record.runtimeFence)) {
          writeJson(response, 409, { error: 'Command event came from a stale collaboration runtime' }, origin);
          return;
        }
        const eventId = requireSafeRequestId(body.eventId);
        const eventSignature = JSON.stringify(body.event);
        const existingSignature = record.eventSignaturesById.get(eventId);
        if (existingSignature !== undefined) {
          if (existingSignature !== eventSignature) {
            throw new Error('Command event ID was already used for different data');
          }
          writeJson(response, 202, { ok: true, reused: true }, origin);
          return;
        }
        if (record.events.length >= MAX_RETAINED_COMMAND_EVENTS) {
          throw new Error('Command produced too many progress events');
        }
        await appendVesselCollaborationJournal(session, {
          type: 'progress',
          commandId: id,
          eventType: body.event.type,
          completedOperations: body.event.completedOperations,
          totalOperations: body.event.totalOperations,
          revision: body.event.revision,
          checkpointName: body.event.checkpointName,
        });
        const event = { ...body.event, commandId: id, eventId };
        record.eventSignaturesById.set(eventId, eventSignature);
        record.events.push(event);
        writeJson(response, 202, { ok: true, reused: false }, origin);
        return;
      }

      const controlMatch = /^\/v1\/commands\/([^/]+)\/control$/.exec(url.pathname);
      if (request.method === 'GET' && controlMatch) {
        const id = decodeURIComponent(controlMatch[1]);
        const record = commandRecords.get(id);
        if (!record) {
          writeJson(response, 404, { error: 'Command was not found' }, origin);
          return;
        }
        const clientId = readClientId(request);
        if (record.deliveryClientId && record.deliveryClientId !== clientId) {
          writeJson(response, 409, { error: 'Command belongs to a different collaboration client' }, origin);
          return;
        }
        writeJson(response, 200, { cancelRequested: record.cancelRequested }, origin);
        return;
      }

      const cancelMatch = /^\/v1\/commands\/([^/]+)\/cancel$/.exec(url.pathname);
      if (request.method === 'POST' && cancelMatch) {
        const id = decodeURIComponent(cancelMatch[1]);
        const record = commandRecords.get(id);
        if (!record) {
          writeJson(response, 404, { error: 'Command was not found' }, origin);
          return;
        }
        const completed = record.result !== undefined;
        if (!completed) {
          await appendVesselCollaborationJournal(session, {
            type: 'cancel-requested',
            commandId: id,
          });
          record.cancelRequested = true;
        }
        writeJson(response, 202, { ok: true, completed, cancelRequested: !completed }, origin);
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
        const clientId = readClientId(request);
        if (record.deliveryClientId && record.deliveryClientId !== clientId) {
          writeJson(response, 409, { error: 'Command belongs to a different collaboration client' }, origin);
          return;
        }
        const body = await readJsonBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw new Error('Command result must be a JSON object');
        }
        if (body.commandId !== id) {
          throw new Error('Command result ID does not match the accepted command');
        }
        if (!runtimeMatchesFence(body.runtime, record.runtimeFence)) {
          writeJson(response, 409, { error: 'Command result came from a stale collaboration runtime' }, origin);
          return;
        }
        const resultSignature = JSON.stringify(body);
        if (record.result !== undefined) {
          if (record.resultSignature !== resultSignature) {
            throw new Error('Command result was already recorded with different data');
          }
          writeJson(response, 202, { ok: true, reused: true }, origin);
          return;
        }
        await appendVesselCollaborationJournal(session, {
          type: 'completed',
          commandId: id,
          ok: body.ok,
          revision: body.revision,
          projectId: body.state?.project?.id ?? null,
          outcome: body.outcome,
        });
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

      const readEventsMatch = /^\/v1\/events\/([^/]+)$/.exec(url.pathname);
      if (request.method === 'GET' && readEventsMatch) {
        const id = decodeURIComponent(readEventsMatch[1]);
        const record = commandRecords.get(id);
        if (!record) {
          writeJson(response, 404, { error: 'Command was not found' }, origin);
          return;
        }
        const after = Number(url.searchParams.get('after') ?? 0);
        if (!Number.isInteger(after) || after < 0 || after > record.events.length) {
          throw new Error('Event cursor is invalid');
        }
        writeJson(response, 200, {
          events: record.events.slice(after),
          next: record.events.length,
        }, origin);
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
    schemaVersion: VESSEL_COLLABORATION_STATE_SCHEMA_VERSION,
    session,
    url: `http://127.0.0.1:${port}`,
    token,
    pid: process.pid,
  };
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });

  if (flags.has('quiet')) {
    process.stdout.write(`Vessel collaboration bridge ready: ${session}\n`);
  } else {
    process.stdout.write(`${JSON.stringify({
      session,
      url: state.url,
      pid: state.pid,
      statePath,
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

const resolveCommandTimeout = (command, flags) => {
  if (command.action === 'artwork-job' && !flags.has('timeout')) return null;
  const timeoutMs = Number(flags.get('timeout') ?? DEFAULT_COMMAND_TIMEOUT_MS);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60 * 60 * 1000) {
    throw new Error('--timeout must be between 1000 and 3600000 milliseconds');
  }
  return timeoutMs;
};

const referenceImageMimeType = (filePath) => {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    default:
      throw new Error('Reference image must be a PNG, JPEG, or WebP file');
  }
};

const expandLocalReferenceImage = async (command) => {
  if (command.action !== 'import-reference-image' || command.filePath === undefined) {
    return command;
  }
  const filePath = path.resolve(String(command.filePath));
  const fileBytes = await fs.readFile(filePath);
  if (fileBytes.byteLength > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error('Reference image exceeds the current 12 MB bridge file limit');
  }
  const expanded = {
    ...command,
    fileName: command.fileName ?? path.basename(filePath),
    mimeType: command.mimeType ?? referenceImageMimeType(filePath),
    dataBase64: fileBytes.toString('base64'),
  };
  delete expanded.filePath;
  return expanded;
};

const ARTWORK_JOB_ACTIONS = new Set([
  'stroke',
  'shape',
  'checkpoint',
  'set-tool',
  'set-brush-preset',
  'set-brush',
  'set-palette',
  'set-gradient-source',
  'set-gradient',
  'set-eraser',
]);

const preflightArtworkJob = (command) => {
  if (command.action !== 'artwork-job') return command;
  if (!Array.isArray(command.operations) || command.operations.length === 0) {
    throw new Error('Artwork job operations must contain at least one operation');
  }
  if (command.operations.length > MAX_ARTWORK_JOB_OPERATIONS) {
    throw new Error(
      `Artwork jobs cannot contain more than ${MAX_ARTWORK_JOB_OPERATIONS} operations`,
    );
  }
  if (command.capture === 'each-thumbnail') {
    throw new Error('Artwork jobs use named checkpoints instead of each-thumbnail capture');
  }
  if (!command.runtimeFence ||
      !Object.hasOwn(command.runtimeFence, 'expectedProjectId') ||
      !Number.isInteger(command.runtimeFence.expectedProjectRevision)) {
    throw new Error('Artwork jobs require runtimeFence.expectedProjectId and expectedProjectRevision');
  }
  const checkpointNames = new Set();
  let pointCount = 0;
  for (let index = 0; index < command.operations.length; index += 1) {
    const operation = command.operations[index];
    if (!operation || typeof operation !== 'object' || Array.isArray(operation) ||
        !ARTWORK_JOB_ACTIONS.has(operation.action)) {
      throw new Error(`Artwork job operation ${index} has an unsupported action`);
    }
    if (operation.action === 'checkpoint') {
      if (typeof operation.name !== 'string' || operation.name.trim().length === 0) {
        throw new Error(`Artwork job checkpoint ${index} requires a name`);
      }
      if (checkpointNames.has(operation.name)) {
        throw new Error('Artwork job checkpoint names must be unique');
      }
      checkpointNames.add(operation.name);
      continue;
    }
    if (operation.action !== 'stroke' && operation.action !== 'shape') continue;
    const pointGroups = [operation.points];
    if (operation.action === 'shape' && operation.direction !== undefined) {
      pointGroups.push(operation.direction);
    }
    for (const points of pointGroups) {
      if (!Array.isArray(points) || points.length === 0) {
        throw new Error(`Artwork job gesture ${index} requires points`);
      }
      for (const point of points) {
        if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
          throw new Error(`Artwork job gesture ${index} contains an invalid point`);
        }
      }
      pointCount += points.length;
    }
  }
  if (checkpointNames.size === 0) {
    throw new Error('Artwork jobs must contain at least one named checkpoint');
  }
  if (checkpointNames.size > 8) {
    throw new Error('Artwork jobs cannot contain more than 8 checkpoints');
  }
  if (pointCount > MAX_ARTWORK_JOB_POINTS) {
    throw new Error(`Artwork jobs cannot contain more than ${MAX_ARTWORK_JOB_POINTS} points`);
  }
  return command;
};

const expandArtworkJobFile = async (command) => {
  if (command.action !== 'artwork-job' || command.planFile === undefined) {
    return preflightArtworkJob(command);
  }
  const planPath = path.resolve(String(command.planFile));
  const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
  const planCommand = Array.isArray(plan)
    ? { operations: plan }
    : plan;
  if (!planCommand || typeof planCommand !== 'object' || Array.isArray(planCommand)) {
    throw new Error('Artwork job plan file must contain an object or operation array');
  }
  if (planCommand.action !== undefined && planCommand.action !== 'artwork-job') {
    throw new Error('Artwork job plan file has a conflicting action');
  }
  const expanded = {
    ...planCommand,
    ...command,
    action: 'artwork-job',
    operations: planCommand.operations,
  };
  delete expanded.planFile;
  return preflightArtworkJob(expanded);
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
  } else if (action === 'import-reference-image') {
    const fileFlag = flags.get('file');
    if (typeof fileFlag !== 'string' || fileFlag.trim().length === 0) {
      throw new Error('import-reference-image requires --file /path/to/image');
    }
    command = await expandLocalReferenceImage({
      action,
      filePath: fileFlag,
      fit: flags.has('fit') ? String(flags.get('fit')) : undefined,
    });
  } else if (action === 'artwork-job') {
    const fileFlag = flags.get('file');
    if (typeof fileFlag !== 'string' || fileFlag.trim().length === 0) {
      throw new Error('artwork-job requires --file /path/to/plan.json');
    }
    command = await expandArtworkJobFile({ action, planFile: fileFlag });
  } else if (flags.has('json')) {
    command = JSON.parse(String(flags.get('json')));
  } else if (action) {
    const data = flags.has('data') ? JSON.parse(String(flags.get('data'))) : {};
    command = { ...data, action };
  } else {
    throw new Error('Call requires an action or --json command');
  }
  return expandArtworkJobFile(applyCaptureFlags(command, flags));
};

const call = async ({ positional, flags }) => {
  const session = requireSafeSession(flags.get('session'));
  const state = await readSessionState(session);
  const command = await buildCommand({ positional, flags });
  const client = createBridgeClient(state);
  const { result } = await client.send(command, {
    timeoutMs: resolveCommandTimeout(command, flags),
    requestId: flags.get('request-id'),
    onEvent: async (event) => {
      await materializeEventFrame(event, {
        session,
        frameDir: flags.get('frame-dir'),
      });
      process.stdout.write(`${JSON.stringify(event)}\n`);
    },
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
  const state = await readSessionState(session);
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
  let lastProjectId = null;
  const preparedCommandsByRequestId = new Map();

  try {
    for await (const line of input) {
      if (line.trim().length === 0) continue;
      let requestId;
      try {
        let command = JSON.parse(line);
        if (!command || typeof command !== 'object' || Array.isArray(command)) {
          throw new Error('Client input must be one JSON command per line');
        }
        const inputSignature = JSON.stringify(command);
        const inputRequestId = command.action === 'get-result'
          ? undefined
          : requireSafeRequestId(command.requestId);
        const preparedCommand = inputRequestId
          ? preparedCommandsByRequestId.get(inputRequestId)
          : undefined;
        if (preparedCommand) {
          if (preparedCommand.inputSignature !== inputSignature) {
            throw new Error('Request ID was already used for a different client command');
          }
          command = structuredClone(preparedCommand.command);
        } else {
          command = await expandLocalReferenceImage(command);
          if (command.action === 'artwork-job' && lastProjectId && command.runtimeFence === undefined) {
            command.runtimeFence = {
              expectedProjectId: lastProjectId,
              expectedProjectRevision: lastRevision,
            };
          }
          command = await expandArtworkJobFile(command);
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
          lastProjectId = result.state?.project?.id ?? lastProjectId;
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
        if (
          command.action !== 'observe' &&
          command.action !== 'new-project' &&
          command.action !== 'open-project' &&
          !preparedCommand &&
          lastProjectId &&
          command.runtimeFence === undefined
        ) {
          command.runtimeFence = {
            expectedProjectId: lastProjectId,
            expectedProjectRevision: lastRevision,
          };
        }
        requestId = inputRequestId;
        applyCaptureFlags(command, flags);
        if (!preparedCommand) {
          preparedCommandsByRequestId.set(requestId, {
            inputSignature,
            command: structuredClone(command),
          });
        }
        const { result } = await client.send(command, {
          timeoutMs: resolveCommandTimeout(command, flags),
          requestId,
          onAccepted: (accepted) => {
            process.stdout.write(`${JSON.stringify({ type: 'accepted', ...accepted })}\n`);
          },
          onEvent: async (event) => {
            await materializeEventFrame(event, {
              session,
              frameDir: flags.get('frame-dir'),
            });
            process.stdout.write(`${JSON.stringify(event)}\n`);
          },
        });
        if (typeof result.revision === 'number') lastRevision = result.revision;
        lastProjectId = result.state?.project?.id ?? lastProjectId;
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
  const state = await readSessionState(session);
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

const cancelCommand = async ({ flags }) => {
  const session = requireSafeSession(flags.get('session'));
  const commandId = String(flags.get('id') ?? '');
  const state = await readSessionState(session);
  const client = createBridgeClient(state);
  const result = await client.cancel(commandId);
  process.stdout.write(`${JSON.stringify({ commandId, ...result }, null, 2)}\n`);
};

const waitForBridgeClient = async ({ state, deadline }) => {
  const headers = {
    Authorization: `Bearer ${state.token}`,
  };
  while (Date.now() < deadline) {
    try {
      const active = await fetchJson(`${state.url}/v1/clients/active`, { headers });
      if (active.value.ready === true) return;
    } catch {
      // The newly navigated page may still be loading or claiming the bridge.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('The reused Vessel tab did not claim the collaboration session before the deadline');
};

const readReferenceGate = async ({ gatePath, width, height }) => {
  if (!gatePath) throw new Error('prepare-reference requires --gate-file /path/to/gate.json');
  const gate = JSON.parse(await fs.readFile(path.resolve(String(gatePath)), 'utf8'));
  if (!gate || typeof gate !== 'object' || Array.isArray(gate) || gate.action !== 'shape') {
    throw new Error('Reference gate must be one shape operation');
  }
  if (!Array.isArray(gate.points) || gate.points.length < 3) {
    throw new Error('Reference gate shape requires at least three points');
  }
  const firstPoint = gate.points[0];
  if (!Number.isFinite(firstPoint?.x) || !Number.isFinite(firstPoint?.y) ||
      firstPoint.x < 0 || firstPoint.x >= width || firstPoint.y < 0 || firstPoint.y >= height) {
    throw new Error('Reference gate shape must start inside the project canvas');
  }
  if (!Array.isArray(gate.direction) || gate.direction.length < 2) {
    throw new Error('Reference gate shape requires a two-point sample direction');
  }
  return gate;
};

const readReferenceGeometry = async ({ referencePath, flags }) => {
  const width = requireIntegerFlag(flags, 'width');
  const sharp = (await import('sharp')).default;
  const metadata = await sharp(referencePath).metadata();
  const sourceWidth = metadata.width;
  const sourceHeight = metadata.height;
  if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) ||
      sourceWidth < 1 || sourceHeight < 1) {
    throw new Error('Reference image dimensions could not be decoded');
  }
  const referenceAspectHeight = Math.max(1, Math.round(width * sourceHeight / sourceWidth));
  const height = flags.has('height')
    ? requireIntegerFlag(flags, 'height')
    : referenceAspectHeight;
  if (!flags.has('allow-aspect-mismatch') && Math.abs(height - referenceAspectHeight) > 1) {
    throw new Error(
      `Reference aspect requires ${width} x ${referenceAspectHeight}; ` +
      'pass --allow-aspect-mismatch only for an intentional non-reference canvas',
    );
  }
  return { width, height, sourceWidth, sourceHeight };
};

const buildReferenceTransform = ({
  sourceWidth,
  sourceHeight,
  width,
  height,
  fit,
}) => {
  if (fit === 'stretch') {
    return {
      scaleX: width / sourceWidth,
      scaleY: height / sourceHeight,
      offsetX: 0,
      offsetY: 0,
      renderWidth: width,
      renderHeight: height,
    };
  }
  const scale = fit === 'cover'
    ? Math.max(width / sourceWidth, height / sourceHeight)
    : Math.min(width / sourceWidth, height / sourceHeight);
  const renderWidth = sourceWidth * scale;
  const renderHeight = sourceHeight * scale;
  return {
    scaleX: scale,
    scaleY: scale,
    offsetX: (width - renderWidth) / 2,
    offsetY: (height - renderHeight) / 2,
    renderWidth,
    renderHeight,
  };
};

const assertReferenceReadyState = ({
  state,
  width,
  height,
  activeLayerId,
  referenceLayerId,
}) => {
  if (state?.project?.width !== width || state?.project?.height !== height) {
    throw new Error('Prepared project dimensions do not match the requested reference canvas');
  }
  const activeLayer = state.layers?.find((layer) => layer.id === activeLayerId);
  const referenceLayer = state.layers?.find((layer) => layer.id === referenceLayerId);
  if (state.activeLayerId !== activeLayerId || activeLayer?.type !== 'color-cycle' ||
      !activeLayer.visible || activeLayer.locked) {
    throw new Error('Prepared painting layer is not the active visible unlocked Color Cycle layer');
  }
  if (!referenceLayer || referenceLayer.type !== 'normal' || referenceLayer.visible) {
    throw new Error('Prepared reference layer must be a hidden normal layer');
  }
  const colorCycle = state.colorCycle;
  if (!state.preferReferenceSampling || state.gradient?.source !== 'sampled' ||
      !colorCycle?.hasContent || colorCycle.sampledGradientDefinitionCount < 1 ||
      colorCycle.sampledPaintedPixelCount < 1 ||
      colorCycle.latestSampledGradient?.stopCount < 2 ||
      colorCycle.latestSampledGradient?.uniqueColorCount < 2) {
    throw new Error('Sampled gate did not commit canonical reference-sampled Color Cycle paint');
  }
  if (state.currentBrushPresetId !== 'color-cycle-flat-dither' ||
      state.brush?.ditherAlgorithm !== 'sierra-lite' ||
      state.brush?.ditherPaletteSpread !== 100 ||
      state.brush?.fillResolution !== 3) {
    throw new Error('Prepared brush state does not match the reference collaboration contract');
  }
};

const prepareReference = async ({ flags }) => {
  const startedAt = performance.now();
  const session = requireSafeSession(flags.get('session'));
  const state = await readSessionState(session);
  const maxReadyMs = flags.has('max-ready-ms')
    ? requireIntegerFlag(flags, 'max-ready-ms', { minimum: 1000, maximum: 120000 })
    : 60000;
  const referencePath = flags.get('file');
  if (typeof referencePath !== 'string' || referencePath.trim().length === 0) {
    throw new Error('prepare-reference requires --file /path/to/reference-image');
  }
  const referenceGeometry = await readReferenceGeometry({
    referencePath: path.resolve(referencePath),
    flags,
  });
  const { width, height, sourceWidth, sourceHeight } = referenceGeometry;
  const gate = await readReferenceGate({
    gatePath: flags.get('gate-file'),
    width,
    height,
  });
  const fit = String(flags.get('fit') ?? 'contain');
  if (!['contain', 'cover', 'stretch'].includes(fit)) {
    throw new Error('--fit must be contain, cover, or stretch');
  }
  const referenceTransform = buildReferenceTransform({
    sourceWidth,
    sourceHeight,
    width,
    height,
    fit,
  });
  const requestPrefix = requireSafeRequestId(flags.get('request-id') ?? `prepare-${crypto.randomUUID()}`);
  if (requestPrefix.length > 110) {
    throw new Error('--request-id must leave room for preparation phase suffixes');
  }
  const thumbnailMaxSize = flags.has('thumbnail-size')
    ? requireIntegerFlag(flags, 'thumbnail-size', { minimum: 64, maximum: 768 })
    : 768;
  const deadline = Date.now() + maxReadyMs;
  const client = createBridgeClient(state);
  const phases = [];
  const runPhase = async (name, command) => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error(`Reference preparation exceeded ${maxReadyMs} ms before ${name}`);
    const phaseStartedAt = performance.now();
    const { result } = await client.send(command, {
      timeoutMs: remainingMs,
      requestId: requireSafeRequestId(`${requestPrefix}:${name}`),
    });
    if (!result.ok) throw new Error(result.error ?? `Reference preparation failed during ${name}`);
    phases.push({
      name,
      action: result.action,
      revision: result.revision,
      wallMs: Math.round((performance.now() - phaseStartedAt) * 10) / 10,
      vesselMs: result.profile?.totalMs,
    });
    return result;
  };

  const tab = 'already-connected';
  await waitForBridgeClient({ state, deadline });
  await runPhase('attach', { action: 'observe', capture: 'none' });
  await runPhase('project', {
    action: 'new-project',
    width,
    height,
    name: String(flags.get('name') ?? 'Reference Collaboration'),
    capture: 'none',
  });
  const referenceResult = await runPhase('reference', await expandLocalReferenceImage({
    action: 'import-reference-image',
    filePath: referencePath,
    fit,
    capture: 'none',
  }));
  const referenceLayerId = referenceResult.state?.referenceLayerId;
  if (!referenceLayerId) throw new Error('Reference import did not establish a reference layer');
  const layerResult = await runPhase('layer', {
    action: 'create-layer',
    layerType: 'color-cycle',
    name: String(flags.get('layer-name') ?? 'Reference paint'),
    capture: 'none',
  });
  const activeLayerId = layerResult.state?.activeLayerId;
  if (!activeLayerId) throw new Error('Color Cycle layer creation did not establish an active layer');
  await runPhase('configure', {
    action: 'batch',
    capture: 'none',
    operations: [
      { action: 'set-tool', tool: 'brush' },
      { action: 'set-brush-preset', presetId: 'color-cycle-flat-dither' },
      { action: 'set-gradient-source', source: 'sampled' },
      { action: 'set-gradient', resetSample: true },
      {
        action: 'set-brush',
        settings: {
          size: 8,
          opacity: 1,
          ditherEnabled: true,
          ditherAlgorithm: 'sierra-lite',
          fillResolution: 3,
          pressureLinkedFillResolution: false,
          ditherBackgroundFill: true,
          ditherPaletteSpread: 100,
          ditherPatternDiversity: 100,
          ditherPhaseJitter: 4,
          pxlEdge: true,
          colorCycleSpeed: 0.18,
          gradientBands: 6,
          colorCycleFillMode: 'linear',
          ccGradientDrawingShape: 'freehand',
        },
      },
    ],
  });
  await runPhase('gate', {
    ...gate,
    capture: 'none',
  });
  const frameResult = await runPhase('hide-reference', {
    action: 'set-layer-visibility',
    layerId: referenceLayerId,
    visible: false,
    capture: 'final-thumbnail',
    thumbnailMaxSize,
  });
  if (!frameResult.frame || frameResult.frame.sourceWidth !== width ||
      frameResult.frame.sourceHeight !== height) {
    throw new Error('Sampled gate did not return a frame for the requested canvas dimensions');
  }
  await materializeFrames(frameResult, {
    session,
    framePath: flags.get('frame'),
    frameDir: flags.get('frame-dir'),
  });
  assertReferenceReadyState({
    state: frameResult.state,
    width,
    height,
    activeLayerId,
    referenceLayerId,
  });
  const resultPath = await writeResultArtifact(frameResult, {
    session,
    resultDir: flags.get('result-dir'),
  });
  const elapsedMs = Math.round((performance.now() - startedAt) * 10) / 10;
  if (elapsedMs > maxReadyMs) {
    throw new Error(`Reference preparation exceeded its ${maxReadyMs} ms deadline`);
  }
  process.stdout.write(`${JSON.stringify({
    type: 'reference-ready',
    ok: true,
    session,
    tab,
    elapsedMs,
    maxReadyMs,
    reference: {
      sourceWidth,
      sourceHeight,
      fit,
      transform: referenceTransform,
    },
    frame: {
      kind: frameResult.frame.kind,
      width: frameResult.frame.width,
      height: frameResult.frame.height,
      sourceWidth: frameResult.frame.sourceWidth,
      sourceHeight: frameResult.frame.sourceHeight,
      path: frameResult.frame.path,
    },
    state: compactResultState(frameResult.state),
    phases,
    resultPath,
  }, null, 2)}\n`);
};

const status = async ({ flags }) => {
  const session = requireSafeSession(flags.get('session'));
  const state = await readSessionState(session);
  const headers = { Authorization: `Bearer ${state.token}` };
  const health = await fetchJson(`${state.url}/v1/health`, { headers });
  process.stdout.write(`${JSON.stringify({ ...health.value, session, url: state.url, pid: state.pid }, null, 2)}\n`);
};

const pair = async ({ flags }) => {
  const session = requireSafeSession(flags.get('session'));
  const state = await readSessionState(session);
  const targetUrl = requireLocalVesselUrl(flags.get('target') ?? 'http://localhost:3001/');
  const paired = await fetchJson(`${state.url}/v1/pairings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${state.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      targetUrl: targetUrl.toString(),
      ...(flags.has('client-id') ? { clientId: String(flags.get('client-id')) } : {}),
    }),
  });
  process.stdout.write(`${paired.value.url}\n`);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const operation = args.positional[0];
  if (operation === 'serve') return serve(args);
  if (operation === 'call') return call(args);
  if (operation === 'client') return persistentClient(args);
  if (operation === 'result') return readResult(args);
  if (operation === 'cancel') return cancelCommand(args);
  if (operation === 'status') return status(args);
  if (operation === 'pair') return pair(args);
  if (operation === 'prepare-reference') return prepareReference(args);
  throw new Error(
    'Usage: vessel-collab.mjs <serve|pair|call|client|result|cancel|status|prepare-reference> [options]',
  );
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
