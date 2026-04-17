const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed === '[object Event]' || trimmed === '[object Object]') {
    return null;
  }

  return trimmed;
};

const describeEvent = (value: Event): string | null => {
  const eventType = asNonEmptyString(value.type) ?? 'unknown';
  const target = 'target' in value ? value.target : null;
  const targetName =
    target && typeof target === 'object' && 'constructor' in target
      ? asNonEmptyString((target as { constructor?: { name?: unknown } }).constructor?.name)
      : null;

  if (targetName) {
    return `Event "${eventType}" on ${targetName}`;
  }

  return `Event "${eventType}"`;
};

export const getErrorMessage = (value: unknown, fallback = 'Unknown error'): string => {
  if (value instanceof Error) {
    return asNonEmptyString(value.message) ?? asNonEmptyString(value.name) ?? fallback;
  }

  const directString = asNonEmptyString(value);
  if (directString) {
    return directString;
  }

  if (isRecord(value)) {
    const directMessage = asNonEmptyString(value.message);
    if (directMessage) {
      return directMessage;
    }

    if ('reason' in value) {
      const reasonMessage = getErrorMessage(value.reason, '');
      if (reasonMessage) {
        return reasonMessage;
      }
    }

    if ('error' in value) {
      const nestedErrorMessage = getErrorMessage(value.error, '');
      if (nestedErrorMessage) {
        return nestedErrorMessage;
      }
    }
  }

  if (typeof Event !== 'undefined' && value instanceof Event) {
    return describeEvent(value) ?? fallback;
  }

  return fallback;
};

export const getErrorStack = (value: unknown): string | null => {
  if (value instanceof Error) {
    return asNonEmptyString(value.stack);
  }

  if (isRecord(value)) {
    const directStack = asNonEmptyString(value.stack);
    if (directStack) {
      return directStack;
    }

    if ('reason' in value) {
      const reasonStack = getErrorStack(value.reason);
      if (reasonStack) {
        return reasonStack;
      }
    }

    if ('error' in value) {
      const nestedErrorStack = getErrorStack(value.error);
      if (nestedErrorStack) {
        return nestedErrorStack;
      }
    }
  }

  return null;
};
