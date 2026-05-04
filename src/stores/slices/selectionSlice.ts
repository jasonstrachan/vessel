import { debugWarn } from '@/utils/debug';
import type { StateCreator } from 'zustand';
import type { Layer, Rectangle } from '@/types';
import { selectionSnapshotFromValues } from '@/history/selectionState';
import type { SelectionSnapshot } from '@/history/selectionState';
import { cloneLayerImageData, commitLayerHistory } from '@/history/helpers/layerHistory';
import { trackPendingHistoryCommit } from '@/history/pendingHistoryCommits';
import {
  captureColorCycleBrushState,
  type ColorCycleSerializedState,
} from '@/history/helpers/colorCycle';
import { clearColorCycleRegion } from '@/stores/helpers/colorCycleSelection';
import { logCCMutation, summarizeColorCycleLayer } from '@/utils/colorCycle/ccMutationAudit';
import { createSelectionPasteHelpers } from '@/stores/helpers/selectionPaste';
import {
  captureSelectionBitmap,
  captureSelectionBitmapFromMask,
  copyScalarRegion,
  resolveLayerImageData,
} from '@/stores/helpers/selectionCapture';
import {
  appendSequentialEvent,
  buildSequentialDestinationOutEvent,
  createSequentialSelectionMask,
} from '@/lib/sequential/sequentialEdit';
import { commitSequentialLayerHistory } from '@/history/helpers/sequentialLayerHistory';
import { cloneSequentialLayerData } from '@/history/deltas/sequentialFrameDelta';
import {
  cloneTransferredColorCycleSlotPalettes,
  cloneTransferredColorCycleGradientDefs,
  extractTransferredColorCycleSlotPalettes,
  extractTransferredColorCycleGradientDefs,
  type TransferredColorCycleGradientDef,
  type TransferredColorCycleSlotPalette,
} from '@/stores/helpers/colorCycleGradientDefTransfer';
import {
  authorizeSelectionDelete,
  type ColorCycleSelectionPaintSummary,
  type SelectionDeleteAuthorization,
  type SelectionOwnerKind,
} from '@/stores/helpers/selectionDeleteAuthorization';
import {
  captureCcSelectionBefore,
  runCcSelectionTransaction,
  type CcSelectionPreflight,
  type CcCanonicalSelectionPayload,
} from '@/stores/helpers/colorCycleSelectionTransaction';

type AppState = import('../useAppStore').AppState;

export interface SelectionActionProvenance {
  action: 'set-bounds' | 'select-all' | 'delete-selected';
  source: string;
  ownerKind?: SelectionOwnerKind;
  restoredFromHistory?: boolean;
  t: number;
  activeLayerId?: string | null;
  maskLayerId?: string | null;
  bounds?: Rectangle | null;
}

export interface FloatingPasteHistoryContext {
  sourceLayerId: string;
  sourceBounds: Rectangle;
  sourceBeforeImage?: ImageData | null;
  sourceGradientIds?: Uint8Array | null;
  sourceGradientDefIds?: Uint16Array | null;
  sourceSpeed?: Uint8Array | null;
  sourceFlow?: Uint8Array | null;
  sourcePhase?: Uint8Array | null;
  beforeImage: ImageData | null;
  beforeColorState: ColorCycleSerializedState | null;
  selectionBefore: SelectionSnapshot;
}

export interface SelectionSlice {
  selectionStart: { x: number; y: number } | null;
  selectionEnd: { x: number; y: number } | null;
  selectionClipboard: SelectionClipboardPayload | null;
  selectionVectorPath: {
    mode: 'freehand' | 'click-line';
    points: Array<{ x: number; y: number }>;
  } | null;
  selectionMask: ImageData | null;
  selectionMaskBounds: Rectangle | null;
  selectionMaskLayerId: string | null;
  selectionLastAction: SelectionActionProvenance | null;
  setSelectionBounds: (
    start: { x: number; y: number } | null,
    end: { x: number; y: number } | null,
    source?: string,
    provenanceOverride?: Partial<SelectionActionProvenance>
  ) => void;
  appendSelectionBounds: (
    start: { x: number; y: number } | null,
    end: { x: number; y: number } | null
  ) => void;
  appendSelectionMask: (payload: {
    mask: ImageData;
    bounds: Rectangle;
    layerId?: string | null;
  }) => void;
  clearSelection: () => void;
  adjustMarqueeSelection: (delta: number) => void;
  selectAllActiveLayerPixels: (source?: string) => void;
  selectLayerAlpha: (layerId?: string | null) => void;
  invertSelection: () => void;
  deleteSelectedPixels: (source?: string) => void;
  extractSelectionToFloatingPaste: () => boolean;
  floatingPaste: {
    active: boolean;
    imageData: ImageData | null;
    position: { x: number; y: number };
    originalPosition: { x: number; y: number };
    width: number;
    height: number;
    displayWidth: number;
    displayHeight: number;
    rotation: number;
    sourceLayerId?: string | null;
    colorCycleIndices?: Uint8Array | null;
    colorCycleGradientIds?: Uint8Array | null;
    colorCycleSlotPalettes?: TransferredColorCycleSlotPalette[] | null;
    colorCycleGradientDefIds?: Uint16Array | null;
    colorCycleGradientDefs?: TransferredColorCycleGradientDef[] | null;
    colorCycleSpeed?: Uint8Array | null;
    colorCycleFlow?: Uint8Array | null;
    colorCyclePhase?: Uint8Array | null;
    vectorPath?: {
      mode: 'freehand' | 'click-line';
      points: Array<{ x: number; y: number }>;
    } | null;
    } | null;
  floatingPasteHistoryContext: FloatingPasteHistoryContext | null;
  setFloatingPaste: (paste: {
    imageData: ImageData;
    position: { x: number; y: number };
    width: number;
    height: number;
    displayWidth?: number;
    displayHeight?: number;
    rotation?: number;
    originalPosition?: { x: number; y: number };
    sourceLayerId?: string | null;
    colorCycleIndices?: Uint8Array | null;
    colorCycleGradientIds?: Uint8Array | null;
    colorCycleSlotPalettes?: TransferredColorCycleSlotPalette[] | null;
    colorCycleGradientDefIds?: Uint16Array | null;
    colorCycleGradientDefs?: TransferredColorCycleGradientDef[] | null;
    colorCycleSpeed?: Uint8Array | null;
    colorCycleFlow?: Uint8Array | null;
    colorCyclePhase?: Uint8Array | null;
    vectorPath?: {
      mode: 'freehand' | 'click-line';
      points: Array<{ x: number; y: number }>;
    } | null;
  } | null) => void;
  updateFloatingPastePosition: (position: { x: number; y: number }) => void;
  updateFloatingPasteRect: (rect: { x: number; y: number; width: number; height: number }) => void;
  updateFloatingPasteRotation: (rotation: number) => void;
  flipFloatingPasteHorizontal: () => void;
  flipFloatingPasteVertical: () => void;
  commitFloatingPaste: () => Promise<void>;
  cancelFloatingPaste: () => void;
  copySelectionToClipboard: (options?: { mode?: 'copy' | 'cut' }) => Promise<boolean>;
  clearSelectionClipboard: () => void;
}

export interface SelectionClipboardPayload {
  imageData: ImageData;
  position: { x: number; y: number };
  width: number;
  height: number;
  mode: 'copy' | 'cut';
  colorCycleIndices?: Uint8Array | null;
  colorCycleGradientIds?: Uint8Array | null;
  colorCycleSlotPalettes?: TransferredColorCycleSlotPalette[] | null;
  colorCycleGradientDefIds?: Uint16Array | null;
  colorCycleGradientDefs?: TransferredColorCycleGradientDef[] | null;
  colorCycleSpeed?: Uint8Array | null;
  colorCycleFlow?: Uint8Array | null;
  colorCyclePhase?: Uint8Array | null;
  colorCycleSourceLayerId?: string | null;
}

const buildTransferredColorCyclePayload = (
  layer: Layer,
  capture: {
    colorCycleIndices?: Uint8Array | null;
    colorCycleGradientIds?: Uint8Array | null;
    colorCycleGradientDefIds?: Uint16Array | null;
    colorCycleSpeed?: Uint8Array | null;
    colorCycleFlow?: Uint8Array | null;
    colorCyclePhase?: Uint8Array | null;
  }
) => ({
  colorCycleIndices: capture.colorCycleIndices ?? null,
  colorCycleGradientIds: capture.colorCycleGradientIds ?? null,
  colorCycleSlotPalettes: extractTransferredColorCycleSlotPalettes(
    layer,
    capture.colorCycleGradientIds ?? null,
    capture.colorCycleGradientDefIds ?? null
  ),
  colorCycleGradientDefIds: capture.colorCycleGradientDefIds ?? null,
  colorCycleGradientDefs: extractTransferredColorCycleGradientDefs(
    layer,
    capture.colorCycleGradientDefIds ?? null
  ),
  colorCycleSpeed: capture.colorCycleSpeed ?? null,
  colorCycleFlow: capture.colorCycleFlow ?? null,
  colorCyclePhase: capture.colorCyclePhase ?? null,
});

const buildCanonicalColorCycleSelectionPayload = (
  layer: Layer,
  snapshot: {
    paintBuffer?: ArrayBuffer | null;
    gradientIdBuffer?: ArrayBuffer | null;
    gradientDefIdBuffer?: ArrayBuffer | null;
    speedBuffer?: ArrayBuffer | null;
    flowBuffer?: ArrayBuffer | null;
    phaseBuffer?: ArrayBuffer | null;
  } | null,
  width: number,
  height: number
): CcCanonicalSelectionPayload => {
  const paintBuffer = snapshot?.paintBuffer ? new Uint8Array(snapshot.paintBuffer) : null;
  const layerClaimsContent = Boolean(layer.colorCycleData?.hasContent);
  const hasPersistedCcPayload = Boolean(
    layer.colorCycleData?.gradientIdBuffer || layer.colorCycleData?.gradientDefIdBuffer
  );
  const hasCanonicalPaint = paintBuffer?.some((value) => value !== 0) ?? false;
  return {
    paintBuffer: (layerClaimsContent || hasPersistedCcPayload) && !hasCanonicalPaint ? null : paintBuffer,
    gradientIdBuffer: snapshot?.gradientIdBuffer ? new Uint8Array(snapshot.gradientIdBuffer) : null,
    gradientDefIdBuffer: snapshot?.gradientDefIdBuffer ? new Uint16Array(snapshot.gradientDefIdBuffer) : null,
    speedBuffer: snapshot?.speedBuffer ? new Uint8Array(snapshot.speedBuffer) : null,
    flowBuffer: snapshot?.flowBuffer ? new Uint8Array(snapshot.flowBuffer) : null,
    phaseBuffer: snapshot?.phaseBuffer ? new Uint8Array(snapshot.phaseBuffer) : null,
    width,
    height,
  };
};

const computeBoundsFromSelection = (
  start: { x: number; y: number },
  end: { x: number; y: number }
): Rectangle => ({
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
  width: Math.abs(end.x - start.x),
  height: Math.abs(end.y - start.y),
});

const inferSelectionOwnerKind = (source: string): SelectionOwnerKind => {
  if (source.startsWith('history-selection-')) {
    return 'history-restored';
  }
  if (source === 'selection-handle') {
    return 'selection-handle';
  }
  if (
    source === 'selection-marquee-start' ||
    source === 'selection-marquee-preview' ||
    source === 'selection-marquee-final' ||
    source === 'custom-selection-final'
  ) {
    return 'direct-marquee';
  }
  if (
    source.includes('freehand') ||
    source.includes('magic-wand') ||
    source.includes('select-layer-alpha') ||
    source.includes('invert-selection') ||
    source.includes('mask')
  ) {
    return 'mask-selection';
  }
  if (source === 'setSelectionBounds') {
    return 'unknown';
  }
  return 'programmatic';
};

const createSelectionProvenance = (args: {
  action: SelectionActionProvenance['action'];
  source: string;
  activeLayerId?: string | null;
  maskLayerId?: string | null;
  bounds?: Rectangle | null;
  override?: Partial<SelectionActionProvenance>;
}): SelectionActionProvenance => {
  const ownerKind = args.override?.ownerKind ?? inferSelectionOwnerKind(args.source);
  return {
    action: args.override?.action ?? args.action,
    source: args.override?.source ?? args.source,
    ownerKind,
    restoredFromHistory: args.override?.restoredFromHistory ?? ownerKind === 'history-restored',
    t: args.override?.t ?? Date.now(),
    activeLayerId: args.override?.activeLayerId ?? args.activeLayerId ?? null,
    maskLayerId: args.override?.maskLayerId ?? args.maskLayerId ?? null,
    bounds: args.override?.bounds ?? args.bounds ?? null,
  };
};

const resolveMergedSelectionLayerId = (
  existingLayerId: string | null | undefined,
  incomingLayerId: string | null | undefined
): string | null => {
  if (existingLayerId && incomingLayerId && existingLayerId !== incomingLayerId) {
    return existingLayerId;
  }
  return existingLayerId ?? incomingLayerId ?? null;
};

const buildColorCyclePaintAfterClearSummary = (
  paintSummary: ColorCycleSelectionPaintSummary | null | undefined
) => paintSummary
  ? {
      width: paintSummary.paintWidth,
      height: paintSummary.paintHeight,
      nonZeroCount: Math.max(0, paintSummary.totalNonZeroPaint - paintSummary.selectedNonZeroPaint),
    }
  : null;

const logSelectionDeleteAuthorizationBlocked = (args: {
  authorization: Extract<SelectionDeleteAuthorization, { ok: false }>;
  activeLayer: Layer | null;
  activeLayerId: string | null;
  source: string;
  projectId?: string | null;
  selectionStart: { x: number; y: number } | null;
  selectionEnd: { x: number; y: number } | null;
  selectionMaskBounds: Rectangle | null;
  selectionMaskLayerId: string | null;
  selectionLastAction: SelectionActionProvenance | null;
}): void => {
  const {
    authorization,
    activeLayer,
    activeLayerId,
    source,
    projectId,
    selectionStart,
    selectionEnd,
    selectionMaskBounds,
    selectionMaskLayerId,
    selectionLastAction,
  } = args;
  const details = {
    source,
    reason: authorization.reason,
    clearSelection: authorization.clearSelection,
    activeLayerId,
    activeLayerName: activeLayer?.name ?? null,
    activeLayerType: activeLayer?.layerType ?? null,
    selectionStart,
    selectionEnd,
    selectionBounds: selectionLastAction?.bounds ?? null,
    selectionOwnerLayerId: selectionLastAction?.activeLayerId ?? null,
    selectionOwnerKind: selectionLastAction?.ownerKind ?? null,
    restoredFromHistory: selectionLastAction?.restoredFromHistory ?? false,
    selectionMaskBounds,
    selectionMaskLayerId,
    selectionLastAction,
    projectId: projectId ?? null,
    colorCyclePaintSummary: authorization.colorCyclePaintSummary ?? null,
    ...authorization.details,
  };

  if (activeLayer?.layerType === 'color-cycle' && activeLayerId) {
    const summary = summarizeColorCycleLayer(activeLayer);
    logCCMutation({
      event: 'selection-delete-authorization-blocked',
      layerId: activeLayerId,
      reason: authorization.reason,
      severity: authorization.reason === 'missing-canonical-paint' ? 'error' : 'warn',
      before: summary,
      after: summary,
      details,
    });

    if (authorization.reason === 'selection-layer-mismatch') {
      logCCMutation({
        event: 'selection-delete-skipped-layer-mismatch',
        layerId: activeLayerId,
        reason: source,
        severity: 'warn',
        before: summary,
        after: summary,
        details: {
          source,
          selectionSource: selectionLastAction?.source ?? null,
          selectionAction: selectionLastAction?.action ?? null,
          selectionSourceLayerId: selectionLastAction?.activeLayerId ?? null,
          activeLayerId,
          selectionStart,
          selectionEnd,
          selectionBounds: selectionLastAction?.bounds ?? null,
        },
      });
    }

    if (authorization.reason === 'keyboard-full-content-clear-blocked') {
      const paintSummary = authorization.colorCyclePaintSummary ?? null;
      logCCMutation({
        event: 'color-cycle-keyboard-delete-full-content-blocked',
        layerId: activeLayerId,
        reason: 'delete-selected',
        severity: 'error',
        before: summary,
        after: summary,
        details: {
          source: 'selection-region-clear',
          operation: 'delete-selected',
          expectedDestructive: true,
          blockedTimestamp: Date.now(),
          layerName: activeLayer.name,
          projectId: projectId ?? null,
          deleteSource: source,
          selectionLastAction,
          paintBefore: paintSummary
            ? {
                width: paintSummary.paintWidth,
                height: paintSummary.paintHeight,
                nonZeroCount: paintSummary.totalNonZeroPaint,
              }
            : null,
          paintAfter: buildColorCyclePaintAfterClearSummary(paintSummary),
        },
      });
    }

    if (authorization.reason === 'missing-canonical-paint') {
      logCCMutation({
        event: 'color-cycle-selection-clear-skipped-missing-canonical-paint',
        layerId: activeLayerId,
        reason: 'delete-selected',
        severity: 'error',
        before: summary,
        after: summary,
        details: {
          source: 'selection-region-clear',
          operation: 'delete-selected',
          expectedDestructive: true,
          clearTimestamp: Date.now(),
          layerName: activeLayer.name,
          projectId: projectId ?? null,
          deleteSource: source,
          selectionLastAction,
          hasGradientIdBuffer: Boolean(activeLayer.colorCycleData?.gradientIdBuffer),
          hasGradientDefIdBuffer: Boolean(activeLayer.colorCycleData?.gradientDefIdBuffer),
        },
      });
    }
  } else if (process.env.NODE_ENV !== 'production') {
    debugWarn('raw-console', '[selection] delete authorization blocked', details);
  }
};

const logSelectionExtractBlocked = (args: {
  activeLayer: Layer;
  activeLayerId: string;
  projectId?: string | null;
  reason: string;
  selectionStart: { x: number; y: number } | null;
  selectionEnd: { x: number; y: number } | null;
  selectionMaskBounds: Rectangle | null;
  selectionMaskLayerId: string | null;
  selectionLastAction: SelectionActionProvenance | null;
  paintSummary?: ColorCycleSelectionPaintSummary | null;
  details?: Record<string, unknown>;
}): void => {
  const {
    activeLayer,
    activeLayerId,
    projectId,
    reason,
    selectionStart,
    selectionEnd,
    selectionMaskBounds,
    selectionMaskLayerId,
    selectionLastAction,
    paintSummary = null,
    details = {},
  } = args;
  const summary = summarizeColorCycleLayer(activeLayer);
  logCCMutation({
    event: 'selection-extract-authorization-blocked',
    layerId: activeLayerId,
    reason: 'extract-selection-transform',
    severity: reason === 'missing-canonical-paint' ? 'error' : 'warn',
    before: summary,
    after: summary,
    details: {
      source: 'selection-region-clear',
      operation: 'extract-selection-transform',
      expectedDestructive: true,
      blockedTimestamp: Date.now(),
      blockReason: reason,
      layerName: activeLayer.name,
      projectId: projectId ?? null,
      activeLayerId,
      selectionStart,
      selectionEnd,
      selectionBounds: selectionLastAction?.bounds ?? null,
      selectionOwnerLayerId: selectionLastAction?.activeLayerId ?? null,
      selectionOwnerKind: selectionLastAction?.ownerKind ?? null,
      restoredFromHistory: selectionLastAction?.restoredFromHistory ?? false,
      selectionMaskBounds,
      selectionMaskLayerId,
      selectionLastAction,
      paintBefore: paintSummary
        ? {
            width: paintSummary.paintWidth,
            height: paintSummary.paintHeight,
            nonZeroCount: paintSummary.totalNonZeroPaint,
          }
        : null,
      paintAfter: buildColorCyclePaintAfterClearSummary(paintSummary),
      ...details,
    },
  });
};

const logCcSelectionTransactionBlocked = (args: {
  activeLayer: Layer;
  activeLayerId: string;
  projectId?: string | null;
  source: string;
  transactionId: string;
  kind: string;
  operation: string;
  clearSelection: boolean;
  details: Record<string, unknown>;
}): void => {
  const {
    activeLayer,
    activeLayerId,
    projectId,
    source,
    transactionId,
    kind,
    operation,
    clearSelection,
    details,
  } = args;
  const summary = summarizeColorCycleLayer(activeLayer);
  logCCMutation({
    event: 'cc-selection-transaction-preflight-blocked',
    layerId: activeLayerId,
    reason: operation,
    severity: kind === 'missing-canonical-payload' || kind === 'missing-gradient-definition' ? 'error' : 'warn',
    before: summary,
    after: summary,
    details: {
      source,
      transactionId,
      operation,
      kind,
      clearSelection,
      projectId: projectId ?? null,
      ...details,
    },
  });
};

const logCcSelectionTransactionEvent = (args: {
  activeLayer: Layer;
  activeLayerId: string;
  projectId?: string | null;
  event:
    | 'cc-selection-transaction-source-cleared'
    | 'cc-selection-transaction-failed';
  transactionId: string;
  operation: string;
  kind: string;
  severity?: 'warn' | 'error';
  details?: Record<string, unknown>;
}): void => {
  const {
    activeLayer,
    activeLayerId,
    projectId,
    event,
    transactionId,
    operation,
    kind,
    severity = 'warn',
    details = {},
  } = args;
  const summary = summarizeColorCycleLayer(activeLayer);
  logCCMutation({
    event,
    layerId: activeLayerId,
    reason: operation,
    severity,
    before: summary,
    after: summary,
    details: {
      transactionId,
      operation,
      kind,
      projectId: projectId ?? null,
      ...details,
    },
  });
};

const normalizeSelectionRect = (rect: Rectangle): Rectangle | null => {
  const x = Math.floor(rect.x);
  const y = Math.floor(rect.y);
  const right = Math.ceil(rect.x + rect.width);
  const bottom = Math.ceil(rect.y + rect.height);
  const width = right - x;
  const height = bottom - y;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
};

const cloneMaskImageData = (mask: ImageData): ImageData =>
  new ImageData(new Uint8ClampedArray(mask.data), mask.width, mask.height);

const buildOpaqueMaskFromRect = (rect: Rectangle): { bounds: Rectangle; mask: ImageData } | null => {
  const normalized = normalizeSelectionRect(rect);
  if (!normalized) {
    return null;
  }

  const mask = new ImageData(normalized.width, normalized.height);
  for (let index = 0; index < mask.data.length; index += 4) {
    mask.data[index] = 255;
    mask.data[index + 1] = 255;
    mask.data[index + 2] = 255;
    mask.data[index + 3] = 255;
  }

  return {
    bounds: normalized,
    mask,
  };
};

const getSelectionMaskRepresentation = (state: Pick<
  SelectionSlice,
  'selectionStart' | 'selectionEnd' | 'selectionMask' | 'selectionMaskBounds'
>): { bounds: Rectangle; mask: ImageData } | null => {
  if (state.selectionMask && state.selectionMaskBounds) {
    const normalized = normalizeSelectionRect(state.selectionMaskBounds);
    if (!normalized) {
      return null;
    }
    return {
      bounds: normalized,
      mask: cloneMaskImageData(state.selectionMask),
    };
  }

  if (state.selectionStart && state.selectionEnd) {
    return buildOpaqueMaskFromRect(computeBoundsFromSelection(state.selectionStart, state.selectionEnd));
  }

  return null;
};

const mergeSelectionMasks = (
  existing: { bounds: Rectangle; mask: ImageData } | null,
  incoming: { bounds: Rectangle; mask: ImageData } | null
): { bounds: Rectangle; mask: ImageData } | null => {
  if (!existing) {
    return incoming;
  }
  if (!incoming) {
    return existing;
  }

  const x = Math.min(existing.bounds.x, incoming.bounds.x);
  const y = Math.min(existing.bounds.y, incoming.bounds.y);
  const right = Math.max(existing.bounds.x + existing.bounds.width, incoming.bounds.x + incoming.bounds.width);
  const bottom = Math.max(existing.bounds.y + existing.bounds.height, incoming.bounds.y + incoming.bounds.height);
  const width = right - x;
  const height = bottom - y;

  if (width <= 0 || height <= 0) {
    return null;
  }

  const mergedMask = new ImageData(width, height);

  const blitMask = (source: { bounds: Rectangle; mask: ImageData }) => {
    const offsetX = source.bounds.x - x;
    const offsetY = source.bounds.y - y;
    for (let sourceY = 0; sourceY < source.mask.height; sourceY += 1) {
      for (let sourceX = 0; sourceX < source.mask.width; sourceX += 1) {
        const sourceIndex = (sourceY * source.mask.width + sourceX) * 4 + 3;
        if ((source.mask.data[sourceIndex] ?? 0) === 0) {
          continue;
        }

        const targetX = offsetX + sourceX;
        const targetY = offsetY + sourceY;
        const targetIndex = (targetY * width + targetX) * 4;
        mergedMask.data[targetIndex] = 255;
        mergedMask.data[targetIndex + 1] = 255;
        mergedMask.data[targetIndex + 2] = 255;
        mergedMask.data[targetIndex + 3] = 255;
      }
    }
  };

  blitMask(existing);
  blitMask(incoming);

  return {
    bounds: { x, y, width, height },
    mask: mergedMask,
  };
};

const findOpaquePixelBounds = (imageData: ImageData): Rectangle | null => {
  const { width, height, data } = imageData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const alphaIndex = rowOffset + x * 4 + 3;
      if (data[alphaIndex] > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX === -1 || maxY === -1) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
};

const resolveSelectionInvertDimensions = (state: Pick<
  AppState,
  'project' | 'layers' | 'activeLayerId' | 'selectionEnd' | 'selectionMaskBounds'
>): { width: number; height: number } | null => {
  const activeLayer = state.activeLayerId
    ? state.layers.find((layer) => layer.id === state.activeLayerId) ?? null
    : null;

  const maskMaxX = state.selectionMaskBounds
    ? state.selectionMaskBounds.x + state.selectionMaskBounds.width
    : undefined;
  const maskMaxY = state.selectionMaskBounds
    ? state.selectionMaskBounds.y + state.selectionMaskBounds.height
    : undefined;

  const resolvedWidth =
    activeLayer?.imageData?.width ??
    activeLayer?.framebuffer?.width ??
    state.project?.width ??
    maskMaxX ??
    state.selectionEnd?.x;
  const resolvedHeight =
    activeLayer?.imageData?.height ??
    activeLayer?.framebuffer?.height ??
    state.project?.height ??
    maskMaxY ??
    state.selectionEnd?.y;

  const width = Math.max(0, Math.floor(resolvedWidth ?? 0));
  const height = Math.max(0, Math.floor(resolvedHeight ?? 0));

  if (!width || !height) {
    return null;
  }

  return { width, height };
};

const resolveSelectionBoundsLimits = (state: Pick<
  AppState,
  'project' | 'layers' | 'activeLayerId' | 'selectionEnd'
>): { width: number; height: number } | null => {
  const activeLayer = state.activeLayerId
    ? state.layers.find((layer) => layer.id === state.activeLayerId) ?? null
    : null;

  const resolvedWidth =
    activeLayer?.imageData?.width ??
    activeLayer?.framebuffer?.width ??
    state.project?.width ??
    state.selectionEnd?.x;
  const resolvedHeight =
    activeLayer?.imageData?.height ??
    activeLayer?.framebuffer?.height ??
    state.project?.height ??
    state.selectionEnd?.y;

  const width = Math.max(0, Math.floor(resolvedWidth ?? 0));
  const height = Math.max(0, Math.floor(resolvedHeight ?? 0));

  if (!width || !height) {
    return null;
  }

  return { width, height };
};

const cropMaskToBounds = (mask: ImageData, bounds: Rectangle): ImageData => {
  const cropped = new ImageData(bounds.width, bounds.height);
  const source = mask.data;
  const target = cropped.data;

  for (let y = 0; y < bounds.height; y += 1) {
    const sourceStart = ((bounds.y + y) * mask.width + bounds.x) * 4;
    const sourceEnd = sourceStart + bounds.width * 4;
    target.set(source.subarray(sourceStart, sourceEnd), y * bounds.width * 4);
  }

  return cropped;
};

const cloneOptionalImageData = (imageData: ImageData | null): ImageData | null => {
  if (!imageData) {
    return null;
  }
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
};

const extractImageDataRegion = (imageData: ImageData | null, bounds: Rectangle): ImageData | null => {
  if (!imageData || bounds.width <= 0 || bounds.height <= 0) {
    return null;
  }

  const x = Math.max(0, Math.floor(bounds.x));
  const y = Math.max(0, Math.floor(bounds.y));
  const right = Math.min(imageData.width, Math.ceil(bounds.x + bounds.width));
  const bottom = Math.min(imageData.height, Math.ceil(bounds.y + bounds.height));
  const width = right - x;
  const height = bottom - y;

  if (width <= 0 || height <= 0) {
    return null;
  }

  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const srcStart = ((y + row) * imageData.width + x) * 4;
    const srcEnd = srcStart + width * 4;
    data.set(imageData.data.subarray(srcStart, srcEnd), row * width * 4);
  }

  return new ImageData(data, width, height);
};

const extractColorCycleRegion = (
  state: ColorCycleSerializedState | null,
  bounds: Rectangle,
  field: 'gradientIdBuffer' | 'speedBuffer' | 'flowBuffer' | 'phaseBuffer',
  layerId?: string | null
): Uint8Array | null => {
  const layer = layerId
    ? state?.layers?.find((entry) => entry.layerId === layerId)
    : state?.layers?.[0];
  if (!layer?.strokeData) {
    return null;
  }
  const source = layer.strokeData[field];
  if (!source) {
    return null;
  }
  const bytes = new Uint8Array(source);
  const layerDimensions = layer as typeof layer & {
    dimensions?: { width?: number; height?: number };
  };
  const width = layer.data?.indexBuffer?.width ?? layerDimensions.dimensions?.width ?? 0;
  const height = layer.data?.indexBuffer?.height ?? layerDimensions.dimensions?.height ?? 0;
  if (!width || !height || bytes.length < width * height) {
    return null;
  }
  return copyScalarRegion(bytes, width, height, {
    x: Math.floor(bounds.x),
    y: Math.floor(bounds.y),
    width: Math.max(1, Math.ceil(bounds.width)),
    height: Math.max(1, Math.ceil(bounds.height)),
  });
};

const extractColorCycleDefRegion = (
  state: ColorCycleSerializedState | null,
  bounds: Rectangle,
  layerId?: string | null
): Uint16Array | null => {
  const layer = layerId
    ? state?.layers?.find((entry) => entry.layerId === layerId)
    : state?.layers?.[0];
  const source = layer?.strokeData?.gradientDefIdBuffer;
  if (!source) {
    return null;
  }
  const values = new Uint16Array(source);
  const layerDimensions = layer as typeof layer & {
    dimensions?: { width?: number; height?: number };
  };
  const width = layer.data?.indexBuffer?.width ?? layerDimensions.dimensions?.width ?? 0;
  const height = layer.data?.indexBuffer?.height ?? layerDimensions.dimensions?.height ?? 0;
  if (!width || !height || values.length < width * height) {
    return null;
  }

  const rect = {
    x: Math.floor(bounds.x),
    y: Math.floor(bounds.y),
    width: Math.max(1, Math.ceil(bounds.width)),
    height: Math.max(1, Math.ceil(bounds.height)),
  };
  const destination = new Uint16Array(rect.width * rect.height);
  const startX = Math.max(0, Math.min(width, rect.x));
  const startY = Math.max(0, Math.min(height, rect.y));
  const endX = Math.max(0, Math.min(width, rect.x + rect.width));
  const endY = Math.max(0, Math.min(height, rect.y + rect.height));

  for (let row = startY; row < endY; row += 1) {
    for (let col = startX; col < endX; col += 1) {
      const srcIndex = row * width + col;
      const destIndex = (row - startY) * rect.width + (col - startX);
      destination[destIndex] = values[srcIndex];
    }
  }

  return destination;
};

type ColorCycleMaskClearOptions = NonNullable<Parameters<typeof clearColorCycleRegion>[4]>;

const buildColorCycleMaskClearOptions = (
  bounds: Rectangle,
  selectionMask: ImageData | null,
  selectionMaskBounds: Rectangle | null
): ColorCycleMaskClearOptions | undefined => {
  if (!selectionMask || !selectionMaskBounds) {
    return undefined;
  }

  return {
    alphaData: selectionMask.data,
    alphaWidth: selectionMask.width,
    alphaHeight: selectionMask.height,
    offsetX: bounds.x - selectionMaskBounds.x,
    offsetY: bounds.y - selectionMaskBounds.y,
    alphaStride: 4,
    alphaChannelOffset: 3,
    alphaThreshold: 0,
  };
};

const clearColorCycleEraseMask = (
  eraseMask: HTMLCanvasElement | OffscreenCanvas | undefined,
  bounds: Rectangle,
  selectionMask: ImageData | null,
  selectionMaskBounds: Rectangle | null
) => {
  const ctxRaw = eraseMask?.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
  if (
    !ctxRaw ||
    !('clearRect' in ctxRaw) ||
    !('getImageData' in ctxRaw) ||
    !('putImageData' in ctxRaw)
  ) {
    return;
  }
  const ctx = ctxRaw;

  const x = Math.floor(bounds.x);
  const y = Math.floor(bounds.y);
  const right = Math.ceil(bounds.x + bounds.width);
  const bottom = Math.ceil(bounds.y + bounds.height);
  const width = Math.max(0, right - x);
  const height = Math.max(0, bottom - y);
  if (width <= 0 || height <= 0) {
    return;
  }

  if (!selectionMask || !selectionMaskBounds) {
    ctx.clearRect(x, y, width, height);
    return;
  }

  try {
    const region = ctx.getImageData(x, y, width, height);
    const regionData = region.data;
    const maskData = selectionMask.data;
    const maskX = Math.floor(selectionMaskBounds.x);
    const maskY = Math.floor(selectionMaskBounds.y);

    let changed = false;
    for (let py = 0; py < height; py += 1) {
      const targetY = y + py;
      const localMaskY = targetY - maskY;
      if (localMaskY < 0 || localMaskY >= selectionMask.height) {
        continue;
      }
      for (let px = 0; px < width; px += 1) {
        const targetX = x + px;
        const localMaskX = targetX - maskX;
        if (localMaskX < 0 || localMaskX >= selectionMask.width) {
          continue;
        }
        const maskAlpha = maskData[(localMaskY * selectionMask.width + localMaskX) * 4 + 3];
        if (maskAlpha === 0) {
          continue;
        }
        const index = (py * width + px) * 4;
        if (regionData[index] === 0 && regionData[index + 1] === 0 && regionData[index + 2] === 0 && regionData[index + 3] === 0) {
          continue;
        }
        regionData[index] = 0;
        regionData[index + 1] = 0;
        regionData[index + 2] = 0;
        regionData[index + 3] = 0;
        changed = true;
      }
    }

    if (changed) {
      ctx.putImageData(region, x, y);
    }
  } catch {
    ctx.clearRect(x, y, width, height);
  }
};

const flipImageData = (imageData: ImageData, axis: 'horizontal' | 'vertical'): ImageData => {
  const { width, height, data } = imageData;
  const source = data;
  const next = new Uint8ClampedArray(source.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = axis === 'horizontal' ? width - 1 - x : x;
      const sourceY = axis === 'vertical' ? height - 1 - y : y;
      const sourceIndex = (sourceY * width + sourceX) * 4;
      const destIndex = (y * width + x) * 4;

      next[destIndex] = source[sourceIndex];
      next[destIndex + 1] = source[sourceIndex + 1];
      next[destIndex + 2] = source[sourceIndex + 2];
      next[destIndex + 3] = source[sourceIndex + 3];
    }
  }

  return new ImageData(next, width, height);
};

const flipColorCycleIndices = (
  indices: Uint8Array,
  width: number,
  height: number,
  axis: 'horizontal' | 'vertical'
): Uint8Array => {
  const expectedLength = width * height;
  if (indices.length !== expectedLength) {
    return indices.slice();
  }

  const next = new Uint8Array(indices.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = axis === 'horizontal' ? width - 1 - x : x;
      const sourceY = axis === 'vertical' ? height - 1 - y : y;
      const sourceIndex = sourceY * width + sourceX;
      const destIndex = y * width + x;
      next[destIndex] = indices[sourceIndex];
    }
  }

  return next;
};

const flipColorCycleValues16 = (
  values: Uint16Array,
  width: number,
  height: number,
  axis: 'horizontal' | 'vertical'
): Uint16Array => {
  const expectedLength = width * height;
  if (values.length !== expectedLength) {
    return values.slice();
  }

  const next = new Uint16Array(values.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = axis === 'horizontal' ? width - 1 - x : x;
      const sourceY = axis === 'vertical' ? height - 1 - y : y;
      const sourceIndex = sourceY * width + sourceX;
      const destIndex = y * width + x;
      next[destIndex] = values[sourceIndex];
    }
  }

  return next;
};

const flipVectorPath = (
  vectorPath: NonNullable<SelectionSlice['floatingPaste']>['vectorPath'],
  width: number,
  height: number,
  axis: 'horizontal' | 'vertical'
) => {
  if (!vectorPath || vectorPath.points.length === 0) {
    return vectorPath;
  }

  const flippedPoints = vectorPath.points.map((point) => ({
    x: axis === 'horizontal' ? width - point.x : point.x,
    y: axis === 'vertical' ? height - point.y : point.y,
  }));

  return {
    mode: vectorPath.mode,
    points: flippedPoints,
  };
};

export const createSelectionSlice: StateCreator<AppState, [], [], SelectionSlice> = (set, get, store) => {
  const selectionPasteHelpers = createSelectionPasteHelpers({
    get: store.getState,
    set: store.setState,
    captureCanvasToActiveLayer: (canvas, roi, options) =>
      get().captureCanvasToActiveLayer(canvas, roi, options),
  });

  return {
    selectionStart: null,
    selectionEnd: null,
    selectionClipboard: null,
    selectionVectorPath: null,
    selectionMask: null,
    selectionMaskBounds: null,
    selectionMaskLayerId: null,
    selectionLastAction: null,
    setSelectionBounds: (start, end, source = 'setSelectionBounds', provenanceOverride) =>
      set((state) => {
        const activeLayer = state.layers.find((layer) => layer.id === state.activeLayerId) ?? null;
        const bounds = start && end ? computeBoundsFromSelection(start, end) : null;
        const provenance = start && end
          ? createSelectionProvenance({
              action: 'set-bounds',
              source,
              activeLayerId: state.activeLayerId,
              bounds,
              override: provenanceOverride,
            })
          : null;
        if (activeLayer?.layerType === 'color-cycle') {
          logCCMutation({
            event: 'selection-bounds-set',
            layerId: activeLayer.id,
            reason: source,
            severity: 'info',
            before: summarizeColorCycleLayer(activeLayer),
            after: summarizeColorCycleLayer(activeLayer),
            details: {
              source,
              setTimestamp: provenance?.t ?? Date.now(),
              activeLayerId: state.activeLayerId,
              activeLayerName: activeLayer.name,
              activeLayerType: activeLayer.layerType,
              ownerKind: provenance?.ownerKind ?? null,
              restoredFromHistory: provenance?.restoredFromHistory ?? false,
              start,
              end,
              bounds,
              previousSelectionStart: state.selectionStart,
              previousSelectionEnd: state.selectionEnd,
              previousSelectionMaskBounds: state.selectionMaskBounds,
              previousSelectionLastAction: state.selectionLastAction,
              projectId: state.project?.id ?? null,
              projectWidth: state.project?.width ?? null,
              projectHeight: state.project?.height ?? null,
            },
          });
        }
        return {
          selectionStart: start,
          selectionEnd: end,
          selectionVectorPath: null,
          selectionMask: null,
          selectionMaskBounds: null,
          selectionMaskLayerId: null,
          selectionLastAction: provenance,
        };
      }),
    appendSelectionBounds: (start, end) =>
      set((state) => {
        if (!start || !end) {
          return state;
        }

        const incoming = buildOpaqueMaskFromRect(computeBoundsFromSelection(start, end));
        if (!incoming) {
          return state;
        }

        const merged = mergeSelectionMasks(getSelectionMaskRepresentation(state), incoming);
        if (!merged) {
          return state;
        }

        const mergedLayerId = resolveMergedSelectionLayerId(
          state.selectionMaskLayerId ?? state.selectionLastAction?.maskLayerId ?? state.selectionLastAction?.activeLayerId,
          state.activeLayerId,
        );

        return {
          selectionStart: { x: merged.bounds.x, y: merged.bounds.y },
          selectionEnd: {
            x: merged.bounds.x + merged.bounds.width,
            y: merged.bounds.y + merged.bounds.height,
          },
          selectionVectorPath: null,
          selectionMask: merged.mask,
          selectionMaskBounds: merged.bounds,
          selectionMaskLayerId: mergedLayerId,
          selectionLastAction: createSelectionProvenance({
            action: 'set-bounds',
            source: 'append-selection-bounds',
            activeLayerId: mergedLayerId,
            maskLayerId: mergedLayerId,
            bounds: merged.bounds,
            override: { ownerKind: 'mask-selection' },
          }),
        };
      }),
    appendSelectionMask: ({ mask, bounds, layerId }) =>
      set((state) => {
        const normalizedBounds = normalizeSelectionRect(bounds);
        if (!normalizedBounds || mask.width <= 0 || mask.height <= 0) {
          return state;
        }

        const incoming = {
          bounds: normalizedBounds,
          mask: cloneMaskImageData(mask),
        };
        const merged = mergeSelectionMasks(getSelectionMaskRepresentation(state), incoming);
        if (!merged) {
          return state;
        }

        const incomingLayerId = layerId ?? state.activeLayerId ?? null;
        const mergedLayerId = resolveMergedSelectionLayerId(
          state.selectionMaskLayerId ?? state.selectionLastAction?.maskLayerId ?? state.selectionLastAction?.activeLayerId,
          incomingLayerId,
        );

        return {
          selectionStart: { x: merged.bounds.x, y: merged.bounds.y },
          selectionEnd: {
            x: merged.bounds.x + merged.bounds.width,
            y: merged.bounds.y + merged.bounds.height,
          },
          selectionVectorPath: null,
          selectionMask: merged.mask,
          selectionMaskBounds: merged.bounds,
          selectionMaskLayerId: mergedLayerId,
          selectionLastAction: createSelectionProvenance({
            action: 'set-bounds',
            source: 'append-selection-mask',
            activeLayerId: mergedLayerId,
            maskLayerId: mergedLayerId,
            bounds: merged.bounds,
            override: { ownerKind: 'mask-selection' },
          }),
        };
      }),
    clearSelection: () =>
      set({
        selectionStart: null,
        selectionEnd: null,
        selectionVectorPath: null,
        selectionMask: null,
        selectionMaskBounds: null,
        selectionMaskLayerId: null,
        selectionLastAction: null,
      }),
    adjustMarqueeSelection: (delta) =>
      set((state) => {
        if (!Number.isFinite(delta) || delta === 0) {
          return state;
        }

        if (!state.selectionStart || !state.selectionEnd || state.selectionMask || state.selectionMaskBounds) {
          return state;
        }

        const currentBounds = normalizeSelectionRect(
          computeBoundsFromSelection(state.selectionStart, state.selectionEnd),
        );
        if (!currentBounds) {
          return state;
        }

        const limits = resolveSelectionBoundsLimits(state);
        if (!limits) {
          return state;
        }

        const amount = Math.floor(Math.abs(delta));
        if (amount === 0) {
          return state;
        }

        const currentRight = currentBounds.x + currentBounds.width;
        const currentBottom = currentBounds.y + currentBounds.height;
        const nextLeft = delta > 0 ? Math.max(0, currentBounds.x - amount) : currentBounds.x + amount;
        const nextTop = delta > 0 ? Math.max(0, currentBounds.y - amount) : currentBounds.y + amount;
        const nextRight = delta > 0 ? Math.min(limits.width, currentRight + amount) : currentRight - amount;
        const nextBottom = delta > 0 ? Math.min(limits.height, currentBottom + amount) : currentBottom - amount;
        const nextBounds = normalizeSelectionRect({
          x: nextLeft,
          y: nextTop,
          width: nextRight - nextLeft,
          height: nextBottom - nextTop,
        });

        if (!nextBounds) {
          return state;
        }

        return {
          selectionStart: { x: nextBounds.x, y: nextBounds.y },
          selectionEnd: {
            x: nextBounds.x + nextBounds.width,
            y: nextBounds.y + nextBounds.height,
          },
          selectionVectorPath: null,
          selectionMask: null,
          selectionMaskBounds: null,
          selectionMaskLayerId: null,
        };
      }),
    selectAllActiveLayerPixels: (source = 'selectAllActiveLayerPixels') => {
      const state = get();
      const { project, layers, activeLayerId } = state;

      const activeLayer = activeLayerId
        ? layers.find((layer) => layer.id === activeLayerId) ?? null
        : null;

      const width =
        activeLayer?.imageData?.width ?? activeLayer?.framebuffer?.width ?? project?.width;
      const height =
        activeLayer?.imageData?.height ?? activeLayer?.framebuffer?.height ?? project?.height;

      if (!width || !height) {
        return;
      }

      set({
        selectionStart: { x: 0, y: 0 },
        selectionEnd: { x: width, y: height },
        selectionVectorPath: null,
        selectionMask: null,
        selectionMaskBounds: null,
        selectionMaskLayerId: null,
        selectionLastAction: {
          action: 'select-all',
          source,
          ownerKind: 'select-all',
          restoredFromHistory: false,
          t: Date.now(),
          activeLayerId,
          maskLayerId: null,
          bounds: { x: 0, y: 0, width, height },
        },
      });
    },
    selectLayerAlpha: (layerId) => {
      const state = get();
      const targetLayerId = layerId ?? state.activeLayerId;
      if (!targetLayerId) {
        return;
      }

      const layer = state.layers.find((l) => l.id === targetLayerId) ?? null;
      if (!layer) {
        return;
      }

      const imageData = resolveLayerImageData(layer);
      if (!imageData) {
        return;
      }

      const bounds = findOpaquePixelBounds(imageData);
      if (!bounds) {
        set({
          selectionStart: null,
          selectionEnd: null,
          selectionVectorPath: null,
          selectionMask: null,
          selectionMaskBounds: null,
          selectionMaskLayerId: null,
          selectionLastAction: null,
        });
        return;
      }

      const maxWidth = state.project?.width ?? imageData.width;
      const maxHeight = state.project?.height ?? imageData.height;

      const clampedX = Math.max(0, Math.min(maxWidth, bounds.x));
      const clampedY = Math.max(0, Math.min(maxHeight, bounds.y));
      const clampedWidth = Math.max(0, Math.min(bounds.width, maxWidth - clampedX));
      const clampedHeight = Math.max(0, Math.min(bounds.height, maxHeight - clampedY));

      if (clampedWidth <= 0 || clampedHeight <= 0) {
        set({
          selectionStart: null,
          selectionEnd: null,
          selectionVectorPath: null,
          selectionMask: null,
          selectionMaskBounds: null,
          selectionMaskLayerId: null,
          selectionLastAction: null,
        });
        return;
      }

      const maskData = new ImageData(clampedWidth, clampedHeight);
      const maskBuffer = maskData.data;

      for (let y = 0; y < clampedHeight; y += 1) {
        const sourceY = clampedY + y;
        const srcRow = sourceY * imageData.width * 4;
        const destRow = y * clampedWidth * 4;
        for (let x = 0; x < clampedWidth; x += 1) {
          const sourceX = clampedX + x;
          const srcIdx = srcRow + sourceX * 4;
          const destIdx = destRow + x * 4;
          const alpha = imageData.data[srcIdx + 3];
          if (alpha > 0) {
            maskBuffer[destIdx] = 255;
            maskBuffer[destIdx + 1] = 255;
            maskBuffer[destIdx + 2] = 255;
            maskBuffer[destIdx + 3] = 255;
          }
        }
      }

      set({
        selectionStart: { x: clampedX, y: clampedY },
        selectionEnd: { x: clampedX + clampedWidth, y: clampedY + clampedHeight },
        selectionVectorPath: null,
        selectionMask: maskData,
        selectionMaskBounds: { x: clampedX, y: clampedY, width: clampedWidth, height: clampedHeight },
        selectionMaskLayerId: targetLayerId,
        selectionLastAction: createSelectionProvenance({
          action: 'set-bounds',
          source: 'select-layer-alpha',
          activeLayerId: targetLayerId,
          maskLayerId: targetLayerId,
          bounds: { x: clampedX, y: clampedY, width: clampedWidth, height: clampedHeight },
          override: { ownerKind: 'mask-selection' },
        }),
      });
    },
    invertSelection: () => {
      const state = get();
      const { selectionStart, selectionEnd, selectionMask, selectionMaskBounds } = state;
      const hasSelection = Boolean(
        (selectionStart && selectionEnd) || (selectionMask && selectionMaskBounds),
      );
      if (!hasSelection) {
        return;
      }

      const dimensions = resolveSelectionInvertDimensions(state);
      if (!dimensions) {
        return;
      }

      const { width, height } = dimensions;
      const selectedCoverage = new Uint8Array(width * height);
      const markSelected = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= width || y >= height) {
          return;
        }
        selectedCoverage[y * width + x] = 1;
      };

      if (selectionMask && selectionMaskBounds) {
        for (let y = 0; y < selectionMask.height; y += 1) {
          const sourceRow = y * selectionMask.width * 4;
          for (let x = 0; x < selectionMask.width; x += 1) {
            const alpha = selectionMask.data[sourceRow + x * 4 + 3];
            if (alpha <= 0) {
              continue;
            }
            markSelected(selectionMaskBounds.x + x, selectionMaskBounds.y + y);
          }
        }
      } else if (selectionStart && selectionEnd) {
        const bounds = computeBoundsFromSelection(selectionStart, selectionEnd);
        const minX = Math.max(0, Math.floor(bounds.x));
        const minY = Math.max(0, Math.floor(bounds.y));
        const maxX = Math.min(width, Math.ceil(bounds.x + bounds.width));
        const maxY = Math.min(height, Math.ceil(bounds.y + bounds.height));

        for (let y = minY; y < maxY; y += 1) {
          for (let x = minX; x < maxX; x += 1) {
            markSelected(x, y);
          }
        }
      }

      const invertedMask = new ImageData(width, height);
      let hasInvertedPixels = false;
      for (let i = 0; i < selectedCoverage.length; i += 1) {
        if (selectedCoverage[i] === 1) {
          continue;
        }
        const pixel = i * 4;
        invertedMask.data[pixel] = 255;
        invertedMask.data[pixel + 1] = 255;
        invertedMask.data[pixel + 2] = 255;
        invertedMask.data[pixel + 3] = 255;
        hasInvertedPixels = true;
      }

      if (!hasInvertedPixels) {
        set({
          selectionStart: null,
          selectionEnd: null,
          selectionVectorPath: null,
          selectionMask: null,
          selectionMaskBounds: null,
          selectionMaskLayerId: null,
          selectionLastAction: null,
        });
        return;
      }

      const invertedBounds = findOpaquePixelBounds(invertedMask);
      if (!invertedBounds) {
        set({
          selectionStart: null,
          selectionEnd: null,
          selectionVectorPath: null,
          selectionMask: null,
          selectionMaskBounds: null,
          selectionMaskLayerId: null,
          selectionLastAction: null,
        });
        return;
      }

      const croppedMask = cropMaskToBounds(invertedMask, invertedBounds);
      set({
        selectionStart: { x: invertedBounds.x, y: invertedBounds.y },
        selectionEnd: {
          x: invertedBounds.x + invertedBounds.width,
          y: invertedBounds.y + invertedBounds.height,
        },
        selectionVectorPath: null,
        selectionMask: croppedMask,
        selectionMaskBounds: invertedBounds,
        selectionMaskLayerId: state.activeLayerId ?? state.selectionMaskLayerId ?? null,
        selectionLastAction: createSelectionProvenance({
          action: 'set-bounds',
          source: 'invert-selection',
          activeLayerId: state.activeLayerId ?? state.selectionLastAction?.activeLayerId ?? null,
          maskLayerId: state.activeLayerId ?? state.selectionMaskLayerId ?? null,
          bounds: invertedBounds,
          override: { ownerKind: 'mask-selection' },
        }),
      });
    },
    deleteSelectedPixels: (source = 'api-delete') => {
      const state = get();
      const {
        selectionStart,
        selectionEnd,
        selectionMask,
        selectionMaskBounds,
        selectionMaskLayerId,
        selectionLastAction,
        layers,
        activeLayerId,
        project,
        colorCyclePlayback,
      } = state;

      if (!selectionStart || !selectionEnd || !project) {
        return;
      }

      const activeLayer = layers.find((layer) => layer.id === activeLayerId);
      if (!activeLayer || !activeLayerId) {
        return;
      }

      let deleteBounds: Rectangle | null = null;

      if (activeLayer.layerType === 'color-cycle') {
        const brush = typeof state.getLayerColorCycleBrush === 'function'
          ? state.getLayerColorCycleBrush(activeLayerId)
          : null;
        const snapshot = brush?.getLayerSnapshot?.(activeLayerId) ?? null;
        const canvas = activeLayer.colorCycleData?.canvas ?? activeLayer.framebuffer ?? null;
        const canonical = buildCanonicalColorCycleSelectionPayload(
          activeLayer,
          snapshot,
          canvas?.width ?? project.width,
          canvas?.height ?? project.height
        );

        const preflight = runCcSelectionTransaction({
          operation: 'delete-selected',
          source,
          activeLayer,
          activeLayerId,
          project,
          selectionStart,
          selectionEnd,
          selectionMask,
          selectionMaskBounds,
          selectionMaskLayerId,
          selectionLastAction,
          canonical,
          requireGradientDefinitionPresence: false,
        });

        if (!preflight.ok) {
          const authorization = authorizeSelectionDelete({
            source,
            activeLayer,
            activeLayerId,
            project,
            selectionStart,
            selectionEnd,
            selectionMask,
            selectionMaskBounds,
            selectionMaskLayerId,
            selectionLastAction,
            colorCyclePaint: {
              buffer: canonical.paintBuffer,
              width: canonical.width,
              height: canonical.height,
              hasFullCanonicalPayload: preflight.kind !== 'missing-canonical-payload',
            },
          });
          if (!authorization.ok) {
            logSelectionDeleteAuthorizationBlocked({
              authorization,
              activeLayer,
              activeLayerId,
              source,
              projectId: project.id,
              selectionStart,
              selectionEnd,
              selectionMaskBounds,
              selectionMaskLayerId,
              selectionLastAction,
            });
          }
          logCcSelectionTransactionBlocked({
            activeLayer,
            activeLayerId,
            projectId: project.id,
            source,
            transactionId: preflight.transactionId,
            kind: preflight.kind,
            operation: preflight.operation,
            clearSelection: preflight.clearSelection,
            details: preflight.details,
          });
          if (preflight.clearSelection) {
            state.clearSelection();
          }
          return;
        }

        deleteBounds = preflight.bounds;
      } else {
        const authorization = authorizeSelectionDelete({
          source,
          activeLayer,
          activeLayerId,
          project,
          selectionStart,
          selectionEnd,
          selectionMask,
          selectionMaskBounds,
          selectionMaskLayerId,
          selectionLastAction,
          colorCyclePaint: null,
        });

        if (!authorization.ok) {
          logSelectionDeleteAuthorizationBlocked({
            authorization,
            activeLayer,
            activeLayerId,
            source,
            projectId: project.id,
            selectionStart,
            selectionEnd,
            selectionMaskBounds,
            selectionMaskLayerId,
            selectionLastAction,
          });
          if (authorization.clearSelection) {
            state.clearSelection();
          }
          return;
        }

        deleteBounds = authorization.bounds;
      }

      if (!deleteBounds) {
        if (activeLayer.layerType === 'color-cycle') {
          logCcSelectionTransactionBlocked({
            activeLayer,
            activeLayerId,
            projectId: project.id,
            source,
            transactionId: `cc-selection-delete-selected-missing-bounds-${Date.now()}`,
            kind: 'invalid-selection',
            operation: 'delete-selected',
            clearSelection: false,
            details: {
              reason: 'missing-delete-bounds-after-preflight',
            },
          });
        }
        return;
      }

      const { x, y, width, height } = deleteBounds;

      const selectionBefore = selectionSnapshotFromValues(selectionStart, selectionEnd);

      const beforeImage = cloneLayerImageData(activeLayer.imageData);
      const beforeColorState =
        activeLayer.layerType === 'color-cycle'
          ? captureColorCycleBrushState(activeLayer.id)
          : null;

      if (activeLayer.layerType === 'sequential' && activeLayer.sequentialData) {
        const selectionMaskImage = createSequentialSelectionMask({
          bounds: { x, y, width, height },
          selectionMask,
          selectionMaskBounds,
        });
        if (!selectionMaskImage) {
          return;
        }

        const beforeSequentialData = cloneSequentialLayerData(activeLayer.sequentialData);
        const frameCount = Math.max(1, Math.round(activeLayer.sequentialData.frameCount));
        const frameIndex =
          ((Math.round(state.sequentialRecord.currentFrame) % frameCount) + frameCount) % frameCount;
        const timestampMs = Date.now();
        const strokeId = `seq-delete-${timestampMs}`;
        const event = buildSequentialDestinationOutEvent({
          layer: activeLayer,
          frameIndex,
          maskImageData: selectionMaskImage,
          maskBounds: { x, y, width, height },
          eraserSettings: {
            ...state.tools.brushSettings,
            ...state.tools.eraserSettings,
            opacity: 1,
            blendMode: 'destination-out',
          },
          timestampMs,
          id: `${strokeId}-0`,
          strokeId,
        });
        const afterSequentialData = appendSequentialEvent(beforeSequentialData, event);

        state.updateLayer(
          activeLayerId,
          { sequentialData: afterSequentialData },
          { skipColorCycleSync: true }
        );
        state.setCurrentCompositeBitmap(null);
        state.setLayersNeedRecomposition(true);
        state.clearSelection();

        const deleteHistoryCommit = commitSequentialLayerHistory({
          layerId: activeLayerId,
          beforeSequentialData,
          afterSequentialData,
          actionType: 'delete',
          description: 'Delete selected pixels',
          tool: 'selection',
          coalesce: {
            key: `selection-delete:${activeLayerId}:${frameIndex}`,
            maxIntervalMs: 250,
          },
        }).catch((error) => {
          if (process.env.NODE_ENV !== 'production') {
            debugWarn('raw-console', '[history] Failed to record sequential selection delete', error);
          }
        });
        trackPendingHistoryCommit(deleteHistoryCommit);
        return;
      }

      if (activeLayer.layerType === 'color-cycle') {
        const cleared = clearColorCycleRegion(
          state,
          activeLayer,
          project,
          { x, y, width, height },
          {
            ...buildColorCycleMaskClearOptions({ x, y, width, height }, selectionMask, selectionMaskBounds),
            auditSource: 'delete-selected',
            auditDetails: {
              activeLayerId,
              selectionStart,
              selectionEnd,
              selectionMaskBounds,
              selectionMaskLayerId,
              selectionLastAction,
              deleteSource: source,
              deleteTimestamp: Date.now(),
              playbackBeforeDelete: {
                desiredPlaying: colorCyclePlayback.desiredPlaying,
                suspendDepth: colorCyclePlayback.suspendDepth,
                lastReason: colorCyclePlayback.lastReason ?? null,
              },
            },
          }
        );
        if (cleared) {
          const eraseMask = activeLayer.colorCycleData?.eraseMask;
          clearColorCycleEraseMask(eraseMask, { x, y, width, height }, selectionMask, selectionMaskBounds);
          state.scheduleColorCycleSlotRebuild?.('delete-selected');
        }
      } else {
        const useMask = selectionMask && selectionMaskBounds;

        const framebuffer = activeLayer.framebuffer;
        const sourceImage = (() => {
          if (framebuffer) {
            const fbCtx = framebuffer.getContext('2d', { willReadFrequently: true }) as
              | CanvasRenderingContext2D
              | OffscreenCanvasRenderingContext2D
              | null;
            try {
              if (fbCtx && 'getImageData' in fbCtx) {
                return fbCtx.getImageData(0, 0, framebuffer.width, framebuffer.height);
              }
            } catch {
              return null;
            }
          }
          return activeLayer.imageData ? cloneLayerImageData(activeLayer.imageData) : null;
        })();

        if (!sourceImage) {
          return;
        }

        const newImageData = cloneLayerImageData(sourceImage);
        if (!newImageData) {
          return;
        }

        if (useMask) {
          const { x: mx, y: my, width: mw, height: mh } = selectionMaskBounds!;
          const maskBuffer = selectionMask!.data;
          for (let py = 0; py < mh; py += 1) {
            const maskRow = py * mw * 4;
            const targetY = my + py;
            if (targetY < 0 || targetY >= newImageData.height) continue;
            for (let px = 0; px < mw; px += 1) {
              const alphaIdx = maskRow + px * 4 + 3;
              if (maskBuffer[alphaIdx] === 0) {
                continue;
              }
              const targetX = mx + px;
              if (targetX < 0 || targetX >= newImageData.width) continue;
              const destIdx = (targetY * newImageData.width + targetX) * 4;
              newImageData.data[destIdx] = 0;
              newImageData.data[destIdx + 1] = 0;
              newImageData.data[destIdx + 2] = 0;
              newImageData.data[destIdx + 3] = 0;
            }
          }
        } else {
          const startY = Math.max(0, Math.floor(y));
          const endY = Math.min(newImageData.height, Math.ceil(y + height));
          const startX = Math.max(0, Math.floor(x));
          const endX = Math.min(newImageData.width, Math.ceil(x + width));

          for (let py = startY; py < endY; py++) {
            for (let px = startX; px < endX; px++) {
              const index = (py * newImageData.width + px) * 4;
              newImageData.data[index + 3] = 0;
              newImageData.data[index] = 0;
              newImageData.data[index + 1] = 0;
              newImageData.data[index + 2] = 0;
            }
          }
        }

        if (framebuffer) {
          const fbCtx = framebuffer.getContext('2d', { willReadFrequently: true }) as
            | CanvasRenderingContext2D
            | OffscreenCanvasRenderingContext2D
            | null;
          if (fbCtx && 'putImageData' in fbCtx) {
            fbCtx.putImageData(newImageData, 0, 0);
          }
        }

        state.updateLayer(activeLayerId, { imageData: newImageData });
      }

      state.setCurrentCompositeBitmap(null);
      state.setLayersNeedRecomposition(true);
      state.clearSelection();

      const deleteHistoryCommit = commitLayerHistory({
        layerId: activeLayerId,
        beforeImage,
        beforeColorState,
        actionType: 'delete',
        description: 'Delete selected pixels',
        tool: 'selection',
        selectionBefore,
      }).catch((error) => {
        if (process.env.NODE_ENV !== 'production') {
          debugWarn('raw-console', '[history] Failed to record selection delete', error);
        }
      });
      trackPendingHistoryCommit(deleteHistoryCommit);
    },
    extractSelectionToFloatingPaste: () => {
      const state = get();
      const {
        selectionStart,
        selectionEnd,
        selectionMask,
        selectionMaskBounds,
        selectionMaskLayerId,
        selectionLastAction,
        selectionVectorPath,
        project,
        layers,
        activeLayerId,
      } = state;

      if (!selectionStart || !selectionEnd || !project || !activeLayerId) {
        return false;
      }

      const activeLayer = layers.find((layer) => layer.id === activeLayerId) ?? null;
      if (!activeLayer) {
        return false;
      }

      const selectionBefore = selectionSnapshotFromValues(selectionStart, selectionEnd);
      const sourceImageData = resolveLayerImageData(activeLayer);
      const beforeImage = activeLayer.layerType === 'color-cycle'
        ? null
        : cloneOptionalImageData(sourceImageData);
      const beforeColorState = activeLayer.layerType === 'color-cycle'
        ? captureColorCycleBrushState(activeLayer.id)
        : null;
      let ccExtractPreflight: Extract<CcSelectionPreflight, { ok: true }> | null = null;

      if (activeLayer.layerType === 'color-cycle') {
        const brush = state.getLayerColorCycleBrush?.(activeLayerId);
        const snapshot = brush?.getLayerSnapshot?.(activeLayerId) ?? null;
        const canvas = activeLayer.colorCycleData?.canvas ?? activeLayer.framebuffer ?? null;
        const canonical = buildCanonicalColorCycleSelectionPayload(
          activeLayer,
          snapshot,
          canvas?.width ?? project.width,
          canvas?.height ?? project.height
        );
        const preflight = runCcSelectionTransaction({
          operation: 'extract-selection-transform',
          activeLayer,
          activeLayerId,
          project,
          selectionStart,
          selectionEnd,
          selectionMask,
          selectionMaskBounds,
          selectionMaskLayerId,
          selectionLastAction,
          canonical,
          requireGradientDefinitionPresence: false,
        });

        if (!preflight.ok) {
          logSelectionExtractBlocked({
            activeLayer,
            activeLayerId,
            projectId: project.id,
            reason: preflight.kind === 'missing-canonical-payload' ? 'missing-canonical-paint' : preflight.kind,
            selectionStart,
            selectionEnd,
            selectionMaskBounds,
            selectionMaskLayerId,
            selectionLastAction,
            details: preflight.details,
          });
          logCcSelectionTransactionBlocked({
            activeLayer,
            activeLayerId,
            projectId: project.id,
            source: 'extract-selection-transform',
            transactionId: preflight.transactionId,
            kind: preflight.kind,
            operation: preflight.operation,
            clearSelection: preflight.clearSelection,
            details: preflight.details,
          });
          if (preflight.clearSelection) {
            state.clearSelection();
          }
          return false;
        }
        ccExtractPreflight = preflight;
      }

      const capture = activeLayer.layerType === 'color-cycle' && ccExtractPreflight
        ? (() => {
            const captured = captureCcSelectionBefore({
              preflight: ccExtractPreflight,
              layer: activeLayer,
              project,
              selectionStart,
              selectionEnd,
              selectionMask,
              selectionMaskBounds,
            });
            if (!captured.ok) {
              logSelectionExtractBlocked({
                activeLayer,
                activeLayerId,
                projectId: project.id,
                reason: captured.kind === 'missing-canonical-payload' ? 'missing-canonical-paint' : captured.kind,
                selectionStart,
                selectionEnd,
                selectionMaskBounds,
                selectionMaskLayerId,
                selectionLastAction,
                details: captured.details,
              });
              logCcSelectionTransactionBlocked({
                activeLayer,
                activeLayerId,
                projectId: project.id,
                source: 'extract-selection-transform',
                transactionId: captured.transactionId,
                kind: captured.kind,
                operation: 'extract-selection-transform',
                clearSelection: false,
                details: captured.details,
              });
              return null;
            }
            return captured.capture;
          })()
        : (selectionMask && selectionMaskBounds
            ? captureSelectionBitmapFromMask({
                mask: selectionMask,
                maskBounds: selectionMaskBounds,
                project,
                layer: activeLayer,
                clearSource: true,
              })
            : captureSelectionBitmap({
                selectionStart,
                selectionEnd,
                project,
                layer: activeLayer,
                clearSource: true,
              }));

      if (!capture || !capture.updatedLayerImageData) {
        return false;
      }

      if (activeLayer.layerType === 'color-cycle') {
        const cleared = clearColorCycleRegion(state, activeLayer, project, {
          x: capture.bounds.x,
          y: capture.bounds.y,
          width: capture.bounds.width,
          height: capture.bounds.height,
        }, {
          ...buildColorCycleMaskClearOptions(capture.bounds, selectionMask, selectionMaskBounds),
          auditSource: 'extract-selection-transform',
          auditDetails: {
            activeLayerId,
            transactionId: ccExtractPreflight?.transactionId ?? null,
            transactionKind: ccExtractPreflight?.kind ?? null,
            captureBounds: capture.bounds,
            selectionStart,
            selectionEnd,
            selectionMaskBounds,
            selectionMaskLayerId: state.selectionMaskLayerId,
          },
        });
        if (cleared) {
          const eraseMask = activeLayer.colorCycleData?.eraseMask;
          clearColorCycleEraseMask(eraseMask, capture.bounds, selectionMask, selectionMaskBounds);
          state.scheduleColorCycleSlotRebuild?.('extract-selection-transform');
          logCcSelectionTransactionEvent({
            activeLayer,
            activeLayerId,
            projectId: project.id,
            event: 'cc-selection-transaction-source-cleared',
            transactionId: ccExtractPreflight?.transactionId ?? 'unknown',
            operation: 'extract-selection-transform',
            kind: ccExtractPreflight?.kind ?? 'partial-clear',
            details: {
              bounds: capture.bounds,
              selectionMaskBounds,
            },
          });
        } else {
          logCcSelectionTransactionEvent({
            activeLayer,
            activeLayerId,
            projectId: project.id,
            event: 'cc-selection-transaction-failed',
            transactionId: ccExtractPreflight?.transactionId ?? 'unknown',
            operation: 'extract-selection-transform',
            kind: ccExtractPreflight?.kind ?? 'partial-clear',
            severity: 'error',
            details: {
              reason: 'source-clear-failed',
              bounds: capture.bounds,
              selectionMaskBounds,
            },
          });
          return false;
        }
      } else {
        const updatedImageData = capture.updatedLayerImageData;
        const framebuffer = activeLayer.framebuffer;
        if (framebuffer) {
          try {
            if (framebuffer.width !== updatedImageData.width || framebuffer.height !== updatedImageData.height) {
              framebuffer.width = updatedImageData.width;
              framebuffer.height = updatedImageData.height;
            }
            const fbCtx = framebuffer.getContext('2d', { willReadFrequently: true }) as
              | CanvasRenderingContext2D
              | OffscreenCanvasRenderingContext2D
              | null;
            if (fbCtx && 'putImageData' in fbCtx) {
              fbCtx.putImageData(updatedImageData, 0, 0);
            }
          } catch {
            // If framebuffer sync fails, imageData update still preserves correctness.
          }
          state.updateLayer(activeLayerId, { imageData: updatedImageData, framebuffer });
        } else {
          state.updateLayer(activeLayerId, { imageData: updatedImageData });
        }
      }

      state.setCurrentCompositeBitmap(null);
      state.setLayersNeedRecomposition(true);
      const floatingVectorPath =
        selectionVectorPath && selectionVectorPath.points.length >= 2
          ? {
              mode: selectionVectorPath.mode,
              points: selectionVectorPath.points.map((point) => ({
                x: point.x - capture.bounds.x,
                y: point.y - capture.bounds.y,
              })),
            }
          : null;
      const colorCyclePayload = buildTransferredColorCyclePayload(activeLayer, capture);
      set({
        selectionStart: null,
        selectionEnd: null,
        selectionVectorPath: null,
        selectionMask: null,
        selectionMaskBounds: null,
        selectionMaskLayerId: null,
        floatingPaste: {
          active: true,
          imageData: capture.selectionImageData,
          position: { x: capture.bounds.x, y: capture.bounds.y },
          originalPosition: { x: capture.bounds.x, y: capture.bounds.y },
          width: capture.bounds.width,
          height: capture.bounds.height,
          displayWidth: capture.bounds.width,
          displayHeight: capture.bounds.height,
          rotation: 0,
          sourceLayerId: activeLayerId,
          ...colorCyclePayload,
          vectorPath: floatingVectorPath,
        },
        floatingPasteHistoryContext: {
          sourceLayerId: activeLayerId,
          sourceBounds: {
            x: capture.bounds.x,
            y: capture.bounds.y,
            width: capture.bounds.width,
            height: capture.bounds.height,
          },
          sourceBeforeImage: extractImageDataRegion(sourceImageData, capture.bounds),
          sourceGradientIds: extractColorCycleRegion(beforeColorState, capture.bounds, 'gradientIdBuffer', activeLayerId),
          sourceGradientDefIds: extractColorCycleDefRegion(beforeColorState, capture.bounds, activeLayerId),
          sourceSpeed: extractColorCycleRegion(beforeColorState, capture.bounds, 'speedBuffer', activeLayerId),
          sourceFlow: extractColorCycleRegion(beforeColorState, capture.bounds, 'flowBuffer', activeLayerId),
          sourcePhase: extractColorCycleRegion(beforeColorState, capture.bounds, 'phaseBuffer', activeLayerId),
          beforeImage,
          beforeColorState,
          selectionBefore,
        },
      });

      return true;
    },

    floatingPaste: null,
    floatingPasteHistoryContext: null,
    setFloatingPaste: (paste) =>
      set((state) => {
        if (
          process.env.NODE_ENV !== 'production' &&
          paste &&
          !paste.colorCycleIndices &&
          state.layers.find((layer) => layer.id === state.activeLayerId)?.layerType === 'color-cycle'
        ) {
          debugWarn('raw-console', '[floatingPaste] Missing colorCycleIndices in setFloatingPaste', {
            activeLayerId: state.activeLayerId,
            sourceLayerId: paste.sourceLayerId,
            hasImageData: Boolean(paste.imageData),
          });
        }

        return {
          floatingPaste: paste
              ? {
                  active: true,
                  imageData: paste.imageData,
                  position: paste.position,
                  originalPosition: paste.originalPosition ?? paste.position,
                  width: paste.width,
                  height: paste.height,
                  displayWidth: paste.displayWidth ?? paste.width,
                  displayHeight: paste.displayHeight ?? paste.height,
                  rotation: paste.colorCycleIndices ? 0 : (paste.rotation ?? 0),
                  sourceLayerId: paste.sourceLayerId ?? null,
                  colorCycleIndices: paste.colorCycleIndices ?? null,
                  colorCycleGradientIds: paste.colorCycleGradientIds ?? null,
                  colorCycleSlotPalettes: cloneTransferredColorCycleSlotPalettes(paste.colorCycleSlotPalettes),
                  colorCycleGradientDefIds: paste.colorCycleGradientDefIds ?? null,
                  colorCycleGradientDefs: cloneTransferredColorCycleGradientDefs(paste.colorCycleGradientDefs),
                  colorCycleSpeed: paste.colorCycleSpeed ?? null,
                  colorCycleFlow: paste.colorCycleFlow ?? null,
                  colorCyclePhase: paste.colorCyclePhase ?? null,
                  vectorPath: paste.vectorPath ?? null,
                }
              : null,
          floatingPasteHistoryContext: null,
        };
      }),
    updateFloatingPastePosition: (position) =>
      set((state) => ({
        floatingPaste: state.floatingPaste
          ? {
              ...state.floatingPaste,
              position,
            }
          : null,
      })),
    updateFloatingPasteRect: (rect) =>
      set((state) => ({
        floatingPaste: state.floatingPaste
          ? {
              ...state.floatingPaste,
              position: { x: rect.x, y: rect.y },
              displayWidth: rect.width,
              displayHeight: rect.height,
            }
          : null,
      })),
    updateFloatingPasteRotation: (rotation) =>
      set((state) => ({
        floatingPaste: state.floatingPaste
          ? {
              ...state.floatingPaste,
              rotation,
            }
          : null,
      })),
    flipFloatingPasteHorizontal: () =>
      set((state) => {
        const floatingPaste = state.floatingPaste;
        if (!floatingPaste || !floatingPaste.imageData) {
          return { floatingPaste };
        }

        const imageData = floatingPaste.imageData;
        return {
          floatingPaste: {
            ...floatingPaste,
            imageData: flipImageData(imageData, 'horizontal'),
            colorCycleIndices: floatingPaste.colorCycleIndices
              ? flipColorCycleIndices(
                  floatingPaste.colorCycleIndices,
                  floatingPaste.width,
                  floatingPaste.height,
                  'horizontal'
                )
              : floatingPaste.colorCycleIndices,
            colorCycleGradientIds: floatingPaste.colorCycleGradientIds
              ? flipColorCycleIndices(
                  floatingPaste.colorCycleGradientIds,
                  floatingPaste.width,
                  floatingPaste.height,
                  'horizontal'
                )
              : floatingPaste.colorCycleGradientIds,
            colorCycleGradientDefIds: floatingPaste.colorCycleGradientDefIds
              ? flipColorCycleValues16(
                  floatingPaste.colorCycleGradientDefIds,
                  floatingPaste.width,
                  floatingPaste.height,
                  'horizontal'
                )
              : floatingPaste.colorCycleGradientDefIds,
            colorCycleSpeed: floatingPaste.colorCycleSpeed
              ? flipColorCycleIndices(
                  floatingPaste.colorCycleSpeed,
                  floatingPaste.width,
                  floatingPaste.height,
                  'horizontal'
                )
              : floatingPaste.colorCycleSpeed,
            colorCycleFlow: floatingPaste.colorCycleFlow
              ? flipColorCycleIndices(
                  floatingPaste.colorCycleFlow,
                  floatingPaste.width,
                  floatingPaste.height,
                  'horizontal'
                )
              : floatingPaste.colorCycleFlow,
            colorCyclePhase: floatingPaste.colorCyclePhase
              ? flipColorCycleIndices(
                  floatingPaste.colorCyclePhase,
                  floatingPaste.width,
                  floatingPaste.height,
                  'horizontal'
                )
              : floatingPaste.colorCyclePhase,
            vectorPath: flipVectorPath(
              floatingPaste.vectorPath ?? null,
              floatingPaste.width,
              floatingPaste.height,
              'horizontal'
            ),
          },
        };
      }),
    flipFloatingPasteVertical: () =>
      set((state) => {
        const floatingPaste = state.floatingPaste;
        if (!floatingPaste || !floatingPaste.imageData) {
          return { floatingPaste };
        }

        const imageData = floatingPaste.imageData;
        return {
          floatingPaste: {
            ...floatingPaste,
            imageData: flipImageData(imageData, 'vertical'),
            colorCycleIndices: floatingPaste.colorCycleIndices
              ? flipColorCycleIndices(
                  floatingPaste.colorCycleIndices,
                  floatingPaste.width,
                  floatingPaste.height,
                  'vertical'
                )
              : floatingPaste.colorCycleIndices,
            colorCycleGradientIds: floatingPaste.colorCycleGradientIds
              ? flipColorCycleIndices(
                  floatingPaste.colorCycleGradientIds,
                  floatingPaste.width,
                  floatingPaste.height,
                  'vertical'
                )
              : floatingPaste.colorCycleGradientIds,
            colorCycleGradientDefIds: floatingPaste.colorCycleGradientDefIds
              ? flipColorCycleValues16(
                  floatingPaste.colorCycleGradientDefIds,
                  floatingPaste.width,
                  floatingPaste.height,
                  'vertical'
                )
              : floatingPaste.colorCycleGradientDefIds,
            colorCycleSpeed: floatingPaste.colorCycleSpeed
              ? flipColorCycleIndices(
                  floatingPaste.colorCycleSpeed,
                  floatingPaste.width,
                  floatingPaste.height,
                  'vertical'
                )
              : floatingPaste.colorCycleSpeed,
            colorCycleFlow: floatingPaste.colorCycleFlow
              ? flipColorCycleIndices(
                  floatingPaste.colorCycleFlow,
                  floatingPaste.width,
                  floatingPaste.height,
                  'vertical'
                )
              : floatingPaste.colorCycleFlow,
            colorCyclePhase: floatingPaste.colorCyclePhase
              ? flipColorCycleIndices(
                  floatingPaste.colorCyclePhase,
                  floatingPaste.width,
                  floatingPaste.height,
                  'vertical'
                )
              : floatingPaste.colorCyclePhase,
            vectorPath: flipVectorPath(
              floatingPaste.vectorPath ?? null,
              floatingPaste.width,
              floatingPaste.height,
              'vertical'
            ),
          },
        };
      }),
    commitFloatingPaste: () => selectionPasteHelpers.commitFloatingPaste(),
    cancelFloatingPaste: () => selectionPasteHelpers.cancelFloatingPaste(),
    copySelectionToClipboard: async (options) => {
      const mode = options?.mode ?? 'copy';
      const state = get();
      const { selectionStart, selectionEnd, project, layers, activeLayerId, floatingPaste } = state;

      let clipboardPayload: SelectionClipboardPayload | null = null;

      if (selectionStart && selectionEnd && project && activeLayerId) {
        const activeLayer = layers.find((layer) => layer.id === activeLayerId) ?? null;
        if (activeLayer) {
          const capture = state.selectionMask && state.selectionMaskBounds
            ? captureSelectionBitmapFromMask({
                mask: state.selectionMask,
                maskBounds: state.selectionMaskBounds,
                project,
                layer: activeLayer,
                clearSource: mode === 'cut',
              })
            : captureSelectionBitmap({
                selectionStart,
                selectionEnd,
                project,
                layer: activeLayer,
                clearSource: mode === 'cut',
              });

          if (capture) {
            const colorCyclePayload = buildTransferredColorCyclePayload(activeLayer, capture);
            clipboardPayload = {
              imageData: capture.selectionImageData,
              position: { x: capture.bounds.x, y: capture.bounds.y },
              width: capture.bounds.width,
              height: capture.bounds.height,
              mode,
              ...colorCyclePayload,
              colorCycleSourceLayerId: capture.colorCycleIndices ? activeLayerId : null,
            };

            if (mode === 'cut' && capture.updatedLayerImageData) {
              const selectionBefore = selectionSnapshotFromValues(selectionStart, selectionEnd);
              const beforeImage = activeLayer.imageData ? cloneLayerImageData(activeLayer.imageData) : null;
              const beforeColorState =
                activeLayer.layerType === 'color-cycle'
                  ? captureColorCycleBrushState(activeLayer.id)
                  : null;

              let skipImageUpdate = false;
              if (activeLayer.layerType === 'color-cycle' && project) {
                skipImageUpdate = clearColorCycleRegion(state, activeLayer, project, {
                  x: capture.bounds.x,
                  y: capture.bounds.y,
                  width: capture.bounds.width,
                  height: capture.bounds.height,
                }, {
                  ...buildColorCycleMaskClearOptions(capture.bounds, state.selectionMask, state.selectionMaskBounds),
                  auditSource: 'cut-selection',
                  auditDetails: {
                    activeLayerId,
                    captureBounds: capture.bounds,
                    selectionStart,
                    selectionEnd,
                    selectionMaskBounds: state.selectionMaskBounds,
                    selectionMaskLayerId: state.selectionMaskLayerId,
                  },
                });
                if (skipImageUpdate) {
                  const eraseMask = activeLayer.colorCycleData?.eraseMask;
                  clearColorCycleEraseMask(eraseMask, capture.bounds, state.selectionMask, state.selectionMaskBounds);
                  state.scheduleColorCycleSlotRebuild?.('cut-selection');
                }
              }
              if (!skipImageUpdate) {
                state.updateLayer(activeLayerId, { imageData: capture.updatedLayerImageData });
              }
              state.setLayersNeedRecomposition(true);
              state.setCurrentCompositeBitmap(null);

              const cutHistoryCommit = commitLayerHistory({
                layerId: activeLayerId,
                beforeImage,
                beforeColorState,
                actionType: 'selection',
                description: 'Cut selection to clipboard',
                tool: 'selection',
                selectionBefore,
              }).catch((error) => {
                if (process.env.NODE_ENV !== 'production') {
                  debugWarn('raw-console', '[history] Failed to record selection cut', error);
                }
              });
              trackPendingHistoryCommit(cutHistoryCommit);
            }
          }
        }
      }

      if (!clipboardPayload && floatingPaste?.imageData) {
        clipboardPayload = createClipboardPayloadFromFloatingPaste(floatingPaste, mode);
        if (mode === 'cut') {
          set({ floatingPaste: null, floatingPasteHistoryContext: null });
        }
      }

      if (!clipboardPayload) {
        return false;
      }

      set({ selectionClipboard: clipboardPayload });
      void writeImageDataToClipboard(clipboardPayload.imageData);
      return true;
    },
    clearSelectionClipboard: () => set({ selectionClipboard: null }),
  };
};

const writeImageDataToClipboard = async (imageData: ImageData): Promise<void> => {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    return;
  }

  const clipboardCtor = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (typeof clipboardCtor !== 'function') {
    return;
  }

  const blob = await imageDataToBlob(imageData);
  if (!blob) {
    return;
  }

  try {
    await navigator.clipboard.write([new clipboardCtor({ [blob.type]: blob })]);
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      debugWarn('raw-console', '[selectionClipboard] Failed to write image to clipboard', error);
    }
  }
};

const imageDataToBlob = async (imageData: ImageData): Promise<Blob | null> => {
  if (typeof document === 'undefined') {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.putImageData(imageData, 0, 0);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob ?? null);
    }, 'image/png');
  });
};

const cloneImageData = (imageData: ImageData): ImageData =>
  new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);

const createClipboardPayloadFromFloatingPaste = (
  floatingPaste: NonNullable<AppState['floatingPaste']>,
  mode: 'copy' | 'cut'
): SelectionClipboardPayload => {
  if (!floatingPaste.imageData) {
    throw new Error('Floating paste is missing image data.');
  }

  return {
    imageData: cloneImageData(floatingPaste.imageData),
    position: {
      x: Math.round(floatingPaste.position.x),
      y: Math.round(floatingPaste.position.y),
    },
    width: floatingPaste.imageData.width,
    height: floatingPaste.imageData.height,
    mode,
    colorCycleIndices: floatingPaste.colorCycleIndices
      ? new Uint8Array(floatingPaste.colorCycleIndices)
      : null,
    colorCycleGradientIds: floatingPaste.colorCycleGradientIds
      ? new Uint8Array(floatingPaste.colorCycleGradientIds)
      : null,
    colorCycleSlotPalettes: cloneTransferredColorCycleSlotPalettes(floatingPaste.colorCycleSlotPalettes),
    colorCycleGradientDefIds: floatingPaste.colorCycleGradientDefIds
      ? new Uint16Array(floatingPaste.colorCycleGradientDefIds)
      : null,
    colorCycleGradientDefs: cloneTransferredColorCycleGradientDefs(floatingPaste.colorCycleGradientDefs),
    colorCycleSpeed: floatingPaste.colorCycleSpeed
      ? new Uint8Array(floatingPaste.colorCycleSpeed)
      : null,
    colorCycleFlow: floatingPaste.colorCycleFlow
      ? new Uint8Array(floatingPaste.colorCycleFlow)
      : null,
    colorCyclePhase: floatingPaste.colorCyclePhase
      ? new Uint8Array(floatingPaste.colorCyclePhase)
      : null,
    colorCycleSourceLayerId: floatingPaste.sourceLayerId ?? null,
  };
};
