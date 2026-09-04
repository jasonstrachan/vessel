import type { SequentialMaterializerBackend } from '@/lib/sequential/materializer/SequentialMaterializerBackend';
import type {
  FrameTilePatch,
  FrameTileSet,
  SequentialMaterializeFrameInput,
  SequentialMaterializeRectInput,
} from '@/lib/sequential/types';

export class SequentialGpuMaterializer implements SequentialMaterializerBackend {
  readonly kind = 'gpu' as const;

  constructor(options?: { tileSize?: number }) {
    void options;
    throw new Error('Sequential WebGPU materialization is reserved but not implemented');
  }

  materializeFrame(input: SequentialMaterializeFrameInput): FrameTileSet {
    void input;
    throw new Error('Sequential WebGPU materialization is not implemented');
  }

  materializeRect(input: SequentialMaterializeRectInput): FrameTilePatch {
    void input;
    throw new Error('Sequential WebGPU materialization is not implemented');
  }

  patchFrame(input: SequentialMaterializeFrameInput & { baseTileSet: FrameTileSet }): FrameTileSet {
    void input;
    throw new Error('Sequential WebGPU materialization is not implemented');
  }
}
