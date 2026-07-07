export class ColorCycleStrokeSessionState {
  private strokeCounter = 0;
  private stampCounter = 0;
  private drawing = false;

  isDrawing(): boolean {
    return this.drawing;
  }

  setDrawing(isDrawing: boolean): void {
    this.drawing = isDrawing;
  }

  incrementStrokeCounter(): number {
    this.strokeCounter += 1;
    return this.strokeCounter;
  }

  getStrokeCounter(): number {
    return this.strokeCounter;
  }

  setStrokeCounter(strokeCounter: number): void {
    this.strokeCounter = strokeCounter;
  }

  getStampCounter(): number {
    return this.stampCounter;
  }

  resetStampCounter(): void {
    this.stampCounter = 0;
  }

  advanceStampCounter(delta: number): number {
    this.stampCounter += delta;
    return this.stampCounter;
  }
}
