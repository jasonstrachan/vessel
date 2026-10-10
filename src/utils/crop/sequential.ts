import {
  clearSequentialLayerRendererLayer,
  getSequentialLayerRenderCanvas,
} from '@/lib/sequential/SequentialLayerRenderer';
import { buildSequentialBitmapPasteEvent } from '@/lib/sequential/sequentialEdit';
import type { Layer, SequentialLayerData } from '@/types';
import type { NormalizedCropRect } from '@/utils/crop/types';

/** Freeze authored frames before changing their coordinate space, preserving pattern phase. */
export const cropSequentialLayerData = ({
  layer,
  sourceWidth,
  sourceHeight,
  rect,
}: {
  layer: Layer;
  sourceWidth: number;
  sourceHeight: number;
  rect: NormalizedCropRect;
}): SequentialLayerData | undefined => {
  if (layer.layerType !== 'sequential' || !layer.sequentialData) {
    return layer.sequentialData;
  }

  const authoredFrames = new Map<number, number>();
  for (const event of layer.sequentialData.events) {
    if (!authoredFrames.has(event.frameIndex)) {
      authoredFrames.set(event.frameIndex, event.timestampMs);
    }
  }

  try {
    const events = Array.from(authoredFrames, ([frameIndex, timestampMs]) => {
      // A warm renderer may return the preceding frame while a worker renders.
      // Clearing its presentation forces this source read to finish synchronously.
      clearSequentialLayerRendererLayer(layer.id);
      const canvas = getSequentialLayerRenderCanvas({
        layer,
        width: sourceWidth,
        height: sourceHeight,
        frameIndex,
        holdPreviousOnEmptyFrames: false,
      });
      const context = canvas?.getContext('2d') as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null
        | undefined;
      if (!context) {
        throw new Error(`Unable to read Sequence frame ${frameIndex} for crop.`);
      }
      const imageData = context.getImageData(rect.x, rect.y, rect.width, rect.height);
      const id = crypto.randomUUID();
      // Keep fully transparent authored frames: omitting one changes held playback.
      return buildSequentialBitmapPasteEvent({
        layerId: layer.id,
        frameIndex,
        imageData,
        bounds: { x: 0, y: 0, width: rect.width, height: rect.height },
        timestampMs,
        id,
        strokeId: id,
      });
    });
    return {
      ...layer.sequentialData,
      events,
      ...(layer.sequentialData.eventChunks ? {
        eventChunks: events.length > 0 ? [{
          id: crypto.randomUUID(),
          startEventIndex: 0,
          eventCount: events.length,
          frameIndexes: [...authoredFrames.keys()].sort((a, b) => a - b),
        }] : [],
      } : {}),
    };
  } finally {
    // A translated crop can retain the old dimensions and event count.
    clearSequentialLayerRendererLayer(layer.id);
  }
};
