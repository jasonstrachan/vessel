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

export const consumeSequentialWorkerMaterializedFrame = (_key: string): FrameTileSet | null => null;

export const requestSequentialWorkerMaterializedFrame = (_args: {
  key: string;
  width: number;
  height: number;
  frameIndex: number;
  events: ReadonlyArray<SequentialStrokeEvent>;
}): void => {};

export const clearSequentialWorkerMaterializerBridge = (): void => {};

export const disposeSequentialWorkerMaterializerBridge = (): void => {};
