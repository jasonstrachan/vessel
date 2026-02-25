import type { StateCreator } from 'zustand';
import type { CanvasShape, CanvasShapeTool } from '@/types';
import { normalizeCanvasShape } from '@/utils/canvasShape';

export interface CanvasShapeEditorState {
  active: boolean;
  tool: CanvasShapeTool | null;
  draft: CanvasShape | null;
}

export interface CanvasShapeSlice {
  canvasShapeEditor: CanvasShapeEditorState;
  beginCanvasShapeEdit: (tool: CanvasShapeTool) => void;
  setCanvasShapeDraft: (shape: CanvasShape | null) => void;
  commitCanvasShape: () => void;
  cancelCanvasShapeEdit: () => void;
  setCanvasShape: (shape: CanvasShape) => void;
}

type AppState = import('../useAppStore').AppState;

const DEFAULT_EDITOR_STATE: CanvasShapeEditorState = {
  active: false,
  tool: null,
  draft: null,
};

export const createCanvasShapeSlice: StateCreator<AppState, [], [], CanvasShapeSlice> = (set, get) => ({
  canvasShapeEditor: DEFAULT_EDITOR_STATE,
  beginCanvasShapeEdit: (tool) =>
    set({
      canvasShapeEditor: {
        active: true,
        tool,
        draft: null,
      },
    }),
  setCanvasShapeDraft: (shape) =>
    set((state) => ({
      canvasShapeEditor: {
        ...state.canvasShapeEditor,
        draft: shape,
      },
    })),
  commitCanvasShape: () => {
    const state = get();
    const project = state.project;
    const draft = state.canvasShapeEditor.draft;

    if (!project || !draft) {
      set({ canvasShapeEditor: DEFAULT_EDITOR_STATE });
      return;
    }

    const normalized = normalizeCanvasShape(draft, project.width, project.height);
    state.updateProject({ canvasShape: normalized });
    state.setLayersNeedRecomposition(true);
    set({ canvasShapeEditor: DEFAULT_EDITOR_STATE });
  },
  cancelCanvasShapeEdit: () => set({ canvasShapeEditor: DEFAULT_EDITOR_STATE }),
  setCanvasShape: (shape) => {
    const state = get();
    const project = state.project;
    if (!project) return;
    const normalized = normalizeCanvasShape(shape, project.width, project.height);
    state.updateProject({ canvasShape: normalized });
    state.setLayersNeedRecomposition(true);
  },
});
