import {
  createShapeToolHandler,
  type ShapeToolHandler,
  type ShapeToolHandlerContext,
  type ShapeToolHandlerDelegate,
} from '@/hooks/canvas/handlers/shapes/ShapeToolHandler';
import { useDrawingShapeRuntimeBridge } from '@/hooks/canvas/useDrawingShapeRuntimeBridge';

export const createShapeRuntime = (
  context: ShapeToolHandlerContext,
  delegate: ShapeToolHandlerDelegate
): ShapeToolHandler => createShapeToolHandler(context, delegate);

export const useShapeToolRuntime = useDrawingShapeRuntimeBridge;

export type ShapeRuntime = ReturnType<typeof createShapeRuntime>;
export type ShapeToolRuntime = ReturnType<typeof useShapeToolRuntime>;
