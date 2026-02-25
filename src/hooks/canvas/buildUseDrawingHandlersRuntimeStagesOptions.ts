import type React from 'react';
import type { UseDrawingHandlersRuntimeStagesOptions } from '@/hooks/canvas/useDrawingHandlersRuntimeStages.types';

interface BuildUseDrawingHandlersRuntimeStagesOptionsArgs {
  project: UseDrawingHandlersRuntimeStagesOptions['project'];
  isBusyRef?: React.MutableRefObject<boolean>;
  sampleColorAt?: (x: number, y: number) => string;
  perf: UseDrawingHandlersRuntimeStagesOptions['perf'];
}

export const buildUseDrawingHandlersRuntimeStagesOptions = ({
  project,
  isBusyRef,
  sampleColorAt,
  perf,
}: BuildUseDrawingHandlersRuntimeStagesOptionsArgs): UseDrawingHandlersRuntimeStagesOptions => ({
  project,
  isBusyRef,
  sampleColorAt,
  perf,
});
