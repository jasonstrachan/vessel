export class ColorCycleLayerBindingState {
  private activeLayerId: string | null = null;
  private layerId: string | null = null;
  private isolated = false;

  getActiveLayerId(): string | null {
    return this.activeLayerId;
  }

  setActiveLayerId(layerId: string): void {
    this.activeLayerId = layerId;
  }

  getLayerId(): string | null {
    return this.layerId;
  }

  setLayerId(layerId: string): void {
    this.layerId = layerId;
    this.setActiveLayerId(layerId);
  }

  isIsolated(): boolean {
    return this.isolated;
  }

  setIsolated(isolated: boolean): void {
    this.isolated = isolated;
  }
}
