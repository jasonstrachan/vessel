export type FlowMode = 'forward' | 'reverse' | 'pingpong';

export class StrokeOrderTracker {
  private strokeOrder: Uint16Array;
  private currentStrokeIndex: number = 1;
  private maxStrokeIndex: number = 0;
  private flowMode: FlowMode = 'forward';
  private lastControllerOffset: number = 0;
  private pingPongAscending: boolean = true;

  constructor(width: number, height: number) {
    this.strokeOrder = new Uint16Array(width * height);
  }

  reset() {
    this.strokeOrder.fill(0);
    this.currentStrokeIndex = 1;
    this.maxStrokeIndex = 0;
  }

  resize(width: number, height: number, options: { preserveIndices: boolean }) {
    if (width * height === this.strokeOrder.length) {
      return;
    }
    this.strokeOrder = new Uint16Array(width * height);
    if (!options.preserveIndices) {
      this.currentStrokeIndex = 1;
      this.maxStrokeIndex = 0;
    }
  }

  setFlowMode(mode: FlowMode, offset: number): boolean {
    if (this.flowMode === mode) {
      return false;
    }
    this.flowMode = mode;
    if (mode === 'pingpong') {
      this.lastControllerOffset = offset;
      this.pingPongAscending = true;
    }
    return true;
  }

  getFlowMode(): FlowMode {
    return this.flowMode;
  }

  getFlowDirection(): 'forward' | 'backward' {
    return this.flowMode === 'reverse' ? 'backward' : 'forward';
  }

  computePhase(offset: number): number {
    // Forward-only: ignore reverse/pingpong to keep a consistent phase direction.
    this.lastControllerOffset = offset;
    return ((offset % 1) + 1) % 1;
  }

  serialize() {
    return {
      flowMode: this.flowMode,
      currentStrokeIndex: this.currentStrokeIndex,
      maxStrokeIndex: this.maxStrokeIndex,
    };
  }
}
