export { getSharedAnimationRuntime } from '@/runtime/playback/animationRuntime';
export type { AnimationRuntimeConsumer } from '@/runtime/playback/animationRuntime';

export const CANVAS_FRAME_UPDATE_EVENT = 'vessel:canvasFrameUpdate';

export const dispatchGlobalAnimationFrameUpdate = (): void => {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent('vessel:animationFrameUpdate'));
};

export const dispatchCanvasFrameUpdate = (): void => {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(CANVAS_FRAME_UPDATE_EVENT));
};

export const dispatchInterlaceFrameUpdate = dispatchCanvasFrameUpdate;

export interface SequentialAnimationFrameUpdateDetail {
  frameIndex: number;
  advancedFrames: number;
}

export const dispatchSequentialAnimationFrameUpdate = (
  detail: SequentialAnimationFrameUpdateDetail
): void => {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<SequentialAnimationFrameUpdateDetail>('vessel:sequentialFrameUpdate', {
      detail,
    })
  );
};
