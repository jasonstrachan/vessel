import type { Layer, Project, Rectangle } from '@/types';
import type { SelectionActionProvenance } from '@/stores/slices/selectionSlice';
import {
  summarizeColorCycleSelectionPaint,
  type ColorCycleSelectionPaintSummary,
} from '@/lib/colorCycle/document/paintDeltaMask';

export {
  summarizeColorCycleSelectionPaint,
  type ColorCycleSelectionPaintSummary,
} from '@/lib/colorCycle/document/paintDeltaMask';

export type SelectionDeleteSource =
  | 'keyboard-delete'
  | 'menu-delete'
  | 'toolbar-delete'
  | 'api-delete';

export type SelectionOwnerKind =
  | 'direct-marquee'
  | 'selection-handle'
  | 'mask-selection'
  | 'history-restored'
  | 'select-all'
  | 'programmatic'
  | 'unknown';

export interface SelectionDeleteRequest {
  source: string;
  activeLayer: Layer | null;
  activeLayerId: string | null;
  project: Project | null;
  selectionStart: { x: number; y: number } | null;
  selectionEnd: { x: number; y: number } | null;
  selectionMask: ImageData | null;
  selectionMaskBounds: Rectangle | null;
  selectionMaskLayerId: string | null;
  selectionLastAction: SelectionActionProvenance | null;
  colorCyclePaint?: {
    buffer: Uint8Array | null;
    width: number;
    height: number;
    hasFullCanonicalPayload?: boolean;
  } | null;
}

export type SelectionDeleteAuthorization =
  | {
      ok: true;
      layerId: string;
      layerType: Layer['layerType'];
      bounds: Rectangle;
      source: SelectionDeleteSource;
      selectionOwnerKind: SelectionOwnerKind;
      allowFullContentClear: boolean;
      destructiveIntent: 'normal' | 'explicit-full-clear';
      colorCyclePaintSummary: ColorCycleSelectionPaintSummary | null;
    }
  | {
      ok: false;
      reason:
        | 'missing-selection'
        | 'missing-active-layer'
        | 'history-restored-keyboard-delete'
        | 'keyboard-full-content-clear-blocked'
        | 'unknown-delete-source'
        | 'missing-canonical-paint'
        | 'invalid-bounds';
      clearSelection: boolean;
      details: Record<string, unknown>;
      colorCyclePaintSummary?: ColorCycleSelectionPaintSummary | null;
    };

export const normalizeSelectionDeleteSource = (source: string): SelectionDeleteSource | null => {
  switch (source) {
    case 'keyboard-delete':
    case 'menu-delete':
    case 'toolbar-delete':
    case 'api-delete':
      return source;
    case 'deleteSelectedPixels':
      return 'api-delete';
    default:
      return null;
  }
};

export const resolveSelectionDeleteBounds = (
  start: { x: number; y: number } | null,
  end: { x: number; y: number } | null
): Rectangle | null => {
  if (!start || !end) {
    return null;
  }
  if (
    !Number.isFinite(start.x) ||
    !Number.isFinite(start.y) ||
    !Number.isFinite(end.x) ||
    !Number.isFinite(end.y)
  ) {
    return null;
  }

  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
};

const reject = (
  reason: Extract<SelectionDeleteAuthorization, { ok: false }>['reason'],
  clearSelection: boolean,
  details: Record<string, unknown>,
  colorCyclePaintSummary?: ColorCycleSelectionPaintSummary | null
): SelectionDeleteAuthorization => ({
  ok: false,
  reason,
  clearSelection,
  details,
  colorCyclePaintSummary,
});

export const authorizeSelectionDelete = (
  request: SelectionDeleteRequest
): SelectionDeleteAuthorization => {
  const source = normalizeSelectionDeleteSource(request.source);
  if (!source) {
    return reject('unknown-delete-source', false, { source: request.source });
  }

  const bounds = resolveSelectionDeleteBounds(request.selectionStart, request.selectionEnd);
  if (!request.selectionStart || !request.selectionEnd) {
    return reject('missing-selection', false, { source });
  }
  if (!bounds) {
    return reject('invalid-bounds', true, {
      source,
      selectionStart: request.selectionStart,
      selectionEnd: request.selectionEnd,
    });
  }

  const { activeLayer, activeLayerId } = request;
  if (!activeLayer || !activeLayerId || !request.project) {
    return reject('missing-active-layer', false, { source, activeLayerId });
  }

  const selectionOwnerKind = request.selectionLastAction?.ownerKind ?? 'unknown';
  const isHistoryRestored = selectionOwnerKind === 'history-restored' || request.selectionLastAction?.restoredFromHistory === true;
  const isExplicitSelectAll =
    request.selectionLastAction?.action === 'select-all' && selectionOwnerKind === 'select-all';
  const isCurrentMarqueeSelection =
    selectionOwnerKind === 'direct-marquee' ||
    selectionOwnerKind === 'selection-handle';
  if (activeLayer.layerType === 'color-cycle' && source === 'keyboard-delete' && isHistoryRestored) {
    return reject('history-restored-keyboard-delete', false, {
      source,
      activeLayerId,
      selectionLastAction: request.selectionLastAction,
    });
  }

  let colorCyclePaintSummary: ColorCycleSelectionPaintSummary | null = null;
  if (activeLayer.layerType === 'color-cycle') {
    const paint = request.colorCyclePaint;
    if (
      !paint?.buffer ||
      paint.buffer.byteLength === 0 ||
      paint.width <= 0 ||
      paint.height <= 0 ||
      paint.hasFullCanonicalPayload !== true
    ) {
      return reject('missing-canonical-paint', false, {
        source,
        activeLayerId,
        selectionLastAction: request.selectionLastAction,
        hasPaintBuffer: Boolean(paint?.buffer?.byteLength),
        hasFullCanonicalPayload: paint?.hasFullCanonicalPayload ?? false,
        paintWidth: paint?.width ?? null,
        paintHeight: paint?.height ?? null,
      });
    }
    colorCyclePaintSummary = summarizeColorCycleSelectionPaint({
      paint: paint.buffer,
      paintWidth: paint.width,
      paintHeight: paint.height,
      bounds,
      selectionMask: request.selectionMask,
      selectionMaskBounds: request.selectionMaskBounds,
    });

    if (
      source === 'keyboard-delete' &&
      !isExplicitSelectAll &&
      !isCurrentMarqueeSelection &&
      colorCyclePaintSummary.wouldClearAllPaint
    ) {
      return reject('keyboard-full-content-clear-blocked', false, {
        source,
        activeLayerId,
        selectionLastAction: request.selectionLastAction,
      }, colorCyclePaintSummary);
    }
  }

  const allowFullContentClear =
    (isExplicitSelectAll || isCurrentMarqueeSelection) &&
    colorCyclePaintSummary?.wouldClearAllPaint === true;
  return {
    ok: true,
    layerId: activeLayerId,
    layerType: activeLayer.layerType,
    bounds,
    source,
    selectionOwnerKind,
    allowFullContentClear,
    destructiveIntent: allowFullContentClear ? 'explicit-full-clear' : 'normal',
    colorCyclePaintSummary,
  };
};
