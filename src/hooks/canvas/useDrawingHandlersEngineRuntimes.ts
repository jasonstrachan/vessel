import { useMemo } from 'react';

import { useBrushEngineSimplified } from '@/hooks/useBrushEngineSimplified';
import { useUserBrushEngine } from '@/hooks/useUserBrushEngine';
import type { UseDrawingHandlersRuntimeSetupBridgeOptions } from '@/hooks/canvas/useDrawingHandlersRuntimeSetupBridge.types';

export const useDrawingHandlersEngineRuntimes = () => {
  const brushRuntime = useBrushEngineSimplified();
  const userBrushEngine = useUserBrushEngine();
  const brushRuntimeAdapters = useMemo(() => {
    const updateConfig = brushRuntime.updateConfig;
    const brushStampRuntime = {
      drawBrush: brushRuntime.drawBrush,
      updateConfig,
    };
    const strokeBrushRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['strokeBrushRuntime'] = {
      updateConfig,
      resetColorCycle: brushRuntime.resetColorCycle,
      resetStroke: brushRuntime.resetStroke,
      drawColorCycle: brushRuntime.drawColorCycle,
      drawBrush: brushRuntime.drawBrush,
      consumeRecentStamps: brushRuntime.consumeRecentStamps,
    };
    const finalizeBrushRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['finalizeBrushRuntime'] = {
      finalizeStroke: brushRuntime.finalizeStroke,
      endColorCycleStroke: brushRuntime.endColorCycleStroke,
      renderColorCycle: brushRuntime.renderColorCycle,
      updateColorCycleGradient: brushRuntime.updateColorCycleGradient,
    };
    const shapeBrushRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['shapeBrushRuntime'] = {
      updateConfig,
      fillCcGradientLinear: brushRuntime.fillCcGradientLinear,
      fillCcGradientConcentric: brushRuntime.fillCcGradientConcentric,
      updateColorCycleTexture: brushRuntime.updateColorCycleTexture,
      applyStrokeDither: brushRuntime.applyStrokeDither,
      updateColorCycleGradient: brushRuntime.updateColorCycleGradient,
      resetColorCycle: brushRuntime.resetColorCycle,
    };
    const playbackBrushRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['playbackBrushRuntime'] = {
      isColorCycleAnimating: brushRuntime.isColorCycleAnimating,
      updateColorCycleAnimation: brushRuntime.updateColorCycleAnimation,
      renderColorCycle: (targetCtx, onlyActiveLayer) => {
        const rendered: unknown = brushRuntime.renderColorCycle(targetCtx, onlyActiveLayer);
        return typeof rendered === 'boolean' ? rendered : true;
      },
    };

    return {
      brushStampRuntime,
      strokeBrushRuntime,
      finalizeBrushRuntime,
      shapeBrushRuntime,
      playbackBrushRuntime,
    };
  }, [brushRuntime]);

  return {
    ...brushRuntimeAdapters,
    userBrushEngine,
  };
};
