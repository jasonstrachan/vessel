import {
  createLocalPatternDirectory,
  type LocalPatternDirectoryStorage,
  type PatternDirectoryHandle,
} from '@/utils/ditherPatterns/localPatternDirectory';

const makeFile = (name: string, bytes: number[]) => ({
  kind: 'file' as const,
  name,
  getFile: async () => ({
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  }) as File,
});

const makeDirectory = (
  name: string,
  entries: Array<[string, ReturnType<typeof makeFile> | PatternDirectoryHandle]>,
  permission: PermissionState = 'granted',
): PatternDirectoryHandle => {
  let currentPermission = permission;
  return {
    kind: 'directory',
    name,
    queryPermission: jest.fn(async () => currentPermission),
    requestPermission: jest.fn(async () => {
      currentPermission = 'granted';
      return currentPermission;
    }),
    entries: async function* () {
      for (const entry of entries) yield entry;
    },
  };
};

describe('localPatternDirectory', () => {
  const originalPicker = Object.getOwnPropertyDescriptor(window, 'showDirectoryPicker');
  const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');

  beforeEach(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: jest.fn(),
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: {},
    });
  });

  afterAll(() => {
    if (originalPicker) Object.defineProperty(window, 'showDirectoryPicker', originalPicker);
    else Reflect.deleteProperty(window, 'showDirectoryPicker');
    if (originalIndexedDb) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDb);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  });

  it('connects once, scans nested pack folders, and ignores backup archives', async () => {
    let stored: PatternDirectoryHandle | null = null;
    const storage: LocalPatternDirectoryStorage = {
      load: async () => stored,
      save: async (handle) => { stored = handle; },
      clear: async () => { stored = null; },
    };
    const install = jest.fn(async (archive: Uint8Array | ArrayBuffer) => {
      void archive;
    });
    const packs = makeDirectory('packs', [
      ['current.vpatternpack', makeFile('current.vpatternpack', [1, 2, 3])],
      ['current.backup-before-edit.vpatternpack', makeFile('current.backup-before-edit.vpatternpack', [9])],
    ]);
    const root = makeDirectory('Private Practice', [['packs', packs]]);
    const directory = createLocalPatternDirectory({
      storage,
      installer: { install },
      pickDirectory: async () => root,
    });

    await expect(directory.connect()).resolves.toEqual({
      status: 'connected',
      loadedPacks: 1,
      failedPacks: 0,
    });
    expect(stored).toBe(root);
    expect(install).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(install.mock.calls[0]?.[0] as ArrayBuffer)).toEqual(Uint8Array.from([1, 2, 3]));
  });

  it('does not prompt during automatic sync and reconnects only from an explicit action', async () => {
    const root = makeDirectory('Private Practice', [], 'prompt');
    const storage: LocalPatternDirectoryStorage = {
      load: async () => root,
      save: async () => undefined,
      clear: async () => undefined,
    };
    const directory = createLocalPatternDirectory({ storage, installer: { install: jest.fn() } });

    await expect(directory.sync()).resolves.toEqual({
      status: 'permission-required',
      loadedPacks: 0,
      failedPacks: 0,
    });
    expect(root.requestPermission).not.toHaveBeenCalled();

    await expect(directory.reconnect()).resolves.toEqual({
      status: 'connected',
      loadedPacks: 0,
      failedPacks: 0,
    });
    expect(root.requestPermission).toHaveBeenCalledWith({ mode: 'read' });
  });
});
