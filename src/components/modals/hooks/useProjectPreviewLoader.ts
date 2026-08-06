import { debugWarn, logError } from '@/utils/debug';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ProjectPreview } from '@/components/modals/types';
import type { Project } from '@/types';
import {
  createProjectArchiveInspectionSession,
  deserializeProject,
  generateProjectThumbnail,
  getProjectHealthWarning,
  type ProjectHealthReport,
} from '@/utils/projectIO';
import { repairAndExportProject } from '@/utils/projectRepairExport';

type ProcessProjectFileOptions = {
  autoImport?: boolean;
  fileHandle?: FileSystemFileHandle | null;
};

type ImportProjectFn = (
  project: Project,
  options?: { fileName?: string | null; fileHandle?: FileSystemFileHandle | null },
) => Promise<void>;

type UseProjectPreviewLoaderOptions = {
  importProject: ImportProjectFn;
  closeModal: () => void;
  notify?: (notification: {
    type: 'success' | 'warning' | 'error';
    title: string;
    message: string;
    timestamp: Date;
  }) => void;
};

const EMPTY_FILE_RETRY_ATTEMPTS = 8;
const EMPTY_FILE_INITIAL_RETRY_DELAY_MS = 120;
const EMPTY_FILE_MAX_RETRY_DELAY_MS = 1200;
const waitFor = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  signal?.throwIfAborted();
  const timeout = setTimeout(() => {
    signal?.removeEventListener('abort', handleAbort);
    resolve();
  }, ms);
  const handleAbort = () => {
    clearTimeout(timeout);
    reject(signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
  };
  signal?.addEventListener('abort', handleAbort, { once: true });
});

const buildRepairOnlyHealthReport = (warning: string): ProjectHealthReport => ({
  projectManifestBytes: 0,
  previewManifestBytes: 0,
  combinedManifestBytes: 0,
  archiveBytes: 0,
  compressionRatio: 1,
  binaryPayloadBytes: 0,
  colorCycleDuplicationRiskLayers: [],
  unresolvedColorCycleDefLayers: [],
  staticPreviewColorCycleLayers: [],
  sectionBreakdown: [],
  largestLayers: [],
  recommendations: ['Use Repair & Save Copy to create an openable project copy.'],
  warnings: [warning],
  primaryWarning: warning,
});

const refreshPossiblyIncompleteFile = async (
  file: File,
  fileHandle?: FileSystemFileHandle | null,
  signal?: AbortSignal,
): Promise<File> => {
  if (file.size > 0 || !fileHandle) {
    return file;
  }

  let latest = file;
  let retryDelayMs = EMPTY_FILE_INITIAL_RETRY_DELAY_MS;
  for (let attempt = 0; attempt < EMPTY_FILE_RETRY_ATTEMPTS; attempt += 1) {
    await waitFor(retryDelayMs, signal);
    signal?.throwIfAborted();
    latest = await fileHandle.getFile();
    if (latest.size > 0) {
      return latest;
    }
    retryDelayMs = Math.min(Math.round(retryDelayMs * 1.5), EMPTY_FILE_MAX_RETRY_DELAY_MS);
  }

  return latest;
};

export function useProjectPreviewLoader({
  importProject,
  closeModal,
  notify,
}: UseProjectPreviewLoaderOptions) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [applyInFlight, setApplyInFlight] = useState(false);
  const [repairExportInFlight, setRepairExportInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [projectData, setProjectData] = useState<ArrayBuffer | null>(null);
  const [cachedProject, setCachedProject] = useState<Project | null>(null);
  const [preview, setPreview] = useState<ProjectPreview | null>(null);
  const [selectedFileHandle, setSelectedFileHandle] = useState<FileSystemFileHandle | null>(null);
  const [requiresRepair, setRequiresRepair] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);

  const previewRequestVersionRef = useRef(0);
  const previewAbortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    setIsProcessing(false);
    setIsInspecting(false);
    setApplyInFlight(false);
    setRepairExportInFlight(false);
    setError(null);
    setWarning(null);
    setProjectData(null);
    setCachedProject(null);
    setPreview(null);
    setSelectedFileHandle(null);
    setRequiresRepair(false);
    setProcessingStatus(null);
    previewRequestVersionRef.current += 1;
  }, []);

  useEffect(() => {
    return () => previewAbortRef.current?.abort();
  }, []);

  const processProjectFile = useCallback(async (
    file: File,
    options?: ProcessProjectFileOptions,
  ) => {
    previewAbortRef.current?.abort();
    const abortController = new AbortController();
    previewAbortRef.current = abortController;
    const { signal } = abortController;
    const autoImport = options?.autoImport ?? false;
    const requestVersion = previewRequestVersionRef.current + 1;
    previewRequestVersionRef.current = requestVersion;

    setIsProcessing(true);
    setIsInspecting(false);
    setError(null);
    setWarning(null);
    setProcessingStatus(`Opening ${file.name}…`);
    setApplyInFlight(autoImport);

    const isStale = () => requestVersion !== previewRequestVersionRef.current;

    try {
      const resolvedFile = await refreshPossiblyIncompleteFile(file, options?.fileHandle, signal);
      if (isStale()) {
        return;
      }

      if (resolvedFile.size === 0) {
        setError('File is empty or incomplete. Autosave may have failed to write the file.');
        setProjectData(null);
        setPreview(null);
        setCachedProject(null);
        return;
      }

      const buffer = await resolvedFile.arrayBuffer();
      if (isStale()) {
        return;
      }
      setRequiresRepair(false);

      const inspectionSession = await createProjectArchiveInspectionSession(buffer, { signal });
      if (isStale()) {
        return;
      }

      const { project, metadata } = inspectionSession.preview;
      const previewDetails: ProjectPreview = {
        projectName: project.name,
        width: project.width,
        height: project.height,
        createdAt: metadata?.created,
        modifiedAt: metadata?.modified,
        thumbnail: project.thumbnail,
        hasEmbeddedThumbnail: Boolean(project.thumbnail),
        fileName: resolvedFile.name,
        fileSize: resolvedFile.size,
        healthReport: null,
        healthWarning: null,
      };

      setProjectData(buffer);
      setPreview(previewDetails);
      setCachedProject(null);
      setSelectedFileHandle(options?.fileHandle ?? null);
      setIsProcessing(false);
      setIsInspecting(true);
      setProcessingStatus('Checking project health…');

      const archiveAnalysis = await inspectionSession.analyzeArchiveRefs({ signal });
      if (isStale()) {
        return;
      }
      if (archiveAnalysis.canRepairDanglingColorCycleRefs) {
        const warning = 'This project has damaged color-cycle archive refs. Use Repair & Save Copy to open a preview-only repaired copy.';
        setRequiresRepair(true);
        setWarning(warning);
        setPreview({
          ...previewDetails,
          healthReport: buildRepairOnlyHealthReport(warning),
          healthWarning: warning,
        });
        return;
      }

      const healthReport = await inspectionSession.readHealthReport({ signal });
      if (isStale()) {
        return;
      }
      const inspectedPreview: ProjectPreview = {
        ...previewDetails,
        healthReport,
        healthWarning: getProjectHealthWarning(healthReport),
      };
      setPreview(inspectedPreview);

      let hydratedProject: Project | null = null;
      const ensureHydratedProject = async (): Promise<Project> => {
        if (!hydratedProject) {
          hydratedProject = await deserializeProject(buffer, {
            lazyColorCycleRuntime: true,
          });
        }
        return hydratedProject;
      };

      if (!project.thumbnail && !autoImport) {
        try {
          setProcessingStatus('Generating preview…');
          const hydrated = await ensureHydratedProject();
          if (isStale()) {
            return;
          }
          const thumbnail = generateProjectThumbnail(hydrated, hydrated.layers ?? [], 512);
          if (isStale()) {
            return;
          }
          setCachedProject(hydrated);
          setPreview({
            ...inspectedPreview,
            thumbnail,
            hasEmbeddedThumbnail: false,
          });
        } catch (thumbnailError) {
          if (!signal.aborted) {
            debugWarn('raw-console', '[LoadProjectModal] Failed to generate thumbnail', thumbnailError);
          }
        }
      }

      if (autoImport) {
        if (inspectedPreview.healthWarning) {
          setWarning(inspectedPreview.healthWarning);
          return;
        }
        const hydrated = await ensureHydratedProject();
        if (isStale()) {
          return;
        }
        setCachedProject(hydrated);
        await importProject(hydrated, { fileName: resolvedFile.name, fileHandle: options?.fileHandle ?? null });
        if (isStale()) {
          return;
        }
        closeModal();
      }
    } catch (processError) {
      if (isStale() || signal.aborted) {
        return;
      }
      logError('[LoadProjectModal] Failed to process project file', processError);
      setProjectData(null);
      setPreview(null);
      setCachedProject(null);
      setRequiresRepair(false);
      setError(processError instanceof Error ? processError.message : 'Failed to read project file');
    } finally {
      if (!isStale()) {
        setIsProcessing(false);
        setIsInspecting(false);
        setProcessingStatus(null);
        if (autoImport) {
          setApplyInFlight(false);
        }
      }
    }
  }, [closeModal, importProject]);

  const confirmLoad = useCallback(async () => {
    if (!projectData || applyInFlight || isInspecting) {
      return;
    }
    setApplyInFlight(true);
    setError(null);
    setWarning(null);

    try {
      const project = cachedProject ?? await deserializeProject(projectData, {
        lazyColorCycleRuntime: true,
      });
      await importProject(project, {
        fileName: preview?.fileName ?? null,
        fileHandle: selectedFileHandle,
      });
      closeModal();
    } catch (confirmError) {
      logError('[LoadProjectModal] Failed to import project', confirmError);
      setError(confirmError instanceof Error ? confirmError.message : 'Failed to load project');
    } finally {
      setApplyInFlight(false);
    }
  }, [applyInFlight, cachedProject, closeModal, importProject, isInspecting, preview?.fileName, projectData, selectedFileHandle]);

  const confirmRepairExport = useCallback(async () => {
    if (!projectData || repairExportInFlight || isInspecting) {
      return;
    }

    setRepairExportInFlight(true);
    setError(null);

    try {
      const result = await repairAndExportProject(projectData, {
        fileName: preview?.fileName ?? null,
        confirmWrite: async (summary) => window.confirm(summary.confirmationMessage),
      });

      if (!result) {
        return;
      }

      notify?.({
        type: 'success',
        title: 'Repair Copy Saved',
        message: `Saved ${result.fileName} with ${result.summary.repairCount} repair${result.summary.repairCount === 1 ? '' : 's'} applied.`,
        timestamp: new Date(),
      });
    } catch (repairError) {
      logError('[LoadProjectModal] Failed to repair/export project', repairError);
      const message = repairError instanceof Error ? repairError.message : 'Failed to repair project';
      setError(message);
      notify?.({
        type: 'error',
        title: 'Repair Failed',
        message,
        timestamp: new Date(),
      });
    } finally {
      setRepairExportInFlight(false);
    }
  }, [isInspecting, notify, preview?.fileName, projectData, repairExportInFlight]);

  return {
    isProcessing,
    isInspecting,
    applyInFlight,
    repairExportInFlight,
    error,
    warning,
    preview,
    projectData,
    selectedFileHandle,
    requiresRepair,
    processingStatus,
    processProjectFile,
    confirmLoad,
    confirmRepairExport,
    reset,
  };
}
