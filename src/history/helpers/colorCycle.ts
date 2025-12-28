import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { timeSync } from '@/utils/perf/ccPerfProbe';
import type { ColorCycleBrushImplementation } from '@/stores/colorCycleBrushManager';

export type ColorCycleSerializedState = ReturnType<ColorCycleBrushImplementation['serialize']> | null;

export const captureColorCycleBrushState = (layerId: string): ColorCycleSerializedState =>
  timeSync('captureColorCycleBrushState', () => {
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
            layers:
              snapshot.layers?.map((layer) => ({
                ...layer,
                gradientDefs: layer.gradientDefs
                  ? layer.gradientDefs.map((entry) => ({
                      id: entry.id,
                      name: entry.name,
                      currentSlot: entry.currentSlot,
                    }))
                  : undefined,
                slotPalettes: layer.slotPalettes
                  ? layer.slotPalettes.map((entry) => ({
                      slot: entry.slot,
                      stops: entry.stops.map((stop) => ({ position: stop.position, color: stop.color })),
                    }))
                  : undefined,
                strokeData: layer.strokeData
                  ? {
                      ...layer.strokeData,
                      paintBuffer: layer.strokeData.paintBuffer?.slice(0),
                      gradientIdBuffer: layer.strokeData.gradientIdBuffer?.slice(0),
                    }
                  : undefined,
              })) ?? [],
          }
        : null;
    } catch {
      return null;
    }
  });
