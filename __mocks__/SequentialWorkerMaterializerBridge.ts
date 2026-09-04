import type { SequentialStrokeEvent } from '@/types';
import type { FrameTileSet } from '@/lib/sequential/types';

export const buildSequentialWorkerMaterializeKey = ({
  layerId,
  renderSignature,
  frameIndex,
  eventSignature,
}: {
  layerId: string;
  renderSignature: string;
  frameIndex: number;
  eventSignature: string;
}): string => `${layerId}:${renderSignature}:${frameIndex}:${eventSignature}`;

export const buildSequentialWorkerEventsSignature = (
  events: ReadonlyArray<SequentialStrokeEvent>
): string => `${events.length}:${events.reduce((sum, event) => sum + event.stamps.length, 0)}`;

let acceptsRequests = false;
let completedFrame: FrameTileSet | null = null;

export const consumeSequentialWorkerMaterializedFrame = (key: string): FrameTileSet | null => {
  if (!completedFrame || !key.includes(`:${completedFrame.frameIndex}:`)) {
    return null;
  }
  const result = completedFrame;
  completedFrame = null;
  return result;
};

export const requestSequentialWorkerMaterializedFrame = (_args: {
  key: string;
  width: number;
  height: number;
  frameIndex: number;
  events: ReadonlyArray<SequentialStrokeEvent>;
}): boolean => acceptsRequests;

export const clearSequentialWorkerMaterializerBridge = (): void => {
  completedFrame = null;
};

export const disposeSequentialWorkerMaterializerBridge = (): void => {
  completedFrame = null;
};

export const __setSequentialWorkerFactoryForTests = (
  factory: (() => Worker) | null,
): void => {
  acceptsRequests = factory !== null;
  completedFrame = null;
};

export const __completeSequentialWorkerFrameForTests = (tileSet: FrameTileSet): void => {
  completedFrame = tileSet;
  window.dispatchEvent(new CustomEvent('vessel:sequentialFrameUpdate', {
    detail: { frameIndex: tileSet.frameIndex, advancedFrames: 0 },
  }));
};
