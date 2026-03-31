export type GradientBindingRegion = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

export type CommitCommittedLayerStateOptions = {
  layerId: string;
  targetCanvas?: HTMLCanvasElement | null;
  opacity?: number;
  binding?: {
    defId: number;
    slot: number;
    bbox?: GradientBindingRegion;
    previewSlot?: number | null;
  };
};

export type ColorCycleCommittedStateBrush = {
  commitCommittedLayerState?: (options: CommitCommittedLayerStateOptions) => void;
};
