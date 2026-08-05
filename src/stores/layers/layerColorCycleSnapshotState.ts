import {
  createColorCycleCanonicalBrushStateFromSnapshot,
  createEmptyColorCycleLayerDocumentState,
  scaleColorCyclePaintSnapshotNearest,
  type ColorCycleBrushLayerSnapshot as ColorCycleLayerSnapshot,
} from '@/lib/colorCycle/document';
import type { ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type { Layer } from '@/types';

const cloneBuffer = (buffer: ArrayBuffer | undefined): ArrayBuffer | undefined => (
  buffer ? buffer.slice(0) : undefined
);

export const commitColorCycleGradientBuffersToDocument = (
  colorCycleBrushManager: Pick<Partial<ColorCycleBrushManager>, 'getDocument'>,
  layer: Layer,
  layerId: string,
  width: number,
  height: number,
  gradientIdBuffer: ArrayBuffer | undefined,
  gradientDefIdBuffer: ArrayBuffer | undefined,
): void => {
  const document = colorCycleBrushManager.getDocument?.(layerId);
  if (!document || (!gradientIdBuffer && !gradientDefIdBuffer)) {
    return;
  }

  const { snapshot } = document.read();
  const resizedCanonicalState = snapshot.width === width && snapshot.height === height
    ? snapshot
    : snapshot.paintBuffer
    ? {
        ...snapshot,
        ...scaleColorCyclePaintSnapshotNearest({
          snapshot: {
            paintBuffer: snapshot.paintBuffer,
            gradientIdBuffer: snapshot.gradientIdBuffer,
            gradientDefIdBuffer: snapshot.gradientDefIdBuffer,
            speedBuffer: snapshot.speedBuffer,
            flowBuffer: snapshot.flowBuffer,
            phaseBuffer: snapshot.phaseBuffer,
            hasContent: snapshot.hasContent,
            strokeCounter: 0,
          },
          sourceWidth: snapshot.width,
          sourceHeight: snapshot.height,
          width,
          height,
        }),
        width,
        height,
      }
    : {
        ...snapshot,
        ...createEmptyColorCycleLayerDocumentState({ layerId, width, height }),
      };
  document.replaceState({
    ...resizedCanonicalState,
    layerId,
    width,
    height,
    gradientIdBuffer: cloneBuffer(gradientIdBuffer) ?? resizedCanonicalState.gradientIdBuffer,
    gradientDefIdBuffer: cloneBuffer(gradientDefIdBuffer) ?? resizedCanonicalState.gradientDefIdBuffer,
    gradientDefs: layer.colorCycleData?.gradientDefs ?? resizedCanonicalState.gradientDefs,
    slotPalettes: layer.colorCycleData?.slotPalettes ?? resizedCanonicalState.slotPalettes,
    gradientDefStore: layer.colorCycleData?.gradientDefStore ?? resizedCanonicalState.gradientDefStore,
    activeGradientId: layer.colorCycleData?.activeGradientId ?? resizedCanonicalState.activeGradientId,
    paintSlot: layer.colorCycleData?.paintSlot ?? resizedCanonicalState.paintSlot,
    fgActiveSlot: layer.colorCycleData?.fgActiveSlot ?? resizedCanonicalState.fgActiveSlot,
    flowMode: layer.colorCycleData?.flowMode ?? resizedCanonicalState.flowMode,
  }, 'color-cycle-layer-init-gradient-bindings');
};

export const buildCanonicalBrushStateFromSnapshot = (
  layer: Layer,
  layerId: string,
  snapshot: ColorCycleLayerSnapshot,
  existingBrushState: unknown,
): unknown => {
  const colorCycleData = layer.colorCycleData;
  const width = Math.max(1, Math.floor(
    colorCycleData?.canvasWidth ??
    colorCycleData?.canvas?.width ??
    colorCycleData?.canvasImageData?.width ??
    layer.imageData?.width ??
    1
  ));
  const height = Math.max(1, Math.floor(
    colorCycleData?.canvasHeight ??
    colorCycleData?.canvas?.height ??
    colorCycleData?.canvasImageData?.height ??
    layer.imageData?.height ??
    1
  ));
  return createColorCycleCanonicalBrushStateFromSnapshot({
    layerId,
    width,
    height,
    snapshot,
    existingBrushState,
    metadata: {
      gradientDefs: colorCycleData?.gradientDefs,
      slotPalettes: colorCycleData?.slotPalettes,
      gradientDefStore: colorCycleData?.gradientDefStore,
      paintSlot: colorCycleData?.paintSlot,
      fgActiveSlot: colorCycleData?.fgActiveSlot,
      activeGradientId: colorCycleData?.activeGradientId,
    },
  });
};
