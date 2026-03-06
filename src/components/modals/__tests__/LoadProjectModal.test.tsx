/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import LoadProjectModal from '../LoadProjectModal';
import {
  deserializeProject,
  generateProjectThumbnail,
  readProjectPreviewManifest,
} from '@/utils/projectIO';

jest.mock('@/hooks/useKeyboardScope', () => ({
  useKeyboardScope: jest.fn(),
}));

jest.mock('@/utils/projectIO', () => ({
  deserializeProject: jest.fn(),
  generateProjectThumbnail: jest.fn(),
  readProjectPreviewManifest: jest.fn(),
}));

const mockStore = {
  importProject: jest.fn(),
  toggleModal: jest.fn(),
};

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: (selector: any) => selector(mockStore),
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const mockReadProjectPreviewManifest = readProjectPreviewManifest as jest.MockedFunction<typeof readProjectPreviewManifest>;
const mockDeserializeProject = deserializeProject as jest.MockedFunction<typeof deserializeProject>;
const mockGenerateProjectThumbnail = generateProjectThumbnail as jest.MockedFunction<typeof generateProjectThumbnail>;
let consoleErrorSpy: jest.SpyInstance;

const createProjectFile = (name: string, opts?: { lastModified?: number; bytes?: Uint8Array }): File => {
  const bytes = opts?.bytes ?? new TextEncoder().encode('demo-project');
  const file = new File([bytes], name, {
    type: 'application/json',
    lastModified: opts?.lastModified ?? Date.now(),
  });
  if (typeof (file as any).arrayBuffer !== 'function') {
    (file as any).arrayBuffer = async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  return file;
};

const createFileHandle = (name: string, opts?: { deferred?: Deferred<any>; lastModified?: number }) => {
  const getFile = jest.fn(async () => {
    if (opts?.deferred) {
      return opts.deferred.promise;
    }
    return createProjectFile(name, { lastModified: opts?.lastModified });
  });

  return {
    kind: 'file',
    name,
    getFile,
  };
};

const createDirectoryHandle = (entries: Array<[string, ReturnType<typeof createFileHandle>]>) => {
  return {
    kind: 'directory',
    name: 'projects',
    entries: async function* () {
      for (const [name, handle] of entries) {
        yield [name, handle] as unknown as [string, FileSystemHandle];
      }
    },
  };
};

const createMutableDirectoryHandle = (getEntries: () => Array<[string, ReturnType<typeof createFileHandle>]>) => {
  return {
    kind: 'directory',
    name: 'projects',
    entries: async function* () {
      for (const [name, handle] of getEntries()) {
        yield [name, handle] as unknown as [string, FileSystemHandle];
      }
    },
  };
};

describe('LoadProjectModal', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const first = args[0];
      if (typeof first === 'string' && first.includes('not wrapped in act')) {
        return;
      }
      // Preserve unexpected errors in test output.
      console.warn(...args);
    });
    mockReadProjectPreviewManifest.mockResolvedValue({
      version: '1.0.0',
      metadata: {
        name: 'demo',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'p1',
        name: 'demo',
        width: 16,
        height: 16,
        thumbnail: 'data:image/png;base64,thumb',
      },
    } as any);
    mockDeserializeProject.mockResolvedValue({
      id: 'p1',
      name: 'demo',
      width: 16,
      height: 16,
      backgroundColor: '#000000',
      layers: [],
      customBrushes: [],
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    } as any);
    mockGenerateProjectThumbnail.mockReturnValue('data:image/png;base64,generated');
  });

  afterEach(() => {
    jest.useRealTimers();
    consoleErrorSpy.mockRestore();
  });

  it('renders headings and primary actions when open', () => {
    render(<LoadProjectModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    expect(screen.getAllByText('Load Project')[0]).toBeInTheDocument();
    expect(screen.getByText('Browse Files')).toBeInTheDocument();
    expect(screen.getByText('Browse Folder')).toBeInTheDocument();
  });

  it('invokes onClose when Close button is clicked', () => {
    const onClose = jest.fn();
    render(<LoadProjectModal isOpen onClose={onClose} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getAllByText('Close')[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows folder entries before timestamp getFile() resolves (lazy timestamp hydration)', async () => {
    const deferredA = createDeferred<File>();
    const deferredB = createDeferred<File>();
    const handleA = createFileHandle('alpha.vs', { deferred: deferredA });
    const handleB = createFileHandle('beta.vs', { deferred: deferredB });
    (window as any).showDirectoryPicker = jest.fn(async () => createDirectoryHandle([
      ['alpha.vs', handleA],
      ['beta.vs', handleB],
    ]));

    render(<LoadProjectModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByText('Browse Folder'));

    expect(await screen.findByText('alpha.vs')).toBeInTheDocument();
    expect(await screen.findByText('beta.vs')).toBeInTheDocument();

    deferredA.resolve(createProjectFile('alpha.vs', { lastModified: 1704067200000 }));
    deferredB.resolve(createProjectFile('beta.vs', { lastModified: 1704153600000 }));
  });

  it('supports keyboard navigation for directory entries', async () => {
    const handleA = createFileHandle('a.vs');
    const handleB = createFileHandle('b.vs');
    (window as any).showDirectoryPicker = jest.fn(async () => createDirectoryHandle([
      ['a.vs', handleA],
      ['b.vs', handleB],
    ]));

    render(<LoadProjectModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByText('Browse Folder'));
    await screen.findByText('a.vs');
    await screen.findByText('b.vs');

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    await waitFor(() => {
      expect(mockReadProjectPreviewManifest).toHaveBeenCalledTimes(1);
    });
  });

  it('refreshes cached directory entries when modal is reopened', async () => {
    const entries: Array<[string, ReturnType<typeof createFileHandle>]> = [
      ['first.vs', createFileHandle('first.vs')],
    ];
    const directoryHandle = createMutableDirectoryHandle(() => entries);
    (window as any).showDirectoryPicker = jest.fn(async () => directoryHandle);

    const onClose = jest.fn();
    const { rerender } = render(<LoadProjectModal isOpen onClose={onClose} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByText('Browse Folder'));
    expect(await screen.findByText('first.vs')).toBeInTheDocument();

    entries.push(['second.vs', createFileHandle('second.vs')]);

    rerender(<LoadProjectModal isOpen={false} onClose={onClose} />);
    act(() => {
      jest.runAllTimers();
    });
    rerender(<LoadProjectModal isOpen onClose={onClose} />);
    act(() => {
      jest.runAllTimers();
    });

    expect(await screen.findByText('second.vs')).toBeInTheDocument();
  });

  it('retries handle reads when picker initially returns an empty file', async () => {
    const emptyFile = new File([new Uint8Array()], 'retry.vs', {
      type: 'application/zip',
      lastModified: Date.now(),
    });
    const validFile = createProjectFile('retry.vs', {
      bytes: new TextEncoder().encode('valid-project'),
    });

    const handle = {
      kind: 'file',
      name: 'retry.vs',
      getFile: jest.fn()
        .mockResolvedValueOnce(emptyFile)
        .mockResolvedValueOnce(validFile),
    };

    (window as any).showOpenFilePicker = jest.fn(async () => [handle]);
    render(<LoadProjectModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByText('Browse Files'));
    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(mockReadProjectPreviewManifest).toHaveBeenCalledTimes(1);
    });
    expect(handle.getFile).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('File is empty or incomplete. Autosave may have failed to write the file.')).not.toBeInTheDocument();
  });

});
