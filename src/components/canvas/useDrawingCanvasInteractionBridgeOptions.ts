import { getAppStoreState } from '@/stores/appStoreAccess';
import { useDrawingCanvasInteractionBridge } from './useDrawingCanvasInteractionBridge';

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
    saveProject: () => getAppStoreState().saveProject(),
    openProjectModal: () => getAppStoreState().toggleModal('loadProject'),
    canUndo: () => getAppStoreState().canUndo(),
    canRedo: () => getAppStoreState().canRedo(),
  },
  toolSyncOptions,
});
