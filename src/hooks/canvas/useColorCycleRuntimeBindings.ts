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
    () => createGetBrushForLayerDispatcher(),
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
