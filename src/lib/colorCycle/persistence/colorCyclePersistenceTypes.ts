import type { ColorCycleLayerDocumentState } from '@/lib/colorCycle/documentState';
import type {
  ColorCycleBrushSerializedStateRuntimeReader,
  ColorCycleLayerDocumentArchiveRefs,
  ColorCycleLayerDocumentResidency,
} from '@/lib/colorCycle/document';
import type { Layer } from '@/types';

export type ColorCyclePersistenceMode =
  | 'canonical-save'
  | 'autosave'
  | 'history'
  | 'export'
  | 'import-repair'
  | 'diagnostic';

export type ColorCyclePersistenceSource =
  | 'document'
  | 'live-runtime'
  | 'deferred-archive'
  | 'persisted-brush-state';

export type ColorCycleDamageKind =
  | 'missing-paint-buffer'
  | 'missing-gradient-bindings'
  | 'missing-motion-buffers'
  | 'metadata-only'
  | 'dimension-mismatch'
  | 'layer-id-mismatch'
  | 'missing-archive-ref'
  | 'invalid-schema-version';

export type ColorCyclePersistenceFailureReason =
  | 'missing-color-cycle-data'
  | 'missing-canonical-paint'
  | 'missing-gradient-bindings'
  | 'runtime-capture-failed'
  | 'dimension-mismatch'
  | 'missing-motion-buffers'
  | 'layer-id-mismatch'
  | 'missing-archive-ref'
  | 'missing-document-source'
  | 'invalid-schema-version'
  | 'invalid-deferred-archive'
  | 'metadata-only-state';

export type ColorCyclePersistenceDiagnostic = {
  source?: ColorCyclePersistenceSource;
  kind: ColorCycleDamageKind | 'source-selected' | 'source-rejected' | 'static-preview-only';
  message: string;
  fields?: string[];
  documentVersion?: number;
};

export type ColorCyclePersistenceDiagnosticSink = (diagnostic: ColorCyclePersistenceDiagnostic) => void;

export type ColorCycleBufferRef = ArrayBuffer | string;

export type PersistedColorCycleStrokeData = {
  paintBuffer?: ColorCycleBufferRef;
  gradientIdBuffer?: ColorCycleBufferRef;
  gradientDefIdBuffer?: ColorCycleBufferRef;
  speedBuffer?: ColorCycleBufferRef;
  flowBuffer?: ColorCycleBufferRef;
  phaseBuffer?: ColorCycleBufferRef;
  hasContent?: boolean;
  strokeCounter?: number;
};

export type PersistedColorCycleLayerSnapshot = {
  layerId: string;
  canonicalPaint?: boolean;
  schemaVersion?: number;
  dimensions?: { width: number; height: number };
  capturedAtStrokeCounter?: number;
  strokeData?: PersistedColorCycleStrokeData;
  gradientDefs?: NonNullable<Layer['colorCycleData']>['gradientDefs'];
  slotPalettes?: NonNullable<Layer['colorCycleData']>['slotPalettes'];
  gradientDefStore?: NonNullable<Layer['colorCycleData']>['gradientDefStore'];
  nextGradientDefId?: number;
  paintSlot?: number;
  fgActiveSlot?: number;
  activeGradientId?: string;
};

export type PersistedColorCycleBrushState = {
  canonicalPaint?: boolean;
  schemaVersion?: number;
  dimensionsByLayerId?: Record<string, { width: number; height: number }>;
  layers?: PersistedColorCycleLayerSnapshot[];
  [key: string]: unknown;
};

export type ColorCycleRuntimeBrush = ColorCycleBrushSerializedStateRuntimeReader;

export type ColorCycleRuntimeBrushManager = {
  getSerializedStateBrush?: (layerId: string) => ColorCycleRuntimeBrush | null | undefined;
  getDocument?: (layerId: string) => ColorCycleLayerDocumentReader | null | undefined;
};

export type ColorCycleArchiveManifest = {
  has?: (path: string) => boolean;
  get?: (path: string) => { byteLength?: number; logicalByteLength?: number } | undefined;
};

export type DeferredColorCycleArchiveRuntime = {
  brushState?: PersistedColorCycleBrushState;
  gradientIdRef?: string;
  gradientDefIdRef?: string;
  paintRef?: string;
  speedRef?: string;
  flowRef?: string;
  phaseRef?: string;
};

export type ColorCycleLayerRuntimeCache = {
  getDeferredRuntime?: (layerId: string) => DeferredColorCycleArchiveRuntime | undefined;
};

export type ColorCyclePersistenceDocumentState = Omit<
  ColorCycleLayerDocumentState,
  | 'paintBuffer'
  | 'gradientIdBuffer'
  | 'gradientDefIdBuffer'
  | 'speedBuffer'
  | 'flowBuffer'
  | 'phaseBuffer'
> & {
  paintBuffer?: ColorCycleBufferRef;
  gradientIdBuffer?: ColorCycleBufferRef;
  gradientDefIdBuffer?: ColorCycleBufferRef;
  speedBuffer?: ColorCycleBufferRef;
  flowBuffer?: ColorCycleBufferRef;
  phaseBuffer?: ColorCycleBufferRef;
};

export type ColorCyclePersistenceSnapshot =
  | {
      ok: true;
      source: ColorCyclePersistenceSource;
      mode: ColorCyclePersistenceMode;
      layerId: string;
      documentVersion?: number;
      documentState: ColorCyclePersistenceDocumentState & { paintBuffer: ColorCycleBufferRef };
      brushState: PersistedColorCycleBrushState;
      diagnostics: ColorCyclePersistenceDiagnostic[];
    }
  | {
      ok: false;
      layerId: string;
      mode: ColorCyclePersistenceMode;
      reason: ColorCyclePersistenceFailureReason;
      damageKind?: ColorCycleDamageKind;
      previewImageData?: ImageData;
      diagnostics: ColorCyclePersistenceDiagnostic[];
    };

export type CaptureColorCyclePersistenceSnapshotContext = {
  projectWidth: number;
  projectHeight: number;
  requirePaint: boolean;
  mode: ColorCyclePersistenceMode;
  document?: ColorCycleLayerDocumentReader | null;
  runtimeBrushManager?: ColorCycleRuntimeBrushManager;
  runtimeBrush?: ColorCycleRuntimeBrush | null;
  skipRuntime?: boolean;
  serializeRuntimeBrushState?: (state: unknown, layerId: string) => PersistedColorCycleBrushState | undefined;
  archiveManifest?: ColorCycleArchiveManifest;
  deferredRuntime?: DeferredColorCycleArchiveRuntime;
  layerRuntimeCache?: ColorCycleLayerRuntimeCache;
  diagnostics?: ColorCyclePersistenceDiagnosticSink;
};

export type ColorCycleLayerDocumentReader = {
  readonly residency?: ColorCycleLayerDocumentResidency;
  readonly archiveRefs?: ColorCycleLayerDocumentArchiveRefs | null;
  read: () => {
    snapshot: ColorCycleLayerDocumentState;
    version: number;
  };
};
