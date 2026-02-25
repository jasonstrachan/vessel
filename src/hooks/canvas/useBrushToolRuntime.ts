import { useEffect, useMemo } from 'react';
import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import {
  createBrushStampSourceFactory,
} from '@/hooks/canvas/handlers/createBrushStampSourceFactory';
import {
  createMaskHealingDispatchers,
} from '@/hooks/canvas/handlers/maskHealing';
import {
  createBrushHalfSizeGetter,
} from '@/hooks/canvas/handlers/getBrushHalfSize';
import {
  createColorCycleBrushEraserSettingsGetter,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleEraserSettings';
import {
  buildColorCycleBrushEraserSettingsGetterArgs,
} from '@/hooks/canvas/handlers/colorCycle/buildColorCycleBrushEraserSettingsGetterArgs';
import {
  createColorCycleStampTargetCtxGetter,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleStampTarget';
import {
  createStrokeSessionDispatchers,
} from '@/hooks/canvas/handlers/strokeSession';
import {
  createResetPolygonGradientStateDispatcher,
} from '@/hooks/canvas/handlers/shapes/resetPolygonGradientState';

type BrushStampFactoryArgs = Parameters<typeof createBrushStampSourceFactory>[0];
type MaskHealingArgs = Parameters<typeof createMaskHealingDispatchers>[0];
type BrushHalfSizeStoreRef = Parameters<typeof createBrushHalfSizeGetter>[0];
type CcEraserSettingsGetterArgs = Parameters<typeof buildColorCycleBrushEraserSettingsGetterArgs>[0];
type CcStampTargetGetterArgs = Parameters<typeof createColorCycleStampTargetCtxGetter>[0];
type StrokeSessionDispatchersArgs = Parameters<typeof createStrokeSessionDispatchers>[0];

interface UseBrushToolRuntimeArgs {
  brushStampFactoryArgs: BrushStampFactoryArgs;
  maskHealingArgs: Omit<MaskHealingArgs, 'createBrushStampSource'>;
  brushHalfSizeStoreRef: BrushHalfSizeStoreRef;
  ccEraserSettingsGetterArgs: CcEraserSettingsGetterArgs;
  ccStampTargetGetterArgs: CcStampTargetGetterArgs;
  strokeSessionDispatchersArgs: StrokeSessionDispatchersArgs;
  polygonStoreRef: React.MutableRefObject<AppState>;
}

export const useBrushToolRuntime = ({
  brushStampFactoryArgs,
  maskHealingArgs,
  brushHalfSizeStoreRef,
  ccEraserSettingsGetterArgs,
  ccStampTargetGetterArgs,
  strokeSessionDispatchersArgs,
  polygonStoreRef,
}: UseBrushToolRuntimeArgs) => {
  const createBrushStampSource = useMemo(
    () => createBrushStampSourceFactory(brushStampFactoryArgs),
    [brushStampFactoryArgs]
  );

  const {
    beginMaskHealingStroke,
    extendMaskHealingStroke,
    endMaskHealingStroke,
  } = useMemo(
    () =>
      createMaskHealingDispatchers({
        ...maskHealingArgs,
        createBrushStampSource,
      }),
    [maskHealingArgs, createBrushStampSource]
  );

  useEffect(
    () => () => {
      endMaskHealingStroke();
    },
    [endMaskHealingStroke]
  );

  const getBrushHalfSize = useMemo(
    () => createBrushHalfSizeGetter(brushHalfSizeStoreRef),
    [brushHalfSizeStoreRef]
  );

  const getColorCycleBrushEraserSettings = useMemo(
    () =>
      createColorCycleBrushEraserSettingsGetter(
        buildColorCycleBrushEraserSettingsGetterArgs(ccEraserSettingsGetterArgs)
      ),
    [ccEraserSettingsGetterArgs]
  );

  const getCCStampTargetCtx = useMemo(
    () => createColorCycleStampTargetCtxGetter(ccStampTargetGetterArgs),
    [ccStampTargetGetterArgs]
  );

  const { beginStrokeSession, endStrokeSession, clearStrokeSession } = useMemo(
    () => createStrokeSessionDispatchers(strokeSessionDispatchersArgs),
    [strokeSessionDispatchersArgs]
  );

  const resetPolygonState = useMemo(
    () => createResetPolygonGradientStateDispatcher(polygonStoreRef),
    [polygonStoreRef]
  );

  return {
    createBrushStampSource,
    beginMaskHealingStroke,
    extendMaskHealingStroke,
    endMaskHealingStroke,
    getBrushHalfSize,
    getColorCycleBrushEraserSettings,
    getCCStampTargetCtx,
    beginStrokeSession,
    endStrokeSession,
    clearStrokeSession,
    resetPolygonState,
  };
};
