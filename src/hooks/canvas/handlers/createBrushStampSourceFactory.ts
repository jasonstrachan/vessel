import type { MutableRefObject } from 'react';
import type { AppState } from '@/stores/useAppStore';
import {
  BrushStampSource,
  type BrushStampSourceDeps,
  type BrushStampSourceOptions,
} from '@/tools/stamps/BrushStampSource';

interface CreateBrushStampSourceFactoryOptions {
  storeRef: MutableRefObject<AppState>;
  brushEngine: BrushStampSourceDeps['brushEngine'];
  userBrushEngine: BrushStampSourceDeps['userBrushEngine'];
  resolveCustomBrush: BrushStampSourceDeps['resolveCustomBrush'];
}

export const createBrushStampSourceFactory = ({
  storeRef,
  brushEngine,
  userBrushEngine,
  resolveCustomBrush,
}: CreateBrushStampSourceFactoryOptions) => {
  return (options?: BrushStampSourceOptions) =>
    new BrushStampSource({
      getState: () => storeRef.current,
      brushEngine,
      userBrushEngine,
      resolveCustomBrush,
    }, options);
};
