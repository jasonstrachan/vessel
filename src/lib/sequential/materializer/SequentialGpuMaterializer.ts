import { SequentialCpuMaterializer } from '@/lib/sequential/materializer/SequentialCpuMaterializer';
import type { SequentialMaterializerBackend } from '@/lib/sequential/materializer/SequentialMaterializerBackend';
import type { SequentialMaterializeFrameInput, FrameTileSet } from '@/lib/sequential/types';

const hasWebGpuSupport = (): boolean => {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const nav = navigator as Navigator & { gpu?: unknown };
  return Boolean(nav.gpu);
};

export class SequentialGpuMaterializer implements SequentialMaterializerBackend {
  readonly kind = 'gpu' as const;
  private readonly cpuFallback: SequentialCpuMaterializer;

  constructor(options?: { tileSize?: number }) {
    if (!hasWebGpuSupport()) {
      throw new Error('WebGPU is unavailable for SequentialGpuMaterializer');
    }
    this.cpuFallback = new SequentialCpuMaterializer(options);
  }

  materializeFrame(input: SequentialMaterializeFrameInput): FrameTileSet {
    // GPU backend shape is in place; v1 keeps CPU parity as the canonical path.
    return this.cpuFallback.materializeFrame(input);
  }
}
