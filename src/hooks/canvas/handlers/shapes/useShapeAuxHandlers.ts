import {
  buildShapeAuxHandlerArgs,
  type BuildShapeAuxHandlerArgs,
} from '@/hooks/canvas/handlers/shapes/buildShapeAuxHandlerArgs';
import { createShapeAuxHandlers } from '@/hooks/canvas/handlers/shapes/shapeAuxHandlers';

export const useShapeAuxHandlers = (args: BuildShapeAuxHandlerArgs) =>
  createShapeAuxHandlers(buildShapeAuxHandlerArgs(args));
