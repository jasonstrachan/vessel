import type { StoreApi } from 'zustand';
import type { Project, CustomBrush, Layer } from '@/types';
import { BrushShape } from '@/types';
import {
  normalizeProject,
  createDefaultPalette,
  normalizeLayers,
  dedupeLayerIds,
  cloneExportLayout,
  createDefaultLayerAlignment,
  createDefaultExportLayout,
} from '@/utils/layoutDefaults';
import {
  restoreColorCycleBrushes,
  saveProjectToFile,
  loadProjectFromFile,
  exportProjectAsPNG,
} from '@/utils/projectIO';
import { fileBackupService } from '@/utils/fileBackupService';
import { mergeCustomBrushCollections } from './customBrushMerge';
import {
  createColorCycleBrushManager,
  type ColorCycleBrushManager,
  type ColorCycleBrushRuntimeHost,
} from '../colorCycleBrushManager';
import historyManager, { setActiveHistoryDocument } from '@/history/historyService';
import { logError, debugWarn } from '@/utils/debug';
import { captureCanvasImageData } from '@/utils/canvas/canvasImage';
import { devLog } from '@/utils/devLog';
import { backgroundStorageService } from '@/utils/backgroundStorage';
import { updateToolsWithPalette } from './paletteState';
import { flushPendingToolWork } from '@/utils/toolFlushRegistry';
import {
  waitForAllPendingColorCycleSaves,
  waitForFinalizeQueueIdle,
} from '@/stores/pendingColorCycleSaves';
import { getStoredDisplayFilterDefaults } from '@/stores/slices/canvasSlice';
import { normalizePersistedBrushSettings } from '@/stores/helpers/toolsState';
import { ccWarn } from '@/utils/colorCycle/ccDebug';
import {
  markDerivedSurfaceBuiltFromVersion,
  readColorCycleBrushLayerSnapshotFromRuntime,
} from '@/lib/colorCycle/document';

type AppState = import('../useAppStore').AppState;

type StoreSet = StoreApi<AppState>['setState'];
type StoreGet = StoreApi<AppState>['getState'];
type LegacyColorCycleBrushField = NonNullable<NonNullable<Layer['colorCycleData']>['colorCycleBrush']>;
type ColorCycleManagerRegistrationBrush = ColorCycleBrushRuntimeHost;

export type SaveProjectRequest =
  | string
  | {
      filename?: string;
      forceDialog?: boolean;
    };

type CustomBrushSnapshot = {
  brushes: CustomBrush[];
  defaultCustomBrushId: string | null;
} | null;

type SyncPercentOffsetsFn = (layers: Layer[], project: Project | null) => Layer[];

const imageDataHasVisiblePixels = (imageData: ImageData | null | undefined): boolean => {
  if (!imageData) {
    return false;
  }
  const data = imageData.data;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] !== 0) {
      return true;
    }
  }
  return false;
};

export interface ProjectLifecycleOptions {
  set: StoreSet;
  get: StoreGet;
  colorCycleBrushManager: ColorCycleBrushManager | null;
  persistCustomBrushes: () => void;
  getLastCustomBrushSnapshot: () => CustomBrushSnapshot;
  syncPercentOffsetsFromPixels: SyncPercentOffsetsFn;
}

const resolveDefaultCustomBrushId = (
  candidate: string | null,
  storedDefaultId: string | null,
  brushes: CustomBrush[]
): string | null => {
  if (storedDefaultId && brushes.some((brush) => brush.id === storedDefaultId)) {
    return storedDefaultId;
  }
  if (candidate && brushes.some((brush) => brush.id === candidate)) {
    return candidate;
  }
  return null;
};

export const createProjectLifecycle = ({
  set,
  get,
  colorCycleBrushManager,
  persistCustomBrushes,
  getLastCustomBrushSnapshot,
  syncPercentOffsetsFromPixels,
}: ProjectLifecycleOptions) => {
  const autosaveLog = devLog.scope('AUTOSAVE');
  let latestProjectReplacementRequest = 0;
  const resetColorCycleRuntimeForProjectReplacement = (reason: string): void => {
    const currentState = get();
    set({ pendingColorCycleGradientHandoff: null });
    try {
      currentState.colorCycleRuntimeHandlers?.stop?.(reason);
    } catch (error) {
      debugWarn('raw-console', '[Store] Failed to stop color cycle playback during project replacement:', error);
    }

    try {
      colorCycleBrushManager?.cleanupAll();
    } catch (error) {
      debugWarn('raw-console', '[Store] Failed to reset color cycle runtime during project replacement:', error);
    }
  };

  const setProject = (project: Project): void => {
    historyManager.assertDocumentReplacementAvailable();
    latestProjectReplacementRequest += 1;
    const normalized = normalizeProject(project);
    setActiveHistoryDocument(normalized.id);

    const snapshot = getLastCustomBrushSnapshot();
    const storedBrushes = snapshot?.brushes ?? [];
    const storedDefaultId = snapshot?.defaultCustomBrushId ?? null;

    const mergedCustomBrushes = mergeCustomBrushCollections(
      normalized.customBrushes,
      storedBrushes
    );
    const mergedDefaultId = resolveDefaultCustomBrushId(
      normalized.defaultCustomBrushId ?? null,
      storedDefaultId,
      mergedCustomBrushes
    );

    const nextPalette = normalized.palette ?? createDefaultPalette();
    const projectWithPalette: Project = {
      ...normalized,
      customBrushes: mergedCustomBrushes,
      defaultCustomBrushId: mergedDefaultId,
      palette: nextPalette,
    };

    set((state) => ({
      project: projectWithPalette,
      layerGroups: projectWithPalette.layerGroups ?? [],
      palette: nextPalette,
      paletteDirty: false,
      projectFilename: null,
      projectFileHandle: null,
      tools: updateToolsWithPalette(nextPalette, state.tools),
    }));

    if (projectWithPalette.defaultCustomBrushId) {
      get().setDefaultCustomBrush(projectWithPalette.defaultCustomBrushId);
    }

    persistCustomBrushes();
  };

  const updateProject = (updates: Partial<Project>): void => {
    const stateBefore = get();
    if (!stateBefore.project) {
      set({ project: null });
      return;
    }

    const baseProject: Project = {
      ...stateBefore.project,
      ...updates,
      exportLayout: 'exportLayout' in updates
        ? cloneExportLayout(updates.exportLayout)
        : cloneExportLayout(stateBefore.project.exportLayout),
    };

    const normalized = normalizeProject(baseProject);

    if (normalized.id) {
      setActiveHistoryDocument(normalized.id);
    }

    const nextPalette = normalized.palette ?? stateBefore.palette ?? createDefaultPalette();
    const projectWithPalette: Project = {
      ...normalized,
      palette: nextPalette,
    };

    set((state) => ({
      project: projectWithPalette,
      layerGroups: projectWithPalette.layerGroups ?? [],
      palette: nextPalette,
      paletteDirty: false,
      referenceLayerId: null,
      tools: updateToolsWithPalette(nextPalette, state.tools),
    }));

    const previousDefault = stateBefore.project.defaultCustomBrushId ?? null;
    const nextDefault = projectWithPalette.defaultCustomBrushId ?? null;
    if (nextDefault && nextDefault !== previousDefault) {
      get().setDefaultCustomBrush(nextDefault);
    }

    persistCustomBrushes();
  };

  const applyLoadedProject = async (
    loadedProject: Project,
    replacementRequest: number,
  ): Promise<boolean> => {
    const state = get();
    const restoreColorCycleBrushManager = createColorCycleBrushManager();
    const [layersWithRestoredColorCycles, revisionFloor] = await Promise.all([
      restoreColorCycleBrushes(loadedProject.layers, {
        lazy: true,
        activeLayerId: loadedProject.layers[0]?.id ?? null,
        colorCycleBrushManager: restoreColorCycleBrushManager,
      }),
      backgroundStorageService.getAutosaveRevisionFloor(loadedProject.id).catch((error) => {
        debugWarn(
          'raw-console',
          '[Store] Failed to hydrate persisted autosave revision:',
          error,
        );
        return 0;
      }),
    ]);
    if (replacementRequest !== latestProjectReplacementRequest) {
      return false;
    }
    const finalLayers = layersWithRestoredColorCycles ?? loadedProject.layers;

    const normalizedProject = normalizeProject(loadedProject);
    const normalizedPalette = normalizedProject.palette ?? createDefaultPalette();
    const projectWithPalette = {
      ...normalizedProject,
      palette: normalizedPalette,
    };

    const toolsWithPalette = updateToolsWithPalette(normalizedPalette, state.tools);
    const normalizedLayers = dedupeLayerIds(normalizeLayers(finalLayers));
    const repairedLayerIdCount = normalizedLayers.reduce((count, layer, index) => {
      const previousId = finalLayers[index]?.id;
      return count + (previousId === layer.id ? 0 : 1);
    }, 0);
    const syncedLayers = syncPercentOffsetsFromPixels(normalizedLayers, normalizedProject);
    const validLayerIds = new Set(syncedLayers.map((layer) => layer.id));
    const nextReferenceLayerId =
      loadedProject.referenceLayerId && validLayerIds.has(loadedProject.referenceLayerId)
        ? loadedProject.referenceLayerId
        : null;
    const nextActiveLayerId = syncedLayers[0]?.id ?? null;

    historyManager.assertDocumentReplacementAvailable();
    resetColorCycleRuntimeForProjectReplacement('project-load');

    set({
      project: projectWithPalette,
      palette: normalizedPalette,
      paletteDirty: false,
      colorCyclePlayback: {
        ...state.colorCyclePlayback,
        desiredPlaying: false,
        suspendDepth: 0,
        lastReason: 'startup',
      },
      layers: syncedLayers,
      layerGroups: projectWithPalette.layerGroups ?? [],
      activeLayerId: nextActiveLayerId,
      selectedLayerIds: nextActiveLayerId ? [nextActiveLayerId] : [],
      referenceLayerId: nextReferenceLayerId,
      canvas: loadedProject.viewState
        ? {
            ...get().canvas,
            zoom: loadedProject.viewState.zoom,
            displayFilters: loadedProject.viewState.displayFilters ?? getStoredDisplayFilterDefaults(),
          }
        : get().canvas,
      brushSpecificSettings: loadedProject.brushSpecificSettings ?? {},
      globalBrushSize: loadedProject.globalBrushSize ?? 10,
      tools: toolsWithPalette,
      autosave: {
        ...state.autosave,
        hasUnsavedChanges: false,
        dirtyRevision: revisionFloor,
        savedRevision: revisionFloor,
        lastDirtyReason: null,
        lastDirtyAt: null,
      },
    });
    get().setLayersNeedRecomposition(true);
    if (repairedLayerIdCount > 0) {
      get().addNotification({
        type: 'warning',
        title: 'Layer IDs Repaired',
        message: `Fixed ${repairedLayerIdCount} duplicate or invalid layer ID${repairedLayerIdCount === 1 ? '' : 's'} while loading this project.`,
        timestamp: new Date(),
      });
    }

    try {
      const stateAfterLoad = get();
      const currentSettings = stateAfterLoad.tools.brushSettings;
      const activeBrushId = stateAfterLoad.currentBrushPreset?.id
        ?? (currentSettings.brushShape === BrushShape.CUSTOM && currentSettings.selectedCustomBrush
          ? currentSettings.selectedCustomBrush
          : null);
      if (activeBrushId) {
        const overrides = stateAfterLoad.brushSpecificSettings?.[activeBrushId];
        if (overrides) {
          const rest = normalizePersistedBrushSettings({ ...overrides });
          delete rest.size;
          delete rest.pressureEnabled;
          delete rest.minPressure;
          delete rest.maxPressure;
          if (Object.keys(rest).length > 0) {
            set((s) => ({
              tools: {
                ...s.tools,
                brushSettings: {
                  ...s.tools.brushSettings,
                  ...rest,
                },
              },
            }));
          }
        }
      }
    } catch {}

    get().setCanvasDimensions(loadedProject.width, loadedProject.height);

    const currentState = get();
    if (currentState.tools && currentState.globalBrushSize) {
      set((s) => ({
        tools: {
          ...s.tools,
          brushSettings: {
            ...s.tools.brushSettings,
            size: currentState.globalBrushSize,
          },
        },
      }));
    }

    if (colorCycleBrushManager) {
      const postLoadState = get();
      const colorCycleLayerIds = new Set(
        postLoadState.layers
          .filter((layer) => layer.layerType === 'color-cycle')
          .map((layer) => layer.id)
      );

      try {
        colorCycleBrushManager.cleanupOrphanedBrushes(colorCycleLayerIds);
      } catch (error) {
        debugWarn('raw-console', '[Store] Failed to cleanup orphaned color cycle brushes during load:', error);
      }

      const projectWidth = postLoadState.project?.width ?? loadedProject.width ?? 0;
      const projectHeight = postLoadState.project?.height ?? loadedProject.height ?? 0;

      for (const layer of postLoadState.layers) {
        const restoredDocument = restoreColorCycleBrushManager.getDocument(layer.id);
        if (restoredDocument) {
          colorCycleBrushManager.registerDocument(layer.id, restoredDocument);
        }

        if (layer.layerType !== 'color-cycle' || !layer.colorCycleData?.colorCycleBrush) {
          continue;
        }

        const brush = layer.colorCycleData.colorCycleBrush as LegacyColorCycleBrushField & ColorCycleManagerRegistrationBrush & {
          setLayerId?: (layerId: string) => void;
          isUsingWebGL?: () => boolean;
        };

        try {
          brush.setLayerId?.(layer.id);
        } catch (error) {
          debugWarn('raw-console', '[Store] Failed to set layerId on restored color cycle brush:', error);
        }

        colorCycleBrushManager.registerRestoredBrush(layer.id, brush, {
          width: layer.colorCycleData.canvas?.width ?? projectWidth,
          height: layer.colorCycleData.canvas?.height ?? projectHeight,
          isActive: false,
        });
      }

      if (postLoadState.activeLayerId) {
        try {
          colorCycleBrushManager.setActiveState(postLoadState.activeLayerId, true);
        } catch (error) {
          debugWarn('raw-console', '[Store] Failed to set active CC brush state during load:', error);
        }
      }
    }

    try {
      get().runColorCycleSlotRebuild('project-load');
    } catch (error) {
      debugWarn('raw-console', '[Store] Failed to rebuild color cycle slots after load:', error);
    }

    get().clearHistory();
    get().clearDirtyState({ resetSession: false });
    const hydratedAutosave = get().autosave;
    void backgroundStorageService.updateSession(normalizedProject.id, false, {
      dirtyRevision: hydratedAutosave.dirtyRevision,
      savedRevision: hydratedAutosave.savedRevision,
    }).catch(() => undefined);

    setTimeout(() => {
      const current = get();
      if (current.layersNeedRecomposition === false) {
        get().setLayersNeedRecomposition(true);
      }
    }, 100);

    get().addNotification({
      type: 'success',
      title: 'Project Loaded',
      message: `${loadedProject.name} has been loaded successfully`,
      timestamp: new Date(),
    });
    return true;
  };

  let latestManualSaveRequest = 0;

  const saveProject = async (request?: SaveProjectRequest): Promise<void> => {
    const state = get();
    if (!state.project) {
      throw new Error('No project to save');
    }
    const requestedProjectId = state.project.id;
    const saveRequest = ++latestManualSaveRequest;

    try {
      state.setSaveStatus('saving', 'manual', 'Saving project...');
      await flushPendingToolWork();
      await waitForFinalizeQueueIdle();
      await waitForAllPendingColorCycleSaves();

      const freshState = get();
      if (!freshState.project || freshState.project.id !== requestedProjectId) {
        return;
      }
      if (freshState.floatingPaste?.active) {
        throw new Error('Finish or cancel the floating selection before saving.');
      }
      const capturedProjectId = freshState.project.id;
      const capturedRevision = freshState.autosave.dirtyRevision;
      const requestOptions =
        typeof request === 'string' ? { filename: request } : request ?? {};
      const layersForSave = await Promise.all(
        freshState.layers.map(async (layer) => {
          if (layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
            return layer;
          }
          const colorCycleData = layer.colorCycleData;
          let canvasImageData = captureCanvasImageData(colorCycleData.canvas ?? null);

          const snapshotBrush = colorCycleBrushManager?.getSerializedStateBrush?.(layer.id);
          const surfaceBrush = colorCycleBrushManager?.getSurfaceBrush?.(layer.id);
          const savedSnapshot = readColorCycleBrushLayerSnapshotFromRuntime(snapshotBrush, layer.id);
          const shouldPreservePersistedPreview =
            savedSnapshot?.hasContent !== false &&
            colorCycleData.hasContent !== false;

          if (!imageDataHasVisiblePixels(canvasImageData)) {
            if (surfaceBrush?.renderDirectToCanvas && typeof document !== 'undefined') {
              const width =
                colorCycleData.canvas?.width ??
                colorCycleData.canvasImageData?.width ??
                freshState.project?.width ??
                colorCycleData.canvasWidth ??
                1;
              const height =
                colorCycleData.canvas?.height ??
                colorCycleData.canvasImageData?.height ??
                freshState.project?.height ??
                colorCycleData.canvasHeight ??
                1;
              const tempCanvas = document.createElement('canvas');
              tempCanvas.width = Math.max(1, width);
              tempCanvas.height = Math.max(1, height);
              try {
                surfaceBrush.renderDirectToCanvas(tempCanvas, layer.id);
                const renderedImageData = captureCanvasImageData(tempCanvas) ?? undefined;
                if (imageDataHasVisiblePixels(renderedImageData)) {
                  canvasImageData = renderedImageData;
                }
              } catch {
                // best effort; keep existing state
              }
            }
          }

          if (!imageDataHasVisiblePixels(canvasImageData) && shouldPreservePersistedPreview) {
            canvasImageData = colorCycleData.canvasImageData;
          }

          if (!canvasImageData) {
            return layer;
          }
          const documentVersion =
            colorCycleBrushManager?.getDocument?.(layer.id)?.version ??
            null;
          markDerivedSurfaceBuiltFromVersion(
            canvasImageData,
            documentVersion,
          );

          return {
            ...layer,
            colorCycleData: {
              ...colorCycleData,
              canvasImageData,
              canvasWidth: canvasImageData.width,
              canvasHeight: canvasImageData.height,
            },
          };
        })
      );
      const projectWithViewState = {
        ...freshState.project!,
        layerGroups: freshState.layerGroups,
        viewState: {
          zoom: freshState.canvas.zoom,
          displayFilters: freshState.canvas.displayFilters,
        },
        brushSpecificSettings: freshState.brushSpecificSettings,
        globalBrushSize: freshState.globalBrushSize,
        referenceLayerId: freshState.referenceLayerId ?? null,
        palette: freshState.palette,
      };

      const preferredName =
        requestOptions.filename ?? state.projectFilename ?? state.project.name;
      const { fileName: savedFileName, fileHandle, writeStatus } = await saveProjectToFile(
        projectWithViewState,
        preferredName,
        layersForSave,
        requestOptions.forceDialog ? null : state.projectFileHandle ?? undefined,
        { projectId: capturedProjectId, revision: capturedRevision },
      );

      if (saveRequest !== latestManualSaveRequest) {
        return;
      }
      if (get().project?.id !== capturedProjectId) {
        return;
      }
      if (writeStatus === 'superseded') {
        return;
      }
      if (get().autosave.savedRevision > capturedRevision) {
        return;
      }

      const nextFileHandle = fileHandle ?? state.projectFileHandle ?? null;
      if (nextFileHandle) {
        await fileBackupService.ensureFileWritePermission(nextFileHandle, { requestIfNeeded: true });
      }

      const savedAt = new Date();
      set((current) => ({
        ...(current.project?.id === capturedProjectId
          ? {
              projectFilename: savedFileName ?? null,
              projectFileHandle: nextFileHandle,
              autosave: nextFileHandle
                ? {
                    ...current.autosave,
                    fileBackup: {
                      ...current.autosave.fileBackup,
                      enabled: true,
                      mode: 'single-file' as const,
                      fileHandle: nextFileHandle,
                      directoryHandle: null,
                      backupPath:
                        savedFileName
                        ?? current.projectFilename
                        ?? current.autosave.fileBackup.backupPath,
                    },
                  }
                : current.autosave,
            }
          : {}),
      }));

      const stateBeforeCompletion = get();
      if (stateBeforeCompletion.project?.id !== capturedProjectId) {
        return;
      }
      if (nextFileHandle) {
        fileBackupService.setFileHandle(nextFileHandle);
      }
      const didClear = stateBeforeCompletion.clearDirtyStateIfRevision(
        capturedProjectId,
        capturedRevision,
        savedAt,
      );
      const completionState = get();
      void backgroundStorageService.updateSession(
        capturedProjectId,
        completionState.autosave.hasUnsavedChanges,
        {
          dirtyRevision: completionState.autosave.dirtyRevision,
          savedRevision: completionState.autosave.savedRevision,
          lastSaveTime: savedAt.getTime(),
        },
      ).catch(() => undefined);

      completionState.addNotification({
        type: 'success',
        title: 'Project Saved',
        message: didClear
          ? `${savedFileName || state.project.name} has been saved successfully`
          : `${savedFileName || state.project.name} was saved; newer changes remain unsaved`,
        timestamp: new Date(),
      });
      completionState.setSaveStatus(
        didClear ? 'saved' : 'idle',
        'manual',
        didClear ? 'Project saved' : 'Saved earlier changes; newer changes pending',
      );
    } catch (error) {
      if (
        saveRequest !== latestManualSaveRequest ||
        get().project?.id !== requestedProjectId
      ) {
        return;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        state.clearSaveStatus();
        return;
      }
      state.setSaveStatus('error', 'manual', 'Save failed');
      state.addNotification({
        type: 'error',
        title: 'Save Failed',
        message: error instanceof Error ? error.message : 'Failed to save project',
        timestamp: new Date(),
      });
      throw error;
    }
  };

  const loadProject = async (): Promise<void> => {
    const state = get();
    const replacementRequest = ++latestProjectReplacementRequest;

    try {
      const { project: loadedProject, migration, fileName, fileHandle } = await loadProjectFromFile();
      const shouldDetachLoadedHandle = Boolean(migration?.shouldMarkDirty);
      const attachedFileHandle = shouldDetachLoadedHandle ? null : fileHandle;
      autosaveLog.info('Load project file handle info', {
        fileName,
        hasHandle: Boolean(attachedFileHandle),
        handleName: (attachedFileHandle as FileSystemFileHandle | null)?.name ?? null,
        detachedForRepair: shouldDetachLoadedHandle,
      });
      const didApply = await applyLoadedProject(loadedProject, replacementRequest);
      if (!didApply) {
        return;
      }
      if (migration?.shouldMarkDirty) {
        get().markAutosaveDirty('manual');
        get().addNotification({
          type: 'warning',
          title: 'Project Repaired On Load',
          message: `Applied ${migration.repairs.length} load repair${migration.repairs.length === 1 ? '' : 's'} to canonicalize legacy data. Save to keep the repaired format.`,
          timestamp: new Date(),
        });
      }
      if (attachedFileHandle) {
        await fileBackupService.ensureFileWritePermission(attachedFileHandle);
      }
      if (
        replacementRequest !== latestProjectReplacementRequest ||
        get().project?.id !== loadedProject.id
      ) {
        return;
      }
      if (attachedFileHandle) {
        fileBackupService.setFileHandle(attachedFileHandle);
      }
      set((current) => ({
        projectFilename: fileName ?? null,
        projectFileHandle: attachedFileHandle ?? null,
        autosave: attachedFileHandle
          ? {
              ...current.autosave,
              fileBackup: {
                ...current.autosave.fileBackup,
                enabled: true,
                mode: 'single-file',
                fileHandle: attachedFileHandle,
                directoryHandle: null,
                backupPath: fileName ?? current.autosave.fileBackup.backupPath,
              },
            }
          : {
              ...current.autosave,
              fileBackup: {
                ...current.autosave.fileBackup,
                enabled: false,
                fileHandle: null,
                directoryHandle: null,
                backupPath: null,
              },
            },
      }));
    } catch (error) {
      if (replacementRequest !== latestProjectReplacementRequest) {
        return;
      }
      ccWarn('loadProject failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      state.addNotification({
        type: 'error',
        title: 'Load Failed',
        message: error instanceof Error ? error.message : 'Failed to load project',
        timestamp: new Date(),
      });
      throw error;
    }
  };

  const importProject = async (
    project: Project,
    options?: { fileName?: string | null; fileHandle?: FileSystemFileHandle | null }
  ): Promise<void> => {
    const state = get();
    const replacementRequest = ++latestProjectReplacementRequest;

    try {
      const didApply = await applyLoadedProject(project, replacementRequest);
      if (!didApply) {
        return;
      }
      const fileHandle = options?.fileHandle ?? null;
      if (fileHandle) {
        await fileBackupService.ensureFileWritePermission(fileHandle);
      }
      if (
        replacementRequest !== latestProjectReplacementRequest ||
        get().project?.id !== project.id
      ) {
        return;
      }
      if (fileHandle) {
        fileBackupService.setFileHandle(fileHandle);
      }
      set((current) => ({
        projectFilename: options?.fileName ?? null,
        projectFileHandle: fileHandle,
        autosave: fileHandle
          ? {
              ...current.autosave,
              fileBackup: {
                ...current.autosave.fileBackup,
                enabled: true,
                mode: 'single-file',
                fileHandle,
                directoryHandle: null,
                backupPath: options?.fileName ?? current.autosave.fileBackup.backupPath,
              },
            }
          : {
              ...current.autosave,
              fileBackup: {
                ...current.autosave.fileBackup,
                enabled: false,
                fileHandle: null,
                directoryHandle: null,
                backupPath: null,
              },
            },
      }));
    } catch (error) {
      if (replacementRequest !== latestProjectReplacementRequest) {
        return;
      }
      ccWarn('importProject failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      state.addNotification({
        type: 'error',
        title: 'Load Failed',
        message: error instanceof Error ? error.message : 'Failed to load project',
        timestamp: new Date(),
      });
      throw error;
    }
  };

  const exportProject = async (
    format: 'png',
    options: { quality?: number; scale?: number } = {}
  ): Promise<void> => {
    const state = get();
    if (!state.project) {
      throw new Error('No project to export');
    }

    try {
      if (format === 'png') {
        await exportProjectAsPNG(state.project, state.layers, options);
        state.addNotification({
          type: 'success',
          title: 'Export Complete',
          message: `${state.project.name} has been exported as PNG`,
          timestamp: new Date(),
        });
      } else {
        throw new Error(`Unsupported export format: ${format}`);
      }
    } catch (error) {
      state.addNotification({
        type: 'error',
        title: 'Export Failed',
        message: error instanceof Error ? error.message : 'Failed to export project',
        timestamp: new Date(),
      });
      throw error;
    }
  };

  const newProject = (
    width: number,
    height: number,
    name = 'Untitled',
    options?: { preserveRecoverySession?: boolean },
  ): void => {
    historyManager.assertDocumentReplacementAvailable();
    latestProjectReplacementRequest += 1;
    const currentState = get();
    if (options?.preserveRecoverySession === true) {
      currentState.setAutosaveSessionSyncSuspended(true);
    }
    resetColorCycleRuntimeForProjectReplacement('new-project');
    const layerIdFactory = () => `layer-${Date.now()}-${Math.random()}`;
    const makeFramebuffer = (): OffscreenCanvas | HTMLCanvasElement => {
      if (typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(width, height);
      }
      if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
      }
      throw new Error('No canvas implementation available for project initialization');
    };
    const existingCustomBrushes = currentState.project?.customBrushes ?? [];
    const existingDefaultCustomBrushId = currentState.project?.defaultCustomBrushId ?? null;

    const defaultLayerId = layerIdFactory();
    const defaultFramebuffer = makeFramebuffer();
    const defaultLayer: Layer = {
      id: defaultLayerId,
      name: 'Layer 1',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      order: 0,
      locked: false,
      transparencyLocked: false,
      imageData: new ImageData(width, height),
      framebuffer: defaultFramebuffer,
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal',
    };

    const colorCycleLayerId = layerIdFactory();
    const colorCycleFramebuffer = makeFramebuffer();
    const colorCycleCanvas =
      typeof document !== 'undefined'
        ? (() => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            return canvas;
          })()
        : undefined;

    const fallbackColorCycleGradient = [
      { position: 0.0, color: '#ff0000' },
      { position: 0.17, color: '#ff7f00' },
      { position: 0.33, color: '#ffff00' },
      { position: 0.5, color: '#00ff00' },
      { position: 0.67, color: '#0000ff' },
      { position: 0.83, color: '#4b0082' },
      { position: 1.0, color: '#9400d3' },
    ];
    const gradientSource = currentState.tools?.brushSettings?.colorCycleGradient;
    const initialColorCycleGradient = (gradientSource ?? fallbackColorCycleGradient).map((stop) => ({
      position: stop.position,
      color: stop.color,
    }));

    const colorCycleLayer: Layer = {
      id: colorCycleLayerId,
      name: 'CC Layer 1',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      order: 1,
      locked: false,
      transparencyLocked: false,
      imageData: null,
      framebuffer: colorCycleFramebuffer,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        documentId: colorCycleLayerId,
        mode: 'brush',
        gradient: initialColorCycleGradient,
        isAnimating: true,
        flowMode: currentState.tools?.brushSettings?.colorCycleFlowMode ?? 'forward',
        canvas: colorCycleCanvas,
      },
    };

    const newPalette = createDefaultPalette();
    const newProject: Project = {
      id: `project-${Date.now()}-${Math.random()}`,
      name,
      width,
      height,
      layers: [],
      layerGroups: [],
      backgroundColor: 'transparent',
      createdAt: new Date(),
      updatedAt: new Date(),
      customBrushes: existingCustomBrushes,
      ccCustomTilePatterns: [],
      ccCustomTilePatternPacks: [],
      defaultCustomBrushId: existingDefaultCustomBrushId,
      brushSpecificSettings: {},
      exportLayout: createDefaultExportLayout(),
      palette: newPalette,
    };

    const normalizedProject = normalizeProject(newProject);
    const normalizedPalette = normalizedProject.palette ?? createDefaultPalette();
    const projectWithPalette = {
      ...normalizedProject,
      palette: normalizedPalette,
    };
    const normalizedLayers = normalizeLayers([defaultLayer, colorCycleLayer]);
    const syncedLayers = syncPercentOffsetsFromPixels(normalizedLayers, normalizedProject);

    setActiveHistoryDocument(normalizedProject.id);

    set({
      project: projectWithPalette,
      palette: normalizedPalette,
      paletteDirty: false,
      projectFilename: null,
      projectFileHandle: null,
      layers: syncedLayers,
      layerGroups: projectWithPalette.layerGroups ?? [],
      activeLayerId: defaultLayerId,
      selectedLayerIds: defaultLayerId ? [defaultLayerId] : [],
      referenceLayerId: null,
      canvas: {
        ...get().canvas,
        canvasWidth: width,
        canvasHeight: height,
      },
    });
    get().setLayersNeedRecomposition(true);

    if (typeof window !== 'undefined') {
      setTimeout(() => {
        const stateBeforeInitialization = get();
        const isCurrentProject =
          stateBeforeInitialization.project?.id === normalizedProject.id;
        if (!isCurrentProject) {
          if (options?.preserveRecoverySession === true) {
            stateBeforeInitialization.setAutosaveSessionSyncSuspended(false);
          }
          return;
        }
        const shouldRemainClean = !stateBeforeInitialization.autosave.hasUnsavedChanges;
        try {
          get().initColorCycleForLayer(colorCycleLayerId, width, height);
        } catch (error) {
          logError('[Store] Failed to initialize default color cycle layer', error);
        } finally {
          if (shouldRemainClean && get().project?.id === normalizedProject.id) {
            get().clearDirtyState({
              resetSession: options?.preserveRecoverySession !== true,
            });
          }
          if (options?.preserveRecoverySession === true) {
            get().setAutosaveSessionSyncSuspended(false);
          }
        }
      }, 0);
    }

    get().clearHistory();
    get().clearDirtyState({
      resetSession: options?.preserveRecoverySession !== true,
    });
    if (
      typeof window === 'undefined' &&
      options?.preserveRecoverySession === true
    ) {
      get().setAutosaveSessionSyncSuspended(false);
    }

    persistCustomBrushes();
  };

  return {
    setProject,
    updateProject,
    applyLoadedProject,
    saveProject,
    loadProject,
    importProject,
    exportProject,
    newProject,
  };
};
