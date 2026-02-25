import type { AppState } from '@/stores/useAppStore';

export const selectFloatingPaste = (state: AppState) => state.floatingPaste;

type SelectionRects = {
  selectionStart: AppState['selectionStart'];
  selectionEnd: AppState['selectionEnd'];
};

// React 19's stricter `useSyncExternalStore` validation requires selectors to return
// stable references when the underlying state hasn't changed. Cache the last result
// so `useAppStore(selectSelectionRects)` doesn't surface the "getSnapshot" warning.
let cachedSelectionStart: AppState['selectionStart'] = null;
let cachedSelectionEnd: AppState['selectionEnd'] = null;
let cachedSelectionRects: SelectionRects = {
  selectionStart: cachedSelectionStart,
  selectionEnd: cachedSelectionEnd,
};

export const selectSelectionRects = (state: AppState): SelectionRects => {
  if (
    state.selectionStart === cachedSelectionStart &&
    state.selectionEnd === cachedSelectionEnd
  ) {
    return cachedSelectionRects;
  }

  cachedSelectionStart = state.selectionStart;
  cachedSelectionEnd = state.selectionEnd;
  cachedSelectionRects = {
    selectionStart: cachedSelectionStart,
    selectionEnd: cachedSelectionEnd,
  };

  return cachedSelectionRects;
};
