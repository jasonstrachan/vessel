import type { FrameTileSet, SequentialMaterializeFrameInput } from '@/lib/sequential/types';

export type SequentialMaterializerBackendKind = 'cpu' | 'gpu';

export interface SequentialMaterializerBackend {
  readonly kind: SequentialMaterializerBackendKind;
  materializeFrame(input: SequentialMaterializeFrameInput): FrameTileSet;
  dispose?: () => void;
}
