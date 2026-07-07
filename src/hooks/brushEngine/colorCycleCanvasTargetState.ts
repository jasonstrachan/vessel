export type ColorCycleCanvasTargetUpdate = {
  changed: boolean;
  dimensionsChanged: boolean;
  width: number;
  height: number;
};

export type ColorCycleCanvasTargetPresenter = {
  setTargetCanvas(canvas: HTMLCanvasElement): {
    width: number;
    height: number;
    dimensionsChanged: boolean;
  };
};

export class ColorCycleCanvasTargetState {
  private targetCanvas: HTMLCanvasElement;
  private canvasWidth: number;
  private canvasHeight: number;
  private useCanvas2D: boolean;

  constructor(canvas: HTMLCanvasElement, forceCanvas2D: boolean) {
    this.targetCanvas = canvas;
    this.canvasWidth = canvas.width;
    this.canvasHeight = canvas.height;
    this.useCanvas2D = forceCanvas2D;
  }

  get canvas(): HTMLCanvasElement {
    return this.targetCanvas;
  }

  get width(): number {
    return this.canvasWidth;
  }

  get height(): number {
    return this.canvasHeight;
  }

  get pixelCount(): number {
    return this.canvasWidth * this.canvasHeight;
  }

  get forceCanvas2D(): boolean {
    return this.useCanvas2D;
  }

  setForceCanvas2D(forceCanvas2D: boolean): void {
    this.useCanvas2D = forceCanvas2D;
  }

  setTargetCanvas(
    canvas: HTMLCanvasElement | null,
    presenter: ColorCycleCanvasTargetPresenter,
  ): ColorCycleCanvasTargetUpdate {
    if (!canvas || canvas === this.targetCanvas) {
      return {
        changed: false,
        dimensionsChanged: false,
        width: this.canvasWidth,
        height: this.canvasHeight,
      };
    }

    const targetUpdate = presenter.setTargetCanvas(canvas);
    this.targetCanvas = canvas;
    if (targetUpdate.dimensionsChanged) {
      this.canvasWidth = targetUpdate.width;
      this.canvasHeight = targetUpdate.height;
    }

    return {
      changed: true,
      dimensionsChanged: targetUpdate.dimensionsChanged,
      width: this.canvasWidth,
      height: this.canvasHeight,
    };
  }
}
