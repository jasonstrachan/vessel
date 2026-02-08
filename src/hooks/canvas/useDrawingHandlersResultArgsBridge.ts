import { buildDrawingHandlersResultBrushToolArgs } from '@/hooks/canvas/buildDrawingHandlersResultBrushToolArgs';
import { buildDrawingHandlersResultColorCycleArgs } from '@/hooks/canvas/buildDrawingHandlersResultColorCycleArgs';
import { buildDrawingHandlersResultRefsArgs } from '@/hooks/canvas/buildDrawingHandlersResultRefsArgs';
import { buildDrawingHandlersResultRuntimeHandlerArgs } from '@/hooks/canvas/buildDrawingHandlersResultRuntimeHandlerArgs';
import { buildDrawingHandlersResultShapeArgs } from '@/hooks/canvas/buildDrawingHandlersResultShapeArgs';
import type { UseDrawingHandlersResultArgsBridgeOptions } from '@/hooks/canvas/useDrawingHandlersResultArgsBridge.types';

export const useDrawingHandlersResultArgsBridge = ({
  refs,
  shapeRuntime,
  brushToolRuntime,
  colorCycleRuntime,
  runtimeHandlers,
}: UseDrawingHandlersResultArgsBridgeOptions) => ({
  ...buildDrawingHandlersResultRefsArgs({ refs }),
  ...buildDrawingHandlersResultRuntimeHandlerArgs({ runtimeHandlers }),
  ...buildDrawingHandlersResultShapeArgs({ shapeRuntime }),
  ...buildDrawingHandlersResultColorCycleArgs({ colorCycleRuntime }),
  ...buildDrawingHandlersResultBrushToolArgs({ brushToolRuntime }),
});
