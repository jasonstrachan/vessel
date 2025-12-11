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
      lastBrushId: 'pixel-brush',
      pressureSettings: { enabled: true, min: 10, max: 250 }
    }));
    expect(loadGlobalBrushSettings()).toEqual({
      globalBrushSize: 18,
      lastBrushId: 'pixel-brush',
      pressureSettings: { enabled: true, min: 10, max: 250 }
    });
  });

  it('saves sanitized payload', () => {
    saveGlobalBrushSettings({ globalBrushSize: 20, brushSpecificSettings: { demo: { spacing: 4 } }, lastBrushId: 'pixel-brush' });
    const setCalls = (storage.setItem as jest.Mock).mock.calls;
    expect(setCalls[0][0]).toBe('vessel:brush-settings');
    expect(JSON.parse(setCalls[0][1])).toEqual({
      globalBrushSize: 20,
      brushSpecificSettings: { demo: { spacing: 4 } },
      lastBrushId: 'pixel-brush'
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
