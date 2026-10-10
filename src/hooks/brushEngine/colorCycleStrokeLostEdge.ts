import { LOST_EDGE_TILE_DEFAULT } from '@/utils/ditherConstants';

import type { LayerStrokeState } from './colorCycleCanvas2DTypes';
import { applyLostEdgeFromWrittenMask, captureRegionU8, captureRegionU16 } from './colorCycleShapeFillBuffers';
import { visitStrokeStampPixels } from './strokeDefClear';
import type { StampShape } from './colorCycleBrushContracts';

export type ColorCycleStrokeLostEdge = {
  strength: number;
  before: LayerStrokeState['buffers'] | null;
  coverage: Uint8Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/** Capture membership before writing, including writes equal to existing ink. */
export const captureColorCycleStrokeLostEdge = (
  stroke: LayerStrokeState,
  stamp: { width: number; height: number; x: number; y: number; brushSize: number; shape: StampShape; rotation: number },
  strength: number,
  acceptsPixel?: (x: number, y: number) => boolean,
  trackPaintMask = false,
): void => {
  if (stroke.lostEdge === undefined) {
    const lostEdge = Number.isFinite(strength) ? Math.max(0, Math.min(100, strength)) : 0;
    stroke.lostEdge = lostEdge > 0 || trackPaintMask ? {
      strength: lostEdge,
      before: lostEdge > 0 ? {
        paint: stroke.buffers.paint.slice(), gid: stroke.buffers.gid.slice(),
        spd: stroke.buffers.spd.slice(), flow: stroke.buffers.flow.slice(),
        phase: stroke.buffers.phase.slice(), def: stroke.buffers.def.slice(),
      } : null,
      coverage: new Uint8Array(stamp.width * stamp.height),
      minX: stamp.width, minY: stamp.height, maxX: -1, maxY: -1,
    } : null;
  }
  const contour = stroke.lostEdge;
  if (!contour) return;
  visitStrokeStampPixels(stamp, (x, y) => {
    if (acceptsPixel && !acceptsPixel(x, y)) return;
    contour.coverage[y * stamp.width + x] = 255;
    contour.minX = Math.min(contour.minX, x); contour.maxX = Math.max(contour.maxX, x);
    contour.minY = Math.min(contour.minY, y); contour.maxY = Math.max(contour.maxY, y);
  });
};

/** Run after dither finalization and speed binding, before document publication. */
export const finalizeColorCycleStrokeLostEdge = (
  stroke: LayerStrokeState,
  width: number,
  ditherWriteChoices?: Uint8Array,
): {
  minX: number; minY: number; width: number; height: number;
} | undefined => {
  const contour = stroke.lostEdge;
  stroke.lostEdge = null;
  if (!contour) return;
  if (contour.maxX < contour.minX || contour.maxY < contour.minY) {
    // An explicitly empty footprint still replaces pending full-tip preview healing.
    stroke.finalizedPaintMask = {
      data: new Uint8Array(1), width: 1, height: 1,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
    };
    return;
  }
  const bbox = { minX: contour.minX, minY: contour.minY,
    width: contour.maxX - contour.minX + 1, height: contour.maxY - contour.minY + 1 };
  const before = contour.before;
  if (before) applyLostEdgeFromWrittenMask({
    writtenMask: captureRegionU8(contour.coverage, width, bbox),
    prevIdx: captureRegionU8(before.paint, width, bbox),
    prevGid: captureRegionU8(before.gid, width, bbox),
    prevSpd: captureRegionU8(before.spd, width, bbox),
    prevFlow: captureRegionU8(before.flow, width, bbox),
    prevPhase: captureRegionU8(before.phase, width, bbox),
    prevDef: captureRegionU16(before.def, width, bbox),
    ...stroke.buffers,
    fullW: width, bbox, lostEdge: contour.strength, tileSize: LOST_EDGE_TILE_DEFAULT,
    onRejectPixel: (index) => { contour.coverage[index] = 0; },
  });
  const data = captureRegionU8(contour.coverage, width, bbox);
  if (ditherWriteChoices) {
    for (let y = 0; y < bbox.height; y += 1) for (let x = 0; x < bbox.width; x += 1) {
      if (!ditherWriteChoices[(y + bbox.minY) * width + x + bbox.minX]) data[y * bbox.width + x] = 0;
    }
  }
  stroke.finalizedPaintMask = {
    data, width: bbox.width, height: bbox.height,
    bounds: { x: bbox.minX, y: bbox.minY, width: bbox.width, height: bbox.height },
  };
  return bbox;
};
