import { useMemo } from 'react';
import { createStrokeInputHandlers } from '@/hooks/canvas/handlers/strokeInputHandlers';
import { buildStrokeInputHandlerArgs } from '@/hooks/canvas/handlers/buildStrokeInputHandlerArgs';

type StrokeInputHandlerArgs = Parameters<typeof buildStrokeInputHandlerArgs>[0];

interface UseStrokeInputHandlersArgs {
  processArgs: StrokeInputHandlerArgs['processArgs'];
  processDeps: StrokeInputHandlerArgs['processDeps'];
  continueArgs: StrokeInputHandlerArgs['continueArgs'];
}

export const useStrokeInputHandlers = ({
  processArgs,
  processDeps,
  continueArgs,
}: UseStrokeInputHandlersArgs) =>
  useMemo(
    () =>
      createStrokeInputHandlers(
        buildStrokeInputHandlerArgs({
          processArgs,
          processDeps,
          continueArgs,
        })
      ),
    [processArgs, processDeps, continueArgs]
  );
