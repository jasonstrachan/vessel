import {
  createOverlayCanvasDispatchers,
} from '@/hooks/canvas/handlers/overlayCanvas';

type OverlayCanvasDispatcherArgs = Parameters<typeof createOverlayCanvasDispatchers>[0];

export const buildOverlayCanvasDispatcherArgs = (
  args: OverlayCanvasDispatcherArgs
): OverlayCanvasDispatcherArgs => args;
