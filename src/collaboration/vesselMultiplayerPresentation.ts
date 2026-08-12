import type React from 'react';

import type { CompositeSegment } from '@/stores/layers/layersSliceTypes';
import type { Layer } from '@/types';

interface VesselMultiplayerPresentationState {
  layers: Layer[];
  getCompositeSegmentsSnapshot: () => CompositeSegment[];
}

export const presentVesselMultiplayerFrame = ({
  canvas,
  compositeSegmentsRef,
  draw,
  layerMapRef,
  state,
  transform,
  scheduleFrame = requestAnimationFrame,
}: {
  canvas: HTMLCanvasElement | null;
  compositeSegmentsRef: React.MutableRefObject<CompositeSegment[]>;
  draw: (
    context: CanvasRenderingContext2D,
    transform: { scale: number; offsetX: number; offsetY: number },
  ) => void;
  layerMapRef: React.MutableRefObject<Map<string, Layer>>;
  state: VesselMultiplayerPresentationState;
  transform: { scale: number; offsetX: number; offsetY: number };
  scheduleFrame?: (callback: FrameRequestCallback) => number;
}) => {
  compositeSegmentsRef.current = state.getCompositeSegmentsSnapshot();
  layerMapRef.current = new Map(state.layers.map((layer) => [layer.id, layer]));
  const context = canvas?.getContext('2d') ?? null;
  if (context) draw(context, transform);
  return new Promise<void>((resolve) => scheduleFrame(() => resolve()));
};
