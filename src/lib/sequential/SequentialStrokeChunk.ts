import type { SequentialBrushSnapshot, SequentialStampPoint, SequentialStrokeEvent } from '@/types';

const Q8_8_SCALE = 256;
const ROTATION_SCALE = 1024;

type TypedArrayCtor<T extends ArrayBufferView> = {
  new (buffer: ArrayBuffer): T;
  readonly BYTES_PER_ELEMENT: number;
};

export interface SequentialStrokeChunkHeaderV1 {
  encodingVersion: 1;
  layerId: string;
  strokeSessionId: string;
  brushSnapshotId: string;
  coordSpace: 'project-px';
  quantization: 'q8.8';
  fpsAtCapture: number;
  frameCountAtCapture: number;
  startFrameIndex: number;
}

export interface SerializedSequentialStrokeChunkV1 {
  header: SequentialStrokeChunkHeaderV1;
  body: {
    anchorXQ8_8: number;
    anchorYQ8_8: number;
    dXQ8_8: string;
    dYQ8_8: string;
    dFrame: string;
    pressureU8: string;
    rotationI16: string;
    sizeU16: string;
    alphaU8: string;
    eventIds: string[];
    eventStampCounts: string;
    eventTimestampMs: string;
    eventFrameOffsets: string;
  };
}

export interface SequentialChunkEncodeResult {
  chunks: SerializedSequentialStrokeChunkV1[];
  brushSnapshots: Record<string, SequentialBrushSnapshot>;
}

const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
};

const clampInt16 = (value: number): number => Math.round(clamp(value, -32768, 32767));
const clampUint16 = (value: number): number => Math.round(clamp(value, 0, 65535));
const clampUint32 = (value: number): number => Math.round(clamp(value, 0, 0xffffffff));
const clampByte = (value: number): number => Math.round(clamp(value, 0, 255));
const toQ8_8 = (value: number): number => Math.round(toFiniteNumber(value, 0) * Q8_8_SCALE);
const fromQ8_8 = (value: number): number => value / Q8_8_SCALE;

const toFiniteNumber = (value: unknown, fallback: number): number => {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  if (bytes.byteLength === 0) {
    return '';
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  if (typeof btoa === 'function') {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }
  throw new Error('No base64 encoder available');
};

const base64ToBytes = (base64: string): Uint8Array => {
  if (!base64) {
    return new Uint8Array(0);
  }
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  throw new Error('No base64 decoder available');
};

const encodeTypedArray = (view: ArrayBufferView): string => {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  return bytesToBase64(bytes);
};

const decodeTypedArray = <T extends ArrayBufferView>(base64: string, ctor: TypedArrayCtor<T>): T => {
  const bytes = base64ToBytes(base64);
  if (bytes.byteLength % ctor.BYTES_PER_ELEMENT !== 0) {
    throw new Error('Invalid typed-array byte length in sequential chunk');
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new ctor(copy.buffer);
};

const brushSnapshotKey = (brush: SequentialBrushSnapshot): string => {
  return [
    brush.tool,
    brush.brushShape,
    toFiniteNumber(brush.size, 0),
    toFiniteNumber(brush.opacity, 0),
    brush.blendMode,
    toFiniteNumber(brush.rotation, 0),
    toFiniteNumber(brush.spacing, 0),
    brush.color,
    brush.customStampId ?? '',
    brush.customStampHash ?? '',
    brush.customStamp?.width ?? 0,
    brush.customStamp?.height ?? 0,
    brush.customStamp?.rgbaBase64 ?? '',
    brush.customStamp?.isColorizable ? '1' : '0',
    brush.ditherEnabled ? '1' : '0',
    brush.ditherAlgorithm ?? '',
    brush.ditherStrokeTipShape ?? '',
    brush.mosaicTilePx ?? '',
    brush.mosaicSegmentPx ?? '',
    brush.mosaicBlocksCount ?? '',
    brush.mosaicPaletteCount ?? '',
    brush.mosaicDitherEnabled ? '1' : '0',
    brush.mosaicSegmentJitter ?? '',
    brush.mosaicSeed ?? '',
    brush.colorCycleGradient
      ? brush.colorCycleGradient
          .map((stop) => `${stop.position}:${stop.color}`)
          .join(',')
      : '',
  ].join('|');
};

const hashString = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return `brush-${hash.toString(16).padStart(8, '0')}`;
};

const cloneBrushSnapshot = (brush: SequentialBrushSnapshot): SequentialBrushSnapshot => ({
  ...brush,
  customStampId: brush.customStampId ?? null,
  customStampHash: brush.customStampHash ?? null,
  customStamp: brush.customStamp
    ? {
        width: brush.customStamp.width,
        height: brush.customStamp.height,
        rgbaBase64: brush.customStamp.rgbaBase64,
        isColorizable: brush.customStamp.isColorizable,
      }
    : null,
  mosaicTilePx: brush.mosaicTilePx,
  mosaicSegmentPx: brush.mosaicSegmentPx,
  mosaicBlocksCount: brush.mosaicBlocksCount,
  mosaicPaletteCount: brush.mosaicPaletteCount,
  mosaicDitherEnabled: brush.mosaicDitherEnabled,
  mosaicSegmentJitter: brush.mosaicSegmentJitter,
  mosaicSeed: brush.mosaicSeed,
  colorCycleGradient: brush.colorCycleGradient?.map((stop) => ({ ...stop })),
});

type StrokeBucket = {
  strokeId: string;
  events: SequentialStrokeEvent[];
};

const groupStrokeBuckets = (
  layerId: string,
  events: ReadonlyArray<SequentialStrokeEvent>
): StrokeBucket[] => {
  const buckets = new Map<string, SequentialStrokeEvent[]>();
  const order: string[] = [];
  events.forEach((event) => {
    if (!event || event.layerId !== layerId) {
      return;
    }
    if (!buckets.has(event.strokeId)) {
      buckets.set(event.strokeId, []);
      order.push(event.strokeId);
    }
    buckets.get(event.strokeId)?.push(event);
  });
  return order.map((strokeId) => ({
    strokeId,
    events: buckets.get(strokeId) ?? [],
  }));
};

export interface EncodeSequentialChunksInput {
  layerId: string;
  fps: number;
  frameCount: number;
  events: ReadonlyArray<SequentialStrokeEvent>;
}

export const encodeSequentialEventsToChunks = ({
  layerId,
  fps,
  frameCount,
  events,
}: EncodeSequentialChunksInput): SequentialChunkEncodeResult => {
  const safeFps = Math.max(1, Math.round(toFiniteNumber(fps, 12)));
  const safeFrameCount = Math.max(1, Math.round(toFiniteNumber(frameCount, 12)));
  const brushSnapshots: Record<string, SequentialBrushSnapshot> = {};
  const chunks: SerializedSequentialStrokeChunkV1[] = [];

  groupStrokeBuckets(layerId, events).forEach(({ strokeId, events: strokeEvents }) => {
    if (strokeEvents.length === 0) {
      return;
    }

    const firstEvent = strokeEvents[0];
    const brushSnapshotId = hashString(brushSnapshotKey(firstEvent.brush));
    brushSnapshots[brushSnapshotId] = cloneBrushSnapshot(firstEvent.brush);

    const startFrameIndex = Math.round(toFiniteNumber(firstEvent.frameIndex, 0));
    const stampPoints: SequentialStampPoint[] = [];
    const eventIds: string[] = [];
    const eventStampCounts: number[] = [];
    const eventTimestampMs: number[] = [];
    const eventFrameOffsets: number[] = [];

    strokeEvents.forEach((event) => {
      const safeStamps = Array.isArray(event.stamps) ? event.stamps : [];
      eventIds.push(event.id);
      eventStampCounts.push(clampUint16(safeStamps.length));
      eventTimestampMs.push(clampUint32(toFiniteNumber(event.timestampMs, 0)));
      eventFrameOffsets.push(clampInt16(Math.round(toFiniteNumber(event.frameIndex, startFrameIndex)) - startFrameIndex));
      safeStamps.forEach((stamp) => stampPoints.push(stamp));
    });

    const firstStamp = stampPoints[0];
    const anchorXQ8_8 = firstStamp ? toQ8_8(firstStamp.x) : 0;
    const anchorYQ8_8 = firstStamp ? toQ8_8(firstStamp.y) : 0;
    let previousXQ8_8 = anchorXQ8_8;
    let previousYQ8_8 = anchorYQ8_8;

    const dXQ8_8 = new Int16Array(stampPoints.length);
    const dYQ8_8 = new Int16Array(stampPoints.length);
    const dFrame = new Int16Array(stampPoints.length);
    const pressureU8 = new Uint8Array(stampPoints.length);
    const rotationI16 = new Int16Array(stampPoints.length);
    const sizeU16 = new Uint16Array(stampPoints.length);
    const alphaU8 = new Uint8Array(stampPoints.length);

    let stampCursor = 0;
    strokeEvents.forEach((event) => {
      const frameOffset = clampInt16(Math.round(toFiniteNumber(event.frameIndex, startFrameIndex)) - startFrameIndex);
      const safeStamps = Array.isArray(event.stamps) ? event.stamps : [];
      safeStamps.forEach((stamp) => {
        const xQ8_8 = toQ8_8(stamp.x);
        const yQ8_8 = toQ8_8(stamp.y);
        dXQ8_8[stampCursor] = clampInt16(xQ8_8 - previousXQ8_8);
        dYQ8_8[stampCursor] = clampInt16(yQ8_8 - previousYQ8_8);
        dFrame[stampCursor] = frameOffset;
        pressureU8[stampCursor] = clampByte(toFiniteNumber(stamp.pressure, 1) * 255);
        rotationI16[stampCursor] = clampInt16(toFiniteNumber(stamp.rotation, 0) * ROTATION_SCALE);
        sizeU16[stampCursor] = clampUint16(toFiniteNumber(stamp.size, 0) * Q8_8_SCALE);
        alphaU8[stampCursor] = clampByte(toFiniteNumber(stamp.alpha, 1) * 255);
        previousXQ8_8 = xQ8_8;
        previousYQ8_8 = yQ8_8;
        stampCursor += 1;
      });
    });

    chunks.push({
      header: {
        encodingVersion: 1,
        layerId,
        strokeSessionId: strokeId,
        brushSnapshotId,
        coordSpace: 'project-px',
        quantization: 'q8.8',
        fpsAtCapture: safeFps,
        frameCountAtCapture: safeFrameCount,
        startFrameIndex,
      },
      body: {
        anchorXQ8_8,
        anchorYQ8_8,
        dXQ8_8: encodeTypedArray(dXQ8_8),
        dYQ8_8: encodeTypedArray(dYQ8_8),
        dFrame: encodeTypedArray(dFrame),
        pressureU8: encodeTypedArray(pressureU8),
        rotationI16: encodeTypedArray(rotationI16),
        sizeU16: encodeTypedArray(sizeU16),
        alphaU8: encodeTypedArray(alphaU8),
        eventIds,
        eventStampCounts: encodeTypedArray(Uint16Array.from(eventStampCounts)),
        eventTimestampMs: encodeTypedArray(Uint32Array.from(eventTimestampMs)),
        eventFrameOffsets: encodeTypedArray(Int16Array.from(eventFrameOffsets)),
      },
    });
  });

  return {
    chunks,
    brushSnapshots,
  };
};

const cloneStamp = (stamp: SequentialStampPoint): SequentialStampPoint => ({ ...stamp });

const decodeChunkV1 = (
  chunk: SerializedSequentialStrokeChunkV1,
  brushSnapshots: Record<string, SequentialBrushSnapshot>
): SequentialStrokeEvent[] => {
  if (chunk.header.encodingVersion !== 1) {
    throw new Error(`Unsupported sequential chunk version: ${String(chunk.header.encodingVersion)}`);
  }

  const brush = brushSnapshots[chunk.header.brushSnapshotId];
  if (!brush) {
    throw new Error(`Missing sequential brush snapshot: ${chunk.header.brushSnapshotId}`);
  }

  const dXQ8_8 = decodeTypedArray(chunk.body.dXQ8_8, Int16Array);
  const dYQ8_8 = decodeTypedArray(chunk.body.dYQ8_8, Int16Array);
  const dFrame = decodeTypedArray(chunk.body.dFrame, Int16Array);
  const pressureU8 = decodeTypedArray(chunk.body.pressureU8, Uint8Array);
  const rotationI16 = decodeTypedArray(chunk.body.rotationI16, Int16Array);
  const sizeU16 = decodeTypedArray(chunk.body.sizeU16, Uint16Array);
  const alphaU8 = decodeTypedArray(chunk.body.alphaU8, Uint8Array);
  const eventStampCounts = decodeTypedArray(chunk.body.eventStampCounts, Uint16Array);
  const eventTimestampMs = decodeTypedArray(chunk.body.eventTimestampMs, Uint32Array);
  const eventFrameOffsets = decodeTypedArray(chunk.body.eventFrameOffsets, Int16Array);

  const stampCount = dXQ8_8.length;
  if (
    dYQ8_8.length !== stampCount ||
    dFrame.length !== stampCount ||
    pressureU8.length !== stampCount ||
    rotationI16.length !== stampCount ||
    sizeU16.length !== stampCount ||
    alphaU8.length !== stampCount
  ) {
    throw new Error('Sequential chunk stamp payload arrays have mismatched lengths');
  }

  if (
    eventTimestampMs.length !== eventStampCounts.length ||
    eventFrameOffsets.length !== eventStampCounts.length
  ) {
    throw new Error('Sequential chunk event payload arrays have mismatched lengths');
  }

  let currentXQ8_8 = chunk.body.anchorXQ8_8;
  let currentYQ8_8 = chunk.body.anchorYQ8_8;
  const flatStamps: SequentialStampPoint[] = [];
  for (let i = 0; i < stampCount; i += 1) {
    currentXQ8_8 += dXQ8_8[i];
    currentYQ8_8 += dYQ8_8[i];
    flatStamps.push({
      x: fromQ8_8(currentXQ8_8),
      y: fromQ8_8(currentYQ8_8),
      pressure: pressureU8[i] / 255,
      rotation: rotationI16[i] / ROTATION_SCALE,
      size: sizeU16[i] / Q8_8_SCALE,
      alpha: alphaU8[i] / 255,
    });
  }

  const events: SequentialStrokeEvent[] = [];
  let stampCursor = 0;
  for (let eventIndex = 0; eventIndex < eventStampCounts.length; eventIndex += 1) {
    const count = eventStampCounts[eventIndex];
    const frameOffset = eventFrameOffsets[eventIndex] ?? 0;
    const eventStamps = flatStamps.slice(stampCursor, stampCursor + count).map(cloneStamp);
    const eventId =
      chunk.body.eventIds[eventIndex] ??
      `${chunk.header.strokeSessionId}-event-${String(eventIndex).padStart(4, '0')}`;
    events.push({
      id: eventId,
      layerId: chunk.header.layerId,
      strokeId: chunk.header.strokeSessionId,
      timestampMs: eventTimestampMs[eventIndex] ?? 0,
      frameIndex: chunk.header.startFrameIndex + frameOffset,
      brush: cloneBrushSnapshot(brush),
      stamps: eventStamps,
    });
    stampCursor += count;
  }

  if (stampCursor !== stampCount) {
    throw new Error('Sequential chunk event boundaries do not match stamp payload');
  }

  return events;
};

export interface DecodeSequentialChunksInput {
  chunks?: ReadonlyArray<SerializedSequentialStrokeChunkV1> | null;
  brushSnapshots?: Record<string, SequentialBrushSnapshot> | null;
}

export const decodeSequentialChunksToEvents = ({
  chunks,
  brushSnapshots,
}: DecodeSequentialChunksInput): SequentialStrokeEvent[] => {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return [];
  }
  const snapshotMap = brushSnapshots ?? {};
  const decoded: SequentialStrokeEvent[] = [];
  chunks.forEach((chunk) => {
    decoded.push(...decodeChunkV1(chunk, snapshotMap));
  });
  return decoded;
};
