import { createProcessBatchedStrokesDispatcher } from '@/hooks/canvas/handlers/strokeBatching';
import { createContinueDrawingHandler } from '@/hooks/canvas/handlers/continueDrawing';

type ProcessArgs = Parameters<typeof createProcessBatchedStrokesDispatcher>[0];
type ProcessDeps = Parameters<typeof createProcessBatchedStrokesDispatcher>[1];
type ContinueArgs = Omit<Parameters<typeof createContinueDrawingHandler>[0], 'processBatchedStrokes'>;

export const createStrokeInputHandlers = ({
  processArgs,
  processDeps,
  continueArgs,
}: {
  processArgs: ProcessArgs;
  processDeps: ProcessDeps;
  continueArgs: ContinueArgs;
}) => {
  const processBatchedStrokes = createProcessBatchedStrokesDispatcher(processArgs, processDeps);
  const continueDrawing = createContinueDrawingHandler({
    ...continueArgs,
    processBatchedStrokes,
  });
  return {
    processBatchedStrokes,
    continueDrawing,
  };
};
