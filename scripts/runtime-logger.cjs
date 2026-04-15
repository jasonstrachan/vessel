#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.resolve(process.cwd(), 'logs/runtime');

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
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
  ensureLogDir();
  const filePath = path.join(LOG_DIR, `${name}.log`);

  const append = (level, message) => {
    const line = formatLine(level, message);
    fs.appendFileSync(filePath, line, 'utf8');
    return line;
  };

  return {
    filePath,
    log(message) {
      const line = append('INFO', message);
      process.stdout.write(line);
    },
    warn(message) {
      const line = append('WARN', message);
      process.stderr.write(line);
    },
    error(message, error) {
      const rendered = error ? `${message}\n${serializeError(error)}` : message;
      const line = append('ERROR', rendered);
      process.stderr.write(line);
    },
    writeRaw(prefix, chunk, isError = false) {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (!text) {
        return;
      }

      const normalized = text.endsWith('\n') ? text : `${text}\n`;
      fs.appendFileSync(filePath, `${prefix}${normalized}`, 'utf8');
      if (isError) {
        process.stderr.write(text);
      } else {
        process.stdout.write(text);
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
      process.on('uncaughtException', (error) => {
        this.error(`${processName} uncaught exception`, error);
      });

      process.on('unhandledRejection', (reason) => {
        this.error(`${processName} unhandled rejection`, reason);
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
