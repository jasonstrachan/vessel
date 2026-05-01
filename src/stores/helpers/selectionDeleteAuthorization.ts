import type { Layer, Project, Rectangle } from '@/types';
import type { SelectionActionProvenance } from '@/stores/slices/selectionSlice';

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

export interface ColorCycleSelectionPaintSummary {
  paintWidth: number;
  paintHeight: number;
  totalNonZeroPaint: number;
  selectedNonZeroPaint: number;
  wouldClearAllPaint: boolean;
}

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
        | 'selection-layer-mismatch'
        | 'selection-mask-layer-mismatch'
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

const clampRange = (start: number, end: number, limit: number): [number, number] => [
  Math.max(0, Math.floor(start)),
  Math.min(limit, Math.ceil(end)),
];

const isSelectedByMask = (
  x: number,
  y: number,
  mask: ImageData | null,
  maskBounds: Rectangle | null
): boolean => {
  if (!mask || !maskBounds) {
    return true;
  }
  const maskX = x - Math.floor(maskBounds.x);
  const maskY = y - Math.floor(maskBounds.y);
  if (maskX < 0 || maskY < 0 || maskX >= mask.width || maskY >= mask.height) {
    return false;
  }
  return mask.data[(maskY * mask.width + maskX) * 4 + 3] > 0;
};

export const summarizeColorCycleSelectionPaint = (args: {
  paintBuffer: Uint8Array;
  paintWidth: number;
  paintHeight: number;
  bounds: Rectangle;
  selectionMask?: ImageData | null;
  selectionMaskBounds?: Rectangle | null;
}): ColorCycleSelectionPaintSummary => {
  const { paintBuffer, paintWidth, paintHeight, bounds, selectionMask = null, selectionMaskBounds = null } = args;
  let totalNonZeroPaint = 0;
  let selectedNonZeroPaint = 0;

  const [startX, endX] = clampRange(bounds.x, bounds.x + bounds.width, paintWidth);
  const [startY, endY] = clampRange(bounds.y, bounds.y + bounds.height, paintHeight);

  for (let y = 0; y < paintHeight; y += 1) {
    const row = y * paintWidth;
    for (let x = 0; x < paintWidth; x += 1) {
      const index = row + x;
      if (paintBuffer[index] === 0) {
        continue;
      }
      totalNonZeroPaint += 1;
      if (
        x >= startX &&
        x < endX &&
        y >= startY &&
        y < endY &&
        isSelectedByMask(x, y, selectionMask, selectionMaskBounds)
      ) {
        selectedNonZeroPaint += 1;
      }
    }
  }

  return {
    paintWidth,
    paintHeight,
    totalNonZeroPaint,
    selectedNonZeroPaint,
    wouldClearAllPaint: totalNonZeroPaint > 0 && selectedNonZeroPaint === totalNonZeroPaint,
  };
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

  const selectionOwnerLayerId = request.selectionLastAction?.activeLayerId ?? null;
  if (selectionOwnerLayerId && selectionOwnerLayerId !== activeLayerId) {
    return reject('selection-layer-mismatch', true, {
      source,
      selectionOwnerLayerId,
      activeLayerId,
      selectionLastAction: request.selectionLastAction,
    });
  }

  if (request.selectionMaskLayerId && request.selectionMaskLayerId !== activeLayerId) {
    return reject('selection-mask-layer-mismatch', true, {
      source,
      selectionMaskLayerId: request.selectionMaskLayerId,
      activeLayerId,
      selectionLastAction: request.selectionLastAction,
    });
  }

  const selectionOwnerKind = request.selectionLastAction?.ownerKind ?? 'unknown';
  const isHistoryRestored = selectionOwnerKind === 'history-restored' || request.selectionLastAction?.restoredFromHistory === true;
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
    if (!paint?.buffer || paint.buffer.byteLength === 0 || paint.width <= 0 || paint.height <= 0) {
      return reject('missing-canonical-paint', false, {
        source,
        activeLayerId,
        selectionLastAction: request.selectionLastAction,
        hasPaintBuffer: Boolean(paint?.buffer?.byteLength),
        paintWidth: paint?.width ?? null,
        paintHeight: paint?.height ?? null,
      });
    }
    colorCyclePaintSummary = summarizeColorCycleSelectionPaint({
      paintBuffer: paint.buffer,
      paintWidth: paint.width,
      paintHeight: paint.height,
      bounds,
      selectionMask: request.selectionMask,
      selectionMaskBounds: request.selectionMaskBounds,
    });

    const isExplicitSelectAll = request.selectionLastAction?.action === 'select-all' && selectionOwnerKind === 'select-all';
    if (source === 'keyboard-delete' && !isExplicitSelectAll && colorCyclePaintSummary.wouldClearAllPaint) {
      return reject('keyboard-full-content-clear-blocked', false, {
        source,
        activeLayerId,
        selectionLastAction: request.selectionLastAction,
      }, colorCyclePaintSummary);
    }
  }

  const allowFullContentClear = request.selectionLastAction?.action === 'select-all' && selectionOwnerKind === 'select-all';
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
