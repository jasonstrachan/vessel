import { flushGradientApply, requestGradientApply } from '@/hooks/brushEngine/ccGradientApplyScheduler';
import { useAppStore } from '@/stores/useAppStore';
import type { StoredStop } from '@/utils/colorCycleGradientDefs';

export const persistCommittedSampledSlot = ({
  layerId,
  slot,
  stops,
  defId,
  reason,
}: {
  layerId: string;
  slot: number;
  stops: StoredStop[];
  defId?: number;
  reason: string;
}): void => {
  const state = useAppStore.getState();
  const layer = state.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
    return;
  }

  const committedDefStops =
    typeof defId === 'number'
      ? layer.colorCycleData.gradientDefStore?.find((entry) => entry.id === defId)?.stops
      : undefined;
  const sourceStops = committedDefStops?.length ? committedDefStops : stops;
  const nextStops = sourceStops.map((stop) => ({
    position: stop.position,
    color: stop.color,
    opacity: 'opacity' in stop && typeof stop.opacity === 'number' ? stop.opacity : undefined,
  }));
  const slotPalettes = layer.colorCycleData.slotPalettes ?? [];
  const hasSlot = slotPalettes.some((entry) => entry.slot === slot);
  const nextSlotPalettes = hasSlot
    ? slotPalettes.map((entry) =>
        entry.slot === slot
          ? { slot, stops: nextStops }
          : entry
      )
    : [...slotPalettes, { slot, stops: nextStops }];
  const effectivePlaying =
    state.colorCyclePlayback?.desiredPlaying === true && state.colorCyclePlayback.suspendDepth === 0;

  state.updateLayer(layerId, {
    colorCycleData: {
      ...layer.colorCycleData,
      paintStops: nextStops,
      slotPalettes: nextSlotPalettes,
      gradient: nextStops,
      paintSlot: slot,
      isAnimating: effectivePlaying,
    },
  }, { skipColorCycleSync: true });
  requestGradientApply(layerId, reason);
  flushGradientApply(layerId);
};
