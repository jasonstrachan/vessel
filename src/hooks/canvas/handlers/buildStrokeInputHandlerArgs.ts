import {
  createStrokeInputHandlers,
} from '@/hooks/canvas/handlers/strokeInputHandlers';

type StrokeInputHandlerArgs = Parameters<typeof createStrokeInputHandlers>[0];

export const buildStrokeInputHandlerArgs = (
  args: StrokeInputHandlerArgs
): StrokeInputHandlerArgs => args;
