#!/usr/bin/env node

import http from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const DEFAULT_PORT = 4000;
const SERVER_NAME = 'vessel-preview';

const port = Number.parseInt(process.env.PORT ?? '', 10) || DEFAULT_PORT;
const host = process.env.HOST ?? '0.0.0.0';

const projectRoot = path.resolve(process.cwd());
const outDir = path.resolve(projectRoot, 'out');

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
  const time = new Date().toISOString();
  console.log(`HTTP ${time} ${req.socket.remoteAddress ?? '-'} ${method} ${pathName}`);
  console.log(`HTTP ${time} ${req.socket.remoteAddress ?? '-'} Returned ${status} in ${durationMs} ms`);
};

const server = http.createServer(async (req, res) => {
  const start = Date.now();

  if (!req.url) {
    send(res, 400, { 'content-type': 'text/plain; charset=utf-8' }, 'Bad Request');
    log(req, 400, Date.now() - start);
    return;
  }

  const { pathname } = new url.URL(req.url, 'http://localhost');
  const localPath = resolveLocalPath(pathname);
  const absolutePath = path.resolve(outDir, localPath);

  if (!absolutePath.startsWith(outDir)) {
    send(res, 403, { 'content-type': 'text/plain; charset=utf-8' }, 'Forbidden');
    log(req, 403, Date.now() - start);
    return;
  }

  try {
    const stat = await fs.stat(absolutePath);
    if (stat.isDirectory()) {
      const indexPath = path.join(absolutePath, 'index.html');
      const indexStat = await fs.stat(indexPath);
      const stream = createReadStream(indexPath);
      res.writeHead(200, {
        'content-type': MIME_TYPES['.html'],
        'content-length': indexStat.size,
      });
      stream.pipe(res);
      stream.on('close', () => {
        log(req, 200, Date.now() - start);
      });
      stream.on('error', (error) => {
        console.error(error);
        res.destroy(error);
      });
      return;
    }

    const extension = path.extname(absolutePath).toLowerCase();
    const contentType = MIME_TYPES[extension] ?? 'application/octet-stream';
    const stream = createReadStream(absolutePath);
    res.writeHead(200, {
      'content-type': contentType,
      'content-length': stat.size,
    });
    stream.pipe(res);
    stream.on('close', () => {
      log(req, 200, Date.now() - start);
    });
    stream.on('error', (error) => {
      console.error(error);
      res.destroy(error);
    });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Error serving ${localPath}:`, error);
    }
    send(res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'Not Found');
    log(req, 404, Date.now() - start);
  }
});

server.listen(port, host, () => {
  console.log(`${SERVER_NAME} listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  console.log(`Serving static export from ${outDir}`);
  console.log('Hit Ctrl+C to stop.');
});

process.on('SIGINT', () => {
  console.log('\nShutting down preview server...');
  server.close(() => {
    process.exit(0);
  });
});

