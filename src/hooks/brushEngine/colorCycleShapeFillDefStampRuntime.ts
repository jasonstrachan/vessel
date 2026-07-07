import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';

import type { LayerStrokeState } from './colorCycleCanvas2DTypes';
import { ensureLayerStrokeDefBufferSize } from './colorCycleLayerStrokeBuffers';

export function stampColorCycleGradientDefForGpuShapeFillResult(params: {
  strokeData: LayerStrokeState;
  animator: ColorCycleAnimator;
  bbox: {
    minX: number;
    minY: number;
    width: number;
    height: number;
  };
  defId: number | null;
  slot: number;
  canvasWidth: number;
  canvasHeight: number;
  flowSlotMask: number;
}): void {
  if (params.defId === null) {
    return;
  }

  const expected = params.canvasWidth * params.canvasHeight;
  ensureLayerStrokeDefBufferSize(params.strokeData, expected);
  const buffers = params.animator.getIndexBuffers();
  const paint = buffers.data ?? params.strokeData.buffers.paint;
  const gidBuffer = buffers.gid ?? params.strokeData.buffers.gid;
  const defBuffer = params.strokeData.buffers.def;
  const minX = Math.max(0, Math.floor(params.bbox.minX));
  const minY = Math.max(0, Math.floor(params.bbox.minY));
  const maxX = Math.min(
    params.canvasWidth - 1,
    Math.floor(params.bbox.minX + params.bbox.width - 1),
  );
  const maxY = Math.min(
    params.canvasHeight - 1,
    Math.floor(params.bbox.minY + params.bbox.height - 1),
  );
  const slotMasked = params.slot & params.flowSlotMask;

  for (let y = minY; y <= maxY; y += 1) {
    const row = y * params.canvasWidth;
    for (let x = minX; x <= maxX; x += 1) {
      const idx = row + x;
      if (paint[idx] === 0) {
        defBuffer[idx] = 0;
        continue;
      }
      if ((gidBuffer[idx] & params.flowSlotMask) === slotMasked) {
        defBuffer[idx] = params.defId;
      }
    }
  }

  params.animator.setDefIdData(defBuffer, { forceDirty: true });
}
