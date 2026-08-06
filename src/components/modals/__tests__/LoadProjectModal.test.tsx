/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import LoadProjectModal from '../LoadProjectModal';
import {
  createProjectArchiveInspectionSession,
  deserializeProject,
  generateProjectThumbnail,
  getProjectHealthWarning,
} from '@/utils/projectIO';
import { repairAndExportProject } from '@/utils/projectRepairExport';

jest.mock('@/hooks/useKeyboardScope', () => ({
  useKeyboardScope: jest.fn(),
}));

jest.mock('@/utils/projectIO', () => ({
  createProjectArchiveInspectionSession: jest.fn(),
  deserializeProject: jest.fn(),
  generateProjectThumbnail: jest.fn(),
  getProjectHealthWarning: jest.fn((report) => report?.primaryWarning ?? null),
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

const mockCreateProjectArchiveInspectionSession = createProjectArchiveInspectionSession as jest.MockedFunction<
  typeof createProjectArchiveInspectionSession
>;
const mockSessionAnalyzeArchiveRefs = jest.fn();
const mockSessionReadHealthReport = jest.fn();
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
    const preview = {
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
    } as any;
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
    mockSessionReadHealthReport.mockResolvedValue({
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
    mockSessionAnalyzeArchiveRefs.mockResolvedValue({
      issues: [],
      missingCanonicalColorCycleRefs: [],
      missingOptionalColorCycleRefs: [],
      canRepairDanglingColorCycleRefs: false,
    });
    mockCreateProjectArchiveInspectionSession.mockResolvedValue({
      preview,
      analyzeArchiveRefs: mockSessionAnalyzeArchiveRefs,
      readHealthReport: mockSessionReadHealthReport,
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

  it('paints the manifest preview before archive health inspection finishes', async () => {
    const archiveAnalysis = createDeferred<Awaited<ReturnType<typeof mockSessionAnalyzeArchiveRefs>>>();
    mockSessionAnalyzeArchiveRefs.mockReturnValueOnce(archiveAnalysis.promise);
    const { container } = render(<LoadProjectModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('Missing project file input');
    }
    fireEvent.change(input, {
      target: { files: [createProjectFile('staged-preview.vs')] },
    });

    expect(await screen.findByRole('img', { name: 'demo preview' })).toBeInTheDocument();
    expect(screen.getByText('Checking project health…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load Project' })).toBeDisabled();

    archiveAnalysis.resolve({
      issues: [],
      missingCanonicalColorCycleRefs: [],
      missingOptionalColorCycleRefs: [],
      canRepairDanglingColorCycleRefs: false,
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Load Project' })).toBeEnabled();
    });
  });

  it('aborts superseded inspection work and labels the incoming file', async () => {
    const firstSignal = createDeferred<AbortSignal>();
    const firstAnalyze = jest.fn(({ signal }: { signal?: AbortSignal } = {}) => {
      if (!signal) {
        throw new Error('Missing inspection signal');
      }
      firstSignal.resolve(signal);
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const secondPreview = {
      version: '1.0.0',
      metadata: {
        name: 'second',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'second',
        name: 'second',
        width: 16,
        height: 16,
        thumbnail: 'data:image/png;base64,second',
      },
    } as any;
    mockCreateProjectArchiveInspectionSession
      .mockResolvedValueOnce({
        preview: {
          ...secondPreview,
          project: { ...secondPreview.project, id: 'first', name: 'first' },
        },
        analyzeArchiveRefs: firstAnalyze,
        readHealthReport: mockSessionReadHealthReport,
      })
      .mockResolvedValueOnce({
        preview: secondPreview,
        analyzeArchiveRefs: mockSessionAnalyzeArchiveRefs,
        readHealthReport: mockSessionReadHealthReport,
      });
    const { container } = render(<LoadProjectModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('Missing project file input');
    }

    fireEvent.change(input, { target: { files: [createProjectFile('first.vs')] } });
    expect(await screen.findByRole('img', { name: 'first preview' })).toBeInTheDocument();
    const supersededSignal = await firstSignal.promise;

    fireEvent.change(input, { target: { files: [createProjectFile('second.vs')] } });
    expect(screen.getByText('Opening second.vs…')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'second preview' })).toBeInTheDocument();
    expect(supersededSignal.aborted).toBe(true);
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
      expect(mockCreateProjectArchiveInspectionSession).toHaveBeenCalledTimes(1);
    });
  });

  it('loads a folder project when its name is double-clicked', async () => {
    const handle = createFileHandle('open-me.vs');
    (window as any).showDirectoryPicker = jest.fn(async () => createDirectoryHandle([
      ['open-me.vs', handle],
    ]));

    const onClose = jest.fn();
    render(<LoadProjectModal isOpen onClose={onClose} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByText('Browse Folder'));
    const projectName = await screen.findByText('open-me.vs');

    fireEvent.doubleClick(projectName);

    await waitFor(() => {
      expect(mockStore.importProject).toHaveBeenCalledTimes(1);
    });
    expect(mockStore.importProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1', name: 'demo' }),
      expect.objectContaining({ fileName: 'open-me.vs', fileHandle: handle }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
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
      expect(mockCreateProjectArchiveInspectionSession).toHaveBeenCalledTimes(1);
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
      expect(mockCreateProjectArchiveInspectionSession).toHaveBeenCalledTimes(1);
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
    mockSessionReadHealthReport.mockResolvedValue({
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
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.queryByText('Warnings')).not.toBeInTheDocument();
    expect(screen.queryByText('Recommendations')).not.toBeInTheDocument();
    expect(screen.getByText('Risky project')).toBeInTheDocument();
    expect(screen.getByText('Archive 20 B')).toBeInTheDocument();
    expect(screen.getByText('Manifest 20 B')).toBeInTheDocument();
    expect(screen.getByText('Top layers')).toBeInTheDocument();
    expect(screen.getByText('Largest Risk Layer (12 B)')).toBeInTheDocument();
    expect(mockStore.importProject).not.toHaveBeenCalled();
    expect(screen.getByText('Project Health')).toBeInTheDocument();
  });

  it('shows repair-only preview for damaged archive refs before health validation', async () => {
    const damagedHandle = createFileHandle('damaged.vs');
    (window as any).showDirectoryPicker = jest.fn(async () => createDirectoryHandle([
      ['damaged.vs', damagedHandle],
    ]));
    mockSessionAnalyzeArchiveRefs.mockResolvedValue({
      issues: [{
        path: 'buffers/color-cycle/layer-cc/paint.bin',
        kind: 'canonical-color-cycle',
        layerId: 'layer-cc',
        layerName: 'Layer CC',
        layerType: 'color-cycle',
        locations: ['project.layers[0].state.paintRef'],
        missingManifestEntry: true,
        missingArchivePayload: true,
      }],
      missingCanonicalColorCycleRefs: [{
        path: 'buffers/color-cycle/layer-cc/paint.bin',
        kind: 'canonical-color-cycle',
        layerId: 'layer-cc',
        layerName: 'Layer CC',
        layerType: 'color-cycle',
        locations: ['project.layers[0].state.paintRef'],
        missingManifestEntry: true,
        missingArchivePayload: true,
      }],
      missingOptionalColorCycleRefs: [],
      canRepairDanglingColorCycleRefs: true,
    });

    render(<LoadProjectModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByText('Browse Folder'));
    expect(await screen.findByText('damaged.vs')).toBeInTheDocument();

    fireEvent.doubleClick(screen.getByText('damaged.vs'));

    await waitFor(() => {
      expect(screen.getByText('Repair & Save Copy')).toBeEnabled();
    });
    expect(screen.getAllByText('This project has damaged color-cycle archive refs. Use Repair & Save Copy to open a preview-only repaired copy.').length)
      .toBeGreaterThan(0);
    expect(mockSessionReadHealthReport).not.toHaveBeenCalled();
    expect(mockStore.importProject).not.toHaveBeenCalled();
  });

  it('repairs and saves a canonical copy for risky files', async () => {
    const riskyHandle = createFileHandle('risky.vs');
    (window as any).showDirectoryPicker = jest.fn(async () => createDirectoryHandle([
      ['risky.vs', riskyHandle],
    ]));
    mockSessionReadHealthReport.mockResolvedValue({
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
