import type { UseDrawingHandlersResultArgsBridgeOptions } from '@/hooks/canvas/useDrawingHandlersResultArgsBridge.types';

interface BuildDrawingHandlersResultShapeArgsOptions {
  shapeRuntime: UseDrawingHandlersResultArgsBridgeOptions['shapeRuntime'];
}

export const buildDrawingHandlersResultShapeArgs = ({
  shapeRuntime,
}: BuildDrawingHandlersResultShapeArgsOptions) => ({
  latestShapePressureRef: shapeRuntime.latestShapePressureRef,
  lastNonZeroShapePressureRef: shapeRuntime.lastNonZeroShapePressureRef,
  latestShapePixelSizeRef: shapeRuntime.latestShapePixelSizeRef,
  shapeMaxPressureRef: shapeRuntime.shapeMaxPressureRef,
  hadValidShapePressureRef: shapeRuntime.hadValidShapePressureRef,
  lastStablePressureRef: shapeRuntime.lastStablePressureRef,
  resetShapePressureState: shapeRuntime.resetShapePressureState,
  updateShapePressure: shapeRuntime.updateShapePressure,
  computeShapePixelSize: shapeRuntime.computeShapePixelSize,
  triggerSimpleShapePreview: shapeRuntime.triggerSimpleShapePreview,
  setSimpleShapePreviewRenderer: shapeRuntime.setSimpleShapePreviewRenderer,
  seedManualStrokeBoundingBox: shapeRuntime.seedManualStrokeBoundingBox,
});
