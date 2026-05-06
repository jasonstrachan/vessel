import type { Layer } from '@/types';
import { debugLog } from '@/utils/debug';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';

// Boundary: live runtime lookup only. This is the source of truth for direct and
// manager-backed CC brush availability during Goblet export.
export type GobletSerializableColorCycleBrush = {
  serialize?: () => unknown;
};

export const resolveGobletColorCycleLiveBrush = (
  layer: Layer,
): GobletSerializableColorCycleBrush | undefined => {
  const directBrush = layer.colorCycleData?.colorCycleBrush as GobletSerializableColorCycleBrush | undefined;
  if (directBrush && typeof directBrush.serialize === 'function') {
    return directBrush;
  }

  try {
    const manager = getColorCycleBrushManager();
    const managedBrush = manager.getBrush(layer.id) as GobletSerializableColorCycleBrush | undefined;
    if (managedBrush && typeof managedBrush.serialize === 'function') {
      return managedBrush;
    }
  } catch (error) {
    debugLog('raw-console', '[webglExporter] Failed to resolve color cycle brush via manager', error);
  }

  return undefined;
};

export const hasGobletColorCycleLiveBrush = (layer: Layer): boolean => (
  Boolean(resolveGobletColorCycleLiveBrush(layer))
);
