import { visitStrokeStampPixels } from '../strokeDefClear';
import { recordIndexedAuthoringPixel, recordIndexedAuthoringRange } from '@/utils/indexedAuthoringObserver';
import {
  ensureStampDitherBuffers,
  ensureStampDitherTag,
  updateStampDitherBounds,
  type StampDitherShape,
  type StampDitherStrokeData,
} from './state';

const DIAMOND_5_MASK: ReadonlyArray<number> = [
  0, 0, 1, 0, 0,
  0, 1, 1, 1, 0,
  1, 1, 1, 1, 1,
  0, 1, 1, 1, 0,
  0, 0, 1, 0, 0,
];
const DIAMOND_7_MASK: ReadonlyArray<number> = [
  0, 0, 0, 1, 0, 0, 0,
  0, 0, 1, 1, 1, 0, 0,
  0, 1, 1, 1, 1, 1, 0,
  1, 1, 1, 1, 1, 1, 1,
  0, 1, 1, 1, 1, 1, 0,
  0, 0, 1, 1, 1, 0, 0,
  0, 0, 0, 1, 0, 0, 0,
];
const DIAMOND_9_MASK: ReadonlyArray<number> = [
  0, 0, 0, 0, 1, 0, 0, 0, 0,
  0, 0, 0, 1, 1, 1, 0, 0, 0,
  0, 0, 1, 1, 1, 1, 1, 0, 0,
  0, 1, 1, 1, 1, 1, 1, 1, 0,
  1, 1, 1, 1, 1, 1, 1, 1, 1,
  0, 1, 1, 1, 1, 1, 1, 1, 0,
  0, 0, 1, 1, 1, 1, 1, 0, 0,
  0, 0, 0, 1, 1, 1, 0, 0, 0,
  0, 0, 0, 0, 1, 0, 0, 0, 0,
];
const CHECKERED_4_MASK: ReadonlyArray<number> = [
  1, 0, 1, 0,
  0, 1, 0, 1,
  1, 0, 1, 0,
  0, 1, 0, 1,
];

export type StampDitherBgFillWriter = {
  inkOffset?: number;
  data: Uint8Array;
  gradientId: Uint8Array;
  speedData: Uint8Array;
  phaseData?: Uint8Array;
  flowData?: Uint8Array;
  phaseIntent?: Uint8Array;
  flowBits: number;
  defData?: Uint16Array;
  tile: Uint8Array;
  tileClamp: number;
  maskOriginX: number;
  maskOriginY: number;
  flowSlot: number;
  speedByte: number;
  coverageByte: number;
  usePattern: boolean;
};

export const resolveStampDitherSecondaryIndex = (primaryIndex: number, inkOffset = 64): number => {
  const offset = Number.isFinite(inkOffset) ? Math.max(1, Math.min(127, Math.round(inkOffset))) : 64;
  if (!Number.isFinite(primaryIndex)) {
    return 1;
  }
  let next = Math.round(primaryIndex + offset);
  while (next > 255) {
    next -= 255;
  }
  if (next === primaryIndex) {
    next = primaryIndex > 1 ? primaryIndex - 1 : Math.min(255, primaryIndex + 1);
  }
  return Math.max(1, Math.min(255, next));
};

const writeStampDitherBgFillSpan = (
  writer: StampDitherBgFillWriter,
  primary: Uint8Array,
  tag: Uint32Array,
  tagValue: number,
  rowOffset: number,
  startX: number,
  endX: number,
  y: number,
  primaryIndex: number,
  acceptsPixel?: (x: number, y: number) => boolean,
) => {
  if (acceptsPixel) {
    let runStart = startX;
    while (runStart <= endX) {
      while (runStart <= endX && !acceptsPixel(runStart, y)) runStart += 1;
      let runEnd = runStart;
      while (runEnd <= endX && acceptsPixel(runEnd, y)) runEnd += 1;
      if (runEnd > runStart) {
        writeStampDitherBgFillSpan(writer, primary, tag, tagValue, rowOffset, runStart, runEnd - 1, y, primaryIndex);
      }
      runStart = runEnd + 1;
    }
    return;
  }
  const start = rowOffset + startX;
  const end = rowOffset + endX + 1;
  primary.fill(primaryIndex, start, end);
  tag.fill(tagValue, start, end);

  if (primaryIndex === 0) {
    recordIndexedAuthoringRange(writer.data, start, end);
    writer.data.fill(0, start, end);
    writer.gradientId.fill(0, start, end);
    writer.speedData.fill(0, start, end);
    writer.phaseData?.fill(0, start, end);
    writer.flowData?.fill(0, start, end);
    if (writer.defData) {
      writer.defData.fill(0, start, end);
    }
    return;
  }

  writer.gradientId.fill(writer.flowSlot, start, end);
  writer.speedData.fill(writer.speedByte, start, end);
  if (writer.defData) {
    writer.defData.fill(0, start, end);
  }

  const secondaryIndex = resolveStampDitherSecondaryIndex(primaryIndex, writer.inkOffset);
  const writerTileRow = (((y - writer.maskOriginY) % writer.tileClamp + writer.tileClamp) % writer.tileClamp) * writer.tileClamp;
  let writerLocalX = ((startX - writer.maskOriginX) % writer.tileClamp + writer.tileClamp) % writer.tileClamp;
  for (let idx = start; idx < end; idx += 1) {
    const t = writer.tile[writerTileRow + writerLocalX] ?? 0;
    const usePrimary = writer.usePattern ? t === 1 : t <= writer.coverageByte;
    recordIndexedAuthoringPixel(writer.data, idx);
    writer.data[idx] = usePrimary ? primaryIndex : secondaryIndex;
    if (writer.phaseData) writer.phaseData[idx] = writer.phaseIntent?.[idx] ?? 0;
    if (writer.flowData) writer.flowData[idx] = writer.flowBits;
    writerLocalX += 1;
    if (writerLocalX === writer.tileClamp) writerLocalX = 0;
  }
};

export const applyStampDitherMask = (
  strokeData: StampDitherStrokeData,
  width: number,
  height: number,
  shape: StampDitherShape,
  x: number,
  y: number,
  brushSize: number,
  primaryIndex: number,
  stampSeq: number,
  bgFill: boolean,
  bgFillWriter?: StampDitherBgFillWriter,
  acceptsPixel?: (x: number, y: number) => boolean,
  rotation = 0,
): { minX: number; minY: number; maxX: number; maxY: number } => {
  ensureStampDitherBuffers(strokeData, width, height);
  ensureStampDitherTag(strokeData, width, height);
  const primary = strokeData.stampDitherPrimaryBuffer!;
  const tag = strokeData.stampDitherTag!;
  const captureBase = !bgFill && !!strokeData.stampDitherBaseTag;
  const baseTag = strokeData.stampDitherBaseTag;
  const baseIdx = strokeData.stampDitherBaseIdx;
  const baseGid = strokeData.stampDitherBaseGid;
  const baseDef = strokeData.stampDitherBaseDef;
  const paint = strokeData.paint;
  const gid = strokeData.gradientIdBuffer;
  const def = strokeData.gradientDefIdBuffer;
  const strokeEpoch = strokeData.stampDitherStrokeEpoch ?? 1;
  const captureIfNeeded = (idx: number) => {
    if (!captureBase || !baseTag || !baseIdx) return;
    if (baseTag[idx] === strokeEpoch) return;
    baseTag[idx] = strokeEpoch;
    baseIdx[idx] = paint[idx];
    if (baseGid && gid) {
      baseGid[idx] = gid[idx];
    }
    if (baseDef && def) {
      baseDef[idx] = def[idx];
    }
    if (strokeData.stampDitherBaseSpeed) strokeData.stampDitherBaseSpeed[idx] = strokeData.speedBuffer?.[idx] ?? 0;
    if (strokeData.stampDitherBaseFlow) strokeData.stampDitherBaseFlow[idx] = strokeData.flowBuffer?.[idx] ?? 0;
    if (strokeData.stampDitherBasePhase) strokeData.stampDitherBasePhase[idx] = strokeData.phaseBuffer?.[idx] ?? 0;
  };

  const tagValue = ((strokeEpoch & 0xffff) << 16) | (stampSeq & 0xffff);
  const writer = bgFillWriter;

  if (shape !== 'round' && Number.isFinite(rotation) && Math.abs(rotation) > 1e-8) {
    const bounds = { minX: width, minY: height, maxX: -1, maxY: -1 };
    visitStrokeStampPixels({ width, height, x, y, brushSize, shape, rotation }, (px, py) => {
      if (acceptsPixel && !acceptsPixel(px, py)) return;
      const idx = py * width + px;
      captureIfNeeded(idx);
      if (writer) {
        writeStampDitherBgFillSpan(writer, primary, tag, tagValue, py * width, px, px, py, primaryIndex);
      } else {
        primary[idx] = primaryIndex;
        tag[idx] = tagValue;
      }
      bounds.minX = Math.min(bounds.minX, px);
      bounds.minY = Math.min(bounds.minY, py);
      bounds.maxX = Math.max(bounds.maxX, px);
      bounds.maxY = Math.max(bounds.maxY, py);
    });
    if (bounds.maxX >= bounds.minX && bounds.maxY >= bounds.minY) {
      updateStampDitherBounds(strokeData, width, height, bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
    }
    return bounds;
  }

  if (shape === 'triangle') {
    const halfSize = brushSize / 2;
    const topX = x;
    const topY = y - halfSize;
    const leftX = x - halfSize;
    const leftY = y + halfSize;
    const rightX = x + halfSize;
    const rightY = y + halfSize;
    const minX = Math.max(0, Math.floor(Math.min(leftX, rightX, topX)));
    const maxX = Math.min(width - 1, Math.floor(Math.max(leftX, rightX, topX)));
    const minY = Math.max(0, Math.floor(Math.min(topY, leftY, rightY)));
    const maxY = Math.min(height - 1, Math.floor(Math.max(topY, leftY, rightY)));
    const sign = (px: number, py: number, ax: number, ay: number, bx: number, by: number) =>
      (px - bx) * (ay - by) - (ax - bx) * (py - by);

    for (let py = minY; py <= maxY; py++) {
      const writerTileRow = writer
        ? (((py - writer.maskOriginY) % writer.tileClamp + writer.tileClamp) % writer.tileClamp) * writer.tileClamp
        : 0;
      let writerLocalX = writer
        ? ((minX - writer.maskOriginX) % writer.tileClamp + writer.tileClamp) % writer.tileClamp
        : 0;
      for (let px = minX; px <= maxX; px++) {
        if (acceptsPixel && !acceptsPixel(px, py)) {
          if (writer) {
            writerLocalX = (writerLocalX + 1) % writer.tileClamp;
          }
          continue;
        }
        const sampleX = px + 0.5;
        const sampleY = py + 0.5;
        const b1 = sign(sampleX, sampleY, topX, topY, leftX, leftY) <= 0;
        const b2 = sign(sampleX, sampleY, leftX, leftY, rightX, rightY) <= 0;
        const b3 = sign(sampleX, sampleY, rightX, rightY, topX, topY) <= 0;
        if ((b1 === b2) && (b2 === b3)) {
          const idx = py * width + px;
          if (captureBase) captureIfNeeded(idx);
          primary[idx] = primaryIndex;
          tag[idx] = tagValue;
          if (writer) {
            const t = writer.tile[writerTileRow + writerLocalX] ?? 0;
            const usePrimary = writer.usePattern ? t === 1 : t <= writer.coverageByte;
            const nextIndex = usePrimary ? primaryIndex : resolveStampDitherSecondaryIndex(primaryIndex);
            recordIndexedAuthoringPixel(writer.data, idx);
            writer.data[idx] = nextIndex;
            writer.gradientId[idx] = nextIndex === 0 ? 0 : writer.flowSlot;
            writer.speedData[idx] = nextIndex === 0 ? 0 : writer.speedByte;
            if (writer.phaseData) writer.phaseData[idx] = nextIndex === 0 ? 0 : writer.phaseIntent?.[idx] ?? 0;
            if (writer.flowData) writer.flowData[idx] = nextIndex === 0 ? 0 : writer.flowBits;
            if (writer.defData) {
              writer.defData[idx] = 0;
            }
          }
        }
        if (writer) {
          writerLocalX += 1;
          if (writerLocalX === writer.tileClamp) writerLocalX = 0;
        }
      }
    }
    updateStampDitherBounds(strokeData, width, height, minX, minY, maxX, maxY);
    return { minX, minY, maxX, maxY };
  }

  if (shape === 'round') {
    const radius = brushSize / 2;
    const radiusSq = radius * radius;
    const minX = Math.max(0, Math.floor(x - radius));
    const maxX = Math.min(width - 1, Math.ceil(x + radius));
    const minY = Math.max(0, Math.floor(y - radius));
    const maxY = Math.min(height - 1, Math.ceil(y + radius));
    if (writer) {
      for (let py = minY; py <= maxY; py++) {
        const dy = py + 0.5 - y;
        const dxLimitSq = radiusSq - dy * dy;
        if (dxLimitSq < 0) continue;
        const dxLimit = Math.sqrt(dxLimitSq);
        const spanMinX = Math.max(minX, Math.ceil(x - dxLimit - 0.5));
        const spanMaxX = Math.min(maxX, Math.floor(x + dxLimit - 0.5));
        if (spanMaxX < spanMinX) continue;
        writeStampDitherBgFillSpan(
          writer,
          primary,
          tag,
          tagValue,
          py * width,
          spanMinX,
          spanMaxX,
          py,
          primaryIndex,
          acceptsPixel,
        );
      }
      updateStampDitherBounds(strokeData, width, height, minX, minY, maxX, maxY);
      return { minX, minY, maxX, maxY };
    }
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        if (acceptsPixel && !acceptsPixel(px, py)) {
          continue;
        }
        const dx = px + 0.5 - x;
        const dy = py + 0.5 - y;
        if (dx * dx + dy * dy > radiusSq) continue;
        const idx = py * width + px;
        if (captureBase) captureIfNeeded(idx);
        primary[idx] = primaryIndex;
        tag[idx] = tagValue;
      }
    }
    updateStampDitherBounds(strokeData, width, height, minX, minY, maxX, maxY);
    return { minX, minY, maxX, maxY };
  }

  if (shape === 'diamond') {
    const radius = brushSize / 2;
    const minX = Math.max(0, Math.floor(x - radius));
    const maxX = Math.min(width - 1, Math.floor(x + radius));
    const minY = Math.max(0, Math.floor(y - radius));
    const maxY = Math.min(height - 1, Math.floor(y + radius));
    if (writer) {
      for (let py = minY; py <= maxY; py++) {
        const dy = Math.abs(py + 0.5 - y);
        const dxLimit = radius - dy;
        if (dxLimit < 0) continue;
        const spanMinX = Math.max(minX, Math.ceil(x - dxLimit - 0.5));
        const spanMaxX = Math.min(maxX, Math.floor(x + dxLimit - 0.5));
        if (spanMaxX < spanMinX) continue;
        writeStampDitherBgFillSpan(
          writer,
          primary,
          tag,
          tagValue,
          py * width,
          spanMinX,
          spanMaxX,
          py,
          primaryIndex,
          acceptsPixel,
        );
      }
      updateStampDitherBounds(strokeData, width, height, minX, minY, maxX, maxY);
      return { minX, minY, maxX, maxY };
    }
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        if (acceptsPixel && !acceptsPixel(px, py)) {
          continue;
        }
        const dx = Math.abs(px + 0.5 - x);
        const dy = Math.abs(py + 0.5 - y);
        if (dx + dy > radius) continue;
        const idx = py * width + px;
        if (captureBase) captureIfNeeded(idx);
        primary[idx] = primaryIndex;
        tag[idx] = tagValue;
      }
    }
    updateStampDitherBounds(strokeData, width, height, minX, minY, maxX, maxY);
    return { minX, minY, maxX, maxY };
  }

  if (shape === 'diamond5') {
    const pixelScale = Math.max(1, Math.round(brushSize / 5));
    const stampSize = 5 * pixelScale;
    const originX = Math.floor(x - stampSize / 2);
    const originY = Math.floor(y - stampSize / 2);
    const minX = Math.max(0, originX);
    const maxX = Math.min(width - 1, originX + stampSize - 1);
    const minY = Math.max(0, originY);
    const maxY = Math.min(height - 1, originY + stampSize - 1);
    for (let py = minY; py <= maxY; py++) {
      const localY = py - originY;
      const cellY = Math.max(0, Math.min(4, Math.floor(localY / pixelScale)));
      const writerTileRow = writer
        ? (((py - writer.maskOriginY) % writer.tileClamp + writer.tileClamp) % writer.tileClamp) * writer.tileClamp
        : 0;
      let writerLocalX = writer
        ? ((minX - writer.maskOriginX) % writer.tileClamp + writer.tileClamp) % writer.tileClamp
        : 0;
      for (let px = minX; px <= maxX; px++) {
        if (acceptsPixel && !acceptsPixel(px, py)) {
          if (writer) {
            writerLocalX = (writerLocalX + 1) % writer.tileClamp;
          }
          continue;
        }
        const localX = px - originX;
        const cellX = Math.max(0, Math.min(4, Math.floor(localX / pixelScale)));
        if (DIAMOND_5_MASK[cellY * 5 + cellX] === 0) {
          if (writer) {
            writerLocalX += 1;
            if (writerLocalX === writer.tileClamp) writerLocalX = 0;
          }
          continue;
        }
        const idx = py * width + px;
        if (captureBase) captureIfNeeded(idx);
        primary[idx] = primaryIndex;
        tag[idx] = tagValue;
        if (writer) {
          const t = writer.tile[writerTileRow + writerLocalX] ?? 0;
          const usePrimary = writer.usePattern ? t === 1 : t <= writer.coverageByte;
          const nextIndex = usePrimary ? primaryIndex : resolveStampDitherSecondaryIndex(primaryIndex);
          recordIndexedAuthoringPixel(writer.data, idx);
          writer.data[idx] = nextIndex;
          writer.gradientId[idx] = nextIndex === 0 ? 0 : writer.flowSlot;
          writer.speedData[idx] = nextIndex === 0 ? 0 : writer.speedByte;
          if (writer.phaseData) writer.phaseData[idx] = nextIndex === 0 ? 0 : writer.phaseIntent?.[idx] ?? 0;
          if (writer.flowData) writer.flowData[idx] = nextIndex === 0 ? 0 : writer.flowBits;
          if (writer.defData) {
            writer.defData[idx] = 0;
          }
          writerLocalX += 1;
          if (writerLocalX === writer.tileClamp) writerLocalX = 0;
        }
      }
    }
    updateStampDitherBounds(strokeData, width, height, minX, minY, maxX, maxY);
    return { minX, minY, maxX, maxY };
  }

  if (shape === 'diamond7' || shape === 'diamond9') {
    const gridSize = shape === 'diamond7' ? 7 : 9;
    const mask = shape === 'diamond7' ? DIAMOND_7_MASK : DIAMOND_9_MASK;
    const pixelScale = Math.max(1, Math.round(brushSize / gridSize));
    const stampSize = gridSize * pixelScale;
    const originX = Math.floor(x - stampSize / 2);
    const originY = Math.floor(y - stampSize / 2);
    const minX = Math.max(0, originX);
    const maxX = Math.min(width - 1, originX + stampSize - 1);
    const minY = Math.max(0, originY);
    const maxY = Math.min(height - 1, originY + stampSize - 1);
    for (let py = minY; py <= maxY; py++) {
      const localY = py - originY;
      const cellY = Math.max(0, Math.min(gridSize - 1, Math.floor(localY / pixelScale)));
      const writerTileRow = writer
        ? (((py - writer.maskOriginY) % writer.tileClamp + writer.tileClamp) % writer.tileClamp) * writer.tileClamp
        : 0;
      let writerLocalX = writer
        ? ((minX - writer.maskOriginX) % writer.tileClamp + writer.tileClamp) % writer.tileClamp
        : 0;
      for (let px = minX; px <= maxX; px++) {
        if (acceptsPixel && !acceptsPixel(px, py)) {
          if (writer) {
            writerLocalX = (writerLocalX + 1) % writer.tileClamp;
          }
          continue;
        }
        const localX = px - originX;
        const cellX = Math.max(0, Math.min(gridSize - 1, Math.floor(localX / pixelScale)));
        if (mask[cellY * gridSize + cellX] === 0) {
          if (writer) {
            writerLocalX += 1;
            if (writerLocalX === writer.tileClamp) writerLocalX = 0;
          }
          continue;
        }
        const idx = py * width + px;
        if (captureBase) captureIfNeeded(idx);
        primary[idx] = primaryIndex;
        tag[idx] = tagValue;
        if (writer) {
          const t = writer.tile[writerTileRow + writerLocalX] ?? 0;
          const usePrimary = writer.usePattern ? t === 1 : t <= writer.coverageByte;
          const nextIndex = usePrimary ? primaryIndex : resolveStampDitherSecondaryIndex(primaryIndex);
          recordIndexedAuthoringPixel(writer.data, idx);
          writer.data[idx] = nextIndex;
          writer.gradientId[idx] = nextIndex === 0 ? 0 : writer.flowSlot;
          writer.speedData[idx] = nextIndex === 0 ? 0 : writer.speedByte;
          if (writer.phaseData) writer.phaseData[idx] = nextIndex === 0 ? 0 : writer.phaseIntent?.[idx] ?? 0;
          if (writer.flowData) writer.flowData[idx] = nextIndex === 0 ? 0 : writer.flowBits;
          if (writer.defData) {
            writer.defData[idx] = 0;
          }
          writerLocalX += 1;
          if (writerLocalX === writer.tileClamp) writerLocalX = 0;
        }
      }
    }
    updateStampDitherBounds(strokeData, width, height, minX, minY, maxX, maxY);
    return { minX, minY, maxX, maxY };
  }

  if (shape === 'checkered') {
    const gridSize = 4;
    const pixelScale = Math.max(1, Math.round(brushSize / gridSize));
    const stampSize = gridSize * pixelScale;
    const originX = Math.floor(x - stampSize / 2);
    const originY = Math.floor(y - stampSize / 2);
    const minX = Math.max(0, originX);
    const maxX = Math.min(width - 1, originX + stampSize - 1);
    const minY = Math.max(0, originY);
    const maxY = Math.min(height - 1, originY + stampSize - 1);
    for (let py = minY; py <= maxY; py++) {
      const localY = py - originY;
      const cellY = Math.max(0, Math.min(gridSize - 1, Math.floor(localY / pixelScale)));
      const writerTileRow = writer
        ? (((py - writer.maskOriginY) % writer.tileClamp + writer.tileClamp) % writer.tileClamp) * writer.tileClamp
        : 0;
      let writerLocalX = writer
        ? ((minX - writer.maskOriginX) % writer.tileClamp + writer.tileClamp) % writer.tileClamp
        : 0;
      for (let px = minX; px <= maxX; px++) {
        if (acceptsPixel && !acceptsPixel(px, py)) {
          if (writer) {
            writerLocalX = (writerLocalX + 1) % writer.tileClamp;
          }
          continue;
        }
        const localX = px - originX;
        const cellX = Math.max(0, Math.min(gridSize - 1, Math.floor(localX / pixelScale)));
        if (CHECKERED_4_MASK[cellY * gridSize + cellX] === 0) {
          if (writer) {
            writerLocalX += 1;
            if (writerLocalX === writer.tileClamp) writerLocalX = 0;
          }
          continue;
        }
        const idx = py * width + px;
        if (captureBase) captureIfNeeded(idx);
        primary[idx] = primaryIndex;
        tag[idx] = tagValue;
        if (writer) {
          const t = writer.tile[writerTileRow + writerLocalX] ?? 0;
          const usePrimary = writer.usePattern ? t === 1 : t <= writer.coverageByte;
          const nextIndex = usePrimary ? primaryIndex : resolveStampDitherSecondaryIndex(primaryIndex);
          recordIndexedAuthoringPixel(writer.data, idx);
          writer.data[idx] = nextIndex;
          writer.gradientId[idx] = nextIndex === 0 ? 0 : writer.flowSlot;
          writer.speedData[idx] = nextIndex === 0 ? 0 : writer.speedByte;
          if (writer.phaseData) writer.phaseData[idx] = nextIndex === 0 ? 0 : writer.phaseIntent?.[idx] ?? 0;
          if (writer.flowData) writer.flowData[idx] = nextIndex === 0 ? 0 : writer.flowBits;
          if (writer.defData) {
            writer.defData[idx] = 0;
          }
          writerLocalX += 1;
          if (writerLocalX === writer.tileClamp) writerLocalX = 0;
        }
      }
    }
    updateStampDitherBounds(strokeData, width, height, minX, minY, maxX, maxY);
    return { minX, minY, maxX, maxY };
  }

  const halfSize = brushSize / 2;
  const minX = Math.max(0, Math.ceil(x - halfSize));
  const maxX = Math.min(width - 1, Math.ceil(x + halfSize) - 1);
  const minY = Math.max(0, Math.ceil(y - halfSize));
  const maxY = Math.min(height - 1, Math.ceil(y + halfSize) - 1);
  if (writer) {
    for (let py = minY; py <= maxY; py++) {
      writeStampDitherBgFillSpan(
        writer,
        primary,
        tag,
        tagValue,
        py * width,
        minX,
        maxX,
        py,
        primaryIndex,
        acceptsPixel,
      );
    }
    updateStampDitherBounds(strokeData, width, height, minX, minY, maxX, maxY);
    return { minX, minY, maxX, maxY };
  }
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      if (acceptsPixel && !acceptsPixel(px, py)) continue;
      const idx = py * width + px;
      if (captureBase) captureIfNeeded(idx);
      primary[idx] = primaryIndex;
      tag[idx] = tagValue;
    }
  }
  updateStampDitherBounds(strokeData, width, height, minX, minY, maxX, maxY);
  return { minX, minY, maxX, maxY };
};
