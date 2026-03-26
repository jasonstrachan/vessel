import type { WebGLExportSettings } from '@/types';

const STORAGE_KEY = 'vessel:webgl-export-settings';

let storageOverride: Storage | null = null;

export const __setWebglExportSettingsStorageOverride = (storage: Storage | null): void => {
  storageOverride = storage;
};

const isValidStorage = (candidate: Storage | null | undefined): candidate is Storage => {
  if (!candidate) {
    return false;
  }
  return typeof candidate.getItem === 'function' && typeof candidate.setItem === 'function';
};

const getLocalStorage = (): Storage | null => {
  if (storageOverride) {
    return isValidStorage(storageOverride) ? storageOverride : null;
  }
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return isValidStorage(window.localStorage) ? window.localStorage : null;
  } catch {
    return null;
  }
};

const sanitizeBundleFormat = (value: unknown): WebGLExportSettings['bundleFormat'] | undefined => {
  if (value === 'zip' || value === 'single-html' || value === 'json') {
    return value;
  }
  return undefined;
};

const sanitizeGobletVersion = (value: unknown): WebGLExportSettings['gobletVersion'] | undefined => {
  if (value === 'goblet1' || value === 'goblet2') {
    return value;
  }
  return undefined;
};

const sanitizeViewportPreset = (value: unknown): WebGLExportSettings['viewportPreset'] | undefined => {
  if (value === 'fill') {
    return 'embed-fill';
  }
  if (value === 'default' || value === 'embed-fill' || value === 'embed-fit' || value === 'fixed') {
    return value;
  }
  return undefined;
};

const sanitizeDesignScalePercent = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(25, Math.min(800, Math.round(value)));
};

const sanitizeHtmlTitle = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, 120);
};

const sanitizeHtmlBackgroundColor = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) {
    return undefined;
  }
  return trimmed.toLowerCase();
};

const sanitizeWebglExportSettings = (value: unknown): Partial<WebGLExportSettings> => {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const record = value as Record<string, unknown>;
  const sanitized: Partial<WebGLExportSettings> = {};

  if (typeof record.includeHiddenLayers === 'boolean') {
    sanitized.includeHiddenLayers = record.includeHiddenLayers;
  }
  if (typeof record.embedCanvasFallback === 'boolean') {
    sanitized.embedCanvasFallback = record.embedCanvasFallback;
  }
  if (typeof record.minifyOutput === 'boolean') {
    sanitized.minifyOutput = record.minifyOutput;
  }
  if (typeof record.enableGobletDiagnostics === 'boolean') {
    sanitized.enableGobletDiagnostics = record.enableGobletDiagnostics;
  }

  const bundleFormat = sanitizeBundleFormat(record.bundleFormat);
  if (bundleFormat) {
    sanitized.bundleFormat = bundleFormat;
  }

  const gobletVersion = sanitizeGobletVersion(record.gobletVersion);
  if (gobletVersion) {
    sanitized.gobletVersion = gobletVersion;
  }

  const viewportPreset = sanitizeViewportPreset(record.viewportPreset);
  if (viewportPreset) {
    sanitized.viewportPreset = viewportPreset;
  }

  const designScalePercent = sanitizeDesignScalePercent(record.designScalePercent);
  if (typeof designScalePercent === 'number') {
    sanitized.designScalePercent = designScalePercent;
  }

  const htmlTitle = sanitizeHtmlTitle(record.htmlTitle);
  if (htmlTitle) {
    sanitized.htmlTitle = htmlTitle;
  }

  const htmlBackgroundColor = sanitizeHtmlBackgroundColor(record.htmlBackgroundColor);
  if (htmlBackgroundColor) {
    sanitized.htmlBackgroundColor = htmlBackgroundColor;
  }

  return sanitized;
};

export const loadWebglExportSettings = (): Partial<WebGLExportSettings> | null => {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    const sanitized = sanitizeWebglExportSettings(parsed);
    return Object.keys(sanitized).length > 0 ? sanitized : null;
  } catch (error) {
    console.warn('[WebglExportSettingsStorage] Failed to load settings', error);
    return null;
  }
};

export const saveWebglExportSettings = (payload: WebGLExportSettings): void => {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  try {
    const sanitized = sanitizeWebglExportSettings(payload);
    storage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  } catch (error) {
    console.warn('[WebglExportSettingsStorage] Failed to save settings', error);
  }
};
