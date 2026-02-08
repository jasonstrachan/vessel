import { useMemo, useRef } from 'react';
import type { AppState } from '@/stores/useAppStore';
import {
  createEffectiveColorCyclePlayingGetter,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleInteraction';
import {
  createGetBrushForLayerDispatcher,
} from '@/hooks/canvas/handlers/colorCycle/getBrushForLayerDispatcher';
import {
  createScheduleRecomposeDispatcher,
} from '@/hooks/canvas/handlers/colorCycle/scheduleRecompose';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';

type ManagedColorCycleBrush = ColorCycleBrushImplementation & {
  commitCurrentStroke?: (layerId?: string) => void;
  finalizeCurrentStroke?: (layerId?: string) => void;
  commitToLayer?: (canvas: HTMLCanvasElement, layerId: string) => void;
  renderDirectToCanvas?: (canvas: HTMLCanvasElement, layerId: string) => void;
  clearPaintBuffer?: (layerId?: string) => void;
  flush?: (layerId?: string) => void;
  updateColorCycleTexture?: () => void;
};

interface UseColorCycleRuntimeBindingsArgs {
  storeRef: React.MutableRefObject<AppState>;
}

export const useColorCycleRuntimeBindings = ({
  storeRef,
}: UseColorCycleRuntimeBindingsArgs) => {
  const getEffectiveColorCyclePlaying = useMemo(
    () => createEffectiveColorCyclePlayingGetter(storeRef),
    [storeRef]
  );
  const getBrushForLayer = useMemo(
    () => createGetBrushForLayerDispatcher() as (layerId: string) => ManagedColorCycleBrush | undefined,
    []
  );
  const pendingRecomposeRef = useRef(false);
  const scheduleRecompose = useMemo(
    () => createScheduleRecomposeDispatcher(pendingRecomposeRef),
    []
  );

  return {
    getEffectiveColorCyclePlaying,
    getBrushForLayer,
    scheduleRecompose,
  };
};
