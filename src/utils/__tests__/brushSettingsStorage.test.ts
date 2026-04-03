import {
  loadGlobalBrushSettings,
  saveGlobalBrushSettings,
  __setBrushSettingsStorageOverride,
} from '../brushSettingsStorage';

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

describe('brushSettingsStorage', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createStorageStub();
    __setBrushSettingsStorageOverride(storage);
  });

  afterEach(() => {
    __setBrushSettingsStorageOverride(null);
  });

  it('returns null when storage is empty', () => {
    expect(loadGlobalBrushSettings()).toBeNull();
  });

  it('loads stored payload', () => {
    storage.setItem('vessel:brush-settings', JSON.stringify({
      globalBrushSize: 18,
      lastBrushId: 'pixel-square',
      pressureSettings: { enabled: true, min: 10, max: 250 }
    }));
    expect(loadGlobalBrushSettings()).toEqual({
      globalBrushSize: 18,
      lastBrushId: 'pixel-square',
      pressureSettings: { enabled: true, min: 10, max: 250 }
    });
  });

  it('drops deprecated brush-specific keys on load', () => {
    storage.setItem('vessel:brush-settings', JSON.stringify({
      brushSpecificSettings: {
        'color-cycle-gradient': {
          spacing: 4,
          ccGradientSamplePerShape: true,
          ditherAlgorithm: 'pattern',
          patternStyle: 'crosshatch',
        },
      },
    }));

    expect(loadGlobalBrushSettings()).toEqual({
      brushSpecificSettings: {
        'color-cycle-gradient': {
          spacing: 4,
        },
      },
    });
  });

  it('saves sanitized payload', () => {
    saveGlobalBrushSettings({ globalBrushSize: 20, brushSpecificSettings: { demo: { spacing: 4 } }, lastBrushId: 'pixel-square' });
    const setCalls = (storage.setItem as jest.Mock).mock.calls;
    expect(setCalls[0][0]).toBe('vessel:brush-settings');
    expect(JSON.parse(setCalls[0][1])).toEqual({
      globalBrushSize: 20,
      brushSpecificSettings: { demo: { spacing: 4 } },
      lastBrushId: 'pixel-square'
    });
  });

  it('does not persist deprecated brush-specific keys', () => {
    saveGlobalBrushSettings({
      brushSpecificSettings: {
        'color-cycle-gradient': {
          spacing: 4,
          ccGradientSamplePerShape: true,
          ditherAlgorithm: 'pattern',
          patternStyle: 'crosshatch',
        } as Partial<Record<string, unknown>>,
      },
    } as Parameters<typeof saveGlobalBrushSettings>[0]);

    const payload = JSON.parse((storage.setItem as jest.Mock).mock.calls[0][1]);
    expect(payload).toEqual({
      brushSpecificSettings: {
        'color-cycle-gradient': {
          spacing: 4,
        },
      },
    });
  });

  it('persists shared CC dither selection separately from brush-specific settings', () => {
    saveGlobalBrushSettings({
      ccBrushDitherSelection: {
        ditherAlgorithm: 'pattern',
        patternStyle: 'crosshatch',
      },
      brushSpecificSettings: {
        'color-cycle-stroke': {
          spacing: 4,
          ditherAlgorithm: 'bayer',
          patternStyle: 'dots',
        },
      },
    });

    const payload = JSON.parse((storage.setItem as jest.Mock).mock.calls[0][1]);
    expect(payload).toEqual({
      ccBrushDitherSelection: {
        ditherAlgorithm: 'pattern',
        patternStyle: 'crosshatch',
      },
      brushSpecificSettings: {
        'color-cycle-stroke': {
          spacing: 4,
        },
      },
    });
  });

  it('sanitizes and saves pressure settings', () => {
    saveGlobalBrushSettings({
      pressureSettings: { enabled: true, min: -5, max: 2000 },
    });
    const payload = JSON.parse((storage.setItem as jest.Mock).mock.calls[0][1]);
    expect(payload.pressureSettings).toEqual({ enabled: true, min: 0, max: 1000 });
  });
});
