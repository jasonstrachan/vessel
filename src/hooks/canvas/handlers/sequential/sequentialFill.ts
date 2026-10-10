import { cloneSequentialLayerData } from '@/history/deltas/sequentialFrameDelta';
import type { EventHandlerDependencies, EventHandlerDynamicDeps } from '@/hooks/canvas/utils/types';
import { getSequentialLayerRenderCanvas } from '@/lib/sequential/SequentialLayerRenderer';
import { appendSequentialEvent } from '@/lib/sequential/sequentialEdit';
import { getSequentialLayerRenderFrame } from '@/runtime/playback/sequentialFrameCursor';
import { getAppStoreState } from '@/stores/appStoreAccess';
import { fillRasterWithinSelection, resolveSelectionRasterScope } from '@/stores/helpers/selectionRoi';
import { BrushShape, type Layer, type Project, type Rectangle, type SequentialLayerData, type SequentialStrokeEvent } from '@/types';
import { parseCssColor } from '@/utils/color/parseCssColor';
import { encodeRgbaToBase64 } from '@/utils/colorCycle/ccCustomTilePattern';
import { floodFill } from '@/utils/floodFill';

let nextFillId = 0;

export const fillSequentialLayer = ({
  layer,
  project,
  dynamic,
  point,
  updateLayer,
}: {
  layer: Layer;
  project: Project;
  dynamic: EventHandlerDynamicDeps;
  point: { x: number; y: number };
  updateLayer: EventHandlerDependencies['updateLayer'];
}): { bounds: Rectangle; beforeSequentialData: SequentialLayerData; afterSequentialData: SequentialLayerData } | null => {
  if (!layer.sequentialData) return null;
  const state = getAppStoreState();
  const frameIndex = getSequentialLayerRenderFrame(state, layer);
  const canvas = getSequentialLayerRenderCanvas({
    layer,
    width: project.width,
    height: project.height,
    frameIndex,
    // Empty-frame hold is a presentation policy, not authored content in this frame.
    holdPreviousOnEmptyFrames: false,
  });
  const ctx = canvas?.getContext('2d', { willReadFrequently: true });
  if (!ctx || !('getImageData' in ctx)) return null;
  const before = ctx.getImageData(0, 0, project.width, project.height);
  const working = new ImageData(before.data.slice(), before.width, before.height);
  const shouldErase = dynamic.tools.fillSettings.eraseInstead;
  const { r, g, b } = parseCssColor(
    dynamic.palette.activeSlot === 'background'
      ? dynamic.palette.backgroundColor
      : dynamic.palette.foregroundColor,
  );
  const color = shouldErase ? { r: 0, g: 0, b: 0, a: 0 } : { r, g, b, a: 255 };
  const scope = resolveSelectionRasterScope(dynamic, before.width, before.height);
  const bounds = scope.bounds
    ? fillRasterWithinSelection(working, scope.bounds, color, scope.selectionMask, scope.selectionMaskBounds)
    : floodFill(working, Math.floor(point.x), Math.floor(point.y), color, {
        threshold: dynamic.tools.fillSettings.threshold,
        contiguous: dynamic.tools.fillSettings.contiguous,
      }).bounds;
  if (!bounds) return null;

  const payload = new ImageData(bounds.width, bounds.height);
  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      const sourceIndex = ((bounds.y + y) * before.width + bounds.x + x) * 4;
      if (before.data[sourceIndex] === working.data[sourceIndex]
        && before.data[sourceIndex + 1] === working.data[sourceIndex + 1]
        && before.data[sourceIndex + 2] === working.data[sourceIndex + 2]
        && before.data[sourceIndex + 3] === working.data[sourceIndex + 3]) continue;
      const targetIndex = (y * bounds.width + x) * 4;
      payload.data[targetIndex] = shouldErase ? 255 : r;
      payload.data[targetIndex + 1] = shouldErase ? 255 : g;
      payload.data[targetIndex + 2] = shouldErase ? 255 : b;
      payload.data[targetIndex + 3] = 255;
    }
  }
  const timestampMs = Date.now();
  const strokeId = `seq-fill-${timestampMs}-${nextFillId++}`;
  const size = Math.max(bounds.width, bounds.height);
  const event: SequentialStrokeEvent = {
    id: `${strokeId}-0`, layerId: layer.id, strokeId, timestampMs, frameIndex,
    brush: {
      tool: shouldErase ? 'eraser-fill' : 'fill',
      brushShape: BrushShape.SQUARE,
      size,
      opacity: 1,
      blendMode: shouldErase ? 'destination-out' : 'source-over',
      rotation: 0,
      spacing: 1,
      color: '#ffffff',
      customStamp: {
        width: bounds.width,
        height: bounds.height,
        rgbaBase64: encodeRgbaToBase64(payload.data),
        isColorizable: false,
      },
    },
    stamps: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, pressure: 1, rotation: 0, size, alpha: 1 }],
  };
  const beforeSequentialData = cloneSequentialLayerData(layer.sequentialData);
  const afterSequentialData = appendSequentialEvent(beforeSequentialData, event);
  updateLayer(layer.id, { sequentialData: afterSequentialData }, { skipColorCycleSync: true, dirtyRects: [bounds] });
  state.setCurrentCompositeBitmap(null);
  return { bounds, beforeSequentialData, afterSequentialData };
};
