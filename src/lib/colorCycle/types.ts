import type { Layer } from '@/types';

export type RecolorSettings = NonNullable<
  NonNullable<Layer['colorCycleData']>['recolorSettings']
>;
