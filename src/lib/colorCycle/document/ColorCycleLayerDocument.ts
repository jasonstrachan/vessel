import type {
  ColorCycleGradientDef,
  ColorCycleGradientDefStoreEntry,
  ColorCycleSlotPalette,
} from '@/types';
import type {
  ColorCycleLayerDocumentSnapshot,
  ColorCycleLayerDocumentState,
} from './colorCycleDocumentContract';
import { resolveColorCycleBrushPersistenceOwner } from './brushPersistenceOwnerAlias';
import { debugWarn } from '@/utils/debug';
import { strokeFinalizeProbeTimeSync } from '@/utils/strokeFinalizeProbe';

export type ColorCycleLayerDocumentResidency =
  | 'resident'
  | 'cold-archive-ref'
  | 'static-preview-only';

export type ColorCycleLayerDocumentArchiveRefs = {
  paintRef?: string;
  gradientIdRef?: string;
  gradientDefIdRef?: string;
  speedRef?: string;
  flowRef?: string;
  phaseRef?: string;
};

export type ColorCycleLayerDocumentRead = {
  snapshot: ColorCycleLayerDocumentSnapshot;
  version: number;
  pixelVersion: number;
};

export type ColorCycleDirtyRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ColorCycleLayerDirtyBatch = {
  layerId: string;
  version: number;
  rects: ColorCycleDirtyRect[];
};

const dirtyRectsTouchOrOverlap = (
  a: ColorCycleDirtyRect,
  b: ColorCycleDirtyRect,
): boolean => (
  a.x <= b.x + b.width &&
  b.x <= a.x + a.width &&
  a.y <= b.y + b.height &&
  b.y <= a.y + a.height
);

const mergeDirtyRects = (
  a: ColorCycleDirtyRect,
  b: ColorCycleDirtyRect,
): ColorCycleDirtyRect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
};

export const coalesceColorCycleDirtyRects = (
  rects: ColorCycleDirtyRect[],
): ColorCycleDirtyRect[] => {
  const coalesced: ColorCycleDirtyRect[] = [];
  rects.forEach((rect) => {
    let nextRect = { ...rect };
    for (let index = 0; index < coalesced.length; index += 1) {
      const existing = coalesced[index];
      if (!dirtyRectsTouchOrOverlap(existing, nextRect)) {
        continue;
      }
      nextRect = mergeDirtyRects(existing, nextRect);
      coalesced.splice(index, 1);
      index = -1;
    }
    coalesced.push(nextRect);
  });
  return coalesced;
};

export type ColorCycleLayerDocumentAuditEntry = {
  reason: string;
  versionBefore: number;
  versionAfter: number;
  committedAtMs: number;
};

export type ColorCycleLayerDocumentRuntimePolicy = {
  hasEditableSource: boolean;
  hasRuntimeRestoreSource: boolean;
  hasPlaybackWarmupSource: boolean;
  isPreviewOnly: boolean;
};

export type ColorCycleLayerDocumentOptions = {
  initialVersion?: number;
  initialPixelVersion?: number;
  residency?: ColorCycleLayerDocumentResidency;
  archiveRefs?: ColorCycleLayerDocumentArchiveRefs;
  now?: () => number;
};

export type ColorCycleLayerDocumentBaselineOptions = {
  version?: number;
  pixelVersion?: number;
  clearAudit?: boolean;
};

export type ColorCycleLayerDocumentReplaceOptions = {
  force?: boolean;
  pixelsChanged?: boolean;
  dirtyRects?: ColorCycleDirtyRect[];
  takeOwnership?: boolean;
};

type ColorCycleLayerDocumentCommitOptions = Omit<ColorCycleLayerDocumentReplaceOptions, 'dirtyRects'>;

export type DerivedSurface = {
  builtFromVersion: number | null;
  rebuild(snapshot: ColorCycleLayerDocumentSnapshot, version: number): void;
};

class ColorCycleLayerDocumentDirtyTracker {
  private pendingBatch: ColorCycleLayerDirtyBatch | null = null;

  markLayerDirty(layerId: string, version: number, rects: ColorCycleDirtyRect[]): void {
    const sanitizedRects = rects
      .map((rect) => this.sanitizeRect(rect))
      .filter((rect): rect is ColorCycleDirtyRect => rect !== null);
    if (sanitizedRects.length === 0) {
      return;
    }

    this.pendingBatch = {
      layerId,
      version,
      rects: coalesceColorCycleDirtyRects(sanitizedRects),
    };
  }

  peek(): ColorCycleLayerDirtyBatch | null {
    return this.pendingBatch ? this.cloneBatch(this.pendingBatch) : null;
  }

  consume(): ColorCycleLayerDirtyBatch | null {
    const batch = this.peek();
    this.pendingBatch = null;
    return batch;
  }

  clear(): void {
    this.pendingBatch = null;
  }

  private sanitizeRect(rect: ColorCycleDirtyRect): ColorCycleDirtyRect | null {
    const x = Math.max(0, Math.floor(rect.x));
    const y = Math.max(0, Math.floor(rect.y));
    const width = Math.max(0, Math.ceil(rect.width));
    const height = Math.max(0, Math.ceil(rect.height));
    if (width <= 0 || height <= 0) {
      return null;
    }

    return { x, y, width, height };
  }

  private cloneBatch(batch: ColorCycleLayerDirtyBatch): ColorCycleLayerDirtyBatch {
    return {
      layerId: batch.layerId,
      version: batch.version,
      rects: batch.rects.map((rect) => ({ ...rect })),
    };
  }
}

const colorCycleLayerDocumentsByOwner = new WeakMap<object, Map<string, ColorCycleLayerDocument>>();
const colorCycleLayerDocumentOwnerAliases = new WeakMap<object, object>();

export const registerColorCycleLayerDocumentOwnerAlias = (
  publicOwner: object,
  storageOwner: object,
): void => {
  colorCycleLayerDocumentOwnerAliases.set(publicOwner, storageOwner);
};

const resolveColorCycleLayerDocumentOwner = (owner: object): object => {
  const resolvedOwner = resolveColorCycleBrushPersistenceOwner(owner);
  return colorCycleLayerDocumentOwnerAliases.get(resolvedOwner) ?? resolvedOwner;
};

const getColorCycleLayerDocumentMapForOwner = (owner: object): Map<string, ColorCycleLayerDocument> => {
  const resolvedOwner = resolveColorCycleLayerDocumentOwner(owner);
  let documents = colorCycleLayerDocumentsByOwner.get(resolvedOwner);
  if (!documents) {
    documents = new Map<string, ColorCycleLayerDocument>();
    colorCycleLayerDocumentsByOwner.set(resolvedOwner, documents);
  }
  return documents;
};

export const hasColorCycleLayerDocumentForOwner = (owner: object, layerId: string): boolean => (
  colorCycleLayerDocumentsByOwner.get(resolveColorCycleLayerDocumentOwner(owner))?.has(layerId) ?? false
);

export const getColorCycleLayerDocumentForOwner = (
  owner: object,
  layerId: string,
): ColorCycleLayerDocument | undefined => (
  colorCycleLayerDocumentsByOwner.get(resolveColorCycleLayerDocumentOwner(owner))?.get(layerId)
);

export const setColorCycleLayerDocumentForOwner = (
  owner: object,
  layerId: string,
  document: ColorCycleLayerDocument,
): void => {
  getColorCycleLayerDocumentMapForOwner(owner).set(layerId, document);
};

export const deleteColorCycleLayerDocumentForOwner = (owner: object, layerId: string): void => {
  const resolvedOwner = resolveColorCycleLayerDocumentOwner(owner);
  const documents = colorCycleLayerDocumentsByOwner.get(resolvedOwner);
  documents?.delete(layerId);
  if (documents?.size === 0) {
    colorCycleLayerDocumentsByOwner.delete(resolvedOwner);
  }
};

export const clearColorCycleLayerDocumentsForOwner = (owner: object): void => {
  const resolvedOwner = resolveColorCycleLayerDocumentOwner(owner);
  colorCycleLayerDocumentsByOwner.get(resolvedOwner)?.clear();
  colorCycleLayerDocumentsByOwner.delete(resolvedOwner);
};

export type DerivedSurfaceRenderAssertionOptions = {
  document: ColorCycleLayerDocumentVersionSource;
  surface: Pick<DerivedSurface, 'builtFromVersion'>;
  label: string;
  hasScheduledRebuild?: boolean;
  now?: () => number;
};

type ColorCycleLayerDocumentVersionSource =
  | ColorCycleLayerDocument
  | { version: number };

const cloneArrayBuffer = (buffer: ArrayBuffer | undefined): ArrayBuffer | undefined => (
  buffer ? buffer.slice(0) : undefined
);

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
    stops: entry.stops.map((stop) => ({ ...stop })),
  }))
);

const cloneGradientDefStore = (
  gradientDefStore: ColorCycleGradientDefStoreEntry[] | undefined,
): ColorCycleGradientDefStoreEntry[] | undefined => (
  gradientDefStore?.map((entry) => ({
    ...entry,
    stops: entry.stops.map((stop) => ({ ...stop })),
  }))
);

const cloneDocumentState = (
  state: ColorCycleLayerDocumentState,
): ColorCycleLayerDocumentState => ({
  ...state,
  paintBuffer: cloneArrayBuffer(state.paintBuffer),
  gradientIdBuffer: cloneArrayBuffer(state.gradientIdBuffer),
  gradientDefIdBuffer: cloneArrayBuffer(state.gradientDefIdBuffer),
  speedBuffer: cloneArrayBuffer(state.speedBuffer),
  flowBuffer: cloneArrayBuffer(state.flowBuffer),
  phaseBuffer: cloneArrayBuffer(state.phaseBuffer),
  slotPalettes: cloneSlotPalettes(state.slotPalettes),
  gradientDefs: cloneGradientDefs(state.gradientDefs),
  gradientDefStore: cloneGradientDefStore(state.gradientDefStore),
  sources: { ...state.sources },
});

const arrayBuffersEqual = (
  a: ArrayBuffer | undefined,
  b: ArrayBuffer | undefined,
): boolean => {
  if (!a || !b) {
    return a === b;
  }
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  const aBytes = new Uint8Array(a);
  const bBytes = new Uint8Array(b);
  for (let index = 0; index < aBytes.length; index += 1) {
    if (aBytes[index] !== bBytes[index]) {
      return false;
    }
  }
  return true;
};

const optionalArrayEqual = <T>(
  a: T[] | undefined,
  b: T[] | undefined,
  equal: (left: T, right: T) => boolean,
): boolean => {
  if (!a || !b) {
    return a === b;
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.every((entry, index) => equal(entry, b[index]));
};

const stopsEqual = (
  a: Array<{ position: number; color: string }>,
  b: Array<{ position: number; color: string }>,
): boolean => (
  a.length === b.length &&
  a.every((stop, index) => (
    stop.position === b[index]?.position &&
    stop.color === b[index]?.color
  ))
);

const gradientDefsEqual = (
  a: ColorCycleGradientDef,
  b: ColorCycleGradientDef,
): boolean => (
  a.id === b.id &&
  a.name === b.name &&
  a.currentSlot === b.currentSlot
);

const slotPalettesEqual = (
  a: ColorCycleSlotPalette,
  b: ColorCycleSlotPalette,
): boolean => (
  a.slot === b.slot &&
  a.seamProfile === b.seamProfile &&
  stopsEqual(a.stops, b.stops)
);

const gradientDefStoreEntriesEqual = (
  a: ColorCycleGradientDefStoreEntry,
  b: ColorCycleGradientDefStoreEntry,
): boolean => (
  a.id === b.id &&
  a.kind === b.kind &&
  a.hash === b.hash &&
  a.source === b.source &&
  a.seamProfile === b.seamProfile &&
  a.createdAtMs === b.createdAtMs &&
  a.slot === b.slot &&
  a.speedCps === b.speedCps &&
  stopsEqual(a.stops, b.stops)
);

const documentPixelBuffersEqual = (
  a: ColorCycleLayerDocumentState,
  b: ColorCycleLayerDocumentState,
): boolean => (
  arrayBuffersEqual(a.paintBuffer, b.paintBuffer) &&
  arrayBuffersEqual(a.gradientIdBuffer, b.gradientIdBuffer) &&
  arrayBuffersEqual(a.gradientDefIdBuffer, b.gradientDefIdBuffer) &&
  arrayBuffersEqual(a.speedBuffer, b.speedBuffer) &&
  arrayBuffersEqual(a.flowBuffer, b.flowBuffer) &&
  arrayBuffersEqual(a.phaseBuffer, b.phaseBuffer)
);

const documentStatesEqual = (
  a: ColorCycleLayerDocumentState,
  b: ColorCycleLayerDocumentState,
): boolean => (
  a.layerId === b.layerId &&
  a.width === b.width &&
  a.height === b.height &&
  a.activeGradientId === b.activeGradientId &&
  a.paintSlot === b.paintSlot &&
  a.fgActiveSlot === b.fgActiveSlot &&
  a.layerBaseSpeedCps === b.layerBaseSpeedCps &&
  a.flowMode === b.flowMode &&
  a.hasContent === b.hasContent &&
  a.sources.brushStateSnapshot === b.sources.brushStateSnapshot &&
  a.sources.topLevelBuffers === b.sources.topLevelBuffers &&
  a.sources.legacyStateRefs === b.sources.legacyStateRefs &&
  documentPixelBuffersEqual(a, b) &&
  optionalArrayEqual(a.slotPalettes, b.slotPalettes, slotPalettesEqual) &&
  optionalArrayEqual(a.gradientDefs, b.gradientDefs, gradientDefsEqual) &&
  optionalArrayEqual(a.gradientDefStore, b.gradientDefStore, gradientDefStoreEntriesEqual)
);

const freezeDocumentSnapshot = (
  state: ColorCycleLayerDocumentState,
): ColorCycleLayerDocumentSnapshot => {
  Object.freeze(state.sources);
  state.gradientDefs?.forEach(Object.freeze);
  state.slotPalettes?.forEach((palette) => {
    palette.stops.forEach(Object.freeze);
    Object.freeze(palette.stops);
    Object.freeze(palette);
  });
  state.gradientDefStore?.forEach((entry) => {
    entry.stops.forEach(Object.freeze);
    Object.freeze(entry.stops);
    Object.freeze(entry);
  });
  Object.freeze(state.gradientDefs);
  Object.freeze(state.slotPalettes);
  Object.freeze(state.gradientDefStore);
  return Object.freeze(state);
};

const getVersionFromSource = (source: ColorCycleLayerDocumentVersionSource): number => (
  source instanceof ColorCycleLayerDocument ? source.version : source.version
);

export const isDerivedSurfaceStale = (
  document: ColorCycleLayerDocumentVersionSource,
  surface: Pick<DerivedSurface, 'builtFromVersion'>,
): boolean => surface.builtFromVersion !== getVersionFromSource(document);

const STALE_DERIVED_SURFACE_RENDER_WARNING_INTERVAL_MS = 1_000;
const staleDerivedSurfaceRenderWarnedAtByKey = new Map<string, number>();

export const assertDerivedSurfaceFreshForRender = ({
  document,
  surface,
  label,
  hasScheduledRebuild = false,
  now = Date.now,
}: DerivedSurfaceRenderAssertionOptions): boolean => {
  const expectedVersion = getVersionFromSource(document);
  if (surface.builtFromVersion === expectedVersion) {
    return true;
  }
  if (hasScheduledRebuild || process.env.NODE_ENV === 'production') {
    return false;
  }

  const timestamp = now();
  const warningKey = `${label}:${surface.builtFromVersion ?? 'null'}->${expectedVersion}`;
  const previousWarningAt = staleDerivedSurfaceRenderWarnedAtByKey.get(warningKey) ?? -Infinity;
  if (timestamp - previousWarningAt >= STALE_DERIVED_SURFACE_RENDER_WARNING_INTERVAL_MS) {
    staleDerivedSurfaceRenderWarnedAtByKey.set(warningKey, timestamp);
    debugWarn('ColorCycleDocument', 'stale derived surface render', {
      label,
      builtFromVersion: surface.builtFromVersion,
      documentVersion: expectedVersion,
    });
  }
  return false;
};

export class CCDocumentTransaction {
  private isClosed = false;

  private draft: ColorCycleLayerDocumentState;

  private readonly dirtyRects: ColorCycleDirtyRect[] = [];

  constructor(
    private readonly document: ColorCycleLayerDocument,
    readonly reason: string,
    initialState: ColorCycleLayerDocumentState,
  ) {
    this.draft = cloneDocumentState(initialState);
  }

  mutate(mutator: (draft: ColorCycleLayerDocumentState) => void): void {
    this.assertOpen();
    mutator(this.draft);
  }

  markDirtyRect(rect: ColorCycleDirtyRect): void {
    this.assertOpen();
    this.dirtyRects.push({ ...rect });
  }

  readDraft(): ColorCycleLayerDocumentSnapshot {
    this.assertOpen();
    return freezeDocumentSnapshot(cloneDocumentState(this.draft));
  }

  commit(): ColorCycleLayerDocumentRead {
    this.assertOpen();
    this.isClosed = true;
    return this.document.commitTransaction(this.reason, this.draft, this.dirtyRects);
  }

  rollback(): void {
    this.assertOpen();
    this.isClosed = true;
  }

  private assertOpen(): void {
    if (this.isClosed) {
      throw new Error('Color-cycle document transaction is already closed');
    }
  }
}

export class ColorCycleLayerDocument {
  private currentState: ColorCycleLayerDocumentState;

  private currentSnapshot: ColorCycleLayerDocumentSnapshot;

  private currentVersion: number;

  private currentPixelVersion: number;

  private readonly auditEntries: ColorCycleLayerDocumentAuditEntry[] = [];

  private readonly now: () => number;

  private readonly dirtyTracker = new ColorCycleLayerDocumentDirtyTracker();

  private currentResidency: ColorCycleLayerDocumentResidency;

  private currentArchiveRefs: ColorCycleLayerDocumentArchiveRefs | null;

  constructor(
    initialState: ColorCycleLayerDocumentState,
    options: ColorCycleLayerDocumentOptions = {},
  ) {
    this.currentState = cloneDocumentState(initialState);
    this.currentSnapshot = freezeDocumentSnapshot(cloneDocumentState(this.currentState));
    this.currentVersion = options.initialVersion ?? 0;
    this.currentPixelVersion = options.initialPixelVersion ?? this.currentVersion;
    this.currentResidency = options.residency ?? 'resident';
    this.currentArchiveRefs = options.archiveRefs ? { ...options.archiveRefs } : null;
    this.now = options.now ?? Date.now;
  }

  get layerId(): string {
    return this.currentState.layerId;
  }

  get version(): number {
    return this.currentVersion;
  }

  get pixelVersion(): number {
    return this.currentPixelVersion;
  }

  get residency(): ColorCycleLayerDocumentResidency {
    return this.currentResidency;
  }

  get archiveRefs(): ColorCycleLayerDocumentArchiveRefs | null {
    return this.currentArchiveRefs ? { ...this.currentArchiveRefs } : null;
  }

  get runtimePolicy(): ColorCycleLayerDocumentRuntimePolicy {
    const hasCompleteBuffers = this.hasCompleteCanonicalBuffers();
    const hasColdArchiveSource = this.currentResidency === 'cold-archive-ref' && this.hasArchiveRefs();
    const hasEditableSource = this.currentResidency !== 'static-preview-only' && (
      hasCompleteBuffers || hasColdArchiveSource
    );
    const hasRuntimeRestoreSource = this.currentResidency === 'static-preview-only'
      ? false
      : hasCompleteBuffers || hasColdArchiveSource;
    const hasPlaybackWarmupSource = this.currentResidency === 'static-preview-only'
      ? false
      : hasRuntimeRestoreSource || this.currentState.hasContent;

    return {
      hasEditableSource,
      hasRuntimeRestoreSource,
      hasPlaybackWarmupSource,
      isPreviewOnly: this.currentResidency === 'static-preview-only' || !hasRuntimeRestoreSource,
    };
  }

  read(): ColorCycleLayerDocumentRead {
    return {
      snapshot: this.currentSnapshot,
      version: this.currentVersion,
      pixelVersion: this.currentPixelVersion,
    };
  }

  peekDirtyBatch(): ColorCycleLayerDirtyBatch | null {
    return this.dirtyTracker.peek();
  }

  consumeDirtyBatch(): ColorCycleLayerDirtyBatch | null {
    return this.dirtyTracker.consume();
  }

  beginTransaction(reason: string): CCDocumentTransaction {
    if (!reason) {
      throw new Error('Color-cycle document transactions require a reason');
    }
    return new CCDocumentTransaction(this, reason, this.currentState);
  }

  replaceState(
    nextState: ColorCycleLayerDocumentState,
    reason: string,
    options?: ColorCycleLayerDocumentReplaceOptions,
  ): ColorCycleLayerDocumentRead {
    if (!reason) {
      throw new Error('Color-cycle document transactions require a reason');
    }
    return this.commitTransaction(reason, nextState, options?.dirtyRects, {
      force: options?.force,
      pixelsChanged: options?.pixelsChanged,
      takeOwnership: options?.takeOwnership,
    });
  }

  replaceBaseline(
    nextState: ColorCycleLayerDocumentState,
    options: ColorCycleLayerDocumentBaselineOptions = {},
  ): ColorCycleLayerDocumentRead {
    this.currentState = cloneDocumentState(nextState);
    this.currentSnapshot = freezeDocumentSnapshot(cloneDocumentState(this.currentState));
    this.currentVersion = options.version ?? 0;
    this.currentPixelVersion = options.pixelVersion ?? this.currentVersion;
    this.dirtyTracker.clear();
    if (options.clearAudit !== false) {
      this.auditEntries.length = 0;
    }

    return this.read();
  }

  replaceResidency(
    nextResidency: ColorCycleLayerDocumentResidency,
    options?: {
      reason?: string;
      archiveRefs?: ColorCycleLayerDocumentArchiveRefs | null;
    },
  ): ColorCycleLayerDocumentRead;
  replaceResidency(
    nextResidency: ColorCycleLayerDocumentResidency,
    reason?: string,
  ): ColorCycleLayerDocumentRead;
  replaceResidency(
    nextResidency: ColorCycleLayerDocumentResidency,
    reason: string | {
      reason?: string;
      archiveRefs?: ColorCycleLayerDocumentArchiveRefs | null;
    } = 'residency-change',
  ): ColorCycleLayerDocumentRead {
    const nextReason = typeof reason === 'string' ? reason : reason?.reason ?? 'residency-change';
    const nextArchiveRefs = typeof reason === 'string' ? undefined : reason?.archiveRefs;
    const archiveRefsChanged = nextArchiveRefs !== undefined && !this.archiveRefsEqual(this.currentArchiveRefs, nextArchiveRefs);
    if (this.currentResidency === nextResidency && !archiveRefsChanged) {
      return this.read();
    }

    this.currentResidency = nextResidency;
    if (nextArchiveRefs !== undefined) {
      this.currentArchiveRefs = nextArchiveRefs ? { ...nextArchiveRefs } : null;
    }
    return this.commitTransaction(nextReason, this.currentState, undefined, { force: true });
  }

  getAuditLog(): readonly ColorCycleLayerDocumentAuditEntry[] {
    return this.auditEntries.slice();
  }

  commitTransaction(
    reason: string,
    draft: ColorCycleLayerDocumentState,
    dirtyRects?: ColorCycleDirtyRect[],
    options: ColorCycleLayerDocumentCommitOptions = {},
  ): ColorCycleLayerDocumentRead {
    const probeMeta = {
      layerId: draft.layerId,
      reason,
      width: draft.width,
      height: draft.height,
      force: options.force === true,
      pixelsChanged: options.pixelsChanged === true,
      takeOwnership: options.takeOwnership === true,
      hasDirtyRects: Boolean(dirtyRects && dirtyRects.length > 0),
    };

    const statesEqual = options.force !== true
      ? strokeFinalizeProbeTimeSync(
          'colorCycleLayerDocument:documentStatesEqual',
          () => documentStatesEqual(this.currentState, draft),
          probeMeta
        )
      : false;
    if (statesEqual) {
      return this.read();
    }

    const versionBefore = this.currentVersion;
    const versionAfter = versionBefore + 1;
    const pixelVersionAfter = options.pixelsChanged === true
      ? this.currentPixelVersion + 1
      : strokeFinalizeProbeTimeSync(
          'colorCycleLayerDocument:documentPixelBuffersEqual',
          () => documentPixelBuffersEqual(this.currentState, draft),
          probeMeta
        )
        ? this.currentPixelVersion
        : this.currentPixelVersion + 1;

    this.currentState = strokeFinalizeProbeTimeSync(
      'colorCycleLayerDocument:commitState',
      () => options.takeOwnership === true ? draft : cloneDocumentState(draft),
      probeMeta
    );
    this.currentSnapshot = strokeFinalizeProbeTimeSync(
      'colorCycleLayerDocument:commitSnapshot',
      () => freezeDocumentSnapshot(cloneDocumentState(this.currentState)),
      probeMeta
    );
    this.currentVersion = versionAfter;
    this.currentPixelVersion = pixelVersionAfter;
    strokeFinalizeProbeTimeSync(
      'colorCycleLayerDocument:markLayerDirty',
      () => this.dirtyTracker.markLayerDirty(
        this.currentState.layerId,
        versionAfter,
        dirtyRects && dirtyRects.length > 0 ? dirtyRects : [this.createFullLayerDirtyRect()],
      ),
      probeMeta
    );
    strokeFinalizeProbeTimeSync(
      'colorCycleLayerDocument:auditPush',
      () => this.auditEntries.push({
        reason,
        versionBefore,
        versionAfter,
        committedAtMs: this.now(),
      }),
      probeMeta
    );

    return this.read();
  }

  private createFullLayerDirtyRect(): ColorCycleDirtyRect {
    return {
      x: 0,
      y: 0,
      width: Math.max(1, this.currentState.width),
      height: Math.max(1, this.currentState.height),
    };
  }

  private hasCompleteCanonicalBuffers(): boolean {
    return Boolean(
      this.currentState.paintBuffer &&
      this.currentState.gradientIdBuffer &&
      this.currentState.gradientDefIdBuffer &&
      this.currentState.speedBuffer &&
      this.currentState.flowBuffer &&
      this.currentState.phaseBuffer,
    );
  }

  private hasArchiveRefs(): boolean {
    return Boolean(
      this.currentArchiveRefs?.paintRef ||
      this.currentArchiveRefs?.gradientIdRef ||
      this.currentArchiveRefs?.gradientDefIdRef ||
      this.currentArchiveRefs?.speedRef ||
      this.currentArchiveRefs?.flowRef ||
      this.currentArchiveRefs?.phaseRef,
    );
  }

  private archiveRefsEqual(
    left: ColorCycleLayerDocumentArchiveRefs | null,
    right: ColorCycleLayerDocumentArchiveRefs | null,
  ): boolean {
    return (
      (left?.paintRef ?? null) === (right?.paintRef ?? null) &&
      (left?.gradientIdRef ?? null) === (right?.gradientIdRef ?? null) &&
      (left?.gradientDefIdRef ?? null) === (right?.gradientDefIdRef ?? null) &&
      (left?.speedRef ?? null) === (right?.speedRef ?? null) &&
      (left?.flowRef ?? null) === (right?.flowRef ?? null) &&
      (left?.phaseRef ?? null) === (right?.phaseRef ?? null)
    );
  }
}
