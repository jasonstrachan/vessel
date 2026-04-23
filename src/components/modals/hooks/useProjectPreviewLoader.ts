import { useCallback, useRef, useState } from 'react';

import type { ProjectPreview } from '@/components/modals/types';
import type { Project } from '@/types';
import {
  deserializeProject,
  generateProjectThumbnail,
  getProjectHealthWarning,
  readProjectHealthReport,
  readProjectPreviewManifest,
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
const waitFor = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});

const refreshPossiblyIncompleteFile = async (
  file: File,
  fileHandle?: FileSystemFileHandle | null,
): Promise<File> => {
  if (file.size > 0 || !fileHandle) {
    return file;
  }

  let latest = file;
  let retryDelayMs = EMPTY_FILE_INITIAL_RETRY_DELAY_MS;
  for (let attempt = 0; attempt < EMPTY_FILE_RETRY_ATTEMPTS; attempt += 1) {
    await waitFor(retryDelayMs);
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
  const [applyInFlight, setApplyInFlight] = useState(false);
  const [repairExportInFlight, setRepairExportInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [projectData, setProjectData] = useState<ArrayBuffer | null>(null);
  const [cachedProject, setCachedProject] = useState<Project | null>(null);
  const [preview, setPreview] = useState<ProjectPreview | null>(null);
  const [selectedFileHandle, setSelectedFileHandle] = useState<FileSystemFileHandle | null>(null);

  const previewRequestVersionRef = useRef(0);

  const reset = useCallback(() => {
    setIsProcessing(false);
    setApplyInFlight(false);
    setRepairExportInFlight(false);
    setError(null);
    setWarning(null);
    setProjectData(null);
    setCachedProject(null);
    setPreview(null);
    setSelectedFileHandle(null);
    previewRequestVersionRef.current += 1;
  }, []);

  const processProjectFile = useCallback(async (
    file: File,
    options?: ProcessProjectFileOptions,
  ) => {
    const autoImport = options?.autoImport ?? false;
    const requestVersion = previewRequestVersionRef.current + 1;
    previewRequestVersionRef.current = requestVersion;

    setIsProcessing(true);
    setError(null);
    setWarning(null);
    if (autoImport) {
      setApplyInFlight(true);
    }

    const isStale = () => requestVersion !== previewRequestVersionRef.current;

    try {
      const resolvedFile = await refreshPossiblyIncompleteFile(file, options?.fileHandle);
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

      const vesselProject = await readProjectPreviewManifest(buffer);
      if (isStale()) {
        return;
      }
      const healthReport = await readProjectHealthReport(buffer);
      if (isStale()) {
        return;
      }

      const { project, metadata } = vesselProject;
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
        healthReport,
        healthWarning: getProjectHealthWarning(healthReport),
      };

      setProjectData(buffer);
      setPreview(previewDetails);
      setCachedProject(null);
      setSelectedFileHandle(options?.fileHandle ?? null);

      let hydratedProject: Project | null = null;
      const ensureHydratedProject = async (): Promise<Project> => {
        if (!hydratedProject) {
          hydratedProject = await deserializeProject(buffer);
        }
        return hydratedProject;
      };

      if (!project.thumbnail && !autoImport) {
        void (async () => {
          try {
            const hydrated = await ensureHydratedProject();
            if (isStale()) {
              return;
            }
            const thumbnail = generateProjectThumbnail(hydrated, hydrated.layers ?? [], 512);
            if (isStale()) {
              return;
            }
            setCachedProject(hydrated);
            setPreview((prev) => (prev
              ? {
                ...prev,
                thumbnail,
                hasEmbeddedThumbnail: false,
              }
              : prev));
          } catch (thumbnailError) {
            console.warn('[LoadProjectModal] Failed to generate thumbnail', thumbnailError);
          }
        })();
      }

      if (autoImport) {
        if (previewDetails.healthWarning) {
          setWarning(previewDetails.healthWarning);
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
      if (isStale()) {
        return;
      }
      console.error('[LoadProjectModal] Failed to process project file', processError);
      setProjectData(null);
      setPreview(null);
      setCachedProject(null);
      setError(processError instanceof Error ? processError.message : 'Failed to read project file');
    } finally {
      if (!isStale()) {
        setIsProcessing(false);
        if (autoImport) {
          setApplyInFlight(false);
        }
      }
    }
  }, [closeModal, importProject]);

  const confirmLoad = useCallback(async () => {
    if (!projectData || applyInFlight) {
      return;
    }
    setApplyInFlight(true);
    setError(null);
    setWarning(null);

    try {
      const project = cachedProject ?? await deserializeProject(projectData);
      await importProject(project, {
        fileName: preview?.fileName ?? null,
        fileHandle: selectedFileHandle,
      });
      closeModal();
    } catch (confirmError) {
      console.error('[LoadProjectModal] Failed to import project', confirmError);
      setError(confirmError instanceof Error ? confirmError.message : 'Failed to load project');
    } finally {
      setApplyInFlight(false);
    }
  }, [applyInFlight, cachedProject, closeModal, importProject, preview?.fileName, projectData, selectedFileHandle]);

  const confirmRepairExport = useCallback(async () => {
    if (!projectData || repairExportInFlight) {
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
      console.error('[LoadProjectModal] Failed to repair/export project', repairError);
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
  }, [notify, preview?.fileName, projectData, repairExportInFlight]);

  return {
    isProcessing,
    applyInFlight,
    repairExportInFlight,
    error,
    warning,
    preview,
    projectData,
    selectedFileHandle,
    processProjectFile,
    setError,
    confirmLoad,
    confirmRepairExport,
    reset,
  };
}
