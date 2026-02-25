import { BrushShape, type SequentialStrokeEvent } from '@/types';
import {
  decodeSequentialChunksToEvents,
  encodeSequentialEventsToChunks,
} from '@/lib/sequential/SequentialStrokeChunk';

const createEvent = (eventId: string, strokeId: string, frameIndex: number, timestampMs: number): SequentialStrokeEvent => ({
  id: eventId,
  layerId: 'layer-seq',
  strokeId,
  timestampMs,
  frameIndex,
  brush: {
    tool: 'brush',
    brushShape: BrushShape.ROUND,
    size: 12.5,
    opacity: 0.75,
    blendMode: 'source-over',
    rotation: 0.25,
    spacing: 1.5,
    color: '#00ff88',
    pluginBrushId: null,
    pluginConfig: null,
    customStampId: null,
  },
  stamps: [
    { x: 10.25, y: 12.5, pressure: 0.6, rotation: 0.1, size: 8.25, alpha: 0.7 },
    { x: 11.75, y: 13.25, pressure: 0.8, rotation: 0.2, size: 9.5, alpha: 0.9 },
  ],
});

describe('SequentialStrokeChunk', () => {
  it('encodes and decodes sequential events with stable event boundaries', () => {
    const pluginEvent = createEvent('event-2', 'stroke-b', 3, 130);
    const sourceEvents: SequentialStrokeEvent[] = [
      createEvent('event-1', 'stroke-a', 2, 100),
      {
        ...pluginEvent,
        brush: {
          ...pluginEvent.brush,
          pluginBrushId: 'spam-brush',
          pluginConfig: {
            spamFont: 'courier',
            spamContentType: 'mixed',
            spamCustomText: 'WINNER!!!',
            ditherAlgorithm: 'bayer',
            ditherIntensity: 25,
            ditherBayerMatrixSize: 4,
            particleDensity: 36,
            particleScatterRadius: 2.1,
            customNibMode: 'spray-v2',
            customSeed: 1337,
            customEnabled: true,
          },
        },
      },
      createEvent('event-3', 'stroke-c', 7, 210),
    ];

    const encoded = encodeSequentialEventsToChunks({
      layerId: 'layer-seq',
      fps: 12,
      frameCount: 24,
      events: sourceEvents,
    });

    expect(encoded.chunks).toHaveLength(3);
    expect(Object.keys(encoded.brushSnapshots)).toHaveLength(2);

    const decoded = decodeSequentialChunksToEvents({
      chunks: encoded.chunks,
      brushSnapshots: encoded.brushSnapshots,
    });

    expect(decoded.map((event) => event.id)).toEqual(sourceEvents.map((event) => event.id));
    expect(decoded.map((event) => event.strokeId)).toEqual(sourceEvents.map((event) => event.strokeId));
    expect(decoded.map((event) => event.frameIndex)).toEqual(sourceEvents.map((event) => event.frameIndex));
    expect(decoded.map((event) => event.timestampMs)).toEqual(sourceEvents.map((event) => event.timestampMs));
    expect(decoded[1].brush.pluginBrushId).toBe('spam-brush');
    expect(decoded[1].brush.pluginConfig?.spamFont).toBe('courier');
    expect(decoded[1].brush.pluginConfig?.spamContentType).toBe('mixed');
    expect(decoded[1].brush.pluginConfig?.spamCustomText).toBe('WINNER!!!');
    expect(decoded[1].brush.pluginConfig?.ditherAlgorithm).toBe('bayer');
    expect(decoded[1].brush.pluginConfig?.ditherIntensity).toBe(25);
    expect(decoded[1].brush.pluginConfig?.ditherBayerMatrixSize).toBe(4);
    expect(decoded[1].brush.pluginConfig?.particleDensity).toBe(36);
    expect(decoded[1].brush.pluginConfig?.particleScatterRadius).toBe(2.1);
    expect(decoded[1].brush.pluginConfig?.customNibMode).toBe('spray-v2');
    expect(decoded[1].brush.pluginConfig?.customSeed).toBe(1337);
    expect(decoded[1].brush.pluginConfig?.customEnabled).toBe(true);
    expect(decoded[0].stamps).toHaveLength(2);
    expect(decoded[0].stamps[0].x).toBeCloseTo(sourceEvents[0].stamps[0].x, 2);
    expect(decoded[0].stamps[0].y).toBeCloseTo(sourceEvents[0].stamps[0].y, 2);
  });

  it('branches by encodingVersion and rejects unknown versions', () => {
    const encoded = encodeSequentialEventsToChunks({
      layerId: 'layer-seq',
      fps: 12,
      frameCount: 24,
      events: [createEvent('event-1', 'stroke-a', 2, 100)],
    });

    const invalid = {
      ...encoded.chunks[0],
      header: {
        ...encoded.chunks[0].header,
        encodingVersion: 2 as 1,
      },
    };

    expect(() =>
      decodeSequentialChunksToEvents({
        chunks: [invalid],
        brushSnapshots: encoded.brushSnapshots,
      })
    ).toThrow('Unsupported sequential chunk version');
  });

  it('normalizes dither replay config when decoding chunked events', () => {
    const encoded = encodeSequentialEventsToChunks({
      layerId: 'layer-seq',
      fps: 12,
      frameCount: 24,
      events: [
        {
          ...createEvent('event-dither', 'stroke-dither', 4, 160),
          brush: {
            ...createEvent('event-dither', 'stroke-dither', 4, 160).brush,
            pluginBrushId: 'dither-brush',
            pluginConfig: {
              ditherAlgorithm: 'bayer',
              ditherIntensity: 50,
              ditherBayerMatrixSize: 8,
            },
            ditherAlgorithm: 'bayer',
          },
        },
      ],
    });
    const snapshotId = encoded.chunks[0].header.brushSnapshotId;
    const malformedSnapshot = encoded.brushSnapshots[snapshotId] as unknown as {
      pluginConfig?: Record<string, unknown>;
      ditherAlgorithm?: string;
    };
    malformedSnapshot.pluginConfig = {
      ...(malformedSnapshot.pluginConfig ?? {}),
      ditherAlgorithm: 'invalid-algo',
      ditherIntensity: 999,
      ditherBayerMatrixSize: 999,
    };
    malformedSnapshot.ditherAlgorithm = 'invalid-algo';
    const decoded = decodeSequentialChunksToEvents({
      chunks: encoded.chunks,
      brushSnapshots: encoded.brushSnapshots,
    });

    expect(decoded).toHaveLength(1);
    expect(decoded[0].brush.pluginConfig?.ditherAlgorithm).toBe('bayer');
    expect(decoded[0].brush.pluginConfig?.ditherIntensity).toBe(100);
    expect(decoded[0].brush.pluginConfig?.ditherBayerMatrixSize).toBe(8);
    expect(decoded[0].brush.ditherAlgorithm).toBe('bayer');
  });

  it('normalizes particle replay config when decoding chunked events', () => {
    const encoded = encodeSequentialEventsToChunks({
      layerId: 'layer-seq',
      fps: 12,
      frameCount: 24,
      events: [
        {
          ...createEvent('event-particle', 'stroke-particle', 2, 120),
          brush: {
            ...createEvent('event-particle', 'stroke-particle', 2, 120).brush,
            pluginBrushId: 'particle-brush',
            pluginConfig: {
              particleDensity: 20,
              particleScatterRadius: 1.5,
            },
          },
        },
      ],
    });
    const snapshotId = encoded.chunks[0].header.brushSnapshotId;
    const malformedSnapshot = encoded.brushSnapshots[snapshotId] as unknown as {
      pluginConfig?: Record<string, unknown>;
    };
    malformedSnapshot.pluginConfig = {
      ...(malformedSnapshot.pluginConfig ?? {}),
      particleDensity: 1000,
      particleScatterRadius: -4,
    };

    const decoded = decodeSequentialChunksToEvents({
      chunks: encoded.chunks,
      brushSnapshots: encoded.brushSnapshots,
    });

    expect(decoded).toHaveLength(1);
    expect(decoded[0].brush.pluginConfig?.particleDensity).toBe(200);
    expect(decoded[0].brush.pluginConfig?.particleScatterRadius).toBe(0.1);
  });

  it('normalizes spam replay config when decoding chunked events', () => {
    const encoded = encodeSequentialEventsToChunks({
      layerId: 'layer-seq',
      fps: 12,
      frameCount: 24,
      events: [
        {
          ...createEvent('event-spam', 'stroke-spam', 6, 240),
          brush: {
            ...createEvent('event-spam', 'stroke-spam', 6, 240).brush,
            pluginBrushId: 'spam-brush',
            pluginConfig: {
              spamFont: 'menlo',
              spamContentType: 'crypto',
              spamCustomText: 'TO THE MOON',
            },
          },
        },
      ],
    });
    const snapshotId = encoded.chunks[0].header.brushSnapshotId;
    const malformedSnapshot = encoded.brushSnapshots[snapshotId] as unknown as {
      pluginConfig?: Record<string, unknown>;
    };
    malformedSnapshot.pluginConfig = {
      ...(malformedSnapshot.pluginConfig ?? {}),
      spamFont: '',
      spamContentType: '',
      spamCustomText: '',
    };

    const decoded = decodeSequentialChunksToEvents({
      chunks: encoded.chunks,
      brushSnapshots: encoded.brushSnapshots,
    });

    expect(decoded).toHaveLength(1);
    expect(decoded[0].brush.pluginConfig?.spamFont).toBeNull();
    expect(decoded[0].brush.pluginConfig?.spamContentType).toBeNull();
    expect(decoded[0].brush.pluginConfig?.spamCustomText).toBeNull();
  });
});
