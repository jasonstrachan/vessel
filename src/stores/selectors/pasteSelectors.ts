import type { AppState } from '@/stores/useAppStore';

export const selectFloatingPaste = (state: AppState) => state.floatingPaste;

export const selectFloatingPasteActions = (state: AppState) => ({
  updateFloatingPasteRect: state.updateFloatingPasteRect,
  setFloatingPaste: state.setFloatingPaste,
  updateFloatingPastePosition: state.updateFloatingPastePosition,
  commitFloatingPaste: state.commitFloatingPaste,
  cancelFloatingPaste: state.cancelFloatingPaste,
});

export const selectSelectionRects = (state: AppState) => ({
  selectionStart: state.selectionStart,
  selectionEnd: state.selectionEnd,
});

export const selectSelectionActions = (state: AppState) => ({
  setSelectionBounds: state.setSelectionBounds,
  clearSelection: state.clearSelection,
});
