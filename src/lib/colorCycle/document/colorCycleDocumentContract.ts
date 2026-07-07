import type {
  ColorCycleGradientDef,
  ColorCycleGradientDefStoreEntry,
  ColorCycleSlotPalette,
} from '@/types';
import type {
  SerializedGradientStops,
  WebGLSerializedBrushState,
} from '@/utils/export/goblet/gobletTypes';

export type ColorCycleLayerDocumentState = {
  layerId: string;
  width: number;
  height: number;
  paintBuffer?: ArrayBuffer;
  gradientIdBuffer?: ArrayBuffer;
  gradientDefIdBuffer?: ArrayBuffer;
  speedBuffer?: ArrayBuffer;
  flowBuffer?: ArrayBuffer;
  phaseBuffer?: ArrayBuffer;
  slotPalettes?: ColorCycleSlotPalette[];
  gradientDefs?: ColorCycleGradientDef[];
  gradientDefStore?: ColorCycleGradientDefStoreEntry[];
  activeGradientId?: string;
  paintSlot?: number;
  fgActiveSlot?: number;
  layerBaseSpeedCps?: number;
  flowMode?: 'forward' | 'reverse' | 'pingpong';
  hasContent: boolean;
  sources: {
    brushStateSnapshot: boolean;
    topLevelBuffers: boolean;
    legacyStateRefs: boolean;
  };
};

export type ColorCycleLayerDocumentSnapshot = Readonly<ColorCycleLayerDocumentState>;

export const COLOR_CYCLE_STROKE_PAINT_KEY = 'paintBuffer';
export const COLOR_CYCLE_STROKE_GRADIENT_ID_KEY = 'gradientIdBuffer';
export const COLOR_CYCLE_STROKE_GRADIENT_DEF_ID_KEY = 'gradientDefIdBuffer';
export const COLOR_CYCLE_STROKE_SPEED_KEY = 'speedBuffer';
export const COLOR_CYCLE_STROKE_FLOW_KEY = 'flowBuffer';
export const COLOR_CYCLE_STROKE_PHASE_KEY = 'phaseBuffer';

type ArchiveMappingRole =
  | 'identity'
  | 'dimension'
  | 'canonical-buffer'
  | 'metadata'
  | 'diagnostic-source';

type GobletMappingRole =
  | 'payload-dimension'
  | 'payload-buffer'
  | 'payload-gradient'
  | 'payload-speed'
  | 'payload-flow'
  | 'payload-metadata'
  | 'not-exported';

export const COLOR_CYCLE_DOCUMENT_CONTRACT_KEYS = [
  'layerId',
  'width',
  'height',
  'paintBuffer',
  'gradientIdBuffer',
  'gradientDefIdBuffer',
  'speedBuffer',
  'flowBuffer',
  'phaseBuffer',
  'slotPalettes',
  'gradientDefs',
  'gradientDefStore',
  'activeGradientId',
  'paintSlot',
  'fgActiveSlot',
  'layerBaseSpeedCps',
  'flowMode',
  'hasContent',
  'sources',
] as const satisfies readonly (keyof ColorCycleLayerDocumentState)[];

type DocumentContractKey = typeof COLOR_CYCLE_DOCUMENT_CONTRACT_KEYS[number];
type AssertNever<T extends never> = T;
export type ColorCycleDocumentContractMissingKeys = AssertNever<
  Exclude<keyof ColorCycleLayerDocumentState, DocumentContractKey>
>;
export type ColorCycleDocumentContractExtraKeys = AssertNever<
  Exclude<DocumentContractKey, keyof ColorCycleLayerDocumentState>
>;

export const COLOR_CYCLE_DOCUMENT_FIELD_MAPPING = {
  layerId: { archive: 'identity', goblet: 'not-exported' },
  width: { archive: 'dimension', goblet: 'payload-dimension' },
  height: { archive: 'dimension', goblet: 'payload-dimension' },
  paintBuffer: { archive: 'canonical-buffer', goblet: 'payload-buffer' },
  gradientIdBuffer: { archive: 'canonical-buffer', goblet: 'payload-buffer' },
  gradientDefIdBuffer: { archive: 'canonical-buffer', goblet: 'payload-buffer' },
  speedBuffer: { archive: 'canonical-buffer', goblet: 'payload-buffer' },
  flowBuffer: { archive: 'canonical-buffer', goblet: 'payload-buffer' },
  phaseBuffer: { archive: 'canonical-buffer', goblet: 'payload-buffer' },
  slotPalettes: { archive: 'metadata', goblet: 'payload-gradient' },
  gradientDefs: { archive: 'metadata', goblet: 'payload-gradient' },
  gradientDefStore: { archive: 'metadata', goblet: 'payload-gradient' },
  activeGradientId: { archive: 'metadata', goblet: 'payload-gradient' },
  paintSlot: { archive: 'metadata', goblet: 'payload-gradient' },
  fgActiveSlot: { archive: 'metadata', goblet: 'payload-gradient' },
  layerBaseSpeedCps: { archive: 'metadata', goblet: 'payload-speed' },
  flowMode: { archive: 'metadata', goblet: 'payload-flow' },
  hasContent: { archive: 'metadata', goblet: 'payload-metadata' },
  sources: { archive: 'diagnostic-source', goblet: 'not-exported' },
} as const satisfies Record<
  keyof ColorCycleLayerDocumentState,
  { archive: ArchiveMappingRole; goblet: GobletMappingRole }
>;

const cloneArrayBuffer = (buffer: ArrayBuffer | undefined): ArrayBuffer | undefined => (
  buffer ? buffer.slice(0) : undefined
);

const cloneStops = <T extends { position: number; color: string; opacity?: number }>(
  stops: T[],
): T[] => stops.map((stop) => ({ ...stop }));

const cloneGradientDefs = (
  gradientDefs: ColorCycleGradientDef[] | undefined,
): ColorCycleGradientDef[] | undefined => (
  gradientDefs?.map((entry) => ({ ...entry }))
);

const cloneSlotPalettes = (
  slotPalettes: ColorCycleSlotPalette[] | undefined,
): ColorCycleSlotPalette[] | undefined => (
  slotPalettes?.map((entry) => ({
    ...entry,
    stops: cloneStops(entry.stops),
  }))
);

const cloneGradientDefStore = (
  gradientDefStore: ColorCycleGradientDefStoreEntry[] | undefined,
): ColorCycleGradientDefStoreEntry[] | undefined => (
  gradientDefStore?.map((entry) => ({
    ...entry,
    stops: cloneStops(entry.stops),
  }))
);

export const mapDocumentSnapshotToArchiveState = (
  snapshot: ColorCycleLayerDocumentSnapshot,
): ColorCycleLayerDocumentState => ({
  ...snapshot,
  paintBuffer: cloneArrayBuffer(snapshot.paintBuffer),
  gradientIdBuffer: cloneArrayBuffer(snapshot.gradientIdBuffer),
  gradientDefIdBuffer: cloneArrayBuffer(snapshot.gradientDefIdBuffer),
  speedBuffer: cloneArrayBuffer(snapshot.speedBuffer),
  flowBuffer: cloneArrayBuffer(snapshot.flowBuffer),
  phaseBuffer: cloneArrayBuffer(snapshot.phaseBuffer),
  slotPalettes: cloneSlotPalettes(snapshot.slotPalettes),
  gradientDefs: cloneGradientDefs(snapshot.gradientDefs),
  gradientDefStore: cloneGradientDefStore(snapshot.gradientDefStore),
  sources: { ...snapshot.sources },
});

const toByteBuffer = (buffer: ArrayBuffer | undefined): number[] | undefined => (
  buffer ? Array.from(new Uint8Array(buffer)) : undefined
);

const toDefIdBuffer = (buffer: ArrayBuffer | undefined): number[] | undefined => (
  buffer ? Array.from(new Uint16Array(buffer)) : undefined
);

const emptyByteBuffer = (length: number): number[] => new Array<number>(length).fill(0);

export type DocumentSnapshotToGobletBrushStateOptions = {
  gradientStops?: SerializedGradientStops;
  animationOffset?: number;
  animationSpeed?: number;
  targetFPS?: number;
  alphaMode?: WebGLSerializedBrushState['alphaMode'];
  stampDitherEnabled?: boolean;
  palette?: Array<string | number>;
};

export const mapDocumentSnapshotToGobletBrushState = (
  snapshot: ColorCycleLayerDocumentSnapshot,
  options: DocumentSnapshotToGobletBrushStateOptions = {},
): WebGLSerializedBrushState | undefined => {
  const indexBuffer = toByteBuffer(snapshot.paintBuffer);
  if (!indexBuffer || indexBuffer.length === 0) {
    return undefined;
  }

  const pixelCount = Math.max(1, snapshot.width * snapshot.height);
  const gradientStops = options.gradientStops
    ?? snapshot.slotPalettes?.[0]?.stops
    ?? [];

  return {
    width: snapshot.width,
    height: snapshot.height,
    indexBuffer,
    gradientIdBuffer: toByteBuffer(snapshot.gradientIdBuffer),
    gradientDefIdBuffer: toDefIdBuffer(snapshot.gradientDefIdBuffer),
    speedBuffer: toByteBuffer(snapshot.speedBuffer),
    flowBuffer: toByteBuffer(snapshot.flowBuffer) ?? emptyByteBuffer(pixelCount),
    phaseBuffer: toByteBuffer(snapshot.phaseBuffer) ?? emptyByteBuffer(pixelCount),
    gradientStops,
    palette: options.palette,
    animationOffset: options.animationOffset ?? 0,
    animationSpeed: options.animationSpeed ?? snapshot.layerBaseSpeedCps,
    targetFPS: options.targetFPS,
    flowDirection: snapshot.flowMode,
    alphaMode: options.alphaMode ?? 'opaque-indices',
    stampDitherEnabled: options.stampDitherEnabled,
  };
};
