export class ColorCycleRestoreSessionState {
  private historyRestore = false;

  isHistoryRestore(): boolean {
    return this.historyRestore;
  }

  setHistoryRestore(active: boolean): void {
    this.historyRestore = active;
  }
}
