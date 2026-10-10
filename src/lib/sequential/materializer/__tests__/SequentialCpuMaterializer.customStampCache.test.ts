import { SequentialCpuMaterializer } from '@/lib/sequential/materializer/SequentialCpuMaterializer';
import { BrushShape, type SequentialStrokeEvent } from '@/types';

describe('sequential custom stamp content cache', () => {
  it.each([true, false])('keeps different same-size payloads distinct (explicit hash: %s)', (withHash) => {
    const materializer = new SequentialCpuMaterializer({ tileSize: 16 });
    const payloads = [
      [255, 0, 0, 255, 255, 0, 0, 255],
      [0, 255, 0, 255, 0, 0, 0, 0],
    ];
    const events: SequentialStrokeEvent[] = payloads.map((payload, index) => ({
      id: `cache-${withHash}-${index}`, layerId: 'cache-test', strokeId: `cache-${withHash}-${index}`,
      timestampMs: 0, frameIndex: index,
      brush: {
        tool: 'fill', brushShape: BrushShape.SQUARE, size: 2, opacity: 1,
        blendMode: 'source-over', rotation: 0, spacing: 1, color: '#ffffff',
        customStampHash: withHash ? `cache-payload-${index}` : undefined,
        customStamp: { width: 2, height: 1, rgbaBase64: Buffer.from(payload).toString('base64'), isColorizable: false },
      },
      stamps: [{ x: 1, y: 0.5, pressure: 1, rotation: 0, size: 2, alpha: 1 }],
    }));
    for (let frameIndex = 0; frameIndex < 2; frameIndex += 1) {
      const frame = materializer.materializeFrame({ width: 2, height: 1, frameIndex, events });
      const tile = frame.tiles[0];
      expect(tile).toBeDefined();
      expect(Array.from(tile.data.slice(0, 8))).toEqual(payloads[frameIndex]);
    }
  });
});
