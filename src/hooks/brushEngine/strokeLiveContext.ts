import { pick2DRead } from './engineShared';

export const getLiveStrokeRawContext = ({
  ctx,
  ensureLiveStrokeBuffers,
  liveStrokeRawRef,
}: {
  ctx: CanvasRenderingContext2D;
  ensureLiveStrokeBuffers: (ctx: CanvasRenderingContext2D) => boolean;
  liveStrokeRawRef: { current: HTMLCanvasElement | OffscreenCanvas | null };
}): CanvasRenderingContext2D | null => {
  if (!ensureLiveStrokeBuffers(ctx)) {
    return null;
  }
  return pick2DRead(liveStrokeRawRef.current) as CanvasRenderingContext2D | null;
};
