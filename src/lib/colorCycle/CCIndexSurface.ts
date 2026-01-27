export interface CCIndexSurfaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CCIndexSurface {
  width: number;
  height: number;
  getIndexBuffers(): { data: Uint8Array; gid?: Uint8Array; spd?: Uint8Array };
  setIndexBuffers(data: Uint8Array, gid?: Uint8Array, spd?: Uint8Array): void;
  markDirty(bounds?: CCIndexSurfaceRect): void;
  renderToCanvas2D(ctx: CanvasRenderingContext2D): void;
}
