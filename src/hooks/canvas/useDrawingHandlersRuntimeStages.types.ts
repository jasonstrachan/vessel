import type React from 'react';
import type { buildDrawingHandlersColorCycleBridgeOptions } from '@/hooks/canvas/buildDrawingHandlersColorCycleBridgeOptions';
import type { buildDrawingHandlersRuntimeSetupBridgeOptions } from '@/hooks/canvas/buildDrawingHandlersRuntimeSetupBridgeOptions';

type ColorCycleBridgeBuilderArgs = Parameters<typeof buildDrawingHandlersColorCycleBridgeOptions>[0];
type RuntimeSetupBridgeBuilderArgs = Parameters<typeof buildDrawingHandlersRuntimeSetupBridgeOptions>[0];

export interface UseDrawingHandlersRuntimeStagesPerfOptions {
  withTiming: ColorCycleBridgeBuilderArgs['withTiming'];
  logError: ColorCycleBridgeBuilderArgs['logError'];
  perfMark: ColorCycleBridgeBuilderArgs['perfMark'];
  perfMeasure: ColorCycleBridgeBuilderArgs['perfMeasure'];
  debugTime: RuntimeSetupBridgeBuilderArgs['debugTime'];
  debugTimeEnd: RuntimeSetupBridgeBuilderArgs['debugTimeEnd'];
  debugVerbose: RuntimeSetupBridgeBuilderArgs['debugVerbose'];
}

export interface UseDrawingHandlersRuntimeStagesOptions {
  project: { width: number; height: number } | null;
  isBusyRef?: React.MutableRefObject<boolean>;
  sampleColorAt?: (x: number, y: number) => string;
  perf: UseDrawingHandlersRuntimeStagesPerfOptions;
}
