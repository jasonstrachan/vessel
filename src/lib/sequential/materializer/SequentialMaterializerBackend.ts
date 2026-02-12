import type {
  FrameTilePatch,
  FrameTileSet,
  SequentialMaterializeFrameInput,
  SequentialMaterializeRectInput,
} from '@/lib/sequential/types';

export type SequentialMaterializerBackendKind = 'cpu' | 'gpu';

export interface SequentialMaterializerBackend {
  readonly kind: SequentialMaterializerBackendKind;
  materializeFrame(input: SequentialMaterializeFrameInput): FrameTileSet;
  materializeRect?(input: SequentialMaterializeRectInput): FrameTilePatch;
  patchFrame?(
    input: SequentialMaterializeFrameInput & { baseTileSet: FrameTileSet }
  ): FrameTileSet;
  dispose?: () => void;
}
