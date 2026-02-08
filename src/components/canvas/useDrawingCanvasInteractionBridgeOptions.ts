import { useDrawingCanvasInteractionBridge } from './useDrawingCanvasInteractionBridge';
import { useAppStore } from '@/stores/useAppStore';

type InteractionBridgeOptions = Parameters<typeof useDrawingCanvasInteractionBridge>[0];
type KeyboardOptions = InteractionBridgeOptions['keyboardOptions'];

interface UseDrawingCanvasInteractionBridgeOptionsArgs {
  keyboardOptions: Omit<
    KeyboardOptions,
    'saveProject' | 'openProjectModal' | 'canUndo' | 'canRedo'
  >;
  toolSyncOptions: InteractionBridgeOptions['toolSyncOptions'];
}

export const useDrawingCanvasInteractionBridgeOptions = ({
  keyboardOptions,
  toolSyncOptions,
}: UseDrawingCanvasInteractionBridgeOptionsArgs): InteractionBridgeOptions => ({
  keyboardOptions: {
    ...keyboardOptions,
    saveProject: () => useAppStore.getState().saveProject(),
    openProjectModal: () => useAppStore.getState().toggleModal('loadProject'),
    canUndo: () => useAppStore.getState().canUndo(),
    canRedo: () => useAppStore.getState().canRedo(),
  },
  toolSyncOptions,
});
