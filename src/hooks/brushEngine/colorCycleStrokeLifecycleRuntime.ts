import {
  endColorCycleStroke,
  type ColorCycleEndStrokeContext,
} from './colorCycleEndStroke';
import {
  startColorCycleStroke,
  type ColorCycleStartStrokeContext,
} from './colorCycleStartStroke';

export type ColorCycleStrokeLifecycleContext =
  Omit<ColorCycleStartStrokeContext, 'layerId' | 'clearBuffer' | 'phaseOffsetUnits'>
  & Omit<ColorCycleEndStrokeContext, 'layerId'>;

export function startColorCycleStrokeLifecycle(
  context: ColorCycleStrokeLifecycleContext,
  layerId?: string,
  clearBuffer: boolean = false,
  phaseOffsetUnits?: number,
): void {
  startColorCycleStroke({
    ...context,
    layerId,
    clearBuffer,
    phaseOffsetUnits,
  });
}

export function endColorCycleStrokeLifecycle(
  context: ColorCycleStrokeLifecycleContext,
  layerId?: string,
): void {
  endColorCycleStroke({
    ...context,
    layerId,
  });
}
