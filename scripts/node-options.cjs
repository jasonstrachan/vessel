#!/usr/bin/env node

const path = require('node:path');
const os = require('node:os');

const LOCALSTORAGE_FLAG = '--localstorage-file';

function stripLocalStorageFlag(value) {
  if (!value) {
    return '';
  }

  const parts = value.split(/\s+/).filter(Boolean);
  const cleaned = [];

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part === LOCALSTORAGE_FLAG) {
      const nextPart = parts[i + 1];
      if (nextPart && !nextPart.startsWith('-')) {
        i += 1;
      }
      continue;
    }

    if (part.startsWith(`${LOCALSTORAGE_FLAG}=`)) {
      continue;
    }

    cleaned.push(part);
  }

  return cleaned.join(' ');
}

function mergeNodeOptions(...values) {
  return values
    .map((value) => (value || '').trim())
    .filter(Boolean)
    .join(' ');
}

function getDefaultLocalStoragePath(scope = 'default') {
  const normalizedScope = scope.replace(/[^a-zA-Z0-9_.-]+/g, '-');
  return path.join(os.tmpdir(), `vessel-localstorage-${normalizedScope}`);
}

function normalizeNodeOptionsWithLocalStorage(options = {}) {
  const {
    nodeOptions,
    storagePath,
    scope = 'default',
  } = options;

  const baseOptions = stripLocalStorageFlag(nodeOptions);
  const resolvedStoragePath = storagePath || getDefaultLocalStoragePath(scope);
  return mergeNodeOptions(baseOptions, `${LOCALSTORAGE_FLAG}=${resolvedStoragePath}`);
}

module.exports = {
  LOCALSTORAGE_FLAG,
  getDefaultLocalStoragePath,
  mergeNodeOptions,
  normalizeNodeOptionsWithLocalStorage,
  stripLocalStorageFlag,
};
