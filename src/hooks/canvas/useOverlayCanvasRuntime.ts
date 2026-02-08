import { useMemo } from 'react';
import {
  createOverlayCanvasDispatchers,
} from '@/hooks/canvas/handlers/overlayCanvas';
import {
  buildOverlayCanvasDispatcherArgs,
} from '@/hooks/canvas/handlers/buildOverlayCanvasDispatcherArgs';

type OverlayCanvasDispatcherArgs = Parameters<typeof buildOverlayCanvasDispatcherArgs>[0];

type UseOverlayCanvasRuntimeArgs = OverlayCanvasDispatcherArgs;

export const useOverlayCanvasRuntime = ({
  project,
  storeRef,
  drawingCanvasRef,
  drawingCtxRef,
  drawingCanvasHasContent,
  activeLayerWidth,
  activeLayerHeight,
}: UseOverlayCanvasRuntimeArgs) =>
  useMemo(
    () =>
      createOverlayCanvasDispatchers(
        buildOverlayCanvasDispatcherArgs({
          project,
          storeRef,
          drawingCanvasRef,
          drawingCtxRef,
          drawingCanvasHasContent,
          activeLayerWidth,
          activeLayerHeight,
        })
      ),
    [
      project,
      storeRef,
      drawingCanvasRef,
      drawingCtxRef,
      drawingCanvasHasContent,
      activeLayerWidth,
      activeLayerHeight,
    ]
  );
