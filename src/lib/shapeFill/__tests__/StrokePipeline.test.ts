import { defaultBrushSettings } from '@/presets/brushPresets';

import { StrokePipeline } from '../gpu/StrokePipeline';
import type { StrokeJob, FieldGeneratorResult } from '../types';

type MockWebgpuControls = {
  enable(): void;
  disable(): void;
  reset?(): void;
  createDevice?: () => GPUDevice;
};

declare global {
  // eslint-disable-next-line no-var
  var __mockWebgpu: MockWebgpuControls | undefined;
}

describe('StrokePipeline', () => {
  const webgpuMock = global.__mockWebgpu as MockWebgpuControls;

  beforeEach(() => {
    webgpuMock.disable();
  });

  afterEach(() => {
    webgpuMock.enable();
  });

  const job: StrokeJob = {
    id: 'job-1',
    vertices: new Float32Array([0, 0, 10, 0, 10, 10]),
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    brushSettings: { ...defaultBrushSettings },
    previewResolution: { width: 10, height: 10, scale: 1 },
    finalResolution: { width: 10, height: 10, scale: 1 },
    pixelMode: true,
  };

  const fieldResult: FieldGeneratorResult = {
    jobId: 'job-1',
    tiles: [],
    vertexBuffer: {} as unknown as GPUBuffer,
    metrics: {
      tilesProcessed: 0,
      workgroupsDispatched: 0,
      generationTimeMs: 0,
    },
    release: jest.fn(),
  };

  it('returns null when WebGPU is unavailable', async () => {
    const pipeline = new StrokePipeline();
    const result = await pipeline.render(job, fieldResult, { priority: 'final' });
    expect(result).toBeNull();
  });
});
