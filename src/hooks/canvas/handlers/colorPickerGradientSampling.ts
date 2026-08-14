import type { BrushSettings, GradientSeamProfile, Layer } from '@/types';
import type { ColorCycleLayerDocumentSnapshot } from '@/lib/colorCycle/document';
import { normalizeGradientSeamProfile } from '@/lib/colorCycle/gradientSeamProfile';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';

export type PickedColorCycleGradient = {
  stops: NonNullable<BrushSettings['colorCycleGradient']>;
  runtimeStops: NonNullable<BrushSettings['colorCycleGradient']>;
  seamProfile: GradientSeamProfile;
};

type ColorPickerGradientSourceState = {
  activeLayerId: string | null;
  currentTool: string;
  layers: Layer[];
};

type ColorPickerGradientSampleControllerDependencies = {
  getSourceState: () => ColorPickerGradientSourceState;
  ensureColorCycleLayerRuntime: (layerId: string) => Promise<boolean>;
  resolveGradient: (
    layerId: string,
    x: number,
    y: number,
  ) => PickedColorCycleGradient | null;
  rememberGradient: (gradient: PickedColorCycleGradient) => void;
  sampleRegularColor: (position: { x: number; y: number }) => void;
};

const clonePickedStops = (
  stops: NonNullable<BrushSettings['colorCycleGradient']>,
): NonNullable<BrushSettings['colorCycleGradient']> => stops.map((stop) => ({ ...stop }));

export const resolvePickedColorCycleGradientFromSnapshot = ({
  snapshot,
  x,
  y,
}: {
  snapshot: ColorCycleLayerDocumentSnapshot;
  x: number;
  y: number;
}): PickedColorCycleGradient | null => {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isInteger(snapshot.width) ||
    !Number.isInteger(snapshot.height) ||
    snapshot.width <= 0 ||
    snapshot.height <= 0
  ) {
    return null;
  }

  const pixelX = Math.floor(x);
  const pixelY = Math.floor(y);
  if (
    pixelX < 0 ||
    pixelY < 0 ||
    pixelX >= snapshot.width ||
    pixelY >= snapshot.height
  ) {
    return null;
  }

  const pixelCount = snapshot.width * snapshot.height;
  const pixelIndex = pixelY * snapshot.width + pixelX;
  const paint = snapshot.paintBuffer?.byteLength === pixelCount
    ? new Uint8Array(snapshot.paintBuffer)
    : null;
  if (paint && paint[pixelIndex] === 0) {
    return null;
  }

  const definitionIds = snapshot.gradientDefIdBuffer?.byteLength === pixelCount * 2
    ? new Uint16Array(snapshot.gradientDefIdBuffer)
    : null;
  const definitionId = definitionIds?.[pixelIndex] ?? 0;
  if (definitionId > 0) {
    const definition = snapshot.gradientDefStore?.find((entry) => entry.id === definitionId);
    if (definition?.stops.length) {
      const sourceStops = definition.sourceStops?.length
        ? definition.sourceStops
        : definition.stops;
      return {
        stops: clonePickedStops(sourceStops),
        runtimeStops: clonePickedStops(definition.stops),
        seamProfile: normalizeGradientSeamProfile(definition.seamProfile),
      };
    }
  }

  if (!paint) {
    return null;
  }

  const gradientIds = snapshot.gradientIdBuffer?.byteLength === pixelCount
    ? new Uint8Array(snapshot.gradientIdBuffer)
    : null;
  if (!gradientIds) {
    return null;
  }

  const slot = gradientIds[pixelIndex];
  const palette = snapshot.slotPalettes?.find((entry) => entry.slot === slot);
  if (!palette?.stops.length) {
    return null;
  }

  return {
    stops: clonePickedStops(palette.stops),
    runtimeStops: clonePickedStops(palette.stops),
    seamProfile: normalizeGradientSeamProfile(palette.seamProfile),
  };
};

export const resolvePickedColorCycleGradientAtPosition = (
  layerId: string,
  x: number,
  y: number,
): PickedColorCycleGradient | null => {
  const snapshot = getColorCycleBrushManager().getDocument(layerId)?.read().snapshot;
  return snapshot
    ? resolvePickedColorCycleGradientFromSnapshot({ snapshot, x, y })
    : null;
};

const needsColorCycleSamplingRuntime = (layer: Layer): boolean => (
  layer.colorCycleData?.deferredRuntimeRestore === true
  || layer.colorCycleData?.runtimeHydrationState === 'cold'
);

export const createColorPickerGradientSampleController = (
  dependencies: ColorPickerGradientSampleControllerDependencies,
): {
  sample: (position: { x: number; y: number }) => void;
} => {
  let latestRequestId = 0;

  const rememberResolvedGradient = (
    layerId: string,
    position: { x: number; y: number },
  ): boolean => {
    const pickedGradient = dependencies.resolveGradient(
      layerId,
      position.x,
      position.y,
    );
    if (!pickedGradient) {
      return false;
    }
    dependencies.rememberGradient(pickedGradient);
    return true;
  };

  const sample = (position: { x: number; y: number }): void => {
    const requestId = ++latestRequestId;
    const sourceState = dependencies.getSourceState();
    const activeLayer = sourceState.layers.find(
      (layer) => layer.id === sourceState.activeLayerId,
    );

    if (!activeLayer || activeLayer.layerType !== 'color-cycle') {
      dependencies.sampleRegularColor(position);
      return;
    }

    if (rememberResolvedGradient(activeLayer.id, position)) {
      return;
    }

    if (!needsColorCycleSamplingRuntime(activeLayer)) {
      dependencies.sampleRegularColor(position);
      return;
    }

    void dependencies.ensureColorCycleLayerRuntime(activeLayer.id)
      .catch(() => false)
      .then(() => {
        if (requestId !== latestRequestId) {
          return;
        }

        const currentState = dependencies.getSourceState();
        if (
          currentState.currentTool !== 'color-picker'
          || currentState.activeLayerId !== activeLayer.id
        ) {
          return;
        }

        const currentLayer = currentState.layers.find(
          (layer) => layer.id === activeLayer.id,
        );
        if (!currentLayer || currentLayer.layerType !== 'color-cycle') {
          return;
        }

        if (!rememberResolvedGradient(currentLayer.id, position)) {
          dependencies.sampleRegularColor(position);
        }
      });
  };

  return { sample };
};
