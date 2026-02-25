import { useMemo } from 'react';
import {
  buildStartDrawingSharedArgs,
  createStartDrawingCallback,
} from '@/hooks/canvas/handlers/startDrawingCallback';

type StartDrawingSharedArgs = Parameters<typeof buildStartDrawingSharedArgs>[0];

type UseStartDrawingHandlerArgs = StartDrawingSharedArgs;

export const useStartDrawingHandler = ({
  prelude,
  beforeSession,
  samplingCanvas,
  toolStroke,
}: UseStartDrawingHandlerArgs) => {
  const startDrawingSharedArgs = useMemo(
    () =>
      buildStartDrawingSharedArgs({
        prelude,
        beforeSession,
        samplingCanvas,
        toolStroke,
      }),
    [prelude, beforeSession, samplingCanvas, toolStroke]
  );

  return useMemo(() => createStartDrawingCallback(startDrawingSharedArgs), [startDrawingSharedArgs]);
};
