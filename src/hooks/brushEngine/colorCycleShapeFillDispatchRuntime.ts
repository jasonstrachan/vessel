import type {
  FillMode,
  FillOptions,
  Vec2,
} from './colorCycleCanvas2DTypes';
import type { ColorCycleShapeFillExecutionContext } from './colorCycleShapeFillExecutionTypes';
import { runColorCycleConcentricShapeFill } from './colorCycleShapeFillConcentricRuntime';
import { runColorCycleLinearShapeFill } from './colorCycleShapeFillLinearRuntime';

export type ColorCycleShapeFillDispatchArgs = {
  mode: FillMode;
  vertices: Vec2[];
  layerId: string;
  direction?: Vec2;
  options?: FillOptions;
};

export async function dispatchColorCycleShapeFill(
  context: ColorCycleShapeFillExecutionContext,
  args: ColorCycleShapeFillDispatchArgs,
): Promise<void> {
  const { mode, vertices, layerId, direction, options } = args;
  if (!layerId) {
    throw new Error('fillShapeDispatch requires a layerId');
  }
  if (mode === 'linear') {
    if (!direction) {
      throw new Error('fillShapeDispatch(linear) requires direction');
    }
    return fillColorCycleLinearShape(context, vertices, direction, layerId, options?.spacing, options);
  }
  if (mode === 'concentric') {
    return fillColorCycleConcentricShape(context, vertices, layerId, options?.spacing, options);
  }
}

export async function fillColorCycleLinearShape(
  context: ColorCycleShapeFillExecutionContext,
  vertices: Vec2[],
  direction: Vec2,
  layerId: string,
  spacing?: number,
  options?: FillOptions,
): Promise<void> {
  return runColorCycleLinearShapeFill(
    context,
    vertices,
    direction,
    layerId,
    spacing,
    options,
  );
}

export async function fillColorCycleConcentricShape(
  context: ColorCycleShapeFillExecutionContext,
  vertices: Vec2[],
  layerId: string,
  spacing?: number,
  options?: FillOptions,
): Promise<void> {
  return runColorCycleConcentricShapeFill(
    context,
    vertices,
    layerId,
    spacing,
    options,
  );
}
