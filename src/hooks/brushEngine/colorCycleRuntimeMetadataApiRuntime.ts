import type { FlowMode } from '@/lib/colorCycle/flowEncoding';
import type { GradientStop } from '@/lib/GradientPalette';

import { ColorCycleRuntimeMetadataState } from './colorCycleRuntimeMetadataState';

export class ColorCycleRuntimeMetadataApiRuntime {
  private readonly state = new ColorCycleRuntimeMetadataState();

  getGradientStops = (): GradientStop[] => (
    this.state.getGradientStops()
  );

  getGradientStopsBuiltFromVersion = (): number | null => (
    this.state.getGradientStopsBuiltFromVersion()
  );

  setGradientStops = (
    stops: GradientStop[] | undefined,
    builtFromVersion: number | null,
  ): void => {
    this.state.setGradientStops(stops, builtFromVersion);
  };

  getFlowMode = (): FlowMode => (
    this.state.getFlowMode()
  );

  setFlowMode = (mode: FlowMode): void => {
    this.state.setFlowMode(mode);
  };

  getLegacyFlowMode = (): FlowMode => (
    this.state.getLegacyFlowMode()
  );

  setLegacyFlowMode = (mode: FlowMode): void => {
    this.state.setLegacyFlowMode(mode);
  };
}
