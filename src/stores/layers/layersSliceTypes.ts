import type { LayerStructureSnapshot } from '@/history/deltas/layerStructureDelta';
import type { ColorCycleDirtyRect, ColorCycleLayerDirtyBatch } from '@/lib/colorCycle/document/ColorCycleLayerDocument';
import type { CompositeSegment } from '@/stores/layers/layerCompositeRenderer';
import type {
  CommitLayerStructureHistoryOptions,
  LayerHistorySnapshotOptions,
} from '@/stores/helpers/layerStructureHistory';
import type { ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type {
  AppState,
  CaptureROI,
  VesselWindow,
} from '@/stores/useAppStore';
import type {
  AdjustmentEffect,
  Layer,
  LayerAlignmentSettings,
  LayerGroup,
  Project,
  SequentialStrokeEvent,
} from '@/types';
import type { ColorCycleSoftEdgeDitherAlgorithm } from '@/utils/colorCycleSoftEdgeMask';

export type { CompositeSegment } from '@/stores/layers/layerCompositeRenderer';

export type CompositeLayersToCanvasOptions = {
  dirtyBatches?: ColorCycleLayerDirtyBatch[];
  liveLayerOverlay?: {
    layerId: string;
    canvas: HTMLCanvasElement;
    mode: 'over' | 'replace';
  };
};

export type RenderStaticCompositeOptions = {
  captureBitmap?: boolean;
  dirtyBatches?: ColorCycleLayerDirtyBatch[];
};

export type MarkCompositeSegmentsDirtyOptions = {
  dirtyRectsByLayerId?: Map<string, ColorCycleDirtyRect[]>;
};

export type UpdateLayerOptions = {
  skipColorCycleSync?: boolean;
  dirtyRects?: ColorCycleDirtyRect[];
};

export type EnsureColorCycleLayerRuntimeTarget = 'warm' | 'active';

export interface SetActiveLayerOptions {
  preserveSelection?: boolean;
  /** Previous layer captured before a structural replay replaced the layer array. */
  previousActiveLayer?: Layer | null;
  /** Re-run runtime/tool lifecycle even when the active id itself is unchanged. */
  forceLifecycle?: boolean;
}

export interface LayersSliceOptions {
  syncPercentOffsetsFromPixels: (layers: Layer[], project: Project | null) => Layer[];
  trackLayerChanges: (...args: unknown[]) => void;
  colorCycleBrushManager: ColorCycleBrushManager;
  captureLayerStructureSnapshot: (
    state: AppState,
    options: LayerHistorySnapshotOptions,
  ) => LayerStructureSnapshot;
  commitLayerStructureHistory: (options: CommitLayerStructureHistoryOptions) => void;
  getVesselWindow: () => VesselWindow | undefined;
}

export interface LayersSlice {
  layers: Layer[];
  layerGroups: LayerGroup[];
  hiddenLayerGroupIds: string[];
  layersNeedRecomposition: boolean;
  staticCompositeVersion: number;
  compositeSegmentsVersion: number;
  compositeSegments: CompositeSegment[];
  pendingCompositeDirtyBatches: ColorCycleLayerDirtyBatch[];
  currentOffscreenCanvas: HTMLCanvasElement | null;
  currentCompositeBitmap: ImageBitmap | null;
  activeLayerId: string | null;
  selectedLayerIds: string[];
  warmingColorCycleLayerIds: string[];
  referenceLayerId: string | null;
  currentLayer: number;
  setLayersNeedRecomposition: (needed: boolean) => void;
  setCurrentOffscreenCanvas: (canvas: HTMLCanvasElement | null) => void;
  setCurrentCompositeBitmap: (bitmap: ImageBitmap | null) => void;
  setLayers: (layers: Layer[]) => void;
  addLayer: (layer: Omit<Layer, 'id' | 'order'>) => string;
  duplicateLayer: (layerId: string) => string | null;
  duplicateLayers: (layerIds: string[]) => string[];
  removeLayer: (id: string) => void;
  removeLayers: (layerIds: string[]) => void;
  updateLayer: (id: string, updates: Partial<Layer>, options?: UpdateLayerOptions) => void;
  beginAdjustmentLayerEdit: (layerId: string) => void;
  updateAdjustmentLayerEffect: (layerId: string, effect: AdjustmentEffect) => void;
  commitAdjustmentLayerEdit: (layerId: string) => void;
  appendSequentialLayerEvent: (
    layerId: string,
    event: SequentialStrokeEvent,
    metadata: { frameCount: number; fps: number; durationMs: number },
  ) => void;
  appendSequentialLayerEvents: (
    layerId: string,
    events: SequentialStrokeEvent[],
    metadata: { frameCount: number; fps: number; durationMs: number },
  ) => void;
  setLayersVisibility: (layerIds: string[], visible: boolean) => void;
  toggleLayersVisibility: (layerIds: string[]) => void;
  createLayerGroupFromSelection: (layerIds: string[]) => string | null;
  createInterlaceGroupFromSelection: (layerIds: string[]) => string | null;
  updateInterlaceGroup: (
    groupId: string,
    updates: Partial<NonNullable<LayerGroup['interlace']>>,
    options?: {
      recordHistory?: boolean;
      previousSettings?: NonNullable<LayerGroup['interlace']>;
    },
  ) => void;
  moveLayersToGroup: (
    layerIds: string[],
    groupId: string | undefined,
    destinationIndex: number,
  ) => void;
  removeLayerGroup: (groupId: string) => void;
  renameLayerGroup: (groupId: string, name: string) => void;
  setLayerGroupVisibility: (groupId: string, visible: boolean) => void;
  setSelectedLayerIds: (layerIds: string[]) => void;
  mergeLayers: (layerIds: string[]) => string | null;
  convertColorCycleLayerToNormal: (layerId: string) => boolean;
  setActiveLayer: (id: string | null, opts?: SetActiveLayerOptions) => void;
  setReferenceLayer: (id: string | null) => void;
  reorderLayers: (sourceIndex: number, destinationIndex: number) => void;
  reorderLayerBlock: (layerIds: string[], destinationIndex: number) => void;
  updateLayerAlignment: (layerId: string, alignment: LayerAlignmentSettings) => void;
  scheduleColorCycleSlotRebuild: (reason: string) => void;
  runColorCycleSlotRebuild: (reason: string) => void;
  ensureColorCycleLayerRuntime: (
    layerId: string,
    options?: { target?: EnsureColorCycleLayerRuntimeTarget },
  ) => Promise<boolean>;
  applyColorCycleSoftEdgeMask: (
    layerId: string,
    radius: number,
    ditherSize?: number,
    ditherAlgorithm?: ColorCycleSoftEdgeDitherAlgorithm,
  ) => Promise<boolean>;
  setColorCycleSoftEdgeMaskEnabled: (layerId: string, enabled: boolean) => void;
  clearColorCycleSoftEdgeMask: (layerId: string) => void;
  initColorCycleForLayer: (layerId: string, width: number, height: number) => void;
  cleanupColorCycleForLayer: (layerId: string) => void;
  compositeLayersToCanvas: (
    targetCanvas: HTMLCanvasElement,
    options?: CompositeLayersToCanvasOptions,
  ) => void;
  compositeLayersToCanvasSync: (
    targetCanvas: HTMLCanvasElement,
    options?: CompositeLayersToCanvasOptions,
  ) => boolean;
  renderStaticComposite: (
    targetCanvas: HTMLCanvasElement,
    options?: RenderStaticCompositeOptions,
  ) => boolean | Promise<boolean>;
  renderColorCycleOverlay: (targetCanvas: HTMLCanvasElement) => boolean;
  getCompositeSegmentsSnapshot: () => CompositeSegment[];
  markCompositeSegmentsDirtyByLayerIds: (
    layerIds: string[],
    options?: MarkCompositeSegmentsDirtyOptions,
  ) => void;
  markAllCompositeSegmentsDirty: () => void;
  captureCanvasToActiveLayer: (
    sourceCanvas?: HTMLCanvasElement,
    roi?: CaptureROI,
  ) => Promise<void>;
  captureCanvasToLayer: (
    sourceCanvas: HTMLCanvasElement,
    targetLayerId: string | null,
  ) => Promise<void>;
}
