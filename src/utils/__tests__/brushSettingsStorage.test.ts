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
    storage.setItem('vessel:brush-settings', JSON.stringify({ globalBrushSize: 18 }));
    expect(loadGlobalBrushSettings()).toEqual({ globalBrushSize: 18 });
  });

  it('saves sanitized payload', () => {
    saveGlobalBrushSettings({ globalBrushSize: 20, brushSpecificSettings: { demo: { spacing: 4 } } });
    const setCalls = (storage.setItem as jest.Mock).mock.calls;
    expect(setCalls[0][0]).toBe('vessel:brush-settings');
    expect(JSON.parse(setCalls[0][1])).toEqual({
      globalBrushSize: 20,
      brushSpecificSettings: { demo: { spacing: 4 } },
    });
  });
});
