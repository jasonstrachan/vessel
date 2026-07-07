import type { FlowMode } from '@/lib/colorCycle/flowEncoding';
import type { GradientStop } from '@/lib/GradientPalette';

const DEFAULT_GRADIENT_STOPS: GradientStop[] = [
  { position: 0, color: '#000000' },
  { position: 1, color: '#ffffff' },
];

export class ColorCycleRuntimeMetadataState {
  private currentGradientStops: GradientStop[] = [...DEFAULT_GRADIENT_STOPS];
  private currentGradientStopsBuiltFromVersion: number | null = null;
  private flowMode: FlowMode = 'forward';
  private legacyFlowMode: FlowMode = 'forward';

  getGradientStops(): GradientStop[] {
    return this.currentGradientStops;
  }

  getGradientStopsBuiltFromVersion(): number | null {
    return this.currentGradientStopsBuiltFromVersion;
  }

  setGradientStops(stops: GradientStop[] | undefined, builtFromVersion: number | null): void {
    if (!Array.isArray(stops) || stops.length === 0) {
      return;
    }
    this.currentGradientStops = [...stops];
    this.currentGradientStopsBuiltFromVersion = builtFromVersion;
  }

  getFlowMode(): FlowMode {
    return this.flowMode;
  }

  setFlowMode(_mode: FlowMode): void {
    void _mode;
    this.flowMode = 'forward';
  }

  getLegacyFlowMode(): FlowMode {
    return this.legacyFlowMode;
  }

  setLegacyFlowMode(_mode: FlowMode): void {
    void _mode;
    this.legacyFlowMode = 'forward';
  }
}
