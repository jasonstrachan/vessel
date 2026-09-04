import { SequentialGpuMaterializer } from '@/lib/sequential/materializer/SequentialGpuMaterializer';

describe('SequentialGpuMaterializer', () => {
  it('cannot be reported as GPU acceleration until a real backend exists', () => {
    expect(() => new SequentialGpuMaterializer()).toThrow(
      'Sequential WebGPU materialization is reserved but not implemented'
    );
  });
});
