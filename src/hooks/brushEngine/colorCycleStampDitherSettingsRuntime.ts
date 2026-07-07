import type { LayerStrokeState } from './colorCycleCanvas2DTypes';

export type ColorCycleStampDitherSettingsContext = {
  setStampDitherEnabled(enabled: boolean): boolean;
  setStampDitherPressureLinked(enabled: boolean): void;
  getStrokeStateValues(): Iterable<LayerStrokeState>;
};

export function setColorCycleStampDitherEnabled(
  context: ColorCycleStampDitherSettingsContext,
  enabled: boolean,
): void {
  const isEnabled = context.setStampDitherEnabled(enabled);
  if (isEnabled) {
    return;
  }

  for (const stroke of context.getStrokeStateValues()) {
    stroke.stampDither = undefined;
  }
}

export function setColorCycleStampDitherPressureLinked(
  context: ColorCycleStampDitherSettingsContext,
  enabled: boolean,
): void {
  context.setStampDitherPressureLinked(enabled);

  for (const stroke of context.getStrokeStateValues()) {
    if (stroke.stampDither) {
      stroke.stampDither.stampDitherPressureState = null;
    }
  }
}
