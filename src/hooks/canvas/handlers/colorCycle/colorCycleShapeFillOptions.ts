import type { MarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import type { StoredStop } from '@/utils/colorCycleGradientDefs';
import { resolveColorCycleGradientSourceBehavior } from '@/hooks/canvas/handlers/colorCycle/colorCycleGradientSourceContract';
import type { ColorCycleSampledMotion } from '@/types';
import { normalizeColorCycleSampledMotion } from '@/utils/colorCycleSampledMotion';

type ShapeFillRenderSession = Pick<
  MarkGradientSession,
  'source' | 'frozenStopsStored' | 'binding'
> & {
  sourceStopsStored?: MarkGradientSession['frozenStopsStored'];
} | null | undefined;

export type ColorCycleShapeFillSourceOptions = {
  ditherSampledStops?: StoredStop[];
  ditherBaseOffsetOverride?: number;
  paintSlotOverride?: number;
  paintDefIdOverride?: number;
  shapePhaseSeedMarkId: string | null;
  sampledMotionOverride?: ColorCycleSampledMotion;
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
  session: Pick<
    MarkGradientSession,
    'markId' | 'isRuntimePalette' | 'sampledMotion'
  > | null | undefined;
  renderSession: ShapeFillRenderSession;
}): ColorCycleShapeFillSourceOptions => {
  const behavior = renderSession
    ? resolveColorCycleGradientSourceBehavior(renderSession.source)
    : null;
  const sampledMotionOverride = renderSession?.source === 'manual' && session?.isRuntimePalette
    ? normalizeColorCycleSampledMotion(session.sampledMotion) ?? undefined
    : undefined;

  return {
    ditherSampledStops: behavior?.usesSampledStops
      ? cloneStoredStops(renderSession?.sourceStopsStored ?? renderSession?.frozenStopsStored)
      : undefined,
    ditherBaseOffsetOverride: behavior ? 0 : undefined,
    paintSlotOverride: renderSession?.binding?.slot,
    paintDefIdOverride: renderSession?.binding?.defId,
    shapePhaseSeedMarkId: session?.markId ?? null,
    ...(sampledMotionOverride ? { sampledMotionOverride } : {}),
  };
};
