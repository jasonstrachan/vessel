import {
  __setWebglExportSettingsStorageOverride,
  loadWebglExportSettings,
  saveWebglExportSettings,
} from '@/utils/webglExportSettingsStorage';
import type { WebGLExportSettings } from '@/types';

const createStorageStub = () => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] ?? null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
    key: jest.fn(),
    get length() {
      return Object.keys(store).length;
    },
  } as unknown as Storage;
};

const sampleSettings: WebGLExportSettings = {
  includeHiddenLayers: true,
  embedCanvasFallback: false,
  minifyOutput: true,
  bundleFormat: 'single-html',
  gobletVersion: 'goblet2',
  enableGobletDiagnostics: false,
  htmlTitle: 'Goblet',
  htmlBackgroundColor: '#123456',
  transparencyBackgroundMode: 'checker',
  viewportPreset: 'default',
  designScalePercent: 150,
};

describe('webglExportSettingsStorage', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createStorageStub();
    __setWebglExportSettingsStorageOverride(storage);
  });

  afterEach(() => {
    __setWebglExportSettingsStorageOverride(null);
  });

  it('returns null when no payload is present', () => {
    expect(loadWebglExportSettings()).toBeNull();
  });

  it('saves sanitized payload', () => {
    saveWebglExportSettings(sampleSettings);
    const setCalls = (storage.setItem as jest.Mock).mock.calls;
    expect(setCalls[0][0]).toBe('vessel:webgl-export-settings');
    expect(JSON.parse(setCalls[0][1])).toEqual({
      storageVersion: 2,
      ...sampleSettings,
    });
  });

  it('loads and sanitizes persisted values', () => {
    storage.setItem('vessel:webgl-export-settings', JSON.stringify({
      includeHiddenLayers: false,
      embedCanvasFallback: true,
      minifyOutput: false,
      bundleFormat: 'zip',
      gobletVersion: 'goblet1',
      enableGobletDiagnostics: true,
      htmlTitle: '  My Title  ',
      htmlBackgroundColor: '#ABC',
      transparencyBackgroundMode: 'gray',
      viewportPreset: 'embed-fill',
      designScalePercent: 820,
      ignoredField: 'x',
    }));

    expect(loadWebglExportSettings()).toEqual({
      includeHiddenLayers: false,
      embedCanvasFallback: true,
      minifyOutput: false,
      bundleFormat: 'zip-compat',
      gobletVersion: 'goblet1',
      enableGobletDiagnostics: true,
      htmlTitle: 'My Title',
      htmlBackgroundColor: '#abc',
      transparencyBackgroundMode: 'gray',
      viewportPreset: 'embed-fill',
      designScalePercent: 800,
    });
  });

  it('preserves explicit smaller zip selections saved with the current settings version', () => {
    storage.setItem('vessel:webgl-export-settings', JSON.stringify({
      storageVersion: 2,
      bundleFormat: 'zip',
    }));

    expect(loadWebglExportSettings()).toEqual({
      bundleFormat: 'zip',
    });
  });

  it('migrates legacy fill viewport presets to embed-fill', () => {
    storage.setItem('vessel:webgl-export-settings', JSON.stringify({
      viewportPreset: 'fill',
    }));

    expect(loadWebglExportSettings()).toEqual({
      viewportPreset: 'embed-fill',
    });
  });
});
