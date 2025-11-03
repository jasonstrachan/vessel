import { useAppStore } from '@/stores/useAppStore';
import {
  selectProjectName,
  selectProjectDimensions,
  selectProjectExportLayout,
  selectGlobalBrushSize,
  selectProjectBrushSpecificSettings,
} from '@/stores/selectors/projectSelectors';

describe('projectSelectors', () => {
  it('returns project name and dimensions', () => {
    const initialState = useAppStore.getState();
    const name = selectProjectName(initialState);
    const dims = selectProjectDimensions(initialState);

    expect(name).toBe(initialState.project?.name ?? 'Untitled');
    expect(dims).toEqual({
      width: initialState.project?.width ?? 0,
      height: initialState.project?.height ?? 0,
    });

    if (initialState.project) {
      const { width, height } = initialState.project;
      try {
        useAppStore.getState().setProjectDimensions(width + 16, height + 32);
        const updatedDims = selectProjectDimensions(useAppStore.getState());
        expect(updatedDims).toEqual({ width: width + 16, height: height + 32 });
      } finally {
        useAppStore.getState().setProjectDimensions(width, height);
      }
    }
  });

  it('returns export layout reference', () => {
    const state = useAppStore.getState();
    const selectorValue = selectProjectExportLayout(state);
    expect(selectorValue).toBe(state.project?.exportLayout ?? null);
  });

  it('returns global brush size and project brush-specific settings', () => {
    const state = useAppStore.getState();
    const originalSize = state.globalBrushSize;
    const originalSettings = state.project?.brushSpecificSettings ?? {};

    const initialSize = selectGlobalBrushSize(state);
    const initialSettings = selectProjectBrushSpecificSettings(state);
    expect(initialSize).toBe(originalSize);
    expect(initialSettings).toEqual(originalSettings);

    const updatedSettings = { demo: { spacing: 12 } };
    try {
      useAppStore.getState().setGlobalBrushSize(originalSize + 5);
      useAppStore.getState().updateProject({ brushSpecificSettings: updatedSettings });

      const nextState = useAppStore.getState();
      expect(selectGlobalBrushSize(nextState)).toBe(originalSize + 5);
      expect(selectProjectBrushSpecificSettings(nextState)).toEqual(updatedSettings);
    } finally {
      useAppStore.getState().setGlobalBrushSize(originalSize);
      useAppStore.getState().updateProject({ brushSpecificSettings: originalSettings });
    }
  });
});
