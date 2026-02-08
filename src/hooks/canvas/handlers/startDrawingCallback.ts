import { startDrawingHandler } from '@/hooks/canvas/handlers/startDrawing';

type StartDrawingHandlerArgs = Parameters<typeof startDrawingHandler>[0];
type StartDrawingSharedArgs = Omit<StartDrawingHandlerArgs, 'rawWorldPos' | 'pressure'>;
type StartDrawingRawWorldPos = StartDrawingHandlerArgs['rawWorldPos'];
type StartDrawingPressure = StartDrawingHandlerArgs['pressure'];

export const buildStartDrawingSharedArgs = (
  args: StartDrawingSharedArgs
): StartDrawingSharedArgs => args;

export const createStartDrawingCallback = (sharedArgs: StartDrawingSharedArgs) => {
  return (
    rawWorldPos: StartDrawingRawWorldPos,
    pressure: StartDrawingPressure = 0.5
  ) => {
    startDrawingHandler({
      rawWorldPos,
      pressure,
      ...sharedArgs,
    });
  };
};
