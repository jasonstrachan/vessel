import type { Layer } from '@/types';

import {
  hasGradientBindingBuffers,
  normalizeColorCycleLayerDocumentState,
  type ColorCycleLayerDocumentState,
} from './documentState';
import { recoverCompatibilitySnapshotPaintBuffer } from './legacyCompatibilitySnapshotRepair';

export type ColorCycleLegacyRepairFailureReason =
  | 'not-color-cycle'
  | 'dimension-mismatch'
  | 'missing-paint-buffer'
  | 'missing-gradient-bindings'
  | 'empty-compatibility-snapshot'
  | 'unsupported-legacy-shape';

export type ColorCycleLegacyRepairResult =
  | {
      ok: true;
      repaired: boolean;
      state: ColorCycleLayerDocumentState & { paintBuffer: ArrayBuffer };
      repairNotes: string[];
    }
  | {
      ok: false;
      reason: ColorCycleLegacyRepairFailureReason;
      preview?: ImageData;
    };

const cloneImageData = (imageData: ImageData): ImageData => (
  new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height)
);

const hasVisiblePixels = (imageData: ImageData): boolean => {
  for (let index = 3; index < imageData.data.length; index += 4) {
    if (imageData.data[index] !== 0) {
      return true;
    }
  }
  return false;
};

const mapNormalizeFailureReason = (reason: string): ColorCycleLegacyRepairFailureReason => {
  if (reason === 'not-color-cycle') {
    return 'not-color-cycle';
  }
  if (reason.includes('byteLength') || reason === 'missing-dimensions') {
    return 'dimension-mismatch';
  }
  return 'unsupported-legacy-shape';
};

const getCompatibilityPreview = (layer: Layer): ImageData | undefined => (
  layer.colorCycleData?.canvasImageData ?? undefined
);

export const repairLegacyColorCycleLayer = (layer: Layer): ColorCycleLegacyRepairResult => {
  const documentStateResult = normalizeColorCycleLayerDocumentState(layer);
  if (!documentStateResult.ok) {
    return {
      ok: false,
      reason: mapNormalizeFailureReason(documentStateResult.reason),
      preview: getCompatibilityPreview(layer),
    };
  }

  const { state } = documentStateResult;
  if (state.paintBuffer) {
    return {
      ok: true,
      repaired: false,
      state: {
        ...state,
        paintBuffer: state.paintBuffer.slice(0),
      },
      repairNotes: [],
    };
  }

  const preview = getCompatibilityPreview(layer);
  if (!preview) {
    return { ok: false, reason: 'missing-paint-buffer' };
  }

  if (preview.width !== state.width || preview.height !== state.height) {
    return {
      ok: false,
      reason: 'dimension-mismatch',
      preview: cloneImageData(preview),
    };
  }

  if (!hasGradientBindingBuffers(state)) {
    return {
      ok: false,
      reason: 'missing-gradient-bindings',
      preview: cloneImageData(preview),
    };
  }

  if (!hasVisiblePixels(preview)) {
    return {
      ok: false,
      reason: 'empty-compatibility-snapshot',
      preview: cloneImageData(preview),
    };
  }

  const gradientStops =
    state.slotPalettes?.find((entry) => entry.slot === state.paintSlot)?.stops ??
    state.slotPalettes?.find((entry) => entry.slot === state.fgActiveSlot)?.stops ??
    state.slotPalettes?.[0]?.stops ??
    layer.colorCycleData?.gradient;

  const paintBuffer = recoverCompatibilitySnapshotPaintBuffer({
    imageData: preview,
    width: state.width,
    height: state.height,
    gradientStops,
  });

  if (!paintBuffer) {
    return {
      ok: false,
      reason: 'empty-compatibility-snapshot',
      preview: cloneImageData(preview),
    };
  }

  return {
    ok: true,
    repaired: true,
    state: {
      ...state,
      paintBuffer,
      hasContent: true,
    },
    repairNotes: ['recovered-paint-buffer-from-compatibility-snapshot'],
  };
};
