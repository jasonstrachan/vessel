import type { GradientStop } from '@/lib/GradientPalette';
import {
  AUTHORED_SPEED_SOURCE_VERSION,
  type ColorCycleSpeedSourceVersion,
} from '@/lib/colorCycle/persistence/colorCyclePersistenceTypes';
import {
  normalizeGradientSeamProfile,
  type GradientSeamProfile,
} from '@/lib/colorCycle/gradientSeamProfile';
import { getAppStoreState } from '@/stores/appStoreAccess';
import type { ColorCycleGradientDefStoreEntry, ColorCycleSnapshot, DerivedGradientSpec, LayerColorCycleData } from '@/types';
import {
  decodeColorCycleSpeedByte,
  encodeColorCycleSpeedByte,
} from '@/utils/colorCycleSpeed';
import { strokeFinalizeProbeTimeSync } from '@/utils/strokeFinalizeProbe';
import type { ColorCycleLayerDocumentRead } from './ColorCycleLayerDocument';
import type {
  ColorCycleLayerDocumentSnapshot,
  ColorCycleLayerDocumentState,
} from './colorCycleDocumentContract';
import { resolveColorCycleBrushPersistenceOwner } from './brushPersistenceOwnerAlias';
import { recordColorCycleCanonicalBufferCopy } from './canonicalBufferAccounting';

export { registerColorCycleBrushPersistenceOwnerAlias } from './brushPersistenceOwnerAlias';

export type ColorCycleBrushPersistenceBuffers = {
  paint: Uint8Array;
  gid: Uint8Array;
  spd: Uint8Array;
  flow: Uint8Array;
  phase: Uint8Array;
  def: Uint16Array;
};

export type ColorCycleBrushLayerSnapshot = {
  paintBuffer: ArrayBuffer;
  gradientIdBuffer?: ArrayBuffer;
  gradientDefIdBuffer?: ArrayBuffer;
  speedBuffer?: ArrayBuffer;
  speedSourceVersion?: ColorCycleSpeedSourceVersion;
  flowBuffer?: ArrayBuffer;
  phaseBuffer?: ArrayBuffer;
  hasContent: boolean;
  strokeCounter: number;
};

export type ColorCycleLayerStrokeSnapshot = ColorCycleSnapshot['layerStrokes'][number];

export const createEmptyColorCycleBrushLayerSnapshot = (): ColorCycleBrushLayerSnapshot => ({
  paintBuffer: new ArrayBuffer(0),
  gradientIdBuffer: undefined,
  gradientDefIdBuffer: undefined,
  speedBuffer: undefined,
  speedSourceVersion: AUTHORED_SPEED_SOURCE_VERSION,
  flowBuffer: undefined,
  phaseBuffer: undefined,
  hasContent: false,
  strokeCounter: 0,
});

export type ColorCycleBrushPersistenceStrokeState = {
  buffers: ColorCycleBrushPersistenceBuffers;
  snapshot?: ColorCycleBrushLayerSnapshot;
  hasContent: boolean;
  strokeCounter?: number;
};

export type ColorCycleBrushLayerSnapshotMutableStrokeState = ColorCycleBrushPersistenceStrokeState & {
  contentIsOptimistic?: boolean;
  externalBase?: {
    hasExternalBase?: boolean;
  };
  lastPoint?: unknown;
  stampCounter?: number;
  strokePhaseUnits?: number;
  stampDither?: unknown;
};

export type ColorCycleBrushDocumentStateStrokeState = ColorCycleBrushPersistenceStrokeState & {
  flow?: {
    activeSlot?: number;
    mode?: ColorCycleLayerDocumentState['flowMode'];
  };
};

const colorCycleBrushStrokeStatesByOwner = new WeakMap<object, Map<string, ColorCycleBrushPersistenceStrokeState>>();

const getColorCycleBrushStrokeStateMapForOwner = (
  owner: object,
): Map<string, ColorCycleBrushPersistenceStrokeState> => {
  const resolvedOwner = resolveColorCycleBrushPersistenceOwner(owner);
  let strokeStates = colorCycleBrushStrokeStatesByOwner.get(resolvedOwner);
  if (!strokeStates) {
    strokeStates = new Map<string, ColorCycleBrushPersistenceStrokeState>();
    colorCycleBrushStrokeStatesByOwner.set(resolvedOwner, strokeStates);
  }
  return strokeStates;
};

export const getColorCycleBrushStrokeStateForOwner = <
  TStrokeState extends ColorCycleBrushPersistenceStrokeState = ColorCycleBrushPersistenceStrokeState,
>(
  owner: object,
  layerId: string,
): TStrokeState | undefined => (
  colorCycleBrushStrokeStatesByOwner.get(resolveColorCycleBrushPersistenceOwner(owner))?.get(layerId) as TStrokeState | undefined
);

export const hasColorCycleBrushStrokeStateForOwner = (owner: object, layerId: string): boolean => (
  colorCycleBrushStrokeStatesByOwner.get(resolveColorCycleBrushPersistenceOwner(owner))?.has(layerId) ?? false
);

export const setColorCycleBrushStrokeStateForOwner = <
  TStrokeState extends ColorCycleBrushPersistenceStrokeState,
>(
  owner: object,
  layerId: string,
  strokeState: TStrokeState,
): void => {
  getColorCycleBrushStrokeStateMapForOwner(owner).set(layerId, strokeState);
};

export const getColorCycleBrushStrokeStateEntriesForOwner = <
  TStrokeState extends ColorCycleBrushPersistenceStrokeState = ColorCycleBrushPersistenceStrokeState,
>(
  owner: object,
): Array<[string, TStrokeState]> => (
  Array.from(colorCycleBrushStrokeStatesByOwner.get(resolveColorCycleBrushPersistenceOwner(owner))?.entries() ?? []) as Array<[string, TStrokeState]>
);

export const getColorCycleBrushStrokeStateValuesForOwner = <
  TStrokeState extends ColorCycleBrushPersistenceStrokeState = ColorCycleBrushPersistenceStrokeState,
>(
  owner: object,
): TStrokeState[] => (
  Array.from(colorCycleBrushStrokeStatesByOwner.get(resolveColorCycleBrushPersistenceOwner(owner))?.values() ?? []) as TStrokeState[]
);

export const clearColorCycleBrushStrokeStatesForOwner = (owner: object): void => {
  const resolvedOwner = resolveColorCycleBrushPersistenceOwner(owner);
  colorCycleBrushStrokeStatesByOwner.get(resolvedOwner)?.clear();
  colorCycleBrushStrokeStatesByOwner.delete(resolvedOwner);
};

export type ColorCycleBrushPersistenceAnimatorState = {
  indexBuffer?: {
    data?: Uint8Array | ArrayBuffer;
    gradientId?: Uint8Array | ArrayBuffer;
    speedData?: Uint8Array | ArrayBuffer;
    flowData?: Uint8Array | ArrayBuffer;
    phaseData?: Uint8Array | ArrayBuffer;
  };
};

export type ColorCycleBrushPersistenceAnimator = {
  serialize(): ColorCycleBrushPersistenceAnimatorState;
  serializeBaseState?: () => ColorCycleBrushPersistenceAnimatorState;
};

export type ColorCycleBrushPersistenceLayerMeta = {
  gradientDefs?: Array<{ id: string; name?: string; currentSlot: number }>;
  slotPalettes?: Array<{ slot: number; stops: GradientStop[]; seamProfile?: unknown }>;
  gradientDefStore?: Array<{
    id: number;
    kind: 'linear' | 'concentric';
    stops: GradientStop[];
    hash: string;
    source: 'manual' | 'fg' | 'sampled';
    seamProfile?: unknown;
    createdAtMs: number;
    slot?: number;
    speedCps?: number;
  }>;
  nextGradientDefId?: number;
  paintSlot?: number;
  legacyRemap?: { from: number; to: number };
  fgActiveSlot?: number;
  fgDerivedKey?: string;
  fgDerivedGradients?: Array<{
    key: string;
    slot: number;
    spec: DerivedGradientSpec;
  }>;
  derivedGradients?: Array<{
    key: string;
    slot: number;
    spec: DerivedGradientSpec;
  }>;
  activeGradientId?: string;
};

const cloneGradientStops = <T extends { position: number; color: unknown; opacity?: number }>(
  stops: T[] | null | undefined,
): T[] | undefined => (
  Array.isArray(stops) ? stops.map((stop) => ({ ...stop })) : undefined
);

const colorCycleDocumentStopColorToCss = (color: unknown): string => {
  if (typeof color === 'string') {
    return color;
  }
  if (
    color &&
    typeof color === 'object' &&
    'r' in color &&
    'g' in color &&
    'b' in color
  ) {
    const rgb = color as { r: number; g: number; b: number };
    return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  }
  return '#000000';
};

const cloneColorCycleDocumentStops = (
  stops: GradientStop[] | null | undefined,
): Array<{ position: number; color: string; opacity?: number }> | undefined => (
  stops?.map((stop) => ({
    position: stop.position,
    color: colorCycleDocumentStopColorToCss(stop.color),
    opacity: stop.opacity,
  }))
);

export const cloneColorCycleBrushPersistenceLayerMeta = (
  meta?: Partial<ColorCycleBrushPersistenceLayerMeta> | null,
): ColorCycleBrushPersistenceLayerMeta | null => {
  if (!meta) {
    return null;
  }

  const cloned: ColorCycleBrushPersistenceLayerMeta = {
    gradientDefs: meta.gradientDefs
      ? meta.gradientDefs.map((entry) => ({
          id: entry.id,
          name: entry.name,
          currentSlot: entry.currentSlot,
        }))
      : undefined,
    slotPalettes: meta.slotPalettes
      ? meta.slotPalettes.map((entry) => ({
          slot: entry.slot,
          stops: cloneGradientStops(entry.stops) ?? [],
          seamProfile: entry.seamProfile,
        }))
      : undefined,
    gradientDefStore: meta.gradientDefStore
      ? meta.gradientDefStore.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          stops: cloneGradientStops(entry.stops) ?? [],
          hash: entry.hash,
          source: entry.source,
          seamProfile: entry.seamProfile,
          createdAtMs: entry.createdAtMs,
          slot: entry.slot,
          speedCps: entry.speedCps,
        }))
      : undefined,
    nextGradientDefId: meta.nextGradientDefId,
    paintSlot: meta.paintSlot,
    legacyRemap: meta.legacyRemap ? { ...meta.legacyRemap } : undefined,
    fgActiveSlot: meta.fgActiveSlot,
    fgDerivedKey: meta.fgDerivedKey,
    fgDerivedGradients: meta.fgDerivedGradients
      ? meta.fgDerivedGradients.map((entry) => ({
          key: entry.key,
          slot: entry.slot,
          spec: { ...entry.spec },
        }))
      : undefined,
    derivedGradients: meta.derivedGradients
      ? meta.derivedGradients.map((entry) => ({
          key: entry.key,
          slot: entry.slot,
          spec: { ...entry.spec },
        }))
      : undefined,
    activeGradientId: meta.activeGradientId,
  };

  const hasData =
    Boolean(cloned.gradientDefs?.length) ||
    Boolean(cloned.slotPalettes?.length) ||
    Boolean(cloned.gradientDefStore?.length) ||
    typeof cloned.nextGradientDefId === 'number' ||
    typeof cloned.paintSlot === 'number' ||
    Boolean(cloned.legacyRemap) ||
    typeof cloned.fgActiveSlot === 'number' ||
    typeof cloned.fgDerivedKey === 'string' ||
    Boolean(cloned.fgDerivedGradients?.length) ||
    Boolean(cloned.derivedGradients?.length) ||
    typeof cloned.activeGradientId === 'string';

  return hasData ? cloned : null;
};

export const mergeColorCycleBrushPersistenceLayerMeta = (
  persistedMeta: ColorCycleBrushPersistenceLayerMeta | null,
  storeMeta: ColorCycleBrushPersistenceLayerMeta | null,
): ColorCycleBrushPersistenceLayerMeta | null => {
  const persisted = cloneColorCycleBrushPersistenceLayerMeta(persistedMeta);
  const fromStore = cloneColorCycleBrushPersistenceLayerMeta(storeMeta);
  if (!fromStore) {
    return persisted;
  }
  if (!persisted) {
    return fromStore;
  }

  const metadataWeight = (meta: ColorCycleBrushPersistenceLayerMeta | null): number => {
    if (!meta) {
      return 0;
    }
    return (
      (meta.gradientDefs?.length ?? 0) +
      (meta.slotPalettes?.length ?? 0) +
      (meta.gradientDefStore?.length ?? 0) +
      (typeof meta.paintSlot === 'number' ? 1 : 0) +
      (typeof meta.activeGradientId === 'string' && meta.activeGradientId.length > 0 ? 1 : 0) +
      (typeof meta.nextGradientDefId === 'number' ? 1 : 0)
    );
  };
  const primaryMeta = metadataWeight(persisted) > metadataWeight(fromStore)
    ? persisted
    : fromStore;
  const fallbackMeta = primaryMeta === persisted ? fromStore : persisted;
  const mergeByKey = <T, K>(
    primary: T[] | undefined,
    fallback: T[] | undefined,
    getKey: (entry: T) => K | null | undefined,
  ): T[] | undefined => {
    const merged: T[] = [];
    const seen = new Set<K>();
    const append = (entry: T) => {
      const key = getKey(entry);
      if (key === null || typeof key === 'undefined' || seen.has(key)) {
        return;
      }
      seen.add(key);
      merged.push(entry);
    };
    primary?.forEach(append);
    fallback?.forEach(append);
    return merged.length > 0 ? merged : undefined;
  };
  const gradientDefs = mergeByKey(primaryMeta.gradientDefs, fallbackMeta.gradientDefs, (entry) => entry.id);
  const slotPalettes = mergeByKey(primaryMeta.slotPalettes, fallbackMeta.slotPalettes, (entry) => entry.slot);
  const gradientDefStore = mergeByKey(primaryMeta.gradientDefStore, fallbackMeta.gradientDefStore, (entry) => entry.id);
  const hasSlot = (slot: number | undefined): boolean => {
    if (typeof slot !== 'number') {
      return false;
    }
    return Boolean(
      slotPalettes?.some((entry) => entry.slot === slot)
      || gradientDefs?.some((entry) => entry.currentSlot === slot)
      || gradientDefStore?.some((entry) => entry.slot === slot),
    );
  };
  const activeGradientId = [fromStore.activeGradientId, persisted.activeGradientId].find((candidate) => (
    typeof candidate === 'string' &&
    candidate.length > 0 &&
    (gradientDefs?.some((entry) => entry.id === candidate) ?? false)
  ));
  const paintSlot = hasSlot(fromStore.paintSlot)
    ? fromStore.paintSlot
    : hasSlot(persisted.paintSlot)
      ? persisted.paintSlot
      : undefined;
  const nextGradientDefId = Math.max(
    fromStore.nextGradientDefId ?? 0,
    persisted.nextGradientDefId ?? 0,
  ) || undefined;

  return {
    gradientDefs,
    slotPalettes,
    gradientDefStore,
    nextGradientDefId,
    paintSlot,
    legacyRemap: primaryMeta.legacyRemap ?? fallbackMeta.legacyRemap,
    fgActiveSlot: primaryMeta.fgActiveSlot ?? fallbackMeta.fgActiveSlot,
    fgDerivedKey: primaryMeta.fgDerivedKey ?? fallbackMeta.fgDerivedKey,
    fgDerivedGradients: primaryMeta.fgDerivedGradients ?? fallbackMeta.fgDerivedGradients,
    derivedGradients: primaryMeta.derivedGradients ?? fallbackMeta.derivedGradients,
    activeGradientId,
  };
};

export const createColorCycleBrushPersistenceLayerMetaFromLayerData = (
  colorCycleData: LayerColorCycleData | null | undefined,
): ColorCycleBrushPersistenceLayerMeta | null => {
  if (!colorCycleData) {
    return null;
  }

  const seamProfileBySlot = new Map<number, GradientSeamProfile>();
  colorCycleData.gradientDefStore?.forEach((entry) => {
    if (typeof entry.slot === 'number' && !seamProfileBySlot.has(entry.slot)) {
      seamProfileBySlot.set(entry.slot, normalizeGradientSeamProfile(entry.seamProfile));
    }
  });

  return cloneColorCycleBrushPersistenceLayerMeta({
    gradientDefs: colorCycleData.gradientDefs?.map((entry) => ({
      id: entry.id,
      name: entry.name,
      currentSlot: entry.currentSlot,
    })),
    slotPalettes: colorCycleData.slotPalettes?.map((entry) => ({
      slot: entry.slot,
      stops: cloneGradientStops(entry.stops) ?? [],
      seamProfile: entry.seamProfile ?? seamProfileBySlot.get(entry.slot),
    })),
    gradientDefStore: colorCycleData.gradientDefStore?.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      stops: cloneGradientStops(entry.stops) ?? [],
      hash: entry.hash,
      source: entry.source,
      seamProfile: entry.seamProfile,
      createdAtMs: entry.createdAtMs,
      slot: entry.slot,
      speedCps: entry.speedCps,
    })),
    nextGradientDefId: colorCycleData.nextGradientDefId,
    paintSlot: colorCycleData.paintSlot,
    legacyRemap: colorCycleData.legacyRemap,
    fgActiveSlot: colorCycleData.fgActiveSlot,
    fgDerivedKey: colorCycleData.fgDerivedKey,
    fgDerivedGradients: colorCycleData.fgDerivedGradients?.map((entry) => ({
      key: entry.key,
      slot: entry.slot,
      spec: { ...entry.spec },
    })),
    derivedGradients: colorCycleData.derivedGradients?.map((entry) => ({
      key: entry.key,
      slot: entry.slot,
      spec: { ...entry.spec },
    })),
    activeGradientId: colorCycleData.activeGradientId,
  });
};

export class ColorCycleBrushPersistenceMetaCache {
  private readonly persistedMetaByLayer = new Map<string, ColorCycleBrushPersistenceLayerMeta>();

  set(layerId: string, meta?: Partial<ColorCycleBrushPersistenceLayerMeta> | null): void {
    const cloned = cloneColorCycleBrushPersistenceLayerMeta(meta);
    if (!cloned) {
      this.persistedMetaByLayer.delete(layerId);
      return;
    }
    this.persistedMetaByLayer.set(layerId, cloned);
  }

  get(layerId: string): ColorCycleBrushPersistenceLayerMeta | null {
    return cloneColorCycleBrushPersistenceLayerMeta(this.persistedMetaByLayer.get(layerId));
  }

  merge(layerId: string, storeMeta: ColorCycleBrushPersistenceLayerMeta | null): ColorCycleBrushPersistenceLayerMeta | null {
    return mergeColorCycleBrushPersistenceLayerMeta(this.get(layerId), storeMeta);
  }

  clear(): void {
    this.persistedMetaByLayer.clear();
  }
}

const colorCycleBrushPersistenceMetaCaches = new WeakMap<object, ColorCycleBrushPersistenceMetaCache>();

const getColorCycleBrushPersistenceMetaCache = (owner: object): ColorCycleBrushPersistenceMetaCache => {
  const resolvedOwner = resolveColorCycleBrushPersistenceOwner(owner);
  let cache = colorCycleBrushPersistenceMetaCaches.get(resolvedOwner);
  if (!cache) {
    cache = new ColorCycleBrushPersistenceMetaCache();
    colorCycleBrushPersistenceMetaCaches.set(resolvedOwner, cache);
  }
  return cache;
};

export const setColorCycleBrushPersistenceLayerMeta = (
  owner: object,
  layerId: string,
  meta?: Partial<ColorCycleBrushPersistenceLayerMeta> | null,
): void => {
  getColorCycleBrushPersistenceMetaCache(owner).set(layerId, meta);
};

export const mergeColorCycleBrushPersistenceLayerMetaForOwner = (
  owner: object,
  layerId: string,
  storeMeta: ColorCycleBrushPersistenceLayerMeta | null,
): ColorCycleBrushPersistenceLayerMeta | null => (
  getColorCycleBrushPersistenceMetaCache(owner).merge(layerId, storeMeta)
);

export const clearColorCycleBrushPersistenceLayerMetaForOwner = (owner: object): void => {
  const resolvedOwner = resolveColorCycleBrushPersistenceOwner(owner);
  colorCycleBrushPersistenceMetaCaches.get(resolvedOwner)?.clear();
  colorCycleBrushPersistenceMetaCaches.delete(resolvedOwner);
};

export type ColorCycleBrushSerializedLayer = ColorCycleBrushPersistenceLayerMeta & {
  layerId: string;
  data: ColorCycleBrushPersistenceAnimatorState;
  strokeData?: ColorCycleBrushLayerSnapshot;
};

export type ColorCycleBrushSerializedSettings = {
  cycleSpeed: number;
  layerBaseSpeed?: number;
  playbackSpeedScale?: number;
  fps: number;
  brushSize: number;
  ditherEnabled?: boolean;
  ditherStrength?: number;
  ditherPixelSize?: number;
  perceptualDither?: boolean;
  stampShape?: string;
  stampDitherEnabled?: boolean;
  stampDitherPixelSize?: number;
  stampDitherAlgorithm?: string;
  stampDitherPatternStyle?: string;
  stampDitherPatternTileId?: string | null;
  stampDitherPatternTileScale?: number | null;
  stampDitherPatternTileInvert?: boolean | null;
  stampDitherPatternTileThreshold?: number | null;
  stampDitherPatternTileOffsetX?: number | null;
  stampDitherPatternTileOffsetY?: number | null;
  stampDitherBgFill?: boolean;
  stampDitherClears?: boolean;
  stampDitherPressureLinked?: boolean;
  pxlEdgeEnabled?: boolean;
};

export type ColorCycleBrushSerializeSettingsInput = Omit<
  ColorCycleBrushSerializedSettings,
  'stampDitherClears'
>;

export type ColorCycleBrushSerializedState = ColorCycleBrushSerializedSettings & {
  layers: ColorCycleBrushSerializedLayer[];
};

export type ColorCycleBrushPaintPatchExtras = {
  gradientIdBytes?: Uint8Array;
  gradientDefIdBytes?: Uint8Array;
  speedBytes?: Uint8Array;
  flowBytes?: Uint8Array;
  phaseBytes?: Uint8Array;
};

export type ColorCycleBrushPaintPatchResult = {
  x: number;
  y: number;
  width: number;
  height: number;
  hasNonZero: boolean;
};

export type ColorCycleBrushPaintPatchStrokeStateCommit = {
  hasContent: boolean;
  publish: {
    hasContent: boolean;
    strokeCounter: number;
    reason: 'history-restore';
  };
};

export type ExecuteColorCycleBrushPaintPatchAnimatorSyncOptions = {
  patchResult: ColorCycleBrushPaintPatchResult;
  buffers: ColorCycleBrushPersistenceBuffers;
  setDefIdData: (def: Uint16Array) => void;
  setIndexBuffers: (buffers: ColorCycleBrushPersistenceBuffers) => void;
  bindStrokeBuffers: () => void;
  snapshotFromBuffers: () => void;
  markDirtyBounds: (bounds: ColorCycleBrushLayerSnapshotDirtyBounds) => void;
};

export type ExecuteColorCycleBrushPaintPatchRuntimeApplyOptions<
  TStrokeState extends ColorCycleBrushPersistenceStrokeState,
  TAnimator,
> = {
  layerId: string;
  roi: { x: number; y: number; width: number; height: number };
  bytes: Uint8Array;
  extras?: ColorCycleBrushPaintPatchExtras;
  canvasWidth: number;
  canvasHeight: number;
  ensureStrokeState: (layerId: string) => TStrokeState;
  ensureAnimator: (layerId: string) => TAnimator;
  bindStrokeBuffersToAnimator: (strokeState: TStrokeState, animator: TAnimator) => void;
  publishStrokeState: (
    layerId: string,
    strokeState: TStrokeState,
    publish: ColorCycleBrushPaintPatchStrokeStateCommit['publish'],
  ) => void;
  setDefIdData: (animator: TAnimator, def: Uint16Array) => void;
  setIndexBuffers: (animator: TAnimator, buffers: ColorCycleBrushPersistenceBuffers) => void;
  snapshotFromBuffers: (strokeState: TStrokeState) => void;
  markDirtyBounds: (animator: TAnimator, bounds: ColorCycleBrushLayerSnapshotDirtyBounds) => void;
  markLayerDirty: (layerId: string) => void;
};

export type ColorCycleBrushLayerSnapshotRuntimeReader = {
  getColorCycleLayerDocument?(layerId: string): { read(): ColorCycleLayerDocumentRead } | undefined;
};

export type ColorCycleBrushLayerSnapshotRuntimeWriter = object;

type ColorCycleBrushLayerSnapshotRuntime = {
  apply(
    layerId: string,
    snapshot: ColorCycleBrushLayerSnapshotInput,
    animatorIndex?: ColorCycleBrushAnimatorIndexInput,
    reason?: string,
    options?: { suppressClearAudit?: boolean },
  ): void;
};

const colorCycleBrushLayerSnapshotRuntimeByOwner = new WeakMap<
  object,
  ColorCycleBrushLayerSnapshotRuntime
>();

export type ColorCycleBrushSerializedStateRuntimeReader = object;

export type ColorCycleBrushSerializedStateRuntimeWriter = object;

type ColorCycleBrushSerializedStateRuntime = {
  read?: () => unknown;
  restore?: (state?: unknown, options?: unknown) => void;
};

const colorCycleBrushSerializedStateRuntimeByOwner = new WeakMap<
  object,
  ColorCycleBrushSerializedStateRuntime
>();

export type ColorCycleBrushPaintPatchRuntimeWriter = object;

type ColorCycleBrushPaintPatchRuntime = {
  apply(
    layerId: string,
    roi: { x: number; y: number; width: number; height: number },
    bytes: Uint8Array,
    extras?: ColorCycleBrushPaintPatchExtras,
  ): boolean;
};

const colorCycleBrushPaintPatchRuntimeByOwner = new WeakMap<
  object,
  ColorCycleBrushPaintPatchRuntime
>();

export type ColorCycleBrushLayerSnapshotInput = {
  layerId?: string;
  paintBuffer?: ArrayBuffer;
  gradientIdBuffer?: ArrayBuffer;
  gradientDefIdBuffer?: ArrayBuffer;
  speedBuffer?: ArrayBuffer;
  speedSourceVersion?: ColorCycleSpeedSourceVersion;
  flowBuffer?: ArrayBuffer;
  phaseBuffer?: ArrayBuffer;
  hasContent?: boolean;
  strokeCounter?: number;
};

export type NormalizeColorCycleSpeedSourceResult = {
  speedBuffer?: ArrayBuffer;
  speedSourceVersion: typeof AUTHORED_SPEED_SOURCE_VERSION;
  didConvert: boolean;
};

export const normalizeColorCycleSpeedSource = ({
  speedBuffer,
  speedSourceVersion,
  layerBaseSpeedCps,
}: {
  speedBuffer?: ArrayBuffer;
  speedSourceVersion?: ColorCycleSpeedSourceVersion;
  layerBaseSpeedCps: number;
}): NormalizeColorCycleSpeedSourceResult => {
  if (!speedBuffer) {
    return {
      speedBuffer: undefined,
      speedSourceVersion: AUTHORED_SPEED_SOURCE_VERSION,
      didConvert: speedSourceVersion !== AUTHORED_SPEED_SOURCE_VERSION,
    };
  }

  const authoredBytes = speedBuffer.slice(0);
  if (speedSourceVersion === AUTHORED_SPEED_SOURCE_VERSION) {
    return {
      speedBuffer: authoredBytes,
      speedSourceVersion: AUTHORED_SPEED_SOURCE_VERSION,
      didConvert: false,
    };
  }

  const multiplier = Number.isFinite(layerBaseSpeedCps)
    ? Math.max(0, Math.abs(layerBaseSpeedCps))
    : 1;
  if (multiplier > 0 && multiplier !== 1) {
    const bytes = new Uint8Array(authoredBytes);
    for (let index = 0; index < bytes.length; index += 1) {
      const encodedSpeed = bytes[index] ?? 0;
      if (encodedSpeed === 0) {
        continue;
      }
      bytes[index] = encodeColorCycleSpeedByte(
        decodeColorCycleSpeedByte(encodedSpeed) / multiplier,
      );
    }
  }

  return {
    speedBuffer: authoredBytes,
    speedSourceVersion: AUTHORED_SPEED_SOURCE_VERSION,
    didConvert: true,
  };
};

export type ColorCycleBrushAnimatorIndexInput = {
  width?: number;
  height?: number;
  data?: ArrayBuffer;
  gradientIdData?: ArrayBuffer;
  speedData?: ArrayBuffer;
  flowData?: ArrayBuffer;
  phaseData?: ArrayBuffer;
  gradientStops?: GradientStop[];
  gradientDefs?: Array<{ id: string; name?: string; currentSlot: number }>;
  slotPalettes?: Array<{ slot: number; stops: GradientStop[]; seamProfile?: unknown }>;
  activeGradientId?: string;
  paintSlot?: number;
  legacyRemap?: { from: number; to: number };
};

export type ColorCycleBrushDeserializedLayerApplyPlan = {
  layerId: string;
  meta: ColorCycleBrushPersistenceLayerMeta | null;
  snapshot: Required<Pick<ColorCycleBrushLayerSnapshotInput, 'paintBuffer' | 'hasContent' | 'strokeCounter'>> &
    Pick<
      ColorCycleBrushLayerSnapshotInput,
      'gradientIdBuffer' | 'gradientDefIdBuffer' | 'speedBuffer' | 'speedSourceVersion' | 'flowBuffer' | 'phaseBuffer'
    >;
  animatorIndex?: ColorCycleBrushAnimatorIndexInput;
};

export type ColorCycleBrushRestoreState = {
  cycleSpeed?: number;
  layerBaseSpeed?: number;
  playbackSpeedScale?: number;
  fps?: number;
  brushSize?: number;
  layerSnapshots?: Map<string, ArrayBuffer> | Array<ColorCycleBrushLayerSnapshotInput & {
    layerId?: string;
    animatorIndex?: ColorCycleBrushAnimatorIndexInput;
  }>;
  ditherEnabled?: boolean;
  ditherStrength?: number;
  ditherPixelSize?: number;
  perceptualDither?: boolean;
  stampShape?: string;
  stampDitherEnabled?: boolean;
  stampDitherPixelSize?: number;
  stampDitherAlgorithm?: string;
  stampDitherPatternStyle?: string;
  stampDitherPatternTileId?: string | null;
  stampDitherPatternTileScale?: number | null;
  stampDitherPatternTileInvert?: boolean | null;
  stampDitherPatternTileThreshold?: number | null;
  stampDitherPatternTileOffsetX?: number | null;
  stampDitherPatternTileOffsetY?: number | null;
  stampDitherBgFill?: boolean;
  stampDitherClears?: boolean;
  stampDitherPressureLinked?: boolean;
  pxlEdgeEnabled?: boolean;
};

export type ColorCycleBrushDeserializeSettingsPatch = {
  cycleSpeed?: number;
  layerBaseSpeed?: number;
  playbackSpeedScale?: number;
  fps?: number;
  brushSize?: number;
  ditherEnabled?: boolean;
  ditherStrength?: number;
  ditherPixelSize?: number;
  perceptualDither?: boolean;
  stampShape?: 'triangle' | 'square' | 'diamond' | 'diamond5' | 'diamond7' | 'diamond9' | 'round' | 'checkered';
  stampDitherEnabled?: boolean;
  stampDitherPixelSize?: number;
  stampDitherAlgorithm?: string;
  stampDitherPatternStyle?: string;
  stampDitherPatternTileId?: string | null;
  stampDitherPatternTileScale?: number | null;
  stampDitherPatternTileInvert?: boolean | null;
  stampDitherPatternTileThreshold?: number | null;
  stampDitherPatternTileOffsetX?: number | null;
  stampDitherPatternTileOffsetY?: number | null;
  stampDitherBgFill?: boolean;
  stampDitherPressureLinked?: boolean;
  pxlEdgeEnabled?: boolean;
};

export type ColorCycleBrushRestoreLayerClearPlan = {
  layerId: string;
  incomingSnapshot: { paintBuffer?: ArrayBuffer } | ArrayBuffer | null | undefined;
  blockedByCanonicalPayload: boolean;
};

export type ColorCycleBrushRestoreBlockedClearAuditDetails = {
  source: 'project-load';
  snapshotReason: 'project-load-restore';
  existingHasContent: boolean | null;
  brushStateHasPayload: boolean;
};

export type ColorCycleBrushRestoreBlockedClearAuditPlan = {
  severity: 'warn' | 'error';
  details: ColorCycleBrushRestoreBlockedClearAuditDetails;
};

export type CreateColorCycleBrushRestoreBlockedClearAuditPlanOptions = {
  existingHasContent: boolean | null;
  brushStateHasPayload: boolean;
};

export type ColorCycleBrushRestoreLayerApplyPlan = {
  layerId: string;
  snapshot: ColorCycleBrushLayerSnapshotInput;
  animatorIndex?: ColorCycleBrushAnimatorIndexInput;
  reason: 'history-restore' | 'project-load-restore';
};

export type ColorCycleBrushFullStateRestorePlan = {
  asHistory: boolean;
  shouldAssertNoClear: boolean;
  settings: ColorCycleBrushRestoreState;
  clearOperations: ColorCycleBrushRestoreLayerClearPlan[];
  shouldClearComposite: boolean;
  applyOperations: ColorCycleBrushRestoreLayerApplyPlan[];
  highestStrokeCounter: number | null;
};

export type ExecuteColorCycleBrushFullStateRestorePlanOptions = {
  plan: ColorCycleBrushFullStateRestorePlan;
  applySettings: (settings: ColorCycleBrushRestoreState) => void;
  applyLegacyStampDitherClears?: (clears: boolean) => void;
  logBlockedClear: (operation: ColorCycleBrushRestoreLayerClearPlan) => void;
  clearLayer: (operation: ColorCycleBrushRestoreLayerClearPlan) => void;
  clearComposite: () => void;
  applyLayerSnapshot: (operation: ColorCycleBrushRestoreLayerApplyPlan) => void;
  setHighestStrokeCounter: (strokeCounter: number) => void;
  assertNoClear?: (clearedDuringRestore: boolean) => void;
};

export type ColorCycleCommittedLayerStoreSyncPatch = {
  gradientIdBuffer?: ArrayBuffer;
  gradientDefIdBuffer?: ArrayBuffer;
};

export type CreateColorCycleCommittedLayerStoreSyncPatchOptions = {
  snapshot: Pick<ColorCycleBrushLayerSnapshot, 'gradientIdBuffer' | 'gradientDefIdBuffer'> | null | undefined;
  documentSnapshot?: {
    gradientIdBuffer?: ArrayBufferLike;
    gradientDefIdBuffer?: ArrayBufferLike;
  } | null;
};

export type ColorCycleCommittedGradientSlotRemapOptions = {
  indexData?: Uint8Array | null;
  gidData?: Uint8Array | null;
  width: number;
  height: number;
  fromSlot: number;
  toSlot: number;
  flowSlotMask: number;
  bbox?: { minX: number; minY: number; width: number; height: number };
};

export type ColorCycleCommittedGradientSlotRemapResult = {
  x: number;
  y: number;
  width: number;
  height: number;
} | null;

export type BindColorCycleCommittedGradientDefToSlotOptions = {
  buffers: ColorCycleBrushPersistenceBuffers;
  canvasWidth: number;
  canvasHeight: number;
  defId: number;
  slot: number;
  flowSlotMask: number;
  bbox?: { minX: number; minY: number; width: number; height: number };
  previewSlot?: number | null;
  trackPreviewLeak?: boolean;
};

export type BindColorCycleCommittedGradientDefToSlotResult = {
  leftoverPreview: number;
  effectivePreviewSlot: number | null;
  committedSlot: number;
};

export type ColorCycleCommittedLayerStateOptions = {
  layerId: string;
  targetCanvas?: HTMLCanvasElement | null;
  opacity?: number;
  binding?: {
    defId: number;
    slot: number;
    bbox?: { minX: number; minY: number; width: number; height: number };
    previewSlot?: number | null;
  };
};

export type ExecuteColorCycleCommittedLayerStateOptions = {
  options: ColorCycleCommittedLayerStateOptions;
  bindGradientDefIdToSlot: (
    layerId: string,
    defId: number,
    slot: number,
    bbox?: { minX: number; minY: number; width: number; height: number },
    previewSlot?: number | null,
  ) => void;
  syncCommittedBuffersToLayerStore: (layerId: string) => void;
  commitToLayer: (targetCanvas: HTMLCanvasElement, layerId: string, opacity: number) => void;
  renderDirectToCanvas: (targetCanvas: HTMLCanvasElement, layerId: string) => void;
};

export type ColorCycleCommittedLayerRuntimeRead = {
  dimensions: { width: number; height: number };
  indexData: Uint8Array;
  gradientIdData: Uint8Array;
};

export type ColorCycleCommittedLayerRuntime = {
  bindGradientDefIdToSlot?: (
    layerId: string,
    defId: number,
    slot: number,
    bbox?: { minX: number; minY: number; width: number; height: number },
    previewSlot?: number | null,
  ) => void;
  commitToLayer?: (targetCanvas: HTMLCanvasElement, layerId: string, opacity?: number) => void;
  renderDirectToCanvas?: (targetCanvas: HTMLCanvasElement, layerId: string) => void;
  getColorCycleLayerDocument?: (layerId: string) => { read(): ColorCycleLayerDocumentRead } | undefined;
};

export type ColorCycleBrushLayerSnapshotApplyResult = {
  hasLayerContent: boolean;
  selectedPaintHasContent: boolean;
  isExplicitEmptySnapshot: boolean;
  uploadPaint: Uint8Array;
  uploadGradientId: Uint8Array;
  uploadSpeed: Uint8Array;
  uploadFlow: Uint8Array;
  uploadPhase: Uint8Array;
  nextSnapshot: ColorCycleBrushLayerSnapshot;
};

export type CommitColorCycleBrushLayerSnapshotApplyResultOptions = {
  strokeState: ColorCycleBrushLayerSnapshotMutableStrokeState;
  snapshot: ColorCycleBrushLayerSnapshotInput;
  applyResult: ColorCycleBrushLayerSnapshotApplyResult;
  reason: string;
};

export type ColorCycleBrushLayerSnapshotStrokeStateCommit = {
  publish: {
    reason: string;
    hasContent: boolean;
    strokeCounter: number;
  };
};

export type ColorCycleBrushRestoreClearStrokeStateResult = {
  hasContent: false;
  strokeCounter: 0;
};

export type ExecuteColorCycleBrushLayerSnapshotAnimatorSyncOptions = {
  applyResult: ColorCycleBrushLayerSnapshotApplyResult;
  setIndexBuffers: (applyResult: ColorCycleBrushLayerSnapshotApplyResult) => void;
  bindStrokeBuffers: () => void;
  applyDefBindings: () => void;
  snapshotFromBuffers: () => void;
  getAnimatorDimensions: () => ColorCycleBrushLayerSnapshotAnimatorDimensions | null | undefined;
  markDirtyBounds: (bounds: ColorCycleBrushLayerSnapshotDirtyBounds) => void;
};

export type ColorCycleBrushLayerSnapshotRuntimeRestoreAction = {
  kind: ColorCycleBrushLayerSnapshotRestoreActionKind;
  snapshot?: ColorCycleBrushLayerSnapshotInput;
  animatorIndex?: ColorCycleBrushAnimatorIndexInput;
} | null;

export type ExecuteColorCycleBrushLayerSnapshotRuntimeApplyOptions<
  TStrokeState extends ColorCycleBrushLayerSnapshotMutableStrokeState,
  TAnimator,
  TAuditSnapshot,
> = {
  layerId: string;
  snapshot: ColorCycleBrushLayerSnapshotInput;
  animatorIndex?: ColorCycleBrushAnimatorIndexInput;
  reason: string;
  suppressClearAudit?: boolean;
  canvasWidth: number;
  canvasHeight: number;
  flowSlotMask: number;
  getExistingStrokeState: (layerId: string) => TStrokeState | undefined;
  hasCanonicalPaintPayload: (layerId: string) => boolean;
  resolveRestoreAction: (operation: {
    layerId: string;
    applyPlan: ColorCycleBrushLayerSnapshotApplyPlan;
    snapshot: ColorCycleBrushLayerSnapshotInput;
    projectLoadRestore: boolean;
  }) => ColorCycleBrushLayerSnapshotRuntimeRestoreAction;
  brushStateHasPaintPayload: (layerId: string) => boolean;
  logBlockedWrite: (operation: {
    layerId: string;
    severity: ColorCycleBrushLayerSnapshotRestoreGuard['blockedSeverity'];
    details: ColorCycleBrushLayerSnapshotBlockedAuditDetails;
  }) => void;
  applyRecoveredSnapshot: (operation: {
    layerId: string;
    snapshot: ColorCycleBrushLayerSnapshotInput;
    animatorIndex?: ColorCycleBrushAnimatorIndexInput;
    reason: string;
  }) => void;
  ensureAnimator: (layerId: string) => TAnimator | null | undefined;
  resizeAnimator: (animator: TAnimator, width: number, height: number) => void;
  createStrokeState: (options: { hasContent: boolean; bufferSize: number }) => TStrokeState;
  captureAuditSnapshot: (layerId: string, strokeState: TStrokeState | undefined) => TAuditSnapshot | null;
  getFallbackAnimationPlanOptions: (layerId: string) => CreateColorCycleBrushLayerSnapshotFallbackAnimationPlanOptions;
  encodeFallbackSpeedByte: (speed: number) => number;
  encodeFallbackFlowByte: (flowMode: ColorCycleBrushLayerSnapshotFallbackFlowMode) => number;
  applySlotPalette: (slot: number, stops: GradientStop[], seamProfile?: unknown) => void;
  applyActiveGradientSlot: (slot: number) => void;
  publishStrokeState: (
    layerId: string,
    strokeState: TStrokeState,
    publish: ColorCycleBrushLayerSnapshotStrokeStateCommit['publish'],
  ) => void;
  recordClearAudit: (operation: {
    layerId: string;
    reason: string;
    source: ColorCycleBrushLayerSnapshotClearAuditPlan['source'];
    expectedDestructive: boolean;
    before: TAuditSnapshot | null;
    after: TAuditSnapshot | null;
  }) => void;
  setIndexBuffers: (animator: TAnimator | null | undefined, result: ColorCycleBrushLayerSnapshotApplyResult) => void;
  bindStrokeBuffersToAnimator: (strokeState: TStrokeState, animator: TAnimator | null | undefined) => void;
  applyDefBindings: (layerId: string, animator: TAnimator | null | undefined, strokeState: TStrokeState) => void;
  snapshotFromBuffers: (strokeState: TStrokeState) => void;
  getAnimatorDimensions: (animator: TAnimator | null | undefined) => ColorCycleBrushLayerSnapshotAnimatorDimensions | null | undefined;
  markDirtyBounds: (animator: TAnimator | null | undefined, bounds: ColorCycleBrushLayerSnapshotDirtyBounds) => void;
  markLayerDirty: (layerId: string) => void;
};

export type ColorCycleBrushLayerSnapshotApplyPlan = {
  paintBuffer: ArrayBuffer;
  paintByteLength: number;
  selectedPaintHasContent: boolean;
  expectsContent: boolean;
  shouldAuditPotentialClear: boolean;
  shouldBlockPotentialClear: boolean;
  mutationSource: 'history' | 'project-load' | 'snapshot';
};

export const createColorCycleRuntimeRestoreIncomingSnapshot = ({
  applyPlan,
  snapshot,
}: {
  applyPlan: Pick<ColorCycleBrushLayerSnapshotApplyPlan, 'paintBuffer'>;
  snapshot: { hasContent?: boolean };
}): { paintBuffer: ArrayBuffer; hasContent?: boolean } => ({
  paintBuffer: applyPlan.paintBuffer,
  hasContent: snapshot.hasContent,
});

export type ColorCycleBrushLayerSnapshotBlockedAuditDetails = {
  source: 'snapshot';
  snapshotReason: string;
  paintBufferBytes: number;
  paintBufferNonZero: boolean;
  snapshotHasContent: boolean | null;
  existingHasContent: boolean;
  brushStateHasPayload: boolean;
  restoredFromCanonicalBrushState?: boolean;
};

export type ColorCycleBrushLayerSnapshotRestoreActionKind =
  | 'apply'
  | 'recover-from-canonical'
  | 'allow-empty'
  | 'block'
  | null
  | undefined;

export type ColorCycleBrushLayerSnapshotRestoreGuard = {
  blocksEmptySnapshot: boolean;
  shouldLogBlockedWrite: boolean;
  shouldRecoverFromCanonical: boolean;
  blockedSeverity: 'warn' | 'error';
};

export type ColorCycleBrushLayerSnapshotClearAuditPlan = {
  source: 'history' | 'project-load' | 'snapshot';
  expectedDestructive: boolean;
};

export type ColorCycleBrushLayerSnapshotAnimatorSizingPlan = {
  expectedSize: number;
  shouldResizeAnimator: boolean;
  width: number;
  height: number;
};

export type ColorCycleBrushLayerSnapshotDirtyBounds = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

export type ColorCycleBrushLayerSnapshotAnimatorDimensions = {
  width: number;
  height: number;
};

export type ColorCycleBrushLayerSnapshotFallbackFlowMode = 'forward' | 'reverse' | 'pingpong';

export type ColorCycleBrushLayerSnapshotFallbackAnimationPlan = {
  speed: number;
  flowMode: ColorCycleBrushLayerSnapshotFallbackFlowMode;
};

export type CreateColorCycleBrushLayerSnapshotRestoreGuardOptions = {
  reason: string;
  suppressClearAudit?: boolean;
  restoreActionKind?: ColorCycleBrushLayerSnapshotRestoreActionKind;
};

export type CreateColorCycleBrushLayerSnapshotAnimatorSizingPlanOptions = {
  applyPlan: ColorCycleBrushLayerSnapshotApplyPlan;
  width: number;
  height: number;
};

export type CreateColorCycleBrushLayerSnapshotFallbackAnimationPlanOptions = {
  layerBaseSpeed?: number | null;
  toolSpeed?: number | null;
  layerFlowMode?: ColorCycleBrushLayerSnapshotFallbackFlowMode | null;
  brushFlowMode?: ColorCycleBrushLayerSnapshotFallbackFlowMode | null;
  defaultSpeed?: number;
  defaultFlowMode?: ColorCycleBrushLayerSnapshotFallbackFlowMode;
};

export type CreateColorCycleBrushLayerSnapshotClearAuditPlanOptions = {
  applyPlan: ColorCycleBrushLayerSnapshotApplyPlan;
  hasLayerContent: boolean;
};

export type CreateColorCycleBrushLayerSnapshotBlockedAuditDetailsOptions = {
  applyPlan: ColorCycleBrushLayerSnapshotApplyPlan;
  snapshot: ColorCycleBrushLayerSnapshotInput;
  reason: string;
  existingHasContent: boolean;
  brushStateHasPayload: boolean;
  paintBufferNonZero?: boolean;
  restoredFromCanonicalBrushState?: boolean;
};

export type ColorCycleBrushLayerSnapshotMetadataPlan = {
  slotPalettes: Array<{ slot: number; stops: GradientStop[]; seamProfile?: unknown }>;
  activeGradientSlot?: number;
};

export type ExecuteColorCycleBrushLayerSnapshotMetadataPlanOptions = {
  plan: ColorCycleBrushLayerSnapshotMetadataPlan;
  applySlotPalette: (
    slot: number,
    stops: GradientStop[],
    seamProfile?: unknown,
  ) => void;
  applyActiveGradientSlot: (slot: number) => void;
};

export type SerializeColorCycleBrushStateOptions = {
  animators: Map<string, ColorCycleBrushPersistenceAnimator>;
  getStrokeState: (layerId: string) => ColorCycleBrushPersistenceStrokeState | undefined;
  getDocumentRead?: (layerId: string) => ColorCycleLayerDocumentRead | undefined;
  ensureStrokeSnapshot: (strokeState: ColorCycleBrushPersistenceStrokeState) => void;
  hasPaintContent: (paintBuffer: ArrayBuffer | undefined) => boolean;
  hasStrokeContent: (strokeState: ColorCycleBrushPersistenceStrokeState) => boolean;
  getLayerMeta: (layerId: string) => ColorCycleBrushPersistenceLayerMeta | null;
  getFallbackStrokeCounter: () => number;
  settings: ColorCycleBrushSerializedSettings;
};

export type CreateColorCycleLayerDocumentStateFromStrokeStateOptions = {
  layerId: string;
  width: number;
  height: number;
  strokeState: ColorCycleBrushDocumentStateStrokeState;
  meta?: ColorCycleBrushPersistenceLayerMeta | null;
  layerBaseSpeedCps?: number;
  flowMode?: ColorCycleLayerDocumentState['flowMode'];
  hasStrokeContent: (strokeState: ColorCycleBrushDocumentStateStrokeState) => boolean;
  bufferOwnership?: 'borrow' | 'clone';
};

export type CreateEmptyColorCycleLayerDocumentStateOptions = {
  layerId: string;
  width: number;
  height: number;
};

export const colorCycleBrushSnapshotHasPaintPayload = (
  snapshot: { paintBuffer?: ArrayBuffer; hasContent?: boolean } | ArrayBuffer | null | undefined,
): boolean => {
  if (snapshot instanceof ArrayBuffer) {
    return snapshot.byteLength > 0;
  }
  if (snapshot?.hasContent === true) {
    return true;
  }
  const buffer = snapshot?.paintBuffer;
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
    return false;
  }
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0) {
      return true;
    }
  }
  return false;
};

const cloneUint8Buffer = (
  source: ArrayBuffer | Uint8Array | null | undefined,
): ArrayBuffer | undefined => {
  if (!source) {
    return undefined;
  }
  return (source instanceof Uint8Array ? source : new Uint8Array(source)).slice().buffer as ArrayBuffer;
};

const cloneUint16Buffer = (
  source: ArrayBuffer | Uint16Array | null | undefined,
): ArrayBuffer | undefined => {
  if (!source) {
    return undefined;
  }
  return (source instanceof Uint16Array ? source : new Uint16Array(source)).slice().buffer as ArrayBuffer;
};

type ColorCycleBrushSerializedLayerAnimatorData = ColorCycleBrushPersistenceAnimatorState & {
  gradient?: {
    gradientStops?: GradientStop[];
  };
  indexBuffer?: {
    width?: unknown;
    height?: unknown;
    data?: ArrayBuffer | Uint8Array;
    gradientId?: ArrayBuffer | Uint8Array;
    speedData?: ArrayBuffer | Uint8Array;
    flowData?: ArrayBuffer | Uint8Array;
    phaseData?: ArrayBuffer | Uint8Array;
  };
};

export type ColorCycleHistoryLayerStrokeSnapshot = {
  layerId: string;
  paintBuffer: ArrayBuffer;
  gradientIdBuffer?: ArrayBuffer;
  gradientDefIdBuffer?: ArrayBuffer;
  speedBuffer?: ArrayBuffer;
  flowBuffer?: ArrayBuffer;
  phaseBuffer?: ArrayBuffer;
  smoothPhaseBuffer?: ArrayBuffer;
  smoothFlagsBuffer?: ArrayBuffer;
  hasContent: boolean;
  strokeCounter: number;
  strokeLength: number;
  gradientLayerIndices: number[];
  currentGradientIndex: number;
  animatorIndex?: {
    width?: unknown;
    height?: unknown;
    data: ArrayBuffer;
    gradientIdData?: ArrayBuffer;
    gradientDefs?: ColorCycleBrushSerializedLayer['gradientDefs'];
    slotPalettes?: ColorCycleBrushSerializedLayer['slotPalettes'];
    activeGradientId?: ColorCycleBrushSerializedLayer['activeGradientId'];
    gradientStops?: GradientStop[];
  };
};

const createUint8View = (source: ArrayBuffer | Uint8Array | undefined): Uint8Array | null => {
  if (!source) {
    return null;
  }
  return source instanceof Uint8Array ? source : new Uint8Array(source);
};

export const createColorCycleHistoryLayerStrokeSnapshot = (
  layer: ColorCycleBrushSerializedLayer,
): ColorCycleHistoryLayerStrokeSnapshot => {
  const animatorData = layer.data as ColorCycleBrushSerializedLayerAnimatorData | undefined;
  const indexBuffer = animatorData?.indexBuffer;
  const indexArray = createUint8View(indexBuffer?.data);
  const hasNonZeroIndex = indexArray ? indexArray.some((value) => value !== 0) : false;
  const paintBuffer = cloneUint8Buffer(layer.strokeData?.paintBuffer) ?? new ArrayBuffer(0);

  const animatorIndex = indexBuffer
    ? {
        width: indexBuffer.width,
        height: indexBuffer.height,
        data: (indexArray ? indexArray.slice() : new Uint8Array()).buffer as ArrayBuffer,
        gradientIdData: cloneUint8Buffer(indexBuffer.gradientId)
          ?? new Uint8Array(
            (typeof indexBuffer.width === 'number' ? indexBuffer.width : 0) *
              (typeof indexBuffer.height === 'number' ? indexBuffer.height : 0)
          ).buffer as ArrayBuffer,
        gradientDefs: layer.gradientDefs
          ? layer.gradientDefs.map((entry) => ({
              id: entry.id,
              name: entry.name,
              currentSlot: entry.currentSlot,
            }))
          : undefined,
        slotPalettes: layer.slotPalettes
          ? layer.slotPalettes.map((entry) => ({
              slot: entry.slot,
              stops: entry.stops.map((stop) => ({ position: stop.position, color: stop.color })),
            }))
          : undefined,
        activeGradientId: layer.activeGradientId,
        gradientStops: animatorData?.gradient?.gradientStops || undefined,
      }
    : undefined;

  return {
    layerId: layer.layerId,
    paintBuffer,
    gradientIdBuffer: cloneUint8Buffer(layer.strokeData?.gradientIdBuffer),
    gradientDefIdBuffer: cloneUint16Buffer(layer.strokeData?.gradientDefIdBuffer),
    speedBuffer: cloneUint8Buffer(layer.strokeData?.speedBuffer),
    flowBuffer: cloneUint8Buffer(layer.strokeData?.flowBuffer),
    phaseBuffer: cloneUint8Buffer(layer.strokeData?.phaseBuffer),
    hasContent: Boolean(layer.strokeData?.hasContent) || hasNonZeroIndex,
    strokeCounter: layer.strokeData?.strokeCounter ?? 0,
    strokeLength: 0,
    gradientLayerIndices: [],
    currentGradientIndex: 0,
    animatorIndex,
  };
};

const COLOR_CYCLE_DESERIALIZE_STAMP_SHAPES = new Set<ColorCycleBrushDeserializeSettingsPatch['stampShape']>([
  'triangle',
  'square',
  'diamond',
  'diamond5',
  'diamond7',
  'diamond9',
  'round',
  'checkered',
]);

export const createColorCycleBrushDeserializeSettingsPatch = (
  data: ColorCycleBrushRestoreState,
): ColorCycleBrushDeserializeSettingsPatch => {
  const patch: ColorCycleBrushDeserializeSettingsPatch = {};
  if (typeof data.cycleSpeed === 'number') {
    patch.cycleSpeed = data.cycleSpeed;
  }
  if (typeof data.layerBaseSpeed === 'number') {
    patch.layerBaseSpeed = data.layerBaseSpeed;
  }
  if (typeof data.playbackSpeedScale === 'number') {
    patch.playbackSpeedScale = data.playbackSpeedScale;
  }
  if (typeof data.fps === 'number') {
    patch.fps = data.fps;
  }
  if (typeof data.brushSize === 'number') {
    patch.brushSize = data.brushSize;
  }
  if (typeof data.ditherEnabled === 'boolean') {
    patch.ditherEnabled = data.ditherEnabled;
  }
  if (typeof data.ditherStrength === 'number') {
    patch.ditherStrength = data.ditherStrength;
  }
  if (typeof data.ditherPixelSize === 'number') {
    patch.ditherPixelSize = data.ditherPixelSize;
  }
  if (typeof data.perceptualDither === 'boolean') {
    patch.perceptualDither = data.perceptualDither;
  }
  if (COLOR_CYCLE_DESERIALIZE_STAMP_SHAPES.has(data.stampShape as ColorCycleBrushDeserializeSettingsPatch['stampShape'])) {
    patch.stampShape = data.stampShape as ColorCycleBrushDeserializeSettingsPatch['stampShape'];
  }
  if (typeof data.stampDitherEnabled === 'boolean') {
    patch.stampDitherEnabled = data.stampDitherEnabled;
  }
  if (typeof data.stampDitherPixelSize === 'number') {
    patch.stampDitherPixelSize = data.stampDitherPixelSize;
  }
  if (typeof data.stampDitherAlgorithm === 'string') {
    patch.stampDitherAlgorithm = data.stampDitherAlgorithm;
  }
  if (typeof data.stampDitherPatternStyle === 'string') {
    patch.stampDitherPatternStyle = data.stampDitherPatternStyle;
  }
  patch.stampDitherPatternTileId = data.stampDitherPatternTileId;
  patch.stampDitherPatternTileScale = data.stampDitherPatternTileScale;
  patch.stampDitherPatternTileInvert = data.stampDitherPatternTileInvert;
  patch.stampDitherPatternTileThreshold = data.stampDitherPatternTileThreshold;
  patch.stampDitherPatternTileOffsetX = data.stampDitherPatternTileOffsetX;
  patch.stampDitherPatternTileOffsetY = data.stampDitherPatternTileOffsetY;
  if (typeof data.stampDitherBgFill === 'boolean') {
    patch.stampDitherBgFill = data.stampDitherBgFill;
  } else if (typeof data.stampDitherClears === 'boolean') {
    patch.stampDitherBgFill = !data.stampDitherClears;
  }
  if (typeof data.stampDitherPressureLinked === 'boolean') {
    patch.stampDitherPressureLinked = data.stampDitherPressureLinked;
  }
  if (typeof data.pxlEdgeEnabled === 'boolean') {
    patch.pxlEdgeEnabled = data.pxlEdgeEnabled;
  }
  return patch;
};

export const createColorCycleBrushSerializeSettings = (
  settings: ColorCycleBrushSerializeSettingsInput,
): ColorCycleBrushSerializedSettings => ({
  ...settings,
  stampDitherClears: typeof settings.stampDitherBgFill === 'boolean'
    ? !settings.stampDitherBgFill
    : undefined,
});

export const createColorCycleBrushDeserializeLayerApplyPlans = (
  layers: ColorCycleBrushSerializedLayer[] | null | undefined,
): ColorCycleBrushDeserializedLayerApplyPlan[] => {
  if (!layers?.length) {
    return [];
  }

  return layers.map((layer) => {
    const strokeData = layer.strokeData;
    const clonedBuffer = cloneUint8Buffer(strokeData?.paintBuffer) ?? new Uint8Array(0).buffer as ArrayBuffer;
    const animatorData = layer.data as ColorCycleBrushSerializedLayerAnimatorData | undefined;
    const indexBuffer = animatorData?.indexBuffer;
    const animatorIndex = (
      indexBuffer &&
      typeof indexBuffer.width === 'number' &&
      typeof indexBuffer.height === 'number'
    )
      ? {
          width: indexBuffer.width,
          height: indexBuffer.height,
          data: cloneUint8Buffer(indexBuffer.data) ?? new Uint8Array().buffer as ArrayBuffer,
          gradientIdData: cloneUint8Buffer(indexBuffer.gradientId),
          speedData: cloneUint8Buffer(indexBuffer.speedData),
          flowData: cloneUint8Buffer(indexBuffer.flowData),
          phaseData: cloneUint8Buffer(indexBuffer.phaseData),
          gradientStops: animatorData?.gradient?.gradientStops ?? undefined,
          gradientDefs: layer.gradientDefs,
          slotPalettes: layer.slotPalettes,
          activeGradientId: layer.activeGradientId,
          paintSlot: layer.paintSlot,
          legacyRemap: layer.legacyRemap,
        }
      : undefined;

    return {
      layerId: layer.layerId,
      meta: cloneColorCycleBrushPersistenceLayerMeta(layer),
      snapshot: {
        paintBuffer: clonedBuffer,
        gradientIdBuffer: cloneUint8Buffer(strokeData?.gradientIdBuffer),
        gradientDefIdBuffer: cloneUint16Buffer(strokeData?.gradientDefIdBuffer),
        speedBuffer: cloneUint8Buffer(strokeData?.speedBuffer),
        speedSourceVersion: strokeData?.speedSourceVersion,
        flowBuffer: cloneUint8Buffer(strokeData?.flowBuffer),
        phaseBuffer: cloneUint8Buffer(strokeData?.phaseBuffer),
        hasContent: Boolean(strokeData?.hasContent) || clonedBuffer.byteLength > 0,
        strokeCounter: strokeData?.strokeCounter ?? 0,
      },
      animatorIndex,
    };
  });
};

export const createColorCycleBrushFullStateRestorePlan = ({
  state,
  asHistory,
  currentStrokeCounter,
  isProduction,
  hasCanonicalPaintPayload,
}: {
  state: ColorCycleBrushRestoreState;
  asHistory: boolean;
  currentStrokeCounter: number;
  isProduction: boolean;
  hasCanonicalPaintPayload: (layerId: string) => boolean;
}): ColorCycleBrushFullStateRestorePlan => {
  const layerSnapshots = state.layerSnapshots;
  const clearOperations: ColorCycleBrushRestoreLayerClearPlan[] = [];
  const applyOperations: ColorCycleBrushRestoreLayerApplyPlan[] = [];
  let highestStrokeCounter = asHistory ? 0 : currentStrokeCounter;
  const reason = asHistory ? 'history-restore' : 'project-load-restore';

  if (layerSnapshots && !asHistory) {
    const pushClear = (
      layerId: string,
      incomingSnapshot: { paintBuffer?: ArrayBuffer } | ArrayBuffer | null | undefined,
    ): void => {
      clearOperations.push({
        layerId,
        incomingSnapshot,
        blockedByCanonicalPayload:
          !colorCycleBrushSnapshotHasPaintPayload(incomingSnapshot) &&
          hasCanonicalPaintPayload(layerId),
      });
    };

    if (layerSnapshots instanceof Map) {
      layerSnapshots.forEach((buffer, layerId) => pushClear(layerId, buffer));
    } else if (Array.isArray(layerSnapshots)) {
      for (const snapshot of layerSnapshots) {
        if (snapshot?.layerId) {
          pushClear(snapshot.layerId, snapshot);
        }
      }
    }
  }

  if (layerSnapshots) {
    if (layerSnapshots instanceof Map) {
      layerSnapshots.forEach((buffer, layerId) => {
        applyOperations.push({
          layerId,
          snapshot: {
            paintBuffer: buffer,
            gradientIdBuffer: undefined,
            hasContent: colorCycleBrushSnapshotHasPaintPayload(buffer),
            strokeCounter: 0,
          },
          reason,
        });
      });
    } else if (Array.isArray(layerSnapshots)) {
      layerSnapshots.forEach((snapshot) => {
        if (!snapshot?.layerId) {
          return;
        }
        if (typeof snapshot.strokeCounter === 'number') {
          highestStrokeCounter = Math.max(highestStrokeCounter, snapshot.strokeCounter);
        }
        applyOperations.push({
          layerId: snapshot.layerId,
          snapshot: {
            paintBuffer: snapshot.paintBuffer ?? new ArrayBuffer(0),
            gradientIdBuffer: snapshot.gradientIdBuffer,
            gradientDefIdBuffer: snapshot.gradientDefIdBuffer,
            speedBuffer: snapshot.speedBuffer,
            speedSourceVersion: snapshot.speedSourceVersion,
            flowBuffer: snapshot.flowBuffer,
            phaseBuffer: snapshot.phaseBuffer,
            hasContent: Boolean(snapshot.hasContent) || colorCycleBrushSnapshotHasPaintPayload(snapshot),
            strokeCounter: snapshot.strokeCounter ?? 0,
          },
          animatorIndex: snapshot.animatorIndex,
          reason,
        });
      });
    }
  }

  return {
    asHistory,
    shouldAssertNoClear: !isProduction && asHistory,
    settings: state,
    clearOperations,
    shouldClearComposite: clearOperations.length > 0,
    applyOperations,
    highestStrokeCounter: asHistory ? highestStrokeCounter : null,
  };
};

export const executeColorCycleBrushFullStateRestorePlan = ({
  plan,
  applySettings,
  applyLegacyStampDitherClears,
  logBlockedClear,
  clearLayer,
  clearComposite,
  applyLayerSnapshot,
  setHighestStrokeCounter,
  assertNoClear,
}: ExecuteColorCycleBrushFullStateRestorePlanOptions): void => {
  let clearedDuringRestore = false;
  try {
    applySettings(plan.settings);
    if (
      !Object.prototype.hasOwnProperty.call(plan.settings, 'stampDitherBgFill') &&
      typeof plan.settings.stampDitherClears === 'boolean'
    ) {
      applyLegacyStampDitherClears?.(plan.settings.stampDitherClears);
    }

    for (const operation of plan.clearOperations) {
      if (operation.blockedByCanonicalPayload) {
        logBlockedClear(operation);
        continue;
      }
      clearLayer(operation);
      clearedDuringRestore = true;
    }

    if (plan.shouldClearComposite) {
      clearComposite();
    }

    for (const operation of plan.applyOperations) {
      applyLayerSnapshot(operation);
    }

    if (plan.asHistory && typeof plan.highestStrokeCounter === 'number') {
      setHighestStrokeCounter(plan.highestStrokeCounter);
    }
  } finally {
    if (plan.shouldAssertNoClear) {
      assertNoClear?.(clearedDuringRestore);
    }
  }
};

export const colorCycleArrayBuffersEqual = (
  existingBuffer: ArrayBufferLike | undefined,
  nextBuffer: ArrayBufferLike | undefined,
): boolean => {
  if (existingBuffer === nextBuffer) {
    return true;
  }
  if (!existingBuffer || !nextBuffer || existingBuffer.byteLength !== nextBuffer.byteLength) {
    return false;
  }
  const existingView = new Uint8Array(existingBuffer);
  const nextView = new Uint8Array(nextBuffer);
  for (let index = 0; index < existingView.length; index += 1) {
    if (existingView[index] !== nextView[index]) {
      return false;
    }
  }
  return true;
};

export const createColorCycleCommittedLayerStoreSyncPatch = ({
  snapshot,
  documentSnapshot,
}: CreateColorCycleCommittedLayerStoreSyncPatchOptions): ColorCycleCommittedLayerStoreSyncPatch | null => {
  if (!snapshot?.gradientIdBuffer && !snapshot?.gradientDefIdBuffer) {
    return null;
  }

  const nextGradientIdBuffer = snapshot.gradientIdBuffer;
  const nextGradientDefIdBuffer = snapshot.gradientDefIdBuffer;
  const hasGradientIdChange = nextGradientIdBuffer
    ? !colorCycleArrayBuffersEqual(documentSnapshot?.gradientIdBuffer, nextGradientIdBuffer)
    : false;
  const hasGradientDefChange = nextGradientDefIdBuffer
    ? !colorCycleArrayBuffersEqual(documentSnapshot?.gradientDefIdBuffer, nextGradientDefIdBuffer)
    : false;

  if (!hasGradientIdChange && !hasGradientDefChange) {
    return null;
  }

  return {
    ...(hasGradientIdChange ? { gradientIdBuffer: nextGradientIdBuffer } : {}),
    ...(hasGradientDefChange ? { gradientDefIdBuffer: nextGradientDefIdBuffer } : {}),
  };
};

export const remapColorCycleCommittedGradientSlot = ({
  indexData,
  gidData,
  width,
  height,
  fromSlot,
  toSlot,
  flowSlotMask,
  bbox,
}: ColorCycleCommittedGradientSlotRemapOptions): ColorCycleCommittedGradientSlotRemapResult => {
  if (!indexData || !gidData) {
    return null;
  }
  const expected = width * height;
  if (width <= 0 || height <= 0 || indexData.length !== expected || gidData.length !== expected) {
    return null;
  }
  const from = Math.max(0, Math.min(flowSlotMask, Math.round(fromSlot)));
  const to = Math.max(0, Math.min(flowSlotMask, Math.round(toSlot)));
  if (from === to) {
    return null;
  }

  const minX = Math.max(0, Math.floor(bbox?.minX ?? 0));
  const minY = Math.max(0, Math.floor(bbox?.minY ?? 0));
  const maxX = Math.min(width - 1, Math.floor((bbox?.minX ?? 0) + (bbox?.width ?? width) - 1));
  const maxY = Math.min(height - 1, Math.floor((bbox?.minY ?? 0) + (bbox?.height ?? height) - 1));
  if (maxX < minX || maxY < minY) {
    return null;
  }

  for (let y = minY; y <= maxY; y += 1) {
    const row = y * width;
    for (let x = minX; x <= maxX; x += 1) {
      const index = row + x;
      if (indexData[index] === 0) {
        continue;
      }
      const gid = gidData[index];
      const currentSlot = gid & flowSlotMask;
      if (currentSlot === from) {
        gidData[index] = (gid & ~flowSlotMask) | to;
      }
    }
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX + 1),
    height: Math.max(1, maxY - minY + 1),
  };
};

export const bindColorCycleCommittedGradientDefToSlot = ({
  buffers,
  canvasWidth,
  canvasHeight,
  defId,
  slot,
  flowSlotMask,
  bbox,
  previewSlot,
  trackPreviewLeak = false,
}: BindColorCycleCommittedGradientDefToSlotOptions): BindColorCycleCommittedGradientDefToSlotResult => {
  const expected = canvasWidth * canvasHeight;
  if (buffers.def.length !== expected) {
    buffers.def = new Uint16Array(expected);
  }
  if (buffers.gid.length !== expected) {
    buffers.gid = new Uint8Array(expected);
  }
  if (buffers.paint.length !== expected) {
    buffers.paint = new Uint8Array(expected);
  }

  const minX = Math.max(0, Math.floor(bbox?.minX ?? 0));
  const minY = Math.max(0, Math.floor(bbox?.minY ?? 0));
  const maxX = Math.min(canvasWidth - 1, Math.floor((bbox?.minX ?? 0) + (bbox?.width ?? canvasWidth) - 1));
  const maxY = Math.min(canvasHeight - 1, Math.floor((bbox?.minY ?? 0) + (bbox?.height ?? canvasHeight) - 1));
  const previewSlotMasked =
    typeof previewSlot === 'number' ? (previewSlot & flowSlotMask) : null;
  const committedSlot = slot & flowSlotMask;
  const effectivePreviewSlot =
    previewSlotMasked !== null && previewSlotMasked !== committedSlot ? previewSlotMasked : null;
  let leftoverPreview = 0;

  for (let y = minY; y <= maxY; y += 1) {
    const row = y * canvasWidth;
    for (let x = minX; x <= maxX; x += 1) {
      const index = row + x;
      if (buffers.paint[index] === 0) {
        buffers.def[index] = 0;
        continue;
      }
      const gradientId = buffers.gid[index];
      const currentSlot = gradientId & flowSlotMask;
      if (effectivePreviewSlot !== null && currentSlot === effectivePreviewSlot) {
        buffers.gid[index] = (gradientId & ~flowSlotMask) | committedSlot;
        buffers.def[index] = defId;
      } else if (currentSlot === committedSlot && buffers.def[index] === 0) {
        buffers.def[index] = defId;
      }
      if (trackPreviewLeak && effectivePreviewSlot !== null) {
        if ((buffers.gid[index] & flowSlotMask) === effectivePreviewSlot) {
          leftoverPreview += 1;
        }
      }
    }
  }

  return {
    leftoverPreview,
    effectivePreviewSlot,
    committedSlot,
  };
};

export const executeColorCycleCommittedLayerState = ({
  options,
  bindGradientDefIdToSlot,
  syncCommittedBuffersToLayerStore,
  commitToLayer,
  renderDirectToCanvas,
}: ExecuteColorCycleCommittedLayerStateOptions): void => {
  const { layerId, targetCanvas = null, opacity = 1, binding } = options;
  if (binding) {
    strokeFinalizeProbeTimeSync(
      'executeColorCycleCommittedLayerState:bindGradientDefIdToSlot',
      () => bindGradientDefIdToSlot(
        layerId,
        binding.defId,
        binding.slot,
        binding.bbox,
        binding.previewSlot,
      ),
      {
        layerId,
        hasBindingBbox: Boolean(binding.bbox),
        previewSlot: binding.previewSlot ?? null,
      }
    );
    strokeFinalizeProbeTimeSync(
      'executeColorCycleCommittedLayerState:syncCommittedBuffersToLayerStore',
      () => syncCommittedBuffersToLayerStore(layerId),
      {
        layerId,
      }
    );
  }

  if (!targetCanvas) {
    return;
  }

  if (opacity !== 1) {
    strokeFinalizeProbeTimeSync(
      'executeColorCycleCommittedLayerState:commitToLayer',
      () => commitToLayer(targetCanvas, layerId, opacity),
      {
        layerId,
        opacity,
      }
    );
    return;
  }

  strokeFinalizeProbeTimeSync(
    'executeColorCycleCommittedLayerState:renderDirectToCanvas',
    () => renderDirectToCanvas(targetCanvas, layerId),
    { layerId }
  );
};

const syncColorCycleCommittedBuffersToLayerStoreFromRuntime = (
  brush: ColorCycleCommittedLayerRuntime,
  layerId: string,
): void => {
  const strokeState = getColorCycleBrushStrokeStateForOwner(brush, layerId);
  const snapshot = readColorCycleBrushLayerSnapshotFromDocumentRead(
    brush.getColorCycleLayerDocument?.(layerId)?.read(),
    { fallbackStrokeCounter: strokeState?.strokeCounter ?? 0 },
  ) ?? readColorCycleBrushLayerSnapshot({
    strokeState,
    hasStrokeContent: (state) => state.hasContent,
  });
  if (!snapshot?.gradientIdBuffer && !snapshot?.gradientDefIdBuffer) {
    return;
  }
  const state = getAppStoreState();
  const layer = state.layers.find((entry) => entry.id === layerId);
  if (!layer?.colorCycleData) {
    return;
  }
  const patch = createColorCycleCommittedLayerStoreSyncPatch({
    snapshot,
    documentSnapshot: brush.getColorCycleLayerDocument?.(layerId)?.read().snapshot,
  });
  if (!patch) {
    return;
  }
  state.updateLayer(layerId, {
    colorCycleData: {
      ...layer.colorCycleData,
      ...patch,
    },
  }, { skipColorCycleSync: true });
};

export const readColorCycleCommittedLayerStateFromRuntime = (
  brush: ColorCycleCommittedLayerRuntime | null | undefined,
  layerId: string,
): ColorCycleCommittedLayerRuntimeRead | null => {
  if (!brush) {
    return null;
  }
  const snapshot = brush.getColorCycleLayerDocument?.(layerId)?.read().snapshot;
  if (!snapshot?.paintBuffer || !snapshot.gradientIdBuffer) {
    return null;
  }
  const indexData = new Uint8Array(snapshot.paintBuffer);
  const gradientIdData = new Uint8Array(snapshot.gradientIdBuffer);
  const expectedLength = Math.max(1, snapshot.width) * Math.max(1, snapshot.height);
  if (indexData.length < expectedLength || gradientIdData.length < expectedLength) {
    return null;
  }
  return {
    dimensions: {
      width: Math.max(1, snapshot.width),
      height: Math.max(1, snapshot.height),
    },
    indexData,
    gradientIdData,
  };
};

export const commitColorCycleCommittedLayerStateToRuntime = (
  brush: ColorCycleCommittedLayerRuntime | null | undefined,
  options: ColorCycleCommittedLayerStateOptions,
): boolean => {
  if (!brush) {
    return false;
  }
  const { binding, targetCanvas = null, opacity = 1 } = options;
  if (binding && typeof brush.bindGradientDefIdToSlot !== 'function') {
    return false;
  }
  if (targetCanvas && opacity !== 1 && typeof brush.commitToLayer !== 'function') {
    return false;
  }
  if (targetCanvas && opacity === 1 && typeof brush.renderDirectToCanvas !== 'function') {
    return false;
  }

  executeColorCycleCommittedLayerState({
    options,
    bindGradientDefIdToSlot: (layerId, defId, slot, bbox, previewSlot) => {
      brush.bindGradientDefIdToSlot?.(layerId, defId, slot, bbox, previewSlot);
    },
    syncCommittedBuffersToLayerStore: (layerId) => {
      syncColorCycleCommittedBuffersToLayerStoreFromRuntime(brush, layerId);
    },
    commitToLayer: (targetCanvas, layerId, commitOpacity) => {
      brush.commitToLayer?.(targetCanvas, layerId, commitOpacity);
    },
    renderDirectToCanvas: (targetCanvas, layerId) => {
      brush.renderDirectToCanvas?.(targetCanvas, layerId);
    },
  });
  return true;
};

export const createColorCycleBrushLayerSnapshotApplyPlan = ({
  snapshot,
  animatorIndex,
  reason,
  suppressClearAudit,
  existingHasContent,
  hasCanonicalPaintPayload,
  blocksEmptySnapshot,
}: {
  snapshot: ColorCycleBrushLayerSnapshotInput;
  animatorIndex?: ColorCycleBrushAnimatorIndexInput;
  reason: 'history-restore' | 'project-load-restore' | 'snapshot-apply' | string;
  suppressClearAudit?: boolean;
  existingHasContent: boolean;
  hasCanonicalPaintPayload: boolean;
  blocksEmptySnapshot: boolean;
}): ColorCycleBrushLayerSnapshotApplyPlan => {
  const paintBuffer =
    snapshot.paintBuffer && snapshot.paintBuffer.byteLength > 0
      ? snapshot.paintBuffer
      : (animatorIndex?.data ?? new ArrayBuffer(0));
  const selectedPaint = new Uint8Array(paintBuffer);
  const selectedPaintHasContent = selectedPaint.some((value) => value !== 0);
  const expectsContent = Boolean(snapshot.hasContent);
  const shouldAuditPotentialClear =
    suppressClearAudit !== true &&
    (existingHasContent || hasCanonicalPaintPayload) &&
    !expectsContent &&
    !selectedPaintHasContent;

  return {
    paintBuffer,
    paintByteLength: selectedPaint.byteLength,
    selectedPaintHasContent,
    expectsContent,
    shouldAuditPotentialClear,
    shouldBlockPotentialClear: shouldAuditPotentialClear && blocksEmptySnapshot && hasCanonicalPaintPayload,
    mutationSource: reason === 'history-restore'
      ? 'history'
      : reason === 'project-load-restore'
        ? 'project-load'
        : 'snapshot',
  };
};

export const createColorCycleBrushLayerSnapshotRestoreGuard = ({
  reason,
  suppressClearAudit,
  restoreActionKind,
}: CreateColorCycleBrushLayerSnapshotRestoreGuardOptions): ColorCycleBrushLayerSnapshotRestoreGuard => {
  const blocksEmptySnapshot = reason === 'project-load-restore';
  const shouldRecoverFromCanonical = restoreActionKind === 'recover-from-canonical';
  const shouldLogBlockedWrite = (
    suppressClearAudit !== true &&
    blocksEmptySnapshot &&
    (shouldRecoverFromCanonical || restoreActionKind === 'block')
  );
  return {
    blocksEmptySnapshot,
    shouldLogBlockedWrite,
    shouldRecoverFromCanonical,
    blockedSeverity: blocksEmptySnapshot ? 'warn' : 'error',
  };
};

export const createColorCycleBrushRestoreBlockedClearAuditPlan = ({
  existingHasContent,
  brushStateHasPayload,
}: CreateColorCycleBrushRestoreBlockedClearAuditPlanOptions): ColorCycleBrushRestoreBlockedClearAuditPlan => {
  const guard = createColorCycleBrushLayerSnapshotRestoreGuard({
    reason: 'project-load-restore',
  });
  return {
    severity: guard.blockedSeverity,
    details: {
      source: 'project-load',
      snapshotReason: 'project-load-restore',
      existingHasContent,
      brushStateHasPayload,
    },
  };
};

export const createColorCycleBrushLayerSnapshotClearAuditPlan = ({
  applyPlan,
  hasLayerContent,
}: CreateColorCycleBrushLayerSnapshotClearAuditPlanOptions): ColorCycleBrushLayerSnapshotClearAuditPlan | null => {
  if (!applyPlan.shouldAuditPotentialClear || hasLayerContent) {
    return null;
  }
  return {
    source: applyPlan.mutationSource,
    expectedDestructive: !applyPlan.expectsContent,
  };
};

export const createColorCycleBrushLayerSnapshotAnimatorSizingPlan = ({
  applyPlan,
  width,
  height,
}: CreateColorCycleBrushLayerSnapshotAnimatorSizingPlanOptions): ColorCycleBrushLayerSnapshotAnimatorSizingPlan => {
  const safeWidth = Math.max(0, Math.floor(width));
  const safeHeight = Math.max(0, Math.floor(height));
  const expectedSize = safeWidth * safeHeight;
  return {
    expectedSize,
    shouldResizeAnimator: applyPlan.paintByteLength !== expectedSize,
    width: safeWidth,
    height: safeHeight,
  };
};

export const createColorCycleBrushLayerSnapshotFallbackAnimationPlan = ({
  layerBaseSpeed,
  toolSpeed,
  layerFlowMode,
  brushFlowMode,
  defaultSpeed = 0.1,
  defaultFlowMode = 'forward',
}: CreateColorCycleBrushLayerSnapshotFallbackAnimationPlanOptions): ColorCycleBrushLayerSnapshotFallbackAnimationPlan => ({
  speed: layerBaseSpeed ?? toolSpeed ?? defaultSpeed,
  flowMode: layerFlowMode ?? brushFlowMode ?? defaultFlowMode,
});

export const createColorCycleBrushLayerSnapshotDirtyBounds = (
  dimensions: ColorCycleBrushLayerSnapshotAnimatorDimensions | null | undefined,
): ColorCycleBrushLayerSnapshotDirtyBounds | null => {
  if (!dimensions) {
    return null;
  }
  const width = Math.max(0, Math.floor(dimensions.width));
  const height = Math.max(0, Math.floor(dimensions.height));
  return {
    minX: 0,
    minY: 0,
    width,
    height,
  };
};

export const createColorCycleBrushLayerSnapshotBlockedAuditDetails = ({
  applyPlan,
  snapshot,
  reason,
  existingHasContent,
  brushStateHasPayload,
  paintBufferNonZero = applyPlan.selectedPaintHasContent,
  restoredFromCanonicalBrushState,
}: CreateColorCycleBrushLayerSnapshotBlockedAuditDetailsOptions): ColorCycleBrushLayerSnapshotBlockedAuditDetails => {
  const details: ColorCycleBrushLayerSnapshotBlockedAuditDetails = {
    source: 'snapshot',
    snapshotReason: reason,
    paintBufferBytes: applyPlan.paintByteLength,
    paintBufferNonZero,
    snapshotHasContent: snapshot.hasContent ?? null,
    existingHasContent,
    brushStateHasPayload,
  };
  if (typeof restoredFromCanonicalBrushState === 'boolean') {
    details.restoredFromCanonicalBrushState = restoredFromCanonicalBrushState;
  }
  return details;
};

export const createColorCycleBrushLayerSnapshotMetadataPlan = (
  animatorIndex?: ColorCycleBrushAnimatorIndexInput,
): ColorCycleBrushLayerSnapshotMetadataPlan => {
  const activeGradientSlot = typeof animatorIndex?.paintSlot === 'number'
    ? animatorIndex.paintSlot
    : animatorIndex?.gradientDefs?.length && animatorIndex.activeGradientId
      ? animatorIndex.gradientDefs.find((entry) => entry.id === animatorIndex.activeGradientId)?.currentSlot
      : undefined;

  return {
    slotPalettes: animatorIndex?.slotPalettes ?? [],
    activeGradientSlot,
  };
};

export const executeColorCycleBrushLayerSnapshotMetadataPlan = ({
  plan,
  applySlotPalette,
  applyActiveGradientSlot,
}: ExecuteColorCycleBrushLayerSnapshotMetadataPlanOptions): void => {
  for (const palette of plan.slotPalettes) {
    applySlotPalette(palette.slot, palette.stops, palette.seamProfile);
  }
  if (typeof plan.activeGradientSlot === 'number') {
    applyActiveGradientSlot(plan.activeGradientSlot);
  }
};

export const commitColorCycleBrushLayerSnapshotApplyResultToStrokeState = ({
  strokeState,
  snapshot,
  applyResult,
  reason,
}: CommitColorCycleBrushLayerSnapshotApplyResultOptions): ColorCycleBrushLayerSnapshotStrokeStateCommit => {
  strokeState.hasContent = applyResult.hasLayerContent;
  strokeState.contentIsOptimistic = false;
  if (strokeState.externalBase) {
    strokeState.externalBase.hasExternalBase = false;
  }
  strokeState.strokeCounter = snapshot.strokeCounter || 0;
  strokeState.lastPoint = null;
  strokeState.stampCounter = 0;
  strokeState.strokePhaseUnits = 0;
  strokeState.stampDither = undefined;
  strokeState.snapshot = applyResult.nextSnapshot;
  return {
    publish: {
      reason,
      hasContent: strokeState.hasContent,
      strokeCounter: strokeState.strokeCounter ?? 0,
    },
  };
};

export const clearColorCycleBrushStrokeStateForRestore = (
  strokeState: ColorCycleBrushLayerSnapshotMutableStrokeState,
): ColorCycleBrushRestoreClearStrokeStateResult => {
  strokeState.buffers.paint.fill(0);
  strokeState.buffers.gid.fill(0);
  strokeState.buffers.spd.fill(0);
  strokeState.buffers.flow.fill(0);
  strokeState.buffers.phase.fill(0);
  strokeState.buffers.def.fill(0);
  strokeState.hasContent = false;
  strokeState.contentIsOptimistic = false;
  if (strokeState.externalBase) {
    strokeState.externalBase.hasExternalBase = false;
  }
  strokeState.strokeCounter = 0;
  strokeState.lastPoint = null;
  strokeState.stampCounter = 0;
  strokeState.strokePhaseUnits = 0;
  strokeState.snapshot = undefined;
  strokeState.stampDither = undefined;
  return {
    hasContent: false,
    strokeCounter: 0,
  };
};

export const executeColorCycleBrushLayerSnapshotAnimatorSync = ({
  applyResult,
  setIndexBuffers,
  bindStrokeBuffers,
  applyDefBindings,
  snapshotFromBuffers,
  getAnimatorDimensions,
  markDirtyBounds,
}: ExecuteColorCycleBrushLayerSnapshotAnimatorSyncOptions): void => {
  setIndexBuffers(applyResult);
  bindStrokeBuffers();
  applyDefBindings();
  if (applyResult.hasLayerContent) {
    snapshotFromBuffers();
  }
  const dirtyBounds = createColorCycleBrushLayerSnapshotDirtyBounds(getAnimatorDimensions());
  if (dirtyBounds) {
    markDirtyBounds(dirtyBounds);
  }
};

export const executeColorCycleBrushLayerSnapshotRuntimeApply = <
  TStrokeState extends ColorCycleBrushLayerSnapshotMutableStrokeState,
  TAnimator,
  TAuditSnapshot,
>({
  layerId,
  snapshot,
  animatorIndex,
  reason,
  suppressClearAudit,
  canvasWidth,
  canvasHeight,
  flowSlotMask,
  getExistingStrokeState,
  hasCanonicalPaintPayload,
  resolveRestoreAction,
  brushStateHasPaintPayload,
  logBlockedWrite,
  applyRecoveredSnapshot,
  ensureAnimator,
  resizeAnimator,
  createStrokeState,
  captureAuditSnapshot,
  getFallbackAnimationPlanOptions,
  encodeFallbackSpeedByte,
  encodeFallbackFlowByte,
  applySlotPalette,
  applyActiveGradientSlot,
  publishStrokeState,
  recordClearAudit,
  setIndexBuffers,
  bindStrokeBuffersToAnimator,
  applyDefBindings,
  snapshotFromBuffers,
  getAnimatorDimensions,
  markDirtyBounds,
  markLayerDirty,
}: ExecuteColorCycleBrushLayerSnapshotRuntimeApplyOptions<TStrokeState, TAnimator, TAuditSnapshot>): void => {
  const existing = getExistingStrokeState(layerId);
  const canonicalPayload = hasCanonicalPaintPayload(layerId);
  const initialRestoreGuard = createColorCycleBrushLayerSnapshotRestoreGuard({
    reason,
    suppressClearAudit,
  });
  const applyPlan = createColorCycleBrushLayerSnapshotApplyPlan({
    snapshot,
    animatorIndex,
    reason,
    suppressClearAudit,
    existingHasContent: existing?.hasContent ?? false,
    hasCanonicalPaintPayload: canonicalPayload,
    blocksEmptySnapshot: initialRestoreGuard.blocksEmptySnapshot,
  });
  const restoreAction = resolveRestoreAction({
    layerId,
    applyPlan,
    snapshot,
    projectLoadRestore: initialRestoreGuard.blocksEmptySnapshot,
  });
  const restoreGuard = createColorCycleBrushLayerSnapshotRestoreGuard({
    reason,
    suppressClearAudit,
    restoreActionKind: restoreAction?.kind,
  });
  if (restoreGuard.shouldLogBlockedWrite) {
    logBlockedWrite({
      layerId,
      severity: restoreGuard.blockedSeverity,
      details: createColorCycleBrushLayerSnapshotBlockedAuditDetails({
        applyPlan,
        snapshot,
        reason,
        paintBufferNonZero: false,
        existingHasContent: existing?.hasContent ?? false,
        brushStateHasPayload: brushStateHasPaintPayload(layerId),
        restoredFromCanonicalBrushState: restoreGuard.shouldRecoverFromCanonical,
      }),
    });
    if (
      restoreGuard.shouldRecoverFromCanonical &&
      restoreAction?.kind === 'recover-from-canonical' &&
      restoreAction.snapshot
    ) {
      applyRecoveredSnapshot({
        layerId,
        snapshot: restoreAction.snapshot,
        animatorIndex: restoreAction.animatorIndex,
        reason,
      });
    }
    return;
  }

  const animator = ensureAnimator(layerId);
  const sizingPlan = createColorCycleBrushLayerSnapshotAnimatorSizingPlan({
    applyPlan,
    width: canvasWidth,
    height: canvasHeight,
  });
  const beforeMutation = applyPlan.shouldAuditPotentialClear
    ? captureAuditSnapshot(layerId, existing)
    : null;
  if (applyPlan.shouldBlockPotentialClear) {
    logBlockedWrite({
      layerId,
      severity: restoreGuard.blockedSeverity,
      details: createColorCycleBrushLayerSnapshotBlockedAuditDetails({
        applyPlan,
        snapshot,
        reason,
        existingHasContent: existing?.hasContent ?? false,
        brushStateHasPayload: brushStateHasPaintPayload(layerId),
      }),
    });
    return;
  }

  try {
    if (animator && sizingPlan.shouldResizeAnimator) {
      resizeAnimator(animator, sizingPlan.width, sizingPlan.height);
    }
  } catch {}

  const strokeState = existing || createStrokeState({
    hasContent: false,
    bufferSize: sizingPlan.expectedSize,
  });
  const fallbackAnimationPlan = createColorCycleBrushLayerSnapshotFallbackAnimationPlan(
    getFallbackAnimationPlanOptions(layerId),
  );
  const snapshotApplyResult = applyColorCycleBrushLayerSnapshotToBuffers({
    buffers: strokeState.buffers,
    expectedSize: sizingPlan.expectedSize,
    snapshot,
    animatorIndex,
    flowSlotMask,
    fallbackSpeedByte: encodeFallbackSpeedByte(fallbackAnimationPlan.speed),
    fallbackFlowByte: encodeFallbackFlowByte(fallbackAnimationPlan.flowMode),
  });

  executeColorCycleBrushLayerSnapshotMetadataPlan({
    plan: createColorCycleBrushLayerSnapshotMetadataPlan(animatorIndex),
    applySlotPalette,
    applyActiveGradientSlot,
  });

  const snapshotCommit = commitColorCycleBrushLayerSnapshotApplyResultToStrokeState({
    strokeState,
    snapshot,
    applyResult: snapshotApplyResult,
    reason,
  });
  publishStrokeState(layerId, strokeState, snapshotCommit.publish);

  const clearAuditPlan = createColorCycleBrushLayerSnapshotClearAuditPlan({
    applyPlan,
    hasLayerContent: snapshotApplyResult.hasLayerContent,
  });
  if (clearAuditPlan) {
    recordClearAudit({
      layerId,
      reason,
      source: clearAuditPlan.source,
      expectedDestructive: clearAuditPlan.expectedDestructive,
      before: beforeMutation,
      after: captureAuditSnapshot(layerId, strokeState),
    });
  }

  try {
    executeColorCycleBrushLayerSnapshotAnimatorSync({
      applyResult: snapshotApplyResult,
      setIndexBuffers: (result) => setIndexBuffers(animator, result),
      bindStrokeBuffers: () => bindStrokeBuffersToAnimator(strokeState, animator),
      applyDefBindings: () => applyDefBindings(layerId, animator, strokeState),
      snapshotFromBuffers: () => snapshotFromBuffers(strokeState),
      getAnimatorDimensions: () => getAnimatorDimensions(animator),
      markDirtyBounds: (bounds) => markDirtyBounds(animator, bounds),
    });
  } catch {}

  markLayerDirty(layerId);
};

export const readColorCycleBrushLayerSnapshotFromRuntime = (
  brush: ColorCycleBrushLayerSnapshotRuntimeReader | null | undefined,
  layerId: string,
): ColorCycleBrushLayerSnapshot | null => {
  if (!brush) {
    return null;
  }
  const documentSnapshot = readColorCycleBrushLayerSnapshotFromDocumentRead(
    brush.getColorCycleLayerDocument?.(layerId)?.read(),
    { fallbackStrokeCounter: 0 },
  );
  if (documentSnapshot) {
    return documentSnapshot;
  }
  return null;
};

export const canReadColorCycleBrushLayerSnapshotFromRuntime = (
  brush: ColorCycleBrushLayerSnapshotRuntimeReader | null | undefined,
): brush is ColorCycleBrushLayerSnapshotRuntimeReader => (
  Boolean(brush && typeof brush.getColorCycleLayerDocument === 'function')
);

export const applyColorCycleBrushLayerSnapshotToRuntime = (
  brush: ColorCycleBrushLayerSnapshotRuntimeWriter | null | undefined,
  layerId: string,
  snapshot: ColorCycleBrushLayerSnapshotInput,
  animatorIndex?: ColorCycleBrushAnimatorIndexInput,
  reason?: string,
  options?: { suppressClearAudit?: boolean },
): boolean => {
  if (!brush) {
    return false;
  }
  const runtime = colorCycleBrushLayerSnapshotRuntimeByOwner.get(resolveColorCycleBrushPersistenceOwner(brush));
  if (!runtime) {
    return false;
  }
  if (options !== undefined || reason !== undefined) {
    runtime.apply(layerId, snapshot, animatorIndex, reason, options);
  } else if (animatorIndex !== undefined) {
    runtime.apply(layerId, snapshot, animatorIndex);
  } else {
    runtime.apply(layerId, snapshot);
  }
  return true;
};

export const registerColorCycleBrushLayerSnapshotRuntime = (
  owner: object,
  runtime: ColorCycleBrushLayerSnapshotRuntime,
): void => {
  colorCycleBrushLayerSnapshotRuntimeByOwner.set(resolveColorCycleBrushPersistenceOwner(owner), runtime);
};

export const canApplyColorCycleBrushLayerSnapshotToRuntime = (
  brush: ColorCycleBrushLayerSnapshotRuntimeWriter | null | undefined,
): brush is ColorCycleBrushLayerSnapshotRuntimeWriter => (
  Boolean(brush && colorCycleBrushLayerSnapshotRuntimeByOwner.has(resolveColorCycleBrushPersistenceOwner(brush)))
);

export const readColorCycleBrushSerializedStateFromRuntime = (
  brush: ColorCycleBrushSerializedStateRuntimeReader | null | undefined,
): unknown | undefined => {
  if (!brush) {
    return undefined;
  }
  const registeredState = colorCycleBrushSerializedStateRuntimeByOwner.get(
    resolveColorCycleBrushPersistenceOwner(brush),
  )?.read?.();
  if (registeredState !== undefined) {
    return registeredState;
  }
  const legacyReader = brush as {
    serialize?: () => unknown;
    getFullState?: () => unknown;
  };
  if (typeof legacyReader.serialize === 'function') {
    return legacyReader.serialize();
  }
  if (typeof legacyReader.getFullState === 'function') {
    return legacyReader.getFullState();
  }
  return undefined;
};

export const registerColorCycleBrushSerializedStateRuntime = (
  owner: object,
  runtime: ColorCycleBrushSerializedStateRuntime,
): void => {
  colorCycleBrushSerializedStateRuntimeByOwner.set(resolveColorCycleBrushPersistenceOwner(owner), runtime);
};

export const restoreColorCycleBrushSerializedStateToRuntime = (
  brush: ColorCycleBrushSerializedStateRuntimeWriter | null | undefined,
  state: unknown,
  options?: unknown,
): boolean => {
  if (!brush) {
    return false;
  }
  const runtime = colorCycleBrushSerializedStateRuntimeByOwner.get(resolveColorCycleBrushPersistenceOwner(brush));
  if (!runtime?.restore) {
    return false;
  }
  runtime.restore(state, options);
  return true;
};

export const canRestoreColorCycleBrushSerializedStateToRuntime = (
  brush: ColorCycleBrushSerializedStateRuntimeWriter | null | undefined,
): brush is ColorCycleBrushSerializedStateRuntimeWriter => (
  Boolean(brush && colorCycleBrushSerializedStateRuntimeByOwner.get(resolveColorCycleBrushPersistenceOwner(brush))?.restore)
);

export const applyColorCycleBrushPaintPatchToRuntime = (
  brush: ColorCycleBrushPaintPatchRuntimeWriter | null | undefined,
  layerId: string,
  roi: { x: number; y: number; width: number; height: number },
  bytes: Uint8Array,
  extras?: ColorCycleBrushPaintPatchExtras,
): boolean => {
  if (!brush) {
    return false;
  }
  const runtime = colorCycleBrushPaintPatchRuntimeByOwner.get(resolveColorCycleBrushPersistenceOwner(brush));
  if (!runtime) {
    return false;
  }
  return runtime.apply(layerId, roi, bytes, extras);
};

export const registerColorCycleBrushPaintPatchRuntime = (
  owner: object,
  runtime: ColorCycleBrushPaintPatchRuntime,
): void => {
  colorCycleBrushPaintPatchRuntimeByOwner.set(resolveColorCycleBrushPersistenceOwner(owner), runtime);
};

export const commitColorCycleBrushPaintPatchResultToStrokeState = (
  strokeState: ColorCycleBrushPersistenceStrokeState,
  patchResult: ColorCycleBrushPaintPatchResult,
): ColorCycleBrushPaintPatchStrokeStateCommit => {
  const hasContent = patchResult.hasNonZero;
  strokeState.hasContent = hasContent;
  return {
    hasContent,
    publish: {
      hasContent,
      strokeCounter: strokeState.strokeCounter ?? 0,
      reason: 'history-restore',
    },
  };
};

export const executeColorCycleBrushPaintPatchAnimatorSync = ({
  patchResult,
  buffers,
  setDefIdData,
  setIndexBuffers,
  bindStrokeBuffers,
  snapshotFromBuffers,
  markDirtyBounds,
}: ExecuteColorCycleBrushPaintPatchAnimatorSyncOptions): void => {
  try {
    setDefIdData(buffers.def);
    setIndexBuffers(buffers);
    bindStrokeBuffers();
    snapshotFromBuffers();
  } catch {}

  try {
    markDirtyBounds({
      minX: patchResult.x,
      minY: patchResult.y,
      width: patchResult.width,
      height: patchResult.height,
    });
  } catch {}
};

export const executeColorCycleBrushPaintPatchRuntimeApply = <
  TStrokeState extends ColorCycleBrushPersistenceStrokeState,
  TAnimator,
>({
  layerId,
  roi,
  bytes,
  extras,
  canvasWidth,
  canvasHeight,
  ensureStrokeState,
  ensureAnimator,
  bindStrokeBuffersToAnimator,
  publishStrokeState,
  setDefIdData,
  setIndexBuffers,
  snapshotFromBuffers,
  markDirtyBounds,
  markLayerDirty,
}: ExecuteColorCycleBrushPaintPatchRuntimeApplyOptions<TStrokeState, TAnimator>): boolean => {
  const strokeState = ensureStrokeState(layerId);
  const animator = ensureAnimator(layerId);
  bindStrokeBuffersToAnimator(strokeState, animator);

  const patchResult = applyColorCycleBrushPaintPatchToBuffers({
    canvasWidth,
    canvasHeight,
    buffers: strokeState.buffers,
    roi,
    bytes,
    extras,
  });
  if (!patchResult) {
    return false;
  }

  const patchCommit = commitColorCycleBrushPaintPatchResultToStrokeState(strokeState, patchResult);
  publishStrokeState(layerId, strokeState, patchCommit.publish);

  executeColorCycleBrushPaintPatchAnimatorSync({
    patchResult,
    buffers: strokeState.buffers,
    setDefIdData: (def) => setDefIdData(animator, def),
    setIndexBuffers: (buffers) => setIndexBuffers(animator, buffers),
    bindStrokeBuffers: () => bindStrokeBuffersToAnimator(strokeState, animator),
    snapshotFromBuffers: () => snapshotFromBuffers(strokeState),
    markDirtyBounds: (bounds) => markDirtyBounds(animator, bounds),
  });

  markLayerDirty(layerId);
  return patchCommit.hasContent;
};

export const canApplyColorCycleBrushPaintPatchToRuntime = (
  brush: ColorCycleBrushPaintPatchRuntimeWriter | null | undefined,
): brush is ColorCycleBrushPaintPatchRuntimeWriter => (
  Boolean(brush && colorCycleBrushPaintPatchRuntimeByOwner.has(resolveColorCycleBrushPersistenceOwner(brush)))
);

const cloneArrayBuffer = (buffer: ArrayBuffer | undefined): ArrayBuffer | undefined => (
  buffer && buffer.byteLength > 0 ? buffer.slice(0) : undefined
);

const hasAnyNonZeroByte = (buffer: ArrayBuffer | undefined): boolean => (
  buffer ? new Uint8Array(buffer).some((value) => value !== 0) : false
);

const copyColorCycleBrushSnapshotRegion = (
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  rect: { x: number; y: number; width: number; height: number },
): Uint8Array => {
  const targetWidth = rect.width;
  const targetHeight = rect.height;
  const destination = new Uint8Array(targetWidth * targetHeight);
  const sourceRight = Math.max(0, sourceWidth);
  const sourceBottom = Math.max(0, sourceHeight);
  const rectRight = rect.x + rect.width;
  const rectBottom = rect.y + rect.height;
  const sx = Math.max(0, Math.min(sourceRight, rect.x));
  const sy = Math.max(0, Math.min(sourceBottom, rect.y));
  const sw = Math.max(0, Math.min(sourceRight, rectRight) - sx);
  const sh = Math.max(0, Math.min(sourceBottom, rectBottom) - sy);

  if (sw === 0 || sh === 0) {
    return destination;
  }

  const dx = sx - rect.x;
  const dy = sy - rect.y;

  for (let row = 0; row < sh; row += 1) {
    const srcStart = (sy + row) * sourceWidth + sx;
    const destStart = (dy + row) * targetWidth + dx;
    destination.set(source.subarray(srcStart, srcStart + sw), destStart);
  }

  return destination;
};

const copyColorCycleBrushSnapshotRegionU16 = (
  source: Uint16Array,
  sourceWidth: number,
  sourceHeight: number,
  rect: { x: number; y: number; width: number; height: number },
): Uint16Array => {
  const targetWidth = rect.width;
  const targetHeight = rect.height;
  const destination = new Uint16Array(targetWidth * targetHeight);
  const sourceRight = Math.max(0, sourceWidth);
  const sourceBottom = Math.max(0, sourceHeight);
  const rectRight = rect.x + rect.width;
  const rectBottom = rect.y + rect.height;
  const sx = Math.max(0, Math.min(sourceRight, rect.x));
  const sy = Math.max(0, Math.min(sourceBottom, rect.y));
  const sw = Math.max(0, Math.min(sourceRight, rectRight) - sx);
  const sh = Math.max(0, Math.min(sourceBottom, rectBottom) - sy);

  if (sw === 0 || sh === 0) {
    return destination;
  }

  const dx = sx - rect.x;
  const dy = sy - rect.y;

  for (let row = 0; row < sh; row += 1) {
    const srcStart = (sy + row) * sourceWidth + sx;
    const destStart = (dy + row) * targetWidth + dx;
    destination.set(source.subarray(srcStart, srcStart + sw), destStart);
  }

  return destination;
};

const cloneUnknownBufferLike = (value: unknown): unknown => {
  if (value instanceof ArrayBuffer) {
    return value.slice(0);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice().buffer;
  }
  return value;
};

const cloneUnknownRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

export const cloneColorCycleSerializedBrushLayerSnapshotBuffers = <
  T extends { strokeData?: Record<string, unknown> },
>(
  entry: T,
): T => {
  if (!entry.strokeData) {
    return { ...entry };
  }
  return {
    ...entry,
    strokeData: {
      ...entry.strokeData,
      paintBuffer: cloneUnknownBufferLike(entry.strokeData.paintBuffer),
      gradientIdBuffer: cloneUnknownBufferLike(entry.strokeData.gradientIdBuffer),
      gradientDefIdBuffer: cloneUnknownBufferLike(entry.strokeData.gradientDefIdBuffer),
      speedBuffer: cloneUnknownBufferLike(entry.strokeData.speedBuffer),
      flowBuffer: cloneUnknownBufferLike(entry.strokeData.flowBuffer),
      phaseBuffer: cloneUnknownBufferLike(entry.strokeData.phaseBuffer),
    },
  };
};

export const cloneColorCycleBrushLayerSnapshot = (
  snapshot: ColorCycleBrushLayerSnapshot | null | undefined,
): ColorCycleBrushLayerSnapshot | null => {
  if (!snapshot?.paintBuffer) {
    return null;
  }
  return {
    paintBuffer: snapshot.paintBuffer.slice(0),
    gradientIdBuffer: cloneArrayBuffer(snapshot.gradientIdBuffer),
    gradientDefIdBuffer: cloneArrayBuffer(snapshot.gradientDefIdBuffer),
    speedBuffer: cloneArrayBuffer(snapshot.speedBuffer),
    speedSourceVersion: snapshot.speedSourceVersion,
    flowBuffer: cloneArrayBuffer(snapshot.flowBuffer),
    phaseBuffer: cloneArrayBuffer(snapshot.phaseBuffer),
    hasContent: snapshot.hasContent,
    strokeCounter: snapshot.strokeCounter,
  };
};

export const cloneColorCycleLayerStrokePaintBytes = (
  stroke: Pick<ColorCycleLayerStrokeSnapshot, 'paintBuffer'>,
): Uint8Array => new Uint8Array(stroke.paintBuffer).slice();

export const createColorCycleStorageLayerStrokeSnapshot = ({
  layerId,
  paint,
}: {
  layerId: string;
  paint: Uint8Array;
}): ColorCycleLayerStrokeSnapshot => ({
  layerId,
  paintBuffer: paint.buffer.slice(paint.byteOffset, paint.byteOffset + paint.byteLength) as ArrayBuffer,
  hasContent: paint.some((value) => value > 0),
  strokeCounter: 0,
  strokeLength: 0,
  gradientLayerIndices: [],
  currentGradientIndex: 0,
});

export const cropColorCycleBrushLayerSnapshotRegion = ({
  snapshot,
  sourceWidth,
  sourceHeight,
  rect,
}: {
  snapshot: ColorCycleBrushLayerSnapshot | null | undefined;
  sourceWidth: number;
  sourceHeight: number;
  rect: { x: number; y: number; width: number; height: number };
}): ColorCycleBrushLayerSnapshot | null => {
  if (!snapshot?.paintBuffer) {
    return null;
  }

  const expectedLength = sourceWidth * sourceHeight;
  const paint = new Uint8Array(snapshot.paintBuffer);
  if (expectedLength <= 0 || paint.length !== expectedLength) {
    return null;
  }

  const croppedPaint = copyColorCycleBrushSnapshotRegion(paint, sourceWidth, sourceHeight, rect);
  const cropOptionalMap = (buffer: ArrayBuffer | undefined): ArrayBuffer | undefined => {
    if (!buffer) {
      return undefined;
    }
    const source = new Uint8Array(buffer);
    if (source.length !== expectedLength) {
      return undefined;
    }
    return copyColorCycleBrushSnapshotRegion(source, sourceWidth, sourceHeight, rect).buffer.slice(0) as ArrayBuffer;
  };
  const cropOptionalDefMap = (buffer: ArrayBuffer | undefined): ArrayBuffer | undefined => {
    if (!buffer) {
      return undefined;
    }
    const source = new Uint16Array(buffer);
    if (source.length !== expectedLength) {
      return undefined;
    }
    return copyColorCycleBrushSnapshotRegionU16(source, sourceWidth, sourceHeight, rect).buffer.slice(0) as ArrayBuffer;
  };

  const gradientIdBuffer = cropOptionalMap(snapshot.gradientIdBuffer);
  const gradientDefIdBuffer = cropOptionalDefMap(snapshot.gradientDefIdBuffer);
  const speedBuffer = cropOptionalMap(snapshot.speedBuffer);
  const flowBuffer = cropOptionalMap(snapshot.flowBuffer);
  const phaseBuffer = cropOptionalMap(snapshot.phaseBuffer);

  return {
    paintBuffer: croppedPaint.buffer.slice(0) as ArrayBuffer,
    gradientIdBuffer,
    gradientDefIdBuffer,
    speedBuffer,
    flowBuffer,
    phaseBuffer,
    hasContent: Boolean(snapshot.hasContent) && (
      croppedPaint.some((value) => value !== 0) ||
      hasAnyNonZeroByte(gradientIdBuffer) ||
      hasAnyNonZeroByte(gradientDefIdBuffer) ||
      hasAnyNonZeroByte(speedBuffer) ||
      hasAnyNonZeroByte(flowBuffer) ||
      hasAnyNonZeroByte(phaseBuffer)
    ),
    strokeCounter: snapshot.strokeCounter,
  };
};

const cloneColorCycleSerializedBrushLayerForDuplicate = (
  snapshot: unknown,
  sourceLayerId: string,
  targetLayerId: string,
): unknown => {
  const record = cloneUnknownRecord(snapshot);
  if (!record) {
    return snapshot;
  }
  const strokeData = cloneUnknownRecord(record.strokeData);
  const data = cloneUnknownRecord(record.data);
  const indexBuffer = cloneUnknownRecord(data?.indexBuffer);
  const clonedData = data
    ? {
        ...data,
        indexBuffer: indexBuffer
          ? {
              ...indexBuffer,
              data: cloneUnknownBufferLike(indexBuffer.data),
              gradientId: cloneUnknownBufferLike(indexBuffer.gradientId),
              speedData: cloneUnknownBufferLike(indexBuffer.speedData),
              flowData: cloneUnknownBufferLike(indexBuffer.flowData),
              phaseData: cloneUnknownBufferLike(indexBuffer.phaseData),
            }
          : data.indexBuffer,
      }
    : record.data;

  return {
    ...record,
    layerId: record.layerId === sourceLayerId ? targetLayerId : record.layerId,
    data: clonedData,
    strokeData: strokeData
      ? {
          ...strokeData,
          paintBuffer: cloneUnknownBufferLike(strokeData.paintBuffer),
          gradientIdBuffer: cloneUnknownBufferLike(strokeData.gradientIdBuffer),
          gradientDefIdBuffer: cloneUnknownBufferLike(strokeData.gradientDefIdBuffer),
          speedBuffer: cloneUnknownBufferLike(strokeData.speedBuffer),
          flowBuffer: cloneUnknownBufferLike(strokeData.flowBuffer),
          phaseBuffer: cloneUnknownBufferLike(strokeData.phaseBuffer),
        }
      : record.strokeData,
  };
};

export const cloneColorCycleBrushStateForLayerDuplicate = (
  brushState: unknown,
  sourceLayerId: string,
  targetLayerId: string,
): unknown => {
  const record = cloneUnknownRecord(brushState);
  if (!record) {
    return brushState;
  }
  const layers = Array.isArray(record.layers)
    ? record.layers.map((snapshot) => cloneColorCycleSerializedBrushLayerForDuplicate(snapshot, sourceLayerId, targetLayerId))
    : record.layers;
  return {
    ...record,
    layers,
  };
};

export type CreateColorCycleCanonicalBrushStateFromSnapshotOptions = {
  layerId: string;
  width: number;
  height: number;
  snapshot: ColorCycleBrushLayerSnapshot;
  existingBrushState: unknown;
  metadata?: Partial<ColorCycleBrushPersistenceLayerMeta> | null;
};

export const createColorCycleCanonicalBrushStateFromSnapshot = ({
  layerId,
  width,
  height,
  snapshot,
  existingBrushState,
  metadata,
}: CreateColorCycleCanonicalBrushStateFromSnapshotOptions): unknown => {
  const record = cloneUnknownRecord(existingBrushState);
  const existingLayers = Array.isArray(record?.layers) ? record.layers : [];
  const existingSnapshot = existingLayers.find((entry) => (
    cloneUnknownRecord(entry)?.layerId === layerId
  ));
  const existingDimensionsByLayerId = (
    record?.dimensionsByLayerId &&
    typeof record.dimensionsByLayerId === 'object' &&
    !Array.isArray(record.dimensionsByLayerId)
  )
    ? record.dimensionsByLayerId as Record<string, { width: number; height: number }>
    : {};
  const existingSnapshotRecord = cloneUnknownRecord(existingSnapshot);
  const clonedSnapshot = cloneColorCycleBrushLayerSnapshot(snapshot);
  const persistedSnapshot = {
    ...(existingSnapshotRecord ?? {}),
    layerId,
    canonicalPaint: true,
    schemaVersion: 1,
    dimensions: { width, height },
    strokeData: {
      ...(cloneUnknownRecord(existingSnapshotRecord?.strokeData) ?? {}),
      hasContent: snapshot.hasContent,
      strokeCounter: snapshot.strokeCounter,
      paintBuffer: clonedSnapshot?.paintBuffer ?? new ArrayBuffer(0),
      gradientIdBuffer: clonedSnapshot?.gradientIdBuffer,
      gradientDefIdBuffer: clonedSnapshot?.gradientDefIdBuffer,
      speedBuffer: clonedSnapshot?.speedBuffer,
      speedSourceVersion: AUTHORED_SPEED_SOURCE_VERSION,
      flowBuffer: clonedSnapshot?.flowBuffer,
      phaseBuffer: clonedSnapshot?.phaseBuffer,
    },
    gradientDefs: metadata?.gradientDefs,
    slotPalettes: metadata?.slotPalettes,
    gradientDefStore: metadata?.gradientDefStore,
    paintSlot: metadata?.paintSlot,
    fgActiveSlot: metadata?.fgActiveSlot,
    activeGradientId: metadata?.activeGradientId,
  };
  const filteredLayers = existingLayers.filter((entry) => cloneUnknownRecord(entry)?.layerId !== layerId);
  return {
    ...(record ?? {}),
    canonicalPaint: true,
    schemaVersion: 1,
    dimensionsByLayerId: {
      ...existingDimensionsByLayerId,
      [layerId]: { width, height },
    },
    layers: [...filteredLayers, persistedSnapshot],
  };
};

export const createColorCycleCanonicalBrushStateFromDocumentSnapshot = ({
  layerId,
  snapshot,
  version,
  existingBrushState,
}: {
  layerId: string;
  snapshot: ColorCycleLayerDocumentSnapshot;
  version: number;
  existingBrushState: unknown;
}): unknown => createColorCycleCanonicalBrushStateFromSnapshot({
    layerId,
    width: snapshot.width,
    height: snapshot.height,
    snapshot: {
      paintBuffer: snapshot.paintBuffer ?? new ArrayBuffer(0),
      gradientIdBuffer: snapshot.gradientIdBuffer,
      gradientDefIdBuffer: snapshot.gradientDefIdBuffer,
      speedBuffer: snapshot.speedBuffer,
      speedSourceVersion: AUTHORED_SPEED_SOURCE_VERSION,
      flowBuffer: snapshot.flowBuffer,
      phaseBuffer: snapshot.phaseBuffer,
      hasContent: snapshot.hasContent,
      strokeCounter: version,
    },
    existingBrushState,
    metadata: snapshot,
  });

export const cloneColorCycleStrokeSnapshotBuffers = (
  strokeState: ColorCycleBrushPersistenceStrokeState,
): Omit<ColorCycleBrushLayerSnapshot, 'hasContent' | 'strokeCounter'> => {
  const { buffers, snapshot } = strokeState;
  const cloned = {
    paintBuffer: buffers.paint.length > 0
      ? buffers.paint.slice().buffer
      : cloneArrayBuffer(snapshot?.paintBuffer) ?? new ArrayBuffer(0),
    gradientIdBuffer: buffers.gid.length > 0
      ? buffers.gid.slice().buffer
      : cloneArrayBuffer(snapshot?.gradientIdBuffer),
    gradientDefIdBuffer: buffers.def.length > 0
      ? buffers.def.slice().buffer
      : cloneArrayBuffer(snapshot?.gradientDefIdBuffer),
    speedBuffer: buffers.spd.length > 0
      ? buffers.spd.slice().buffer
      : cloneArrayBuffer(snapshot?.speedBuffer),
    flowBuffer: buffers.flow.length > 0
      ? buffers.flow.slice().buffer
      : cloneArrayBuffer(snapshot?.flowBuffer),
    phaseBuffer: buffers.phase.length > 0
      ? buffers.phase.slice().buffer
      : cloneArrayBuffer(snapshot?.phaseBuffer),
  };
  recordColorCycleCanonicalBufferCopy('boundary-materialization', cloned);
  return cloned;
};

export const readColorCycleBrushLayerSnapshot = ({
  strokeState,
  hasStrokeContent,
}: {
  strokeState: ColorCycleBrushPersistenceStrokeState | undefined;
  hasStrokeContent: (strokeState: ColorCycleBrushPersistenceStrokeState) => boolean;
}): ColorCycleBrushLayerSnapshot | null => {
  if (!strokeState) {
    return null;
  }
  const snapshot = strokeState.snapshot;
  const buffers = cloneColorCycleStrokeSnapshotBuffers(strokeState);
  const hasContent = hasStrokeContent(strokeState);
  strokeState.hasContent = hasContent;
  return {
    ...buffers,
    hasContent,
    strokeCounter: strokeState.strokeCounter ?? snapshot?.strokeCounter ?? 0,
  };
};

export const readColorCycleBrushLayerSnapshotFromDocumentRead = (
  documentRead: ColorCycleLayerDocumentRead | null | undefined,
  options?: { fallbackStrokeCounter?: number },
): ColorCycleBrushLayerSnapshot | null => {
  const snapshot = documentRead?.snapshot;
  if (!snapshot?.paintBuffer) {
    return null;
  }
  const materialized = {
    paintBuffer: snapshot.paintBuffer.slice(0),
    gradientIdBuffer: cloneArrayBuffer(snapshot.gradientIdBuffer),
    gradientDefIdBuffer: cloneArrayBuffer(snapshot.gradientDefIdBuffer),
    speedBuffer: cloneArrayBuffer(snapshot.speedBuffer),
    flowBuffer: cloneArrayBuffer(snapshot.flowBuffer),
    phaseBuffer: cloneArrayBuffer(snapshot.phaseBuffer),
    hasContent: snapshot.hasContent,
    strokeCounter: options?.fallbackStrokeCounter ?? 0,
  };
  recordColorCycleCanonicalBufferCopy('boundary-materialization', materialized);
  return materialized;
};

const borrowExactStrokeBuffer = (buffer: Uint8Array | Uint16Array): ArrayBuffer => {
  if (
    !(buffer.buffer instanceof ArrayBuffer) ||
    buffer.byteOffset !== 0 ||
    buffer.byteLength !== buffer.buffer.byteLength
  ) {
    throw new Error('Color-cycle runtime publication requires exact ArrayBuffer-backed views');
  }
  return buffer.buffer;
};

export const createColorCycleLayerDocumentStateFromStrokeState = ({
  layerId,
  width,
  height,
  strokeState,
  meta,
  layerBaseSpeedCps,
  flowMode,
  hasStrokeContent,
  bufferOwnership = 'clone',
}: CreateColorCycleLayerDocumentStateFromStrokeStateOptions): ColorCycleLayerDocumentState => {
  const clonedMeta = cloneColorCycleBrushPersistenceLayerMeta(meta);
  const state: ColorCycleLayerDocumentState = {
    layerId,
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height)),
    paintBuffer: bufferOwnership === 'borrow'
      ? borrowExactStrokeBuffer(strokeState.buffers.paint)
      : strokeState.buffers.paint.slice().buffer as ArrayBuffer,
    gradientIdBuffer: bufferOwnership === 'borrow'
      ? borrowExactStrokeBuffer(strokeState.buffers.gid)
      : strokeState.buffers.gid.slice().buffer as ArrayBuffer,
    gradientDefIdBuffer: bufferOwnership === 'borrow'
      ? borrowExactStrokeBuffer(strokeState.buffers.def)
      : strokeState.buffers.def.slice().buffer as ArrayBuffer,
    speedBuffer: bufferOwnership === 'borrow'
      ? borrowExactStrokeBuffer(strokeState.buffers.spd)
      : strokeState.buffers.spd.slice().buffer as ArrayBuffer,
    flowBuffer: bufferOwnership === 'borrow'
      ? borrowExactStrokeBuffer(strokeState.buffers.flow)
      : strokeState.buffers.flow.slice().buffer as ArrayBuffer,
    phaseBuffer: bufferOwnership === 'borrow'
      ? borrowExactStrokeBuffer(strokeState.buffers.phase)
      : strokeState.buffers.phase.slice().buffer as ArrayBuffer,
    slotPalettes: clonedMeta?.slotPalettes?.map((palette) => ({
      slot: palette.slot,
      seamProfile: palette.seamProfile as GradientSeamProfile | undefined,
      stops: cloneColorCycleDocumentStops(palette.stops) ?? [],
    })),
    gradientDefs: clonedMeta?.gradientDefs,
    gradientDefStore: clonedMeta?.gradientDefStore?.map((entry) => ({
      ...entry,
      seamProfile: entry.seamProfile as ColorCycleGradientDefStoreEntry['seamProfile'],
      stops: cloneColorCycleDocumentStops(entry.stops) ?? [],
    })),
    activeGradientId: clonedMeta?.activeGradientId,
    paintSlot: clonedMeta?.paintSlot ?? strokeState.flow?.activeSlot,
    fgActiveSlot: clonedMeta?.fgActiveSlot,
    layerBaseSpeedCps,
    flowMode: strokeState.flow?.mode ?? flowMode,
    hasContent: hasStrokeContent(strokeState),
    sources: {
      brushStateSnapshot: false,
      topLevelBuffers: false,
      legacyStateRefs: false,
    },
  };
  if (bufferOwnership === 'clone') {
    recordColorCycleCanonicalBufferCopy('document-state-build', state);
  }
  return state;
};

export const createEmptyColorCycleLayerDocumentState = ({
  layerId,
  width,
  height,
}: CreateEmptyColorCycleLayerDocumentStateOptions): ColorCycleLayerDocumentState => {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const pixelCount = safeWidth * safeHeight;
  return {
    layerId,
    width: safeWidth,
    height: safeHeight,
    paintBuffer: new Uint8Array(pixelCount).buffer,
    gradientIdBuffer: new Uint8Array(pixelCount).buffer,
    gradientDefIdBuffer: new Uint16Array(pixelCount).buffer,
    speedBuffer: new Uint8Array(pixelCount).buffer,
    flowBuffer: new Uint8Array(pixelCount).buffer,
    phaseBuffer: new Uint8Array(pixelCount).buffer,
    hasContent: false,
    sources: {
      brushStateSnapshot: false,
      topLevelBuffers: false,
      legacyStateRefs: false,
    },
  };
};

const stripAnimatorIndexBufferPayload = (
  state: ColorCycleBrushPersistenceAnimatorState,
): ColorCycleBrushPersistenceAnimatorState => ({
  ...state,
  indexBuffer: state.indexBuffer
    ? {
        ...state.indexBuffer,
        data: new Uint8Array(0),
        gradientId: new Uint8Array(0),
        speedData: new Uint8Array(0),
        flowData: new Uint8Array(0),
        phaseData: new Uint8Array(0),
      }
    : state.indexBuffer,
});

export const serializeColorCycleBrushState = ({
  animators,
  getStrokeState,
  getDocumentRead,
  ensureStrokeSnapshot,
  hasPaintContent,
  hasStrokeContent,
  getLayerMeta,
  getFallbackStrokeCounter,
  settings,
}: SerializeColorCycleBrushStateOptions): ColorCycleBrushSerializedState => {
  const layers: ColorCycleBrushSerializedLayer[] = [];

  animators.forEach((animator, layerId) => {
    const strokeState = getStrokeState(layerId);
    const documentLayerSnapshot = readColorCycleBrushLayerSnapshotFromDocumentRead(
      getDocumentRead?.(layerId),
      { fallbackStrokeCounter: strokeState?.strokeCounter ?? getFallbackStrokeCounter() },
    );
    const hadSnapshot = Boolean(strokeState?.snapshot?.paintBuffer?.byteLength);
    if (!documentLayerSnapshot && strokeState?.hasContent && !hadSnapshot) {
      ensureStrokeSnapshot(strokeState);
    }
    const snapshot = strokeState?.snapshot;
    const buffers = documentLayerSnapshot
      ? {
          paintBuffer: documentLayerSnapshot.paintBuffer,
          gradientIdBuffer: documentLayerSnapshot.gradientIdBuffer,
          gradientDefIdBuffer: documentLayerSnapshot.gradientDefIdBuffer,
          speedBuffer: documentLayerSnapshot.speedBuffer,
          flowBuffer: documentLayerSnapshot.flowBuffer,
          phaseBuffer: documentLayerSnapshot.phaseBuffer,
        }
      : strokeState
      ? cloneColorCycleStrokeSnapshotBuffers(strokeState)
      : { paintBuffer: new ArrayBuffer(0) };
    const serializedPaintHasContent = hasPaintContent(buffers.paintBuffer);
    const hasContent = documentLayerSnapshot
      ? documentLayerSnapshot.hasContent
      : strokeState
      ? hasStrokeContent(strokeState)
      : Boolean(snapshot?.hasContent ?? serializedPaintHasContent);
    if (!documentLayerSnapshot && strokeState) {
      strokeState.hasContent = hasContent;
    }
    const strokeCounter = documentLayerSnapshot?.strokeCounter
      ?? strokeState?.strokeCounter
      ?? snapshot?.strokeCounter
      ?? getFallbackStrokeCounter();
    const colorCycleMeta = getLayerMeta(layerId);
    const fgDerivedGradients = colorCycleMeta?.fgDerivedGradients ?? colorCycleMeta?.derivedGradients;
    const derivedGradients = fgDerivedGradients
      ? fgDerivedGradients.map((entry) => ({
          key: entry.key,
          slot: entry.slot,
          spec: { ...entry.spec },
        }))
      : undefined;
    const animatorBaseState =
      typeof animator.serializeBaseState === 'function'
        ? animator.serializeBaseState()
        : animator.serialize();
    const hasCanonicalStrokeSnapshot = buffers.paintBuffer.byteLength > 0;
    const serializedAnimatorState = hasCanonicalStrokeSnapshot
      ? stripAnimatorIndexBufferPayload(animatorBaseState)
      : animatorBaseState;

    layers.push({
      layerId,
      data: serializedAnimatorState,
      gradientDefs: colorCycleMeta?.gradientDefs,
      slotPalettes: colorCycleMeta?.slotPalettes,
      gradientDefStore: colorCycleMeta?.gradientDefStore,
      nextGradientDefId: colorCycleMeta?.nextGradientDefId,
      paintSlot: colorCycleMeta?.paintSlot,
      legacyRemap: colorCycleMeta?.legacyRemap,
      fgActiveSlot: colorCycleMeta?.fgActiveSlot,
      fgDerivedKey: colorCycleMeta?.fgDerivedKey,
      fgDerivedGradients: derivedGradients,
      derivedGradients,
      activeGradientId: colorCycleMeta?.activeGradientId,
      strokeData: {
        ...buffers,
        speedSourceVersion: AUTHORED_SPEED_SOURCE_VERSION,
        hasContent,
        strokeCounter,
      },
    });
  });

  return {
    layers,
    ...settings,
  };
};

export const applyColorCycleBrushPaintPatchToBuffers = ({
  canvasWidth,
  canvasHeight,
  buffers,
  roi,
  bytes,
  extras,
}: {
  canvasWidth: number;
  canvasHeight: number;
  buffers: ColorCycleBrushPersistenceBuffers;
  roi: { x: number; y: number; width: number; height: number };
  bytes: Uint8Array;
  extras?: ColorCycleBrushPaintPatchExtras;
}): ColorCycleBrushPaintPatchResult | null => {
  if (!canvasWidth || !canvasHeight) {
    return null;
  }

  const x = Math.max(0, Math.floor(roi.x));
  const y = Math.max(0, Math.floor(roi.y));
  const right = Math.min(canvasWidth, Math.ceil(roi.x + roi.width));
  const bottom = Math.min(canvasHeight, Math.ceil(roi.y + roi.height));
  const patchWidth = right - x;
  const patchHeight = bottom - y;
  if (patchWidth <= 0 || patchHeight <= 0) {
    return null;
  }
  const patchPixels = patchWidth * patchHeight;
  if (bytes.length < patchPixels) {
    return null;
  }
  if (extras?.gradientIdBytes && extras.gradientIdBytes.length < patchPixels) {
    return null;
  }
  if (extras?.gradientDefIdBytes && extras.gradientDefIdBytes.length < patchPixels * Uint16Array.BYTES_PER_ELEMENT) {
    return null;
  }
  if (extras?.speedBytes && extras.speedBytes.length < patchPixels) {
    return null;
  }
  if (extras?.flowBytes && extras.flowBytes.length < patchPixels) {
    return null;
  }
  if (extras?.phaseBytes && extras.phaseBytes.length < patchPixels) {
    return null;
  }

  const gradientDefValues = extras?.gradientDefIdBytes
    ? new Uint16Array(
        extras.gradientDefIdBytes.buffer,
        extras.gradientDefIdBytes.byteOffset,
        Math.floor(extras.gradientDefIdBytes.byteLength / Uint16Array.BYTES_PER_ELEMENT),
      )
    : null;
  let srcIndex = 0;
  for (let row = 0; row < patchHeight; row += 1) {
    const destBase = (y + row) * canvasWidth + x;
    for (let col = 0; col < patchWidth; col += 1) {
      const value = bytes[srcIndex++] ?? 0;
      const destIndex = destBase + col;
      buffers.paint[destIndex] = value;
      if (extras?.gradientIdBytes) {
        buffers.gid[destIndex] = extras.gradientIdBytes[srcIndex - 1] ?? 0;
      }
      if (gradientDefValues) {
        buffers.def[destIndex] = gradientDefValues[srcIndex - 1] ?? 0;
      } else if (value === 0) {
        buffers.def[destIndex] = 0;
      }
      if (extras?.speedBytes) {
        buffers.spd[destIndex] = extras.speedBytes[srcIndex - 1] ?? 0;
      }
      if (extras?.flowBytes) {
        buffers.flow[destIndex] = extras.flowBytes[srcIndex - 1] ?? 0;
      }
      if (extras?.phaseBytes) {
        buffers.phase[destIndex] = extras.phaseBytes[srcIndex - 1] ?? 0;
      }
    }
  }

  return {
    x,
    y,
    width: patchWidth,
    height: patchHeight,
    hasNonZero: buffers.paint.some((value) => value !== 0),
  };
};

const ensureBufferSize = <T extends Uint8Array | Uint16Array>(
  buffer: T,
  expectedSize: number,
  create: (size: number) => T,
): T => (
  buffer.length === expectedSize ? buffer : create(expectedSize)
);

const copyUint8IntoExpectedSize = (
  target: Uint8Array,
  source: Uint8Array,
): void => {
  if (source.length === target.length) {
    target.set(source);
    return;
  }
  const copyLen = Math.min(target.length, source.length);
  target.fill(0);
  target.set(source.subarray(0, copyLen));
};

const copyUint16IntoExpectedSize = (
  target: Uint16Array,
  source: Uint16Array,
): void => {
  if (source.length === target.length) {
    target.set(source);
    return;
  }
  const copyLen = Math.min(target.length, source.length);
  target.fill(0);
  target.set(source.subarray(0, copyLen));
};

export const applyColorCycleBrushLayerSnapshotToBuffers = ({
  buffers,
  expectedSize,
  snapshot,
  animatorIndex,
  flowSlotMask,
  fallbackSpeedByte,
  fallbackFlowByte,
}: {
  buffers: ColorCycleBrushPersistenceBuffers;
  expectedSize: number;
  snapshot: ColorCycleBrushLayerSnapshotInput;
  animatorIndex?: ColorCycleBrushAnimatorIndexInput;
  flowSlotMask: number;
  fallbackSpeedByte?: number;
  fallbackFlowByte?: number;
}): ColorCycleBrushLayerSnapshotApplyResult => {
  const buffer =
    snapshot.paintBuffer && snapshot.paintBuffer.byteLength > 0
      ? snapshot.paintBuffer
      : (animatorIndex?.data ?? new ArrayBuffer(0));
  const gradientBuffer =
    snapshot.gradientIdBuffer && snapshot.gradientIdBuffer.byteLength > 0
      ? snapshot.gradientIdBuffer
      : animatorIndex?.gradientIdData;
  const gradientDefBuffer =
    snapshot.gradientDefIdBuffer && snapshot.gradientDefIdBuffer.byteLength > 0
      ? snapshot.gradientDefIdBuffer
      : undefined;
  const speedBuffer =
    snapshot.speedBuffer && snapshot.speedBuffer.byteLength > 0
      ? snapshot.speedBuffer
      : animatorIndex?.speedData;
  const flowBuffer =
    snapshot.flowBuffer && snapshot.flowBuffer.byteLength > 0
      ? snapshot.flowBuffer
      : animatorIndex?.flowData;
  const phaseBuffer =
    snapshot.phaseBuffer && snapshot.phaseBuffer.byteLength > 0
      ? snapshot.phaseBuffer
      : animatorIndex?.phaseData;
  const expectsContent = Boolean(snapshot.hasContent);
  const selectedPaint = new Uint8Array(buffer);
  const selectedPaintHasContent = selectedPaint.some((value) => value !== 0);
  const isExplicitEmptySnapshot = !expectsContent && !selectedPaintHasContent;
  const incoming = isExplicitEmptySnapshot ? new Uint8Array(0) : selectedPaint;
  const incomingGradient = !isExplicitEmptySnapshot && gradientBuffer ? new Uint8Array(gradientBuffer) : null;
  const incomingGradientDef = !isExplicitEmptySnapshot && gradientDefBuffer ? new Uint16Array(gradientDefBuffer) : null;
  const incomingSpeed = !isExplicitEmptySnapshot && speedBuffer ? new Uint8Array(speedBuffer) : null;
  const incomingFlow = !isExplicitEmptySnapshot && flowBuffer ? new Uint8Array(flowBuffer) : null;
  const incomingPhase = !isExplicitEmptySnapshot && phaseBuffer ? new Uint8Array(phaseBuffer) : null;

  buffers.paint = ensureBufferSize(buffers.paint, expectedSize, (size) => new Uint8Array(size));
  buffers.gid = ensureBufferSize(buffers.gid, expectedSize, (size) => new Uint8Array(size));
  buffers.spd = ensureBufferSize(buffers.spd, expectedSize, (size) => new Uint8Array(size));
  buffers.flow = ensureBufferSize(buffers.flow, expectedSize, (size) => new Uint8Array(size));
  buffers.phase = ensureBufferSize(buffers.phase, expectedSize, (size) => new Uint8Array(size));
  buffers.def = ensureBufferSize(buffers.def, expectedSize, (size) => new Uint16Array(size));

  if (incoming.length > 0) {
    copyUint8IntoExpectedSize(buffers.paint, incoming);
  } else if (isExplicitEmptySnapshot) {
    buffers.paint.fill(0);
    buffers.def.fill(0);
  }
  if (incomingGradient) {
    copyUint8IntoExpectedSize(buffers.gid, incomingGradient);
    const remapSlot = animatorIndex?.legacyRemap?.to ?? 0;
    const remapFrom = animatorIndex?.legacyRemap?.from ?? 63;
    for (let i = 0; i < buffers.gid.length; i += 1) {
      let raw = buffers.gid[i] & flowSlotMask;
      if (raw === remapFrom) {
        raw = remapSlot;
      }
      buffers.gid[i] = raw;
    }
  } else if (isExplicitEmptySnapshot) {
    buffers.gid.fill(0);
  }
  if (incomingGradientDef) {
    copyUint16IntoExpectedSize(buffers.def, incomingGradientDef);
  } else if (isExplicitEmptySnapshot) {
    buffers.def.fill(0);
  }
  if (incomingSpeed) {
    copyUint8IntoExpectedSize(buffers.spd, incomingSpeed);
  } else if (isExplicitEmptySnapshot) {
    buffers.spd.fill(0);
  }
  if (incomingFlow) {
    copyUint8IntoExpectedSize(buffers.flow, incomingFlow);
  } else if (isExplicitEmptySnapshot) {
    buffers.flow.fill(0);
  }
  if (incomingPhase) {
    copyUint8IntoExpectedSize(buffers.phase, incomingPhase);
  } else if (isExplicitEmptySnapshot) {
    buffers.phase.fill(0);
  }
  if (!incomingSpeed && typeof fallbackSpeedByte === 'number') {
    for (let i = 0; i < buffers.paint.length; i += 1) {
      buffers.spd[i] = buffers.paint[i] === 0 ? 0 : fallbackSpeedByte;
    }
  }
  if (!incomingFlow && typeof fallbackFlowByte === 'number') {
    for (let i = 0; i < buffers.paint.length; i += 1) {
      buffers.flow[i] = buffers.paint[i] === 0 ? 0 : fallbackFlowByte;
    }
  }

  let hasLayerContent = expectsContent;
  if (!hasLayerContent && selectedPaintHasContent) {
    hasLayerContent = true;
  }

  const uploadPaint = incoming.length === expectedSize ? incoming : buffers.paint;
  const uploadGradientId = incomingGradient ?? buffers.gid;
  const uploadSpeed = incomingSpeed ?? buffers.spd;
  const uploadFlow = incomingFlow ?? buffers.flow;
  const uploadPhase = incomingPhase ?? buffers.phase;

  return {
    hasLayerContent,
    selectedPaintHasContent,
    isExplicitEmptySnapshot,
    uploadPaint,
    uploadGradientId,
    uploadSpeed,
    uploadFlow,
    uploadPhase,
    nextSnapshot: {
      paintBuffer: hasLayerContent && uploadPaint.length > 0
        ? uploadPaint.slice().buffer
        : new ArrayBuffer(0),
      gradientIdBuffer: hasLayerContent && uploadGradientId.length > 0
        ? uploadGradientId.slice().buffer
        : snapshot.gradientIdBuffer?.slice(0),
      gradientDefIdBuffer: hasLayerContent && buffers.def.length > 0
        ? buffers.def.slice().buffer
        : snapshot.gradientDefIdBuffer?.slice(0),
      speedBuffer: hasLayerContent && uploadSpeed.length > 0
        ? uploadSpeed.slice().buffer
        : snapshot.speedBuffer?.slice(0),
      flowBuffer: hasLayerContent && uploadFlow.length > 0
        ? uploadFlow.slice().buffer
        : snapshot.flowBuffer?.slice(0),
      phaseBuffer: hasLayerContent && uploadPhase.length > 0
        ? uploadPhase.slice().buffer
        : snapshot.phaseBuffer?.slice(0),
      hasContent: hasLayerContent,
      strokeCounter: snapshot.strokeCounter ?? 0,
    },
  };
};
