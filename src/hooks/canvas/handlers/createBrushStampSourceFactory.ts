import type { MutableRefObject } from 'react';
import type { AppState } from '@/stores/useAppStore';
import {
  BrushStampSource,
  type BrushStampSourceDeps,
  type BrushStampSourceOptions,
} from '@/tools/stamps/BrushStampSource';

interface CreateBrushStampSourceFactoryOptions {
  storeRef: MutableRefObject<AppState>;
  brushRuntime: BrushStampSourceDeps['brushRuntime'];
  userBrushEngine: BrushStampSourceDeps['userBrushEngine'];
  resolveCustomBrush: BrushStampSourceDeps['resolveCustomBrush'];
}

export const createBrushStampSourceFactory = ({
  storeRef,
  brushRuntime,
  userBrushEngine,
  resolveCustomBrush,
}: CreateBrushStampSourceFactoryOptions) => {
  return (options?: BrushStampSourceOptions) =>
    new BrushStampSource({
      getState: () => storeRef.current,
      brushRuntime,
      userBrushEngine,
      resolveCustomBrush,
    }, options);
};
