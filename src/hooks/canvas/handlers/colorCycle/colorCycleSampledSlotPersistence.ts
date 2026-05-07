import { getAppStoreState } from '@/stores/appStoreAccess';
import { flushGradientApply, requestGradientApply } from '@/hooks/brushEngine/ccGradientApplyScheduler';
import type { GradientSeamProfile } from '@/lib/colorCycle/gradientSeamProfile';
import type { StoredStop } from '@/utils/colorCycleGradientDefs';

type SampledSlotPalette = {
  slot: number;
  stops: Array<{ position: number; color: string; opacity?: number }>;
  seamProfile?: GradientSeamProfile;
};

const buildSampledSlotPalette = (
  slot: number,
  stops: SampledSlotPalette['stops'],
  seamProfile?: GradientSeamProfile,
): SampledSlotPalette => (
  seamProfile ? { slot, stops, seamProfile } : { slot, stops }
);

export const persistCommittedSampledSlot = ({
  layerId,
  slot,
  stops,
  defId,
  seamProfile,
  reason,
}: {
  layerId: string;
  slot: number;
  stops: StoredStop[];
  defId?: number;
  seamProfile?: GradientSeamProfile;
  reason: string;
}): void => {
  const state = getAppStoreState();
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
          ? buildSampledSlotPalette(slot, nextStops, seamProfile ?? entry.seamProfile)
          : entry
      )
    : [...slotPalettes, buildSampledSlotPalette(slot, nextStops, seamProfile)];
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
