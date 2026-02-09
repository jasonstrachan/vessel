import { BrushShape, type SequentialStrokeEvent } from '@/types';
import { SequentialCpuMaterializer } from '@/lib/sequential/materializer/SequentialCpuMaterializer';
import { SequentialGpuMaterializer } from '@/lib/sequential/materializer/SequentialGpuMaterializer';

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

describe('SequentialGpuMaterializer', () => {
  let hadOwnGpuProperty = false;
  let previousGpuValue: unknown;

  beforeEach(() => {
    hadOwnGpuProperty = Object.prototype.hasOwnProperty.call(navigator, 'gpu');
    previousGpuValue = (navigator as Navigator & { gpu?: unknown }).gpu;
  });

  afterEach(() => {
    if (hadOwnGpuProperty) {
      Object.defineProperty(navigator, 'gpu', {
        value: previousGpuValue,
        configurable: true,
      });
      return;
    }
    try {
      Reflect.deleteProperty(navigator as Navigator & { gpu?: unknown }, 'gpu');
    } catch {
      Object.defineProperty(navigator, 'gpu', {
        value: undefined,
        configurable: true,
      });
    }
  });

  it('throws when WebGPU is unavailable', () => {
    Reflect.deleteProperty(navigator as Navigator & { gpu?: unknown }, 'gpu');
    expect(() => new SequentialGpuMaterializer()).toThrow(
      'WebGPU is unavailable for SequentialGpuMaterializer'
    );
  });

  it('matches CPU materialization output when WebGPU is available', () => {
    Object.defineProperty(navigator, 'gpu', {
      value: {},
      configurable: true,
    });

    const input = {
      width: 12,
      height: 12,
      frameIndex: 0,
      events: [
        createEvent({ id: 'a', frameIndex: 0, x: 4, y: 4, color: 'rgba(255, 0, 0, 0.5)' }),
        createEvent({ id: 'b', frameIndex: 0, x: 7, y: 6, color: '#00ff0080', alpha: 0.8 }),
      ],
    };

    const cpu = new SequentialCpuMaterializer({ tileSize: 8 });
    const gpu = new SequentialGpuMaterializer({ tileSize: 8 });

    expect(gpu.kind).toBe('gpu');
    expect(gpu.materializeFrame(input)).toEqual(cpu.materializeFrame(input));
    const baseTileSet = cpu.materializeFrame({
      ...input,
      events: [input.events[0]],
    });
    expect(
      gpu.patchFrame({
        ...input,
        events: [input.events[1]],
        baseTileSet,
      })
    ).toEqual(cpu.patchFrame({ ...input, events: [input.events[1]], baseTileSet }));
  });
});
