#!/usr/bin/env node

import http from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const require = createRequire(import.meta.url);
const { createRuntimeLogger } = require('./runtime-logger.cjs');

const DEFAULT_PORT = 4000;
const SERVER_NAME = 'vessel-preview';

const port = Number.parseInt(process.env.PORT ?? '', 10) || DEFAULT_PORT;
const host = process.env.HOST ?? '0.0.0.0';

const projectRoot = path.resolve(process.cwd());
const outDir = path.resolve(projectRoot, process.env.PREVIEW_OUT_DIR ?? 'out');
const previousOutDir = path.resolve(projectRoot, `${path.basename(outDir)}-prev`);
const logger = createRuntimeLogger('preview-server');
const lockFile = path.join(
  os.tmpdir(),
  `vessel-preview-${Buffer.from(projectRoot).toString('hex')}-${port}.json`,
);

const isProcessRunning = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
};

const writeLockFile = async () => {
  const payload = {
    pid: process.pid,
    port,
    outDir,
    projectRoot,
    startedAt: new Date().toISOString(),
  };

  await fs.writeFile(lockFile, JSON.stringify(payload, null, 2), 'utf8');
};

const removeLockFile = async () => {
  try {
    const raw = await fs.readFile(lockFile, 'utf8');
    const payload = JSON.parse(raw);
    if (payload?.pid === process.pid) {
      await fs.unlink(lockFile);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      logger.error(`Failed to clean preview lock ${lockFile}`, error);
    }
  }
};

const acquireLock = async () => {
  try {
    const raw = await fs.readFile(lockFile, 'utf8');
    const payload = JSON.parse(raw);
    const existingPid = Number(payload?.pid);

    if (isProcessRunning(existingPid)) {
      throw new Error(
        `${SERVER_NAME} already running for this repo on port ${payload?.port ?? port} (PID ${existingPid}). Stop it before starting another preview server.`,
      );
    }

    await fs.unlink(lockFile);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  await writeLockFile();
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const CACHE_HEADERS = {
  'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  pragma: 'no-cache',
  expires: '0',
};

const HEARTBEAT_GAP_MS = 15_000;
const clientHeartbeatState = new Map();

const stripLeadingSlash = (value) => value.replace(/^\/+/, '');

const resolveLocalPath = (requestPath) => {
  if (!requestPath) {
    return 'index.html';
  }

  let pathname = requestPath;

  if (pathname === '/' || pathname === '/index.html') {
    return 'index.html';
  }

  if (pathname === '/vessel' || pathname === '/vessel/') {
    return 'index.html';
  }

  if (pathname.startsWith('/vessel/')) {
    pathname = pathname.slice('/vessel'.length);
    if (pathname === '' || pathname === '/') {
      return 'index.html';
    }
  }

  if (pathname.endsWith('/')) {
    return stripLeadingSlash(`${pathname}index.html`);
  }

  return stripLeadingSlash(pathname);
};

const isNextStaticAsset = (localPath) => localPath.startsWith('_next/static/');

const resolveAbsolutePath = (baseDir, localPath) => path.resolve(baseDir, localPath);

const canServeFromBaseDir = (baseDir, absolutePath) => absolutePath.startsWith(baseDir);

const streamFile = async ({ req, res, start, localPath, absolutePath, stat, statusCode = 200, fallbackLabel = null }) => {
  const extension = path.extname(absolutePath).toLowerCase();
  const contentType = MIME_TYPES[extension] ?? 'application/octet-stream';
  const stream = createReadStream(absolutePath);
  res.writeHead(statusCode, {
    ...CACHE_HEADERS,
    'content-type': contentType,
    'content-length': stat.size,
  });
  stream.pipe(res);
  stream.on('close', () => {
    if (fallbackLabel) {
      logger.warn(`Served ${localPath} from ${fallbackLabel}`);
    }
    log(req, statusCode, Date.now() - start);
  });
  stream.on('error', (error) => {
    logger.error(`Stream error while serving ${localPath}`, error);
    res.destroy(error);
  });
};

const send = (res, statusCode, headers, message) => {
  res.writeHead(statusCode, headers);
  if (message) {
    res.end(message);
  } else {
    res.end();
  }
};

const log = (req, status, durationMs) => {
  const method = req.method ?? 'GET';
  const pathName = req.url ?? '';
  logger.log(`HTTP ${req.socket.remoteAddress ?? '-'} ${method} ${pathName} -> ${status} in ${durationMs} ms`);
};

const asString = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asFiniteNumber = (value) => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
);

const readJsonBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw.length > 0 ? JSON.parse(raw) : {};
};

const handleClientRuntimeEvent = async (req, res, start) => {
  let payload;

  try {
    payload = await readJsonBody(req);
  } catch {
    send(res, 400, { 'content-type': 'application/json; charset=utf-8' }, JSON.stringify({
      ok: false,
      error: 'invalid-json',
    }));
    log(req, 400, Date.now() - start);
    return;
  }

  const event = asString(payload?.event) ?? 'crash';
  const clientId = asString(payload?.clientId) ?? 'unknown-client';
  const href = asString(payload?.href);
  const visibilityState = asString(payload?.visibilityState);
  const userAgent = asString(payload?.userAgent);
  const ts = asFiniteNumber(payload?.ts) ?? Date.now();

  if (event === 'heartbeat') {
    const now = Date.now();
    const previous = clientHeartbeatState.get(clientId);
    if (previous) {
      const gapMs = now - previous.lastSeenAt;
      if (gapMs > HEARTBEAT_GAP_MS) {
        logger.warn('[client-runtime-gap]', {
          clientId,
          gapMs,
          href,
          previousHref: previous.lastHref,
          visibilityState,
          userAgent,
        });
      }
    } else {
      logger.log('[client-runtime-heartbeat-start]', {
        clientId,
        href,
        visibilityState,
        userAgent,
      });
    }

    clientHeartbeatState.set(clientId, {
      lastSeenAt: now,
      lastHref: href,
    });

    send(res, 200, { 'content-type': 'application/json; charset=utf-8' }, JSON.stringify({ ok: true }));
    log(req, 200, Date.now() - start);
    return;
  }

  if (event === 'longtask') {
    logger.warn('[client-runtime-longtask]', {
      clientId,
      durationMs: asFiniteNumber(payload?.durationMs),
      href,
      visibilityState,
      ts,
    });
    send(res, 200, { 'content-type': 'application/json; charset=utf-8' }, JSON.stringify({ ok: true }));
    log(req, 200, Date.now() - start);
    return;
  }

  if (event === 'lag') {
    logger.warn('[client-runtime-lag]', {
      clientId,
      lagMs: asFiniteNumber(payload?.lagMs),
      href,
      visibilityState,
      ts,
    });
    send(res, 200, { 'content-type': 'application/json; charset=utf-8' }, JSON.stringify({ ok: true }));
    log(req, 200, Date.now() - start);
    return;
  }

  logger.error('[client-runtime-error]', {
    clientId,
    type: payload?.type === 'unhandledrejection' ? 'unhandledrejection' : 'error',
    message: asString(payload?.message) ?? 'Unknown client runtime error',
    href,
    filename: asString(payload?.filename),
    lineno: asFiniteNumber(payload?.lineno),
    colno: asFiniteNumber(payload?.colno),
    userAgent,
    visibilityState,
    ts,
    stack: asString(payload?.stack),
    breadcrumbs: Array.isArray(payload?.breadcrumbs) ? payload.breadcrumbs.slice(-20) : [],
  });
  send(res, 200, { 'content-type': 'application/json; charset=utf-8' }, JSON.stringify({ ok: true }));
  log(req, 200, Date.now() - start);
};

const server = http.createServer(async (req, res) => {
  const start = Date.now();

  if (!req.url) {
    send(res, 400, { 'content-type': 'text/plain; charset=utf-8' }, 'Bad Request');
    log(req, 400, Date.now() - start);
    return;
  }

  const { pathname } = new url.URL(req.url, 'http://localhost');

  if (pathname === '/api/client-error' && req.method === 'POST') {
    await handleClientRuntimeEvent(req, res, start);
    return;
  }

  const localPath = resolveLocalPath(pathname);
  const absolutePath = resolveAbsolutePath(outDir, localPath);

  if (!canServeFromBaseDir(outDir, absolutePath)) {
    send(res, 403, { 'content-type': 'text/plain; charset=utf-8' }, 'Forbidden');
    log(req, 403, Date.now() - start);
    return;
  }

  try {
    const stat = await fs.stat(absolutePath);
    if (stat.isDirectory()) {
      const indexPath = path.join(absolutePath, 'index.html');
      const indexStat = await fs.stat(indexPath);
      await streamFile({ req, res, start, localPath, absolutePath: indexPath, stat: indexStat });
      return;
    }

    await streamFile({ req, res, start, localPath, absolutePath, stat });
  } catch (error) {
    if (error.code === 'ENOENT' && isNextStaticAsset(localPath)) {
      const fallbackPath = resolveAbsolutePath(previousOutDir, localPath);
      if (canServeFromBaseDir(previousOutDir, fallbackPath)) {
        try {
          const fallbackStat = await fs.stat(fallbackPath);
          if (fallbackStat.isFile()) {
            await streamFile({
              req,
              res,
              start,
              localPath,
              absolutePath: fallbackPath,
              stat: fallbackStat,
              fallbackLabel: previousOutDir,
            });
            return;
          }
        } catch (fallbackError) {
          if (fallbackError.code !== 'ENOENT') {
            logger.error(`Error serving fallback asset ${localPath}`, fallbackError);
          }
        }
      }
    }

    if (error.code !== 'ENOENT') {
      logger.error(`Error serving ${localPath}`, error);
    }
    send(res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'Not Found');
    log(req, 404, Date.now() - start);
  }
});

let isShuttingDown = false;
const stopWatchdog = logger.startWatchdog({
  getStatus: () => `port=${port} outDir=${outDir} shuttingDown=${isShuttingDown}`,
});

const shutdown = async (signal) => {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  if (signal) {
    logger.log(`Shutting down preview server (${signal}).`);
  }

  stopWatchdog?.();
  server.close(async () => {
    await removeLockFile();
    process.exit(0);
  });
};

try {
  await acquireLock();
} catch (error) {
  logger.error(error.message);
  process.exit(1);
}

logger.installProcessHandlers('preview-server');
logger.log(`Runtime log file: ${logger.filePath}`);
server.listen(port, host, () => {
  logger.log(`${SERVER_NAME} listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  logger.log(`Serving static export from ${outDir}`);
  logger.log(`Lock file: ${lockFile}`);
  logger.log('Hit Ctrl+C to stop.');
});

server.on('error', async (error) => {
  await removeLockFile();
  logger.error('Preview server failed', error);
  process.exit(1);
});

process.on('SIGINT', () => {
  shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
