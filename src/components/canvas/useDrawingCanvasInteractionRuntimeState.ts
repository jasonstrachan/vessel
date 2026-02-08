import { useCanvasInteraction } from '@/hooks/useCanvasInteraction';
import { useCanvasStateMachine } from '@/hooks/useCanvasStateMachine';
import { useSimplePan } from '@/hooks/useSimplePan';
import { useDrawingCanvasPanCursorRuntime } from './useDrawingCanvasPanCursorRuntime';

type PanCursorRuntimeArgs = Parameters<typeof useDrawingCanvasPanCursorRuntime>[0];

export type UseDrawingCanvasInteractionRuntimeStateOptions = Omit<PanCursorRuntimeArgs, 'pan'>;

export const useDrawingCanvasInteractionRuntimeState = ({
  canvasZoom,
  canvasOffsetX,
  canvasOffsetY,
  setCanvasOffset,
  setCursorStyle,
  setShowBrushCursor,
  currentTool,
}: UseDrawingCanvasInteractionRuntimeStateOptions) => {
  const interaction = useCanvasInteraction();
  const interactionDispatch = interaction.dispatch;
  const stateMachine = useCanvasStateMachine();
  const setCanvasStateMachineTool = stateMachine.setTool;
  const forceCanvasIdle = stateMachine.forceIdle;
  const pan = useSimplePan({ scale: canvasZoom || 1 });
  const setPan = pan.setPan;
  const panCursorRuntime = useDrawingCanvasPanCursorRuntime({
    pan,
    canvasZoom,
    canvasOffsetX,
    canvasOffsetY,
    setCanvasOffset,
    setCursorStyle,
    setShowBrushCursor,
    currentTool,
  });

  return {
    interaction,
    interactionDispatch,
    stateMachine,
    setCanvasStateMachineTool,
    forceCanvasIdle,
    pan,
    setPan,
    ...panCursorRuntime,
  };
};
