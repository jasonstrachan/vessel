#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.resolve(process.cwd(), 'logs/runtime');
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const streamWriters = new WeakMap();

function getStreamWriter(stream) {
  if (streamWriters.has(stream)) {
    return streamWriters.get(stream);
  }

  let failed = false;
  // A disconnected terminal must never report its failure through itself.
  stream.on('error', () => { failed = true; });
  const write = (text) => {
    if (failed || stream.destroyed || stream.writableEnded || stream.writableNeedDrain) {
      return;
    }
    try {
      stream.write(text, (error) => {
        if (error) failed = true;
      });
    } catch {
      failed = true;
    }
  };
  streamWriters.set(stream, write);
  return write;
}

function formatLine(level, message) {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level}] ${message}\n`;
}

function serializeError(error) {
  if (!error) {
    return 'Unknown error';
  }

  if (error instanceof Error) {
    return error.stack || `${error.name}: ${error.message}`;
  }

  try {
    return typeof error === 'string' ? error : JSON.stringify(error, null, 2);
  } catch (jsonError) {
    return String(error);
  }
}

function createRuntimeLogger(name) {
  const filePath = path.join(LOG_DIR, `${name}.log`);
  const writeStdout = getStreamWriter(process.stdout);
  const writeStderr = getStreamWriter(process.stderr);
  let fileLoggingFailed = false;

  const logSize = () => {
    try {
      return fs.statSync(filePath).size;
    } catch (error) {
      if (error.code === 'ENOENT') return 0;
      throw error;
    }
  };

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    if (logSize() > MAX_LOG_BYTES) fs.truncateSync(filePath, 0);
  } catch {
    fileLoggingFailed = true;
  }

  const appendRaw = (text) => {
    if (fileLoggingFailed) return;
    try {
      let data = Buffer.from(text, 'utf8');
      if (data.length > MAX_LOG_BYTES) {
        let start = data.length - MAX_LOG_BYTES;
        // Keep the newest complete UTF-8 characters, even for a single huge entry.
        while ((data[start] & 0xc0) === 0x80) start += 1;
        data = data.subarray(start);
      }
      if (logSize() + data.length > MAX_LOG_BYTES) fs.truncateSync(filePath, 0);
      fs.appendFileSync(filePath, data);
    } catch {
      // Disk errors must not turn diagnostic logging into another exception loop.
      fileLoggingFailed = true;
    }
  };

  const append = (level, message) => {
    const line = formatLine(level, message);
    appendRaw(line);
    return line;
  };

  return {
    filePath,
    log(message) {
      const line = append('INFO', message);
      writeStdout(line);
    },
    warn(message) {
      const line = append('WARN', message);
      writeStderr(line);
    },
    error(message, error) {
      const rendered = error ? `${message}\n${serializeError(error)}` : message;
      const line = append('ERROR', rendered);
      writeStderr(line);
    },
    writeRaw(prefix, chunk, isError = false) {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (!text) {
        return;
      }

      const normalized = text.endsWith('\n') ? text : `${text}\n`;
      appendRaw(`${prefix}${normalized}`);
      if (isError) {
        writeStderr(text);
      } else {
        writeStdout(text);
      }
    },
    attachChild(child, nameOverride) {
      const childName = nameOverride || name;

      child.stdout?.on('data', (chunk) => {
        this.writeRaw(`[${childName}:stdout] `, chunk, false);
      });

      child.stderr?.on('data', (chunk) => {
        this.writeRaw(`[${childName}:stderr] `, chunk, true);
      });
    },
    installProcessHandlers(processName) {
      // Observe fatal errors without suppressing Node's normal nonzero exit.
      process.on('uncaughtExceptionMonitor', (error, origin) => {
        append('ERROR', `${processName} ${origin}\n${serializeError(error)}`);
      });

      process.on('warning', (warning) => {
        this.warn(`${processName} warning\n${serializeError(warning)}`);
      });
    },
    startWatchdog(options = {}) {
      const heartbeatMs = options.heartbeatMs ?? 30000;
      const lagThresholdMs = options.lagThresholdMs ?? 2000;
      const stallThresholdMs = options.stallThresholdMs ?? heartbeatMs + lagThresholdMs;
      const getStatus = typeof options.getStatus === 'function' ? options.getStatus : () => '';

      let lastBeatAt = Date.now();
      let heartbeatTimer = null;
      let lagTimer = null;

      const logHeartbeat = () => {
        const status = getStatus();
        const suffix = status ? ` | ${status}` : '';
        this.log(`heartbeat${suffix}`);
        lastBeatAt = Date.now();
      };

      heartbeatTimer = setInterval(logHeartbeat, heartbeatMs);
      if (typeof heartbeatTimer.unref === 'function') {
        heartbeatTimer.unref();
      }

      let expectedAt = Date.now() + heartbeatMs;
      lagTimer = setInterval(() => {
        const now = Date.now();
        const driftMs = now - expectedAt;
        expectedAt = now + heartbeatMs;

        if (driftMs > lagThresholdMs) {
          this.warn(`event loop lag detected: ${driftMs}ms`);
        }

        const sinceLastBeatMs = now - lastBeatAt;
        if (sinceLastBeatMs > stallThresholdMs) {
          this.warn(`watchdog stall warning: no heartbeat recorded for ${sinceLastBeatMs}ms`);
        }
      }, heartbeatMs);

      if (typeof lagTimer.unref === 'function') {
        lagTimer.unref();
      }

      return () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (lagTimer) {
          clearInterval(lagTimer);
          lagTimer = null;
        }
      };
    },
  };
}

module.exports = {
  createRuntimeLogger,
};
