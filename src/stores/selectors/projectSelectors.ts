import type { AppState } from '@/stores/useAppStore';

export const selectProject = (state: AppState) => state.project;

export const selectProjectMetadata = (state: AppState) => ({
  filename: state.projectFilename,
  fileHandle: state.projectFileHandle,
});

export const selectProjectActions = (state: AppState) => ({
  saveProject: state.saveProject,
  loadProject: state.loadProject,
  importProject: state.importProject,
  exportProject: state.exportProject,
  newProject: state.newProject,
});

export const selectCustomBrushes = (state: AppState) => state.project?.customBrushes ?? [];

export const selectDefaultCustomBrushId = (state: AppState) =>
  state.project?.defaultCustomBrushId ?? null;

export const selectProjectName = (state: AppState) => state.project?.name ?? 'Untitled';

export const selectProjectDimensions = (state: AppState) => {
  const project = state.project;
  return {
    width: project?.width ?? 0,
    height: project?.height ?? 0,
  };
};

export const selectProjectExportLayout = (state: AppState) =>
  state.project?.exportLayout ?? null;

export const selectGlobalBrushSize = (state: AppState) => state.globalBrushSize;

export const selectProjectBrushSpecificSettings = (state: AppState) =>
  state.project?.brushSpecificSettings ?? {};

export const selectCustomBrushActions = (state: AppState) => ({
  addCustomBrush: state.addCustomBrush,
  updateCustomBrush: state.updateCustomBrush,
  removeCustomBrush: state.removeCustomBrush,
  setDefaultCustomBrush: state.setDefaultCustomBrush,
  saveCustomBrushAsPreset: state.saveCustomBrushAsPreset,
  ensureCustomBrushHydrated: state.ensureCustomBrushHydrated,
});

export const selectTemporaryCustomBrush = (state: AppState) => state.temporaryCustomBrush;
