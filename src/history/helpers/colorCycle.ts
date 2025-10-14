import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';

type Brush = NonNullable<ReturnType<typeof getColorCycleBrushManager>['getBrush']>;
export type ColorCycleSerializedState = ReturnType<Brush['serialize']> | null;

export const captureColorCycleBrushState = (layerId: string): ColorCycleSerializedState => {
  const manager = getColorCycleBrushManager();
  const brush = manager.getBrush(layerId);
  if (!brush || typeof brush.serialize !== 'function') {
    return null;
  }
  try {
    const snapshot = brush.serialize();
    return snapshot
      ? {
          ...snapshot,
          layers: snapshot.layers?.map((layer) => ({
            ...layer,
            strokeData: layer.strokeData
              ? {
                  ...layer.strokeData,
                  paintBuffer: layer.strokeData.paintBuffer?.slice(0)
                }
              : undefined
          })) ?? []
        }
      : null;
  } catch {
    return null;
  }
};
