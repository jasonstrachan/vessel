import { dispatchCanvasFrameUpdate } from '@/hooks/canvas/handlers/animation/animationRuntime';

let frame: { projectId: string; canvas: HTMLCanvasElement } | null = null;

/** Ephemeral display override; never changes editable layers or saved project pixels. */
export const setCanvasPresentationFrame = (next: typeof frame): void => {
  frame = next;
  dispatchCanvasFrameUpdate();
};

export const getCanvasPresentationFrame = (projectId: string): HTMLCanvasElement | null =>
  frame?.projectId === projectId ? frame.canvas : null;
