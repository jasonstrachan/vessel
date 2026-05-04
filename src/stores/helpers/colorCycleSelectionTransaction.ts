import type { Layer, Project, Rectangle } from '@/types';
import type { SelectionActionProvenance } from '@/stores/slices/selectionSlice';
import type { LayerHistoryPayload } from '@/history/helpers/layerHistory';
import {
  authorizeSelectionDelete,
  resolveSelectionDeleteBounds,
  summarizeColorCycleSelectionPaint,
  type ColorCycleSelectionPaintSummary,
} from '@/stores/helpers/selectionDeleteAuthorization';
import {
  captureSelectionBitmap,
  captureSelectionBitmapFromMask,
  type SelectionCaptureResult,
} from '@/stores/helpers/selectionCapture';

export type CcSelectionOperation =
  | 'delete-selected'
  | 'extract-selection-transform'
  | 'commit-floating-paste'
  | 'cancel-floating-paste';

export type CcSelectionAllowedKind =
  | 'partial-clear'
  | 'explicit-full-delete'
  | 'full-object-move'
  | 'paste-commit'
  | 'paste-cancel-restore';

export type CcSelectionBlockedKind =
  | 'selection-layer-mismatch'
  | 'selection-mask-layer-mismatch'
  | 'history-restored-unsafe'
  | 'missing-canonical-payload'
  | 'scalar-buffer-size-mismatch'
  | 'missing-gradient-definition'
  | 'unsupported-cross-layer-target'
  | 'invalid-selection';

export type CcSelectionPreflight =
  | {
      ok: true;
      transactionId: string;
      kind: CcSelectionAllowedKind;
      operation: CcSelectionOperation;
      bounds: Rectangle;
      requiresPayload: boolean;
      paintSummary: ColorCycleSelectionPaintSummary | null;
    }
  | {
      ok: false;
      transactionId: string;
      kind: CcSelectionBlockedKind;
      operation: CcSelectionOperation;
      clearSelection: boolean;
      details: Record<string, unknown>;
    };

export interface CcCanonicalSelectionPayload {
  paintBuffer: Uint8Array | null;
  gradientIdBuffer?: Uint8Array | null;
  gradientDefIdBuffer?: Uint16Array | null;
  speedBuffer?: Uint8Array | null;
  flowBuffer?: Uint8Array | null;
  phaseBuffer?: Uint8Array | null;
  width: number;
  height: number;
}

export interface CcSelectionPreflightRequest {
  operation: CcSelectionOperation;
  source?: string;
  transactionId?: string;
  activeLayer: Layer | null;
  activeLayerId: string | null;
  project: Project | null;
  selectionStart: { x: number; y: number } | null;
  selectionEnd: { x: number; y: number } | null;
  selectionMask?: ImageData | null;
  selectionMaskBounds?: Rectangle | null;
  selectionMaskLayerId?: string | null;
  selectionLastAction?: SelectionActionProvenance | null;
  canonical: CcCanonicalSelectionPayload | null;
  requireGradientDefinitionPresence?: boolean;
}

export type CcSelectionBeforeCapture =
  | {
      ok: true;
      transactionId: string;
      capture: SelectionCaptureResult;
    }
  | {
      ok: false;
      transactionId: string;
      kind: CcSelectionBlockedKind;
      details: Record<string, unknown>;
    };

export interface CaptureCcSelectionBeforeRequest {
  preflight: Extract<CcSelectionPreflight, { ok: true }>;
  layer: Layer;
  project: Project;
  selectionStart: { x: number; y: number };
  selectionEnd: { x: number; y: number };
  selectionMask?: ImageData | null;
  selectionMaskBounds?: Rectangle | null;
}

export type CcSelectionHistoryPayloadInput = LayerHistoryPayload & {
  transactionId: string;
  operation: CcSelectionOperation;
};

let nextTransactionId = 0;

const createTransactionId = (operation: CcSelectionOperation): string => {
  nextTransactionId += 1;
  return `cc-selection-${operation}-${Date.now()}-${nextTransactionId}`;
};

const toBlockedKind = (reason: string): CcSelectionBlockedKind => {
  switch (reason) {
    case 'selection-layer-mismatch':
      return 'selection-layer-mismatch';
    case 'selection-mask-layer-mismatch':
      return 'selection-mask-layer-mismatch';
    case 'history-restored-keyboard-delete':
      return 'history-restored-unsafe';
    case 'missing-canonical-paint':
      return 'missing-canonical-payload';
    case 'invalid-bounds':
    case 'missing-selection':
    case 'missing-active-layer':
    case 'unknown-delete-source':
    case 'keyboard-full-content-clear-blocked':
    default:
      return 'invalid-selection';
  }
};

const expectedPixelCount = (canonical: CcCanonicalSelectionPayload | null): number => (
  Math.max(0, canonical?.width ?? 0) * Math.max(0, canonical?.height ?? 0)
);

const hasFullCanonicalPayload = (canonical: CcCanonicalSelectionPayload | null): boolean => {
  const pixelCount = expectedPixelCount(canonical);
  return Boolean(
    canonical &&
    pixelCount > 0 &&
    canonical.paintBuffer?.byteLength === pixelCount &&
    canonical.gradientIdBuffer?.byteLength === pixelCount &&
    canonical.gradientDefIdBuffer?.byteLength === pixelCount * Uint16Array.BYTES_PER_ELEMENT &&
    canonical.speedBuffer?.byteLength === pixelCount &&
    canonical.flowBuffer?.byteLength === pixelCount &&
    canonical.phaseBuffer?.byteLength === pixelCount
  );
};

const collectUsedDefIds = (defIds: Uint16Array | null | undefined): Set<number> => {
  const used = new Set<number>();
  if (!defIds) {
    return used;
  }
  for (const defId of defIds) {
    if (defId > 0) {
      used.add(defId);
    }
  }
  return used;
};

const findMissingGradientDefIds = (
  layer: Layer,
  canonical: CcCanonicalSelectionPayload | null
): number[] => {
  const usedDefIds = collectUsedDefIds(canonical?.gradientDefIdBuffer);
  if (usedDefIds.size === 0) {
    return [];
  }
  const knownDefIds = new Set(layer.colorCycleData?.gradientDefStore?.map((entry) => entry.id) ?? []);
  return [...usedDefIds].filter((defId) => !knownDefIds.has(defId)).sort((a, b) => a - b);
};

const block = (
  request: CcSelectionPreflightRequest,
  transactionId: string,
  kind: CcSelectionBlockedKind,
  clearSelection: boolean,
  details: Record<string, unknown> = {}
): CcSelectionPreflight => ({
  ok: false,
  transactionId,
  kind,
  operation: request.operation,
  clearSelection,
  details,
});

const preflightDelete = (
  request: CcSelectionPreflightRequest,
  transactionId: string,
  bounds: Rectangle
): CcSelectionPreflight => {
  const canonical = request.canonical;
  const authorization = authorizeSelectionDelete({
    source: request.source ?? 'api-delete',
    activeLayer: request.activeLayer,
    activeLayerId: request.activeLayerId,
    project: request.project,
    selectionStart: request.selectionStart,
    selectionEnd: request.selectionEnd,
    selectionMask: request.selectionMask ?? null,
    selectionMaskBounds: request.selectionMaskBounds ?? null,
    selectionMaskLayerId: request.selectionMaskLayerId ?? null,
    selectionLastAction: request.selectionLastAction ?? null,
    colorCyclePaint: {
      buffer: canonical?.paintBuffer ?? null,
      width: canonical?.width ?? 0,
      height: canonical?.height ?? 0,
      hasFullCanonicalPayload: hasFullCanonicalPayload(canonical),
    },
  });

  if (!authorization.ok) {
    return block(request, transactionId, toBlockedKind(authorization.reason), authorization.clearSelection, {
      reason: authorization.reason,
      authorizationDetails: authorization.details,
      colorCyclePaintSummary: authorization.colorCyclePaintSummary ?? null,
    });
  }

  const paintSummary = authorization.colorCyclePaintSummary;
  return {
    ok: true,
    transactionId,
    kind: authorization.destructiveIntent === 'explicit-full-clear' ? 'explicit-full-delete' : 'partial-clear',
    operation: request.operation,
    bounds,
    requiresPayload: false,
    paintSummary,
  };
};

export const preflightCcSelectionTransaction = (
  request: CcSelectionPreflightRequest
): CcSelectionPreflight => {
  const transactionId = request.transactionId ?? createTransactionId(request.operation);
  const bounds = resolveSelectionDeleteBounds(request.selectionStart, request.selectionEnd);
  if (!bounds || !request.activeLayer || !request.activeLayerId || !request.project) {
    return block(request, transactionId, 'invalid-selection', !bounds, {
      hasSelectionStart: Boolean(request.selectionStart),
      hasSelectionEnd: Boolean(request.selectionEnd),
      hasActiveLayer: Boolean(request.activeLayer),
      activeLayerId: request.activeLayerId,
      hasProject: Boolean(request.project),
    });
  }

  if (request.activeLayer.layerType !== 'color-cycle') {
    return block(request, transactionId, 'unsupported-cross-layer-target', false, {
      layerType: request.activeLayer.layerType,
    });
  }

  const selectionOwnerLayerId = request.selectionLastAction?.activeLayerId ?? null;
  if (selectionOwnerLayerId && selectionOwnerLayerId !== request.activeLayerId) {
    return block(request, transactionId, 'selection-layer-mismatch', true, {
      selectionOwnerLayerId,
      activeLayerId: request.activeLayerId,
      selectionLastAction: request.selectionLastAction ?? null,
    });
  }

  const selectionMaskLayerId = request.selectionMaskLayerId ?? null;
  if (selectionMaskLayerId && selectionMaskLayerId !== request.activeLayerId) {
    return block(request, transactionId, 'selection-mask-layer-mismatch', true, {
      selectionMaskLayerId,
      activeLayerId: request.activeLayerId,
      selectionLastAction: request.selectionLastAction ?? null,
    });
  }

  if (!hasFullCanonicalPayload(request.canonical)) {
    return block(request, transactionId, 'missing-canonical-payload', false, {
      hasPaintBuffer: Boolean(request.canonical?.paintBuffer?.byteLength),
      paintWidth: request.canonical?.width ?? null,
      paintHeight: request.canonical?.height ?? null,
      expectedPixels: expectedPixelCount(request.canonical),
      paintBytes: request.canonical?.paintBuffer?.byteLength ?? 0,
      gradientIdBytes: request.canonical?.gradientIdBuffer?.byteLength ?? 0,
      gradientDefIdBytes: request.canonical?.gradientDefIdBuffer?.byteLength ?? 0,
      speedBytes: request.canonical?.speedBuffer?.byteLength ?? 0,
      flowBytes: request.canonical?.flowBuffer?.byteLength ?? 0,
      phaseBytes: request.canonical?.phaseBuffer?.byteLength ?? 0,
    });
  }

  const missingDefIds = request.requireGradientDefinitionPresence === false
    ? []
    : findMissingGradientDefIds(request.activeLayer, request.canonical);
  if (missingDefIds.length > 0) {
    return block(request, transactionId, 'missing-gradient-definition', false, {
      missingDefIds,
    });
  }

  if (request.operation === 'delete-selected') {
    return preflightDelete(request, transactionId, bounds);
  }

  const paintSummary = summarizeColorCycleSelectionPaint({
    paintBuffer: request.canonical!.paintBuffer!,
    paintWidth: request.canonical!.width,
    paintHeight: request.canonical!.height,
    bounds,
    selectionMask: request.selectionMask ?? null,
    selectionMaskBounds: request.selectionMaskBounds ?? null,
  });

  switch (request.operation) {
    case 'extract-selection-transform':
      return {
        ok: true,
        transactionId,
        kind: paintSummary.wouldClearAllPaint ? 'full-object-move' : 'partial-clear',
        operation: request.operation,
        bounds,
        requiresPayload: true,
        paintSummary,
      };
    case 'commit-floating-paste':
      return {
        ok: true,
        transactionId,
        kind: 'paste-commit',
        operation: request.operation,
        bounds,
        requiresPayload: true,
        paintSummary,
      };
    case 'cancel-floating-paste':
      return {
        ok: true,
        transactionId,
        kind: 'paste-cancel-restore',
        operation: request.operation,
        bounds,
        requiresPayload: true,
        paintSummary,
      };
    default:
      return block(request, transactionId, 'invalid-selection', false);
  }
};

export const runCcSelectionTransaction = (
  request: CcSelectionPreflightRequest
): CcSelectionPreflight => preflightCcSelectionTransaction(request);

export const captureCcSelectionBefore = (
  request: CaptureCcSelectionBeforeRequest
): CcSelectionBeforeCapture => {
  const capture = request.selectionMask && request.selectionMaskBounds
    ? captureSelectionBitmapFromMask({
        mask: request.selectionMask,
        maskBounds: request.selectionMaskBounds,
        project: request.project,
        layer: request.layer,
        clearSource: true,
      })
    : captureSelectionBitmap({
        selectionStart: request.selectionStart,
        selectionEnd: request.selectionEnd,
        project: request.project,
        layer: request.layer,
        clearSource: true,
      });

  if (!capture || !capture.updatedLayerImageData) {
    return {
      ok: false,
      transactionId: request.preflight.transactionId,
      kind: 'missing-canonical-payload',
      details: {
        reason: 'capture-failed',
        hasCapture: Boolean(capture),
        hasUpdatedLayerImageData: Boolean(capture?.updatedLayerImageData),
      },
    };
  }

  if (
    request.preflight.requiresPayload &&
    (
      !capture.colorCycleIndices ||
      !capture.colorCycleGradientIds ||
      !capture.colorCycleGradientDefIds ||
      !capture.colorCycleSpeed ||
      !capture.colorCycleFlow ||
      !capture.colorCyclePhase
    )
  ) {
    return {
      ok: false,
      transactionId: request.preflight.transactionId,
      kind: 'missing-canonical-payload',
      details: {
        reason: 'missing-captured-scalar-payload',
        hasColorCycleIndices: Boolean(capture.colorCycleIndices),
        hasColorCycleGradientIds: Boolean(capture.colorCycleGradientIds),
        hasColorCycleGradientDefIds: Boolean(capture.colorCycleGradientDefIds),
        hasColorCycleSpeed: Boolean(capture.colorCycleSpeed),
        hasColorCycleFlow: Boolean(capture.colorCycleFlow),
        hasColorCyclePhase: Boolean(capture.colorCyclePhase),
      },
    };
  }

  return {
    ok: true,
    transactionId: request.preflight.transactionId,
    capture,
  };
};

export const buildCcSelectionHistoryPayload = ({
  transactionId,
  operation,
  ...payload
}: CcSelectionHistoryPayloadInput): LayerHistoryPayload => {
  void transactionId;
  void operation;
  return payload;
};
