import type { BrushSettings, GradientSeamProfile } from '@/types';
import type { ColorCycleLayerDocumentSnapshot } from '@/lib/colorCycle/document';
import { normalizeGradientSeamProfile } from '@/lib/colorCycle/gradientSeamProfile';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';

export type PickedColorCycleGradient = {
  stops: NonNullable<BrushSettings['colorCycleGradient']>;
  seamProfile: GradientSeamProfile;
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
      return {
        stops: clonePickedStops(definition.stops),
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
