import {
  createColorCycleBrushDeserializeLayerApplyPlans,
  createColorCycleBrushDeserializeSettingsPatch,
} from '@/lib/colorCycle/document';

import type {
  CCBrushSettingsPatch,
  ColorCycleBrushCanvas2DOptions,
} from './colorCycleBrushContracts';
import type {
  AnimatorIndexSnapshot,
  ColorCycleBrushCanvasSerialized,
  SerializedLayerColorCycleMeta,
  StrokeDataSnapshot,
} from './colorCycleCanvas2DTypes';

export type ColorCycleCanvasDeserializeContext<TResult> = {
  createInstance(canvas: HTMLCanvasElement, options: ColorCycleBrushCanvas2DOptions): void;
  applySettings(settings: CCBrushSettingsPatch): void;
  setLayerMeta(
    layerId: string,
    meta: Partial<SerializedLayerColorCycleMeta> | null,
  ): void;
  applyLayerSnapshot(
    layerId: string,
    snapshot: StrokeDataSnapshot,
    animatorIndex?: AnimatorIndexSnapshot,
  ): void;
  getResult(): TResult;
};

export function deserializeColorCycleCanvasRuntime<TResult>(
  context: ColorCycleCanvasDeserializeContext<TResult>,
  data: ColorCycleBrushCanvasSerialized,
  canvas: HTMLCanvasElement,
): TResult {
  context.createInstance(canvas, {
    brushSize: data.brushSize,
    fps: data.fps,
  });

  context.applySettings(
    createColorCycleBrushDeserializeSettingsPatch(data) as CCBrushSettingsPatch,
  );

  createColorCycleBrushDeserializeLayerApplyPlans(data.layers).forEach((plan) => {
    context.setLayerMeta(
      plan.layerId,
      plan.meta as Partial<SerializedLayerColorCycleMeta> | null,
    );
    context.applyLayerSnapshot(
      plan.layerId,
      plan.snapshot as StrokeDataSnapshot,
      plan.animatorIndex as AnimatorIndexSnapshot | undefined,
    );
  });

  return context.getResult();
}
