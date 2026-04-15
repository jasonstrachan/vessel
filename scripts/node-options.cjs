#!/usr/bin/env node

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

module.exports = {
  LOCALSTORAGE_FLAG,
  mergeNodeOptions,
  stripLocalStorageFlag,
};
