import { debugWarn } from '@/utils/debug';
import { applySierraLiteLostEdgeMask } from '@/utils/ditherAlgorithms';
import { resolveLostEdgeTileSize } from '@/utils/ditherConstants';

type RegionBox = { minX: number; minY: number; width: number; height: number };

export const captureRegionU8 = (
  src: Uint8Array,
  fullW: number,
  bbox: RegionBox,
): Uint8Array => {
  const out = new Uint8Array(bbox.width * bbox.height);
  for (let row = 0; row < bbox.height; row += 1) {
    const y = bbox.minY + row;
    const srcOff = y * fullW + bbox.minX;
    out.set(src.subarray(srcOff, srcOff + bbox.width), row * bbox.width);
  }
  return out;
};

export const captureRegionU16 = (
  src: Uint16Array,
  fullW: number,
  bbox: RegionBox,
): Uint16Array => {
  const out = new Uint16Array(bbox.width * bbox.height);
  for (let row = 0; row < bbox.height; row += 1) {
    const y = bbox.minY + row;
    const srcOff = y * fullW + bbox.minX;
    out.set(src.subarray(srcOff, srcOff + bbox.width), row * bbox.width);
  }
  return out;
};

export const applyLostEdgeFromWrittenMask = (options: {
  writtenMask: Uint8Array;
  prevIdx: Uint8Array;
  prevGid: Uint8Array;
  prevSpd: Uint8Array;
  prevFlow: Uint8Array;
  prevPhase: Uint8Array;
  prevDef?: Uint16Array;
  paint: Uint8Array;
  gid: Uint8Array;
  spd: Uint8Array;
  flow: Uint8Array;
  phase: Uint8Array;
  def?: Uint16Array;
  fullW: number;
  bbox: RegionBox;
  lostEdge: number;
  tileSize?: number;
}): void => {
  const {
    writtenMask,
    prevIdx,
    prevGid,
    prevSpd,
    prevFlow,
    prevPhase,
    prevDef,
    paint,
    gid,
    spd,
    flow,
    phase,
    def,
    fullW,
    bbox,
    lostEdge,
    tileSize,
  } = options;
  const lostEdgeTile = typeof tileSize === 'number' && Number.isFinite(tileSize)
    ? resolveLostEdgeTileSize(tileSize)
    : null;
  let keep: Uint8ClampedArray;
  let keepWidth = bbox.width;
  let keepOffsetX = 0;
  let keepOffsetY = 0;
  if (lostEdgeTile) {
    const modX = ((bbox.minX % lostEdgeTile) + lostEdgeTile) % lostEdgeTile;
    const modY = ((bbox.minY % lostEdgeTile) + lostEdgeTile) % lostEdgeTile;
    keepOffsetX = modX + lostEdgeTile;
    keepOffsetY = modY + lostEdgeTile;
    const paddedW = Math.max(
      lostEdgeTile,
      Math.ceil((keepOffsetX + bbox.width + lostEdgeTile) / lostEdgeTile) * lostEdgeTile,
    );
    const paddedH = Math.max(
      lostEdgeTile,
      Math.ceil((keepOffsetY + bbox.height + lostEdgeTile) / lostEdgeTile) * lostEdgeTile,
    );
    const paddedWrittenMask = new Uint8Array(paddedW * paddedH);
    for (let row = 0; row < bbox.height; row += 1) {
      paddedWrittenMask.set(
        writtenMask.subarray(row * bbox.width, row * bbox.width + bbox.width),
        (row + keepOffsetY) * paddedW + keepOffsetX,
      );
    }
    keep = applySierraLiteLostEdgeMask(paddedWrittenMask, paddedW, paddedH, lostEdge, lostEdgeTile);
    keepWidth = paddedW;
  } else {
    keep = applySierraLiteLostEdgeMask(writtenMask, bbox.width, bbox.height, lostEdge);
  }
  for (let row = 0; row < bbox.height; row += 1) {
    const y = bbox.minY + row;
    const dstRow = y * fullW + bbox.minX;
    const localRow = row * bbox.width;
    for (let col = 0; col < bbox.width; col += 1) {
      const p = localRow + col;
      if (writtenMask[p] === 0) continue;
      const keepIndex = (row + keepOffsetY) * keepWidth + col + keepOffsetX;
      if (keep[keepIndex] >= 128) continue;
      const dst = dstRow + col;
      paint[dst] = prevIdx[p];
      gid[dst] = prevGid[p];
      spd[dst] = prevSpd[p];
      flow[dst] = prevFlow[p];
      phase[dst] = prevPhase[p];
      if (def && prevDef) {
        def[dst] = prevDef[p] ?? 0;
      }
    }
  }
  if (process.env.NODE_ENV !== 'production') {
    const violations: Array<{ x: number; y: number }> = [];
    for (let row = 0; row < bbox.height; row += 1) {
      const y = bbox.minY + row;
      const dstRow = y * fullW + bbox.minX;
      const localRow = row * bbox.width;
      for (let col = 0; col < bbox.width; col += 1) {
        const p = localRow + col;
        if (writtenMask[p] !== 0) continue;
        const dst = dstRow + col;
        if (
          paint[dst] !== prevIdx[p] ||
          gid[dst] !== prevGid[p] ||
          spd[dst] !== prevSpd[p] ||
          flow[dst] !== prevFlow[p] ||
          phase[dst] !== prevPhase[p] ||
          (def && prevDef && def[dst] !== (prevDef[p] ?? 0))
        ) {
          violations.push({ x: bbox.minX + col, y });
          paint[dst] = prevIdx[p];
          gid[dst] = prevGid[p];
          spd[dst] = prevSpd[p];
          flow[dst] = prevFlow[p];
          phase[dst] = prevPhase[p];
          if (def && prevDef) {
            def[dst] = prevDef[p] ?? 0;
          }
          if (violations.length >= 5) break;
        }
      }
      if (violations.length >= 5) break;
    }
    if (violations.length > 0) {
      debugWarn('raw-console', '[CC lost-edge] write mask violation; restoring pixels', {
        count: violations.length,
        sample: violations,
      });
    }
  }
};
