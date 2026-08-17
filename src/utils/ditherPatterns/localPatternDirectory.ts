import { localPatternLibrary } from './localPatternLibrary';

const DB_NAME = 'vessel-local-pattern-directory';
const DB_VERSION = 1;
const HANDLE_STORE = 'handles';
const ROOT_HANDLE_KEY = 'private-practice-root';
const MAX_SCAN_DEPTH = 2;
const MAX_PACK_FILES = 100;

type PermissionMode = { mode: 'read' };

interface PatternFileHandle {
  kind: 'file';
  name: string;
  getFile: () => Promise<File>;
}

export interface PatternDirectoryHandle {
  kind: 'directory';
  name: string;
  entries?: () => AsyncIterableIterator<[string, PatternFileHandle | PatternDirectoryHandle]>;
  queryPermission?: (options?: PermissionMode) => Promise<PermissionState>;
  requestPermission?: (options?: PermissionMode) => Promise<PermissionState>;
}

export type LocalPatternDirectoryStatus =
  | 'unsupported'
  | 'not-connected'
  | 'permission-required'
  | 'connected';

export interface LocalPatternDirectorySyncResult {
  status: LocalPatternDirectoryStatus;
  loadedPacks: number;
  failedPacks: number;
}

export interface LocalPatternDirectoryStorage {
  load: () => Promise<PatternDirectoryHandle | null>;
  save: (handle: PatternDirectoryHandle) => Promise<void>;
  clear: () => Promise<void>;
}

interface LocalPatternInstaller {
  install: (archive: Uint8Array | ArrayBuffer) => Promise<unknown>;
}

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
});

const transactionComplete = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
});

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(HANDLE_STORE)) {
      db.createObjectStore(HANDLE_STORE);
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Unable to open private folder storage.'));
});

export const createIndexedDbLocalPatternDirectoryStorage = (): LocalPatternDirectoryStorage => ({
  load: async () => {
    const db = await openDatabase();
    try {
      const transaction = db.transaction(HANDLE_STORE, 'readonly');
      const result = await requestResult(transaction.objectStore(HANDLE_STORE).get(ROOT_HANDLE_KEY));
      return (result as PatternDirectoryHandle | undefined) ?? null;
    } finally {
      db.close();
    }
  },
  save: async (handle) => {
    const db = await openDatabase();
    try {
      const transaction = db.transaction(HANDLE_STORE, 'readwrite');
      transaction.objectStore(HANDLE_STORE).put(handle, ROOT_HANDLE_KEY);
      await transactionComplete(transaction);
    } finally {
      db.close();
    }
  },
  clear: async () => {
    const db = await openDatabase();
    try {
      const transaction = db.transaction(HANDLE_STORE, 'readwrite');
      transaction.objectStore(HANDLE_STORE).delete(ROOT_HANDLE_KEY);
      await transactionComplete(transaction);
    } finally {
      db.close();
    }
  },
});

const isPackFilename = (name: string): boolean => {
  const lower = name.toLowerCase();
  return lower.endsWith('.vpatternpack')
    && !lower.includes('.backup-')
    && !lower.includes('.backup.')
    && !lower.includes('.bak.');
};

const collectPackHandles = async (
  directory: PatternDirectoryHandle,
): Promise<Array<{ path: string; handle: PatternFileHandle }>> => {
  const packs: Array<{ path: string; handle: PatternFileHandle }> = [];
  const visit = async (
    currentDirectory: PatternDirectoryHandle,
    depth: number,
    prefix: string,
  ): Promise<void> => {
    if (!currentDirectory.entries) {
      throw new Error('The connected private folder cannot be read by this browser.');
    }
    for await (const [name, handle] of currentDirectory.entries()) {
      if (packs.length >= MAX_PACK_FILES) break;
      if (name.startsWith('.')) continue;
      const relativePath = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'file' && isPackFilename(name)) {
        packs.push({ path: relativePath, handle });
      } else if (handle.kind === 'directory' && depth < MAX_SCAN_DEPTH) {
        await visit(handle, depth + 1, relativePath);
      }
    }
  };
  await visit(directory, 0, '');
  return packs.sort((left, right) => left.path.localeCompare(right.path));
};

export const isLocalPatternDirectorySupported = (): boolean =>
  typeof window !== 'undefined'
  && typeof indexedDB !== 'undefined'
  && 'showDirectoryPicker' in window;

export const createLocalPatternDirectory = ({
  storage = createIndexedDbLocalPatternDirectoryStorage(),
  installer = localPatternLibrary,
  pickDirectory = async () => {
    const picker = (window as Window & {
      showDirectoryPicker?: (options?: { mode?: 'read'; startIn?: 'documents' }) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker;
    if (!picker) throw new Error('Private folder access is unavailable in this browser.');
    return await picker({ mode: 'read', startIn: 'documents' }) as unknown as PatternDirectoryHandle;
  },
}: {
  storage?: LocalPatternDirectoryStorage;
  installer?: LocalPatternInstaller;
  pickDirectory?: () => Promise<PatternDirectoryHandle>;
} = {}) => {
  const syncHandle = async (handle: PatternDirectoryHandle): Promise<LocalPatternDirectorySyncResult> => {
    const permission = handle.queryPermission
      ? await handle.queryPermission({ mode: 'read' })
      : 'granted';
    if (permission !== 'granted') {
      return { status: 'permission-required', loadedPacks: 0, failedPacks: 0 };
    }

    const packs = await collectPackHandles(handle);
    let loadedPacks = 0;
    let failedPacks = 0;
    for (const { handle: fileHandle } of packs) {
      try {
        const file = await fileHandle.getFile();
        await installer.install(await file.arrayBuffer());
        loadedPacks += 1;
      } catch {
        failedPacks += 1;
      }
    }
    return { status: 'connected', loadedPacks, failedPacks };
  };

  return {
    status: async (): Promise<LocalPatternDirectoryStatus> => {
      if (!isLocalPatternDirectorySupported()) return 'unsupported';
      const handle = await storage.load();
      if (!handle) return 'not-connected';
      const permission = handle.queryPermission
        ? await handle.queryPermission({ mode: 'read' })
        : 'granted';
      return permission === 'granted' ? 'connected' : 'permission-required';
    },
    connect: async (): Promise<LocalPatternDirectorySyncResult> => {
      const handle = await pickDirectory();
      await storage.save(handle);
      return syncHandle(handle);
    },
    sync: async (): Promise<LocalPatternDirectorySyncResult> => {
      if (!isLocalPatternDirectorySupported()) {
        return { status: 'unsupported', loadedPacks: 0, failedPacks: 0 };
      }
      const handle = await storage.load();
      return handle
        ? syncHandle(handle)
        : { status: 'not-connected', loadedPacks: 0, failedPacks: 0 };
    },
    reconnect: async (): Promise<LocalPatternDirectorySyncResult> => {
      const handle = await storage.load();
      if (!handle) {
        return { status: 'not-connected', loadedPacks: 0, failedPacks: 0 };
      }
      const permission = handle.requestPermission
        ? await handle.requestPermission({ mode: 'read' })
        : 'granted';
      return permission === 'granted'
        ? syncHandle(handle)
        : { status: 'permission-required', loadedPacks: 0, failedPacks: 0 };
    },
    disconnect: () => storage.clear(),
  };
};

export const localPatternDirectory = createLocalPatternDirectory();
