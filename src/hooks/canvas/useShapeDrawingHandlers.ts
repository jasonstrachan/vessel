import {
  buildShapeDrawingHandlerOptions,
} from '@/hooks/canvas/handlers/shapes/buildShapeDrawingHandlerOptions';
import {
  createShapeDrawingHandlers,
} from '@/hooks/canvas/handlers/shapes/shapeDrawingHandlers';

type UseShapeDrawingHandlersArgs = Parameters<typeof buildShapeDrawingHandlerOptions>[0];

export const useShapeDrawingHandlers = (
  args: UseShapeDrawingHandlersArgs
) => createShapeDrawingHandlers(buildShapeDrawingHandlerOptions(args));
