if (!global.__workerMockInstalled) {
  const registry = new Map();

  const normalizeUrl = value => {
    if (!value) {
      return '';
    }
    if (value instanceof URL) {
      return value.href;
    }
    return String(value);
  };

  class MockWorker {
    constructor(url, options = {}) {
      this.url = normalizeUrl(url);
      this.options = options;
      this.onmessage = null;
      this.onerror = null;
      this._listeners = new Map();
      this._handler = registry.get(this.url) ?? null;
    }

    postMessage(data) {
      const handler = this._handler;
      if (!handler) {
        this._emit('error', { type: 'error', message: `No worker handler registered for ${this.url}` });
        return;
      }

      const respond = payload => {
        this._emit('message', { type: 'message', data: payload });
      };

      const fail = error => {
        const err = error instanceof Error ? error : new Error(String(error));
        this._emit('error', { type: 'error', error: err, message: err.message });
      };

      try {
        const result = handler({ data, respond, fail, url: this.url });
        if (result && typeof result.then === 'function') {
          result.then(respond).catch(fail);
        } else if (result !== undefined) {
          respond(result);
        }
      } catch (error) {
        fail(error);
      }
    }

    terminate() {
      this._listeners.clear();
    }

    addEventListener(type, listener) {
      if (!this._listeners.has(type)) {
        this._listeners.set(type, new Set());
      }
      this._listeners.get(type).add(listener);
    }

    removeEventListener(type, listener) {
      this._listeners.get(type)?.delete(listener);
    }

    _emit(type, event) {
      const listeners = this._listeners.get(type);
      const callback = type === 'message' ? this.onmessage : this.onerror;
      const payload = { ...event, target: this };
      if (typeof callback === 'function') {
        setTimeout(() => callback(payload), 0);
      }
      if (listeners && listeners.size > 0) {
        for (const listener of listeners) {
          setTimeout(() => listener(payload), 0);
        }
      }
    }
  }

  MockWorker.register = (url, handler) => {
    registry.set(normalizeUrl(url), handler);
  };

  MockWorker.reset = () => {
    registry.clear();
  };

  Object.defineProperty(global, 'Worker', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: MockWorker,
  });

  global.__mockWorker = {
    register: MockWorker.register,
    reset: MockWorker.reset,
  };

  global.__workerMockInstalled = true;
}

module.exports = global.__mockWorker;
