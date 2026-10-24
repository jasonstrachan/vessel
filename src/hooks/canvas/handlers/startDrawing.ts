import { prepareStrokeStartPrelude } from '@/hooks/canvas/handlers/strokeStartPrelude';
import { prepareStrokeStartBeforeStateSession } from '@/hooks/canvas/handlers/strokeStartBeforeStateSession';
import { prepareStrokeStartSamplingCanvas } from '@/hooks/canvas/handlers/strokeStartSamplingCanvas';
import { startDrawingToolStroke } from '@/hooks/canvas/handlers/startDrawingToolStroke';
import type { CCReason } from '@/stores/useAppStore';

type PreludeArgs = Parameters<typeof prepareStrokeStartPrelude>[0];
type BeforeSessionArgs = Parameters<typeof prepareStrokeStartBeforeStateSession>[0];
type SamplingCanvasArgs = Parameters<typeof prepareStrokeStartSamplingCanvas>[0];
type ToolStrokeArgs = Parameters<typeof startDrawingToolStroke>[0];

export const startDrawingHandler = ({
  rawWorldPos,
  pressure,
  prelude,
  beforeSession,
  samplingCanvas,
  toolStroke,
}: {
  rawWorldPos: PreludeArgs['rawWorldPos'];
  pressure: ToolStrokeArgs['pressure'];
  prelude: Omit<PreludeArgs, 'rawWorldPos'>;
  beforeSession: Omit<
    BeforeSessionArgs,
    'currentState' | 'runtimeProject' | 'currentTool' | 'currentBrushId'
  >;
  samplingCanvas: Omit<
    SamplingCanvasArgs,
    'currentState' | 'currentTool' | 'ccFlags' | 'worldPos' | 'pauseNonColorCycleInteraction'
  > & {
    pauseColorCycleForNonCCInteraction: (reason?: CCReason) => void;
  };
  toolStroke: Omit<
    ToolStrokeArgs,
    'currentState' | 'currentTool' | 'currentBrushId' | 'ccFlags' | 'worldPos' | 'pressure' | 'drawCtx'
  >;
}): boolean => {
  const preludeResult = prepareStrokeStartPrelude({
    ...prelude,
    rawWorldPos,
  });
  if (!preludeResult) {
    return false;
  }

  const {
    currentState,
    currentTool,
    currentBrushId,
    ccFlags,
    worldPos,
    runtimeProject,
  } = preludeResult;

  if (
    !prepareStrokeStartBeforeStateSession({
      ...beforeSession,
      currentState,
      runtimeProject,
      currentTool,
      currentBrushId: currentBrushId ?? null,
    })
  ) {
    return false;
  }

  const drawCtx = prepareStrokeStartSamplingCanvas({
    ...samplingCanvas,
    currentState,
    currentTool,
    ccFlags,
    worldPos,
    pauseNonColorCycleInteraction: () => {
      samplingCanvas.pauseColorCycleForNonCCInteraction('brush-stroke');
    },
  });
  if (!drawCtx) {
    // Sampling is a palette gesture that still needs pointer move/up routing.
    const activeLayer = currentState.layers.find((layer) => layer.id === currentState.activeLayerId);
    return currentTool === 'brush' && ccFlags.isAny &&
      samplingCanvas.brushSamplingPreviewActiveRef.current && activeLayer?.layerType === 'color-cycle';
  }

  if (ccFlags.isAny && currentTool === 'brush') {
    samplingCanvas.pauseColorCycleForNonCCInteraction('brush-stroke');
  }

  const toolStrokeStarted = startDrawingToolStroke({
    ...toolStroke,
    currentState,
    currentTool,
    currentBrushId: currentBrushId ?? null,
    ccFlags,
    worldPos,
    pressure,
    drawCtx,
  });
  return toolStrokeStarted;
};
