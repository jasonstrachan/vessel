import type { AppState } from '@/stores/useAppStore';
import type { CcCustomTilePattern, CustomBrush } from '@/types';

const EMPTY_CUSTOM_BRUSHES: CustomBrush[] = [];
Object.freeze(EMPTY_CUSTOM_BRUSHES);
const EMPTY_CC_CUSTOM_TILE_PATTERNS: CcCustomTilePattern[] = [];
Object.freeze(EMPTY_CC_CUSTOM_TILE_PATTERNS);

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

export const selectCustomBrushes = (state: AppState) =>
  state.project?.customBrushes ?? EMPTY_CUSTOM_BRUSHES;

export const selectCcCustomTilePatterns = (state: AppState) =>
  state.project?.ccCustomTilePatterns ?? EMPTY_CC_CUSTOM_TILE_PATTERNS;

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

export const selectCcCustomTilePatternActions = (state: AppState) => ({
  addCcCustomTilePattern: state.addCcCustomTilePattern,
  removeCcCustomTilePattern: state.removeCcCustomTilePattern,
  renameCcCustomTilePattern: state.renameCcCustomTilePattern,
});

export const selectCustomBrushHelpers = (state: AppState) => ({
  getCustomBrushById: state.getCustomBrushById,
  listCustomBrushes: state.listCustomBrushes,
});
