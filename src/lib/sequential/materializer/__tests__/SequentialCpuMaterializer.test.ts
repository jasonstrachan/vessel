import { BrushShape, type SequentialStrokeEvent } from '@/types';
import { SequentialCpuMaterializer } from '@/lib/sequential/materializer/SequentialCpuMaterializer';

const createEvent = ({
  id,
  frameIndex,
  x,
  y,
  color,
  alpha = 1,
}: {
  id: string;
  frameIndex: number;
  x: number;
  y: number;
  color: string;
  alpha?: number;
}): SequentialStrokeEvent => ({
  id,
  layerId: 'layer-1',
  strokeId: 'stroke-1',
  timestampMs: 0,
  frameIndex,
  brush: {
    tool: 'brush',
    brushShape: BrushShape.ROUND,
    size: 4,
    opacity: 1,
    blendMode: 'source-over',
    rotation: 0,
    spacing: 1,
    color,
    customStampId: null,
  },
  stamps: [
    {
      x,
      y,
      pressure: 1,
      rotation: 0,
      size: 4,
      alpha,
    },
  ],
});

const sumAlpha = (data: Uint8ClampedArray): number => {
  let total = 0;
  for (let i = 3; i < data.length; i += 4) {
    total += data[i];
  }
  return total;
};

describe('SequentialCpuMaterializer', () => {
  it('materializes only the requested frame', () => {
    const materializer = new SequentialCpuMaterializer({ tileSize: 8 });
    const tileSet = materializer.materializeFrame({
      width: 16,
      height: 16,
      frameIndex: 1,
      events: [
        createEvent({ id: 'f0', frameIndex: 0, x: 4, y: 4, color: '#ff0000' }),
        createEvent({ id: 'f1', frameIndex: 1, x: 12, y: 12, color: '#00ff00' }),
      ],
    });

    expect(tileSet.frameIndex).toBe(1);
    expect(tileSet.tiles.length).toBeGreaterThan(0);
    expect(tileSet.tiles.every((tile) => tile.x >= 8 || tile.y >= 8)).toBe(true);
  });

  it('produces deterministic premultiplied output', () => {
    const materializer = new SequentialCpuMaterializer({ tileSize: 8 });
    const input = {
      width: 12,
      height: 12,
      frameIndex: 0,
      events: [
        createEvent({ id: 'a', frameIndex: 0, x: 4, y: 4, color: 'rgba(255, 0, 0, 0.5)' }),
        createEvent({ id: 'b', frameIndex: 0, x: 7, y: 6, color: '#00ff0080', alpha: 0.8 }),
      ],
    };

    const first = materializer.materializeFrame(input);
    const second = materializer.materializeFrame(input);

    expect(first.tiles).toHaveLength(second.tiles.length);
    const firstBytes = first.tiles.flatMap((tile) => Array.from(tile.data));
    const secondBytes = second.tiles.flatMap((tile) => Array.from(tile.data));
    expect(firstBytes).toEqual(secondBytes);
    expect(first.tiles.some((tile) => sumAlpha(tile.data) > 0)).toBe(true);
  });
});
