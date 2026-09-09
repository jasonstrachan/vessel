export interface CanvasAuthoringContext {
  layerId: string;
  operation: 'source-over' | 'destination-out';
}

export interface CanvasAuthoringObservation {
  context: CanvasRenderingContext2D;
  finish(cancelled?: boolean): void;
}

export interface CanvasAuthoringContribution {
  revealOrder?: Uint8Array;
  image: ImageData;
  x: number;
  y: number;
  operation: CanvasAuthoringContext['operation'];
}

type Point = { x: number; y: number };
interface CanvasProgressObserver {
  sample(canvas: HTMLCanvasElement, from: Point, to: Point): void;
  take(canvas: HTMLCanvasElement, image: ImageData, x: number, y: number): Uint8Array | undefined;
}
let progressObserver: CanvasProgressObserver | null = null;
export const registerCanvasProgressObserver = (next: CanvasProgressObserver): (() => void) => {
  progressObserver = next;
  return () => { if (progressObserver === next) progressObserver = null; };
};
export const observeCanvasProgress = (ctx: CanvasRenderingContext2D, from: Point, to: Point): void => progressObserver?.sample(ctx.canvas, from, to);
export const takeCanvasProgress = (canvas: HTMLCanvasElement, image: ImageData, x: number, y: number): Uint8Array | undefined => progressObserver?.take(canvas, image, x, y);

type Observer = (context: CanvasRenderingContext2D, action: CanvasAuthoringContext) => CanvasAuthoringObservation;
let observer: Observer | null = null;
let collect: ((layerId: string) => CanvasAuthoringContribution | undefined) | undefined;

export const registerCanvasAuthoringObserver = (next: Observer, take?: typeof collect): (() => void) => {
  observer = next;
  collect = take;
  return () => { if (observer === next) { observer = null; collect = undefined; } };
};

/** Consume before asynchronous history work so a later gesture cannot replace this mark. */
export const takeCanvasAuthoringContribution = (layerId: string): CanvasAuthoringContribution | undefined => collect?.(layerId);

export const observeCanvasAuthoring = (context: CanvasRenderingContext2D, action: CanvasAuthoringContext): CanvasAuthoringObservation =>
  observer?.(context, action) ?? { context, finish: () => {} };
