import {
  createPauseAllBrushCCAnimationsDispatcher,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleInteraction';

type PauseAllBrushCCAnimationsArgs = Parameters<typeof createPauseAllBrushCCAnimationsDispatcher>[0];

export const buildPauseAllBrushCCAnimationsArgs = (
  args: PauseAllBrushCCAnimationsArgs
): PauseAllBrushCCAnimationsArgs => args;
