import {
  endColorCycleStroke,
  type ColorCycleEndStrokeContext,
} from './colorCycleEndStroke';
import {
  startColorCycleStroke,
  type ColorCycleStartStrokeContext,
} from './colorCycleStartStroke';

export type ColorCycleStrokeLifecycleContext =
  Omit<ColorCycleStartStrokeContext, 'layerId' | 'clearBuffer'>
  & Omit<ColorCycleEndStrokeContext, 'layerId'>;

export function startColorCycleStrokeLifecycle(
  context: ColorCycleStrokeLifecycleContext,
  layerId?: string,
  clearBuffer: boolean = false,
): void {
  startColorCycleStroke({
    ...context,
    layerId,
    clearBuffer,
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
