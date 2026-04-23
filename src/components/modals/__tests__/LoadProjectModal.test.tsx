/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import LoadProjectModal from '../LoadProjectModal';
import {
  deserializeProject,
  generateProjectThumbnail,
  getProjectHealthWarning,
  readProjectHealthReport,
  readProjectPreviewManifest,
} from '@/utils/projectIO';
import { repairAndExportProject } from '@/utils/projectRepairExport';

jest.mock('@/hooks/useKeyboardScope', () => ({
  useKeyboardScope: jest.fn(),
}));

jest.mock('@/utils/projectIO', () => ({
  deserializeProject: jest.fn(),
  generateProjectThumbnail: jest.fn(),
  getProjectHealthWarning: jest.fn((report) => report?.primaryWarning ?? null),
  readProjectHealthReport: jest.fn(),
  readProjectPreviewManifest: jest.fn(),
}));

jest.mock('@/utils/projectRepairExport', () => ({
  repairAndExportProject: jest.fn(),
}));

const mockStore = {
  importProject: jest.fn(),
  toggleModal: jest.fn(),
  addNotification: jest.fn(),
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
const mockReadProjectHealthReport = readProjectHealthReport as jest.MockedFunction<typeof readProjectHealthReport>;
const mockDeserializeProject = deserializeProject as jest.MockedFunction<typeof deserializeProject>;
const mockGenerateProjectThumbnail = generateProjectThumbnail as jest.MockedFunction<typeof generateProjectThumbnail>;
const mockGetProjectHealthWarning = getProjectHealthWarning as jest.MockedFunction<typeof getProjectHealthWarning>;
const mockRepairAndExportProject = repairAndExportProject as jest.MockedFunction<typeof repairAndExportProject>;
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
    mockReadProjectHealthReport.mockResolvedValue({
      projectManifestBytes: 10,
      previewManifestBytes: 10,
      combinedManifestBytes: 20,
      archiveBytes: 20,
      compressionRatio: 1,
      binaryPayloadBytes: 0,
      colorCycleDuplicationRiskLayers: [],
      unresolvedColorCycleDefLayers: [],
      sectionBreakdown: [],
      largestLayers: [],
      recommendations: ['Looks fine'],
      warnings: [],
      primaryWarning: null,
    });
    mockGenerateProjectThumbnail.mockReturnValue('data:image/png;base64,generated');
    mockGetProjectHealthWarning.mockImplementation((report) => report?.primaryWarning ?? null);
    mockRepairAndExportProject.mockResolvedValue({
      project: ({
        id: 'p1',
        name: 'demo',
        width: 16,
        height: 16,
        backgroundColor: '#000000',
        layers: [],
        customBrushes: [],
      } as any),
      migration: {
        repairs: [{ code: 'legacy-fix', message: 'Fixed legacy issue', semantic: true, layerType: 'color-cycle' }],
        hasSemanticRepairs: true,
        shouldMarkDirty: true,
      },
      beforeHealth: {
        projectManifestBytes: 10,
        previewManifestBytes: 10,
        combinedManifestBytes: 20,
        archiveBytes: 20,
        compressionRatio: 1,
        binaryPayloadBytes: 0,
        colorCycleDuplicationRiskLayers: ['layer-cc-risk'],
        unresolvedColorCycleDefLayers: [],
        sectionBreakdown: [],
        largestLayers: [],
        recommendations: [],
        warnings: ['warn'],
        primaryWarning: 'warn',
      },
      afterHealth: {
        projectManifestBytes: 10,
        previewManifestBytes: 10,
        combinedManifestBytes: 20,
        archiveBytes: 20,
        compressionRatio: 1,
        binaryPayloadBytes: 0,
        colorCycleDuplicationRiskLayers: [],
        unresolvedColorCycleDefLayers: [],
        sectionBreakdown: [],
        largestLayers: [],
        recommendations: [],
        warnings: [],
        primaryWarning: null,
      },
      summary: {
        repairCount: 1,
        semanticRepairCount: 1,
        beforeWarningCount: 1,
        afterWarningCount: 0,
        headline: 'Repair 1 legacy issue and save a canonical copy?',
        detailLines: ['Fixed legacy issue'],
        confirmationMessage: 'Repair 1 legacy issue and save a canonical copy?',
      },
      fileName: 'risky-repaired.vs',
      fileHandle: null,
    } as any);
    (window as Window & { confirm?: (message?: string) => boolean }).confirm = jest.fn(() => true);
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

  it('accepts OS-style file drags where getAsFile is unavailable before drop', async () => {
    const file = createProjectFile('dropped.vs');

    render(<LoadProjectModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.dragEnter(window, {
      dataTransfer: {
        types: ['Files'],
        items: [
          {
            kind: 'file',
            getAsFile: () => null,
          },
        ],
      },
    });

    expect(screen.getByText('Select or drop a Vessel project')).toBeInTheDocument();

    fireEvent.drop(window, {
      dataTransfer: {
        types: ['Files'],
        files: [file],
        items: [
          {
            kind: 'file',
            getAsFile: () => file,
          },
        ],
      },
    });

    await waitFor(() => {
      expect(mockReadProjectPreviewManifest).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText('Select or drop a Vessel project')).not.toBeInTheDocument();
  });

  it('loads directory entries from a dropped folder handle', async () => {
    const alphaHandle = createFileHandle('alpha.vs');
    const betaHandle = createFileHandle('beta.vs');
    const directoryHandle = createDirectoryHandle([
      ['alpha.vs', alphaHandle],
      ['beta.vs', betaHandle],
    ]);

    render(<LoadProjectModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.dragEnter(window, {
      dataTransfer: {
        types: ['Files'],
        items: [
          {
            kind: 'file',
            getAsFile: () => null,
            getAsFileSystemHandle: async () => directoryHandle,
          },
        ],
      },
    });

    expect(screen.getByText('Select or drop a Vessel project')).toBeInTheDocument();

    fireEvent.drop(window, {
      dataTransfer: {
        types: ['Files'],
        items: [
          {
            kind: 'file',
            getAsFile: () => null,
            getAsFileSystemHandle: async () => directoryHandle,
          },
        ],
      },
    });

    expect(await screen.findByText('alpha.vs')).toBeInTheDocument();
    expect(await screen.findByText('beta.vs')).toBeInTheDocument();
  });

  it('shows a project health warning and blocks auto-import for risky files', async () => {
    const riskyHandle = createFileHandle('risky.vs');
    (window as any).showDirectoryPicker = jest.fn(async () => createDirectoryHandle([
      ['risky.vs', riskyHandle],
    ]));
    mockReadProjectHealthReport.mockResolvedValue({
      projectManifestBytes: 10,
      previewManifestBytes: 10,
      combinedManifestBytes: 20,
      archiveBytes: 20,
      compressionRatio: 1,
      binaryPayloadBytes: 0,
      colorCycleDuplicationRiskLayers: ['layer-cc-risk'],
      unresolvedColorCycleDefLayers: [],
      sectionBreakdown: [{ name: 'layers', bytes: 12 }],
      largestLayers: [{
        layerId: 'layer-cc-risk',
        layerName: 'Risk Layer',
        layerType: 'color-cycle',
        bytes: 12,
        dominantSection: 'colorCycleData',
        dominantSectionBytes: 12,
      }],
      recommendations: ['Risky project'],
      warnings: ['This project contains legacy duplicated color-cycle state. Re-save or repair it before archival sharing.'],
      primaryWarning: 'This project contains legacy duplicated color-cycle state. Re-save or repair it before archival sharing.',
    });

    render(<LoadProjectModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByText('Browse Folder'));
    expect(await screen.findByText('risky.vs')).toBeInTheDocument();

    fireEvent.doubleClick(screen.getByText('risky.vs'));

    await waitFor(() => {
      expect(
        screen.getAllByText('This project contains legacy duplicated color-cycle state. Re-save or repair it before archival sharing.').length,
      ).toBeGreaterThan(0);
    });
    expect(screen.getByText('Warnings')).toBeInTheDocument();
    expect(screen.getByText('Recommendations')).toBeInTheDocument();
    expect(screen.getByText('Risky project')).toBeInTheDocument();
    expect(screen.getByText('Archive 20 B')).toBeInTheDocument();
    expect(screen.getByText('Manifest 20 B')).toBeInTheDocument();
    expect(screen.getByText('Top layers')).toBeInTheDocument();
    expect(screen.getByText('Largest Risk Layer (12 B)')).toBeInTheDocument();
    expect(mockStore.importProject).not.toHaveBeenCalled();
    expect(screen.getByText('Project Health')).toBeInTheDocument();
  });

  it('repairs and saves a canonical copy for risky files', async () => {
    const riskyHandle = createFileHandle('risky.vs');
    (window as any).showDirectoryPicker = jest.fn(async () => createDirectoryHandle([
      ['risky.vs', riskyHandle],
    ]));
    mockReadProjectHealthReport.mockResolvedValue({
      projectManifestBytes: 10,
      previewManifestBytes: 10,
      combinedManifestBytes: 20,
      archiveBytes: 20,
      compressionRatio: 1,
      binaryPayloadBytes: 0,
      colorCycleDuplicationRiskLayers: ['layer-cc-risk'],
      unresolvedColorCycleDefLayers: [],
      sectionBreakdown: [{ name: 'layers', bytes: 12 }],
      largestLayers: [{
        layerId: 'layer-cc-risk',
        layerName: 'Risk Layer',
        layerType: 'color-cycle',
        bytes: 12,
        dominantSection: 'colorCycleData',
        dominantSectionBytes: 12,
      }],
      recommendations: ['Risky project'],
      warnings: ['This project contains legacy duplicated color-cycle state. Re-save or repair it before archival sharing.'],
      primaryWarning: 'This project contains legacy duplicated color-cycle state. Re-save or repair it before archival sharing.',
    });

    render(<LoadProjectModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByText('Browse Folder'));
    expect(await screen.findByText('risky.vs')).toBeInTheDocument();

    fireEvent.doubleClick(screen.getByText('risky.vs'));

    await waitFor(() => {
      expect(screen.getByText('Repair & Save Copy')).toBeEnabled();
    });

    fireEvent.click(screen.getByText('Repair & Save Copy'));

    await waitFor(() => {
      expect(mockRepairAndExportProject).toHaveBeenCalledTimes(1);
    });
    expect(mockStore.addNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'success',
      title: 'Repair Copy Saved',
    }));
  });

});
