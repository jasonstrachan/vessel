import type { MarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import type { StoredStop } from '@/utils/colorCycleGradientDefs';

type ShapeFillRenderSession = Pick<MarkGradientSession, 'source' | 'frozenStopsStored' | 'binding'> | null | undefined;

export type ColorCycleShapeFillSourceOptions = {
  ditherSampledStops?: StoredStop[];
  ditherBaseOffsetOverride?: number;
  paintSlotOverride?: number;
  paintDefIdOverride?: number;
  shapePhaseSeedMarkId: string | null;
};

const cloneStoredStops = (stops: StoredStop[] | null | undefined): StoredStop[] | undefined => {
  if (!stops?.length) {
    return undefined;
  }
  return stops.map((stop) => ({ ...stop }));
};

export const resolveColorCycleShapeFillSourceOptions = ({
  session,
  renderSession,
}: {
  session: Pick<MarkGradientSession, 'markId'> | null | undefined;
  renderSession: ShapeFillRenderSession;
}): ColorCycleShapeFillSourceOptions => ({
  ditherSampledStops: renderSession?.source === 'sampled'
    ? cloneStoredStops(renderSession.frozenStopsStored)
    : undefined,
  ditherBaseOffsetOverride: renderSession?.source === 'sampled' ? 0 : undefined,
  paintSlotOverride: renderSession?.binding?.slot,
  paintDefIdOverride: renderSession?.binding?.defId,
  shapePhaseSeedMarkId: session?.markId ?? null,
});
