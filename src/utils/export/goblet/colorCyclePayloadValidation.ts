import type {
  WebGLSerializedBrushState,
  SerializedSlotPalette,
  WebGLSerializedColorCycle,
} from '@/utils/export/goblet/gobletTypes';
import {
  GOBLET2_FORMAT,
  GOBLET2_SCHEMA_VERSION,
  GOBLET_BRUSH_MASK_FIELDS,
  GOBLET_BRUSH_REQUIRED_BUFFERS,
  GOBLET_BRUSH_REQUIRED_SCALARS,
  GOBLET_COLOR_CYCLE_BRUSH_MODE,
  GOBLET_COLOR_CYCLE_RECOLOR_MODE,
} from '@/lib/colorCycle/document/colorCycleDocumentContract';
import { FLOW_SLOT_MASK } from '@/lib/colorCycle/flowEncoding';
import { isB64ZString, unpackB64ZToUint8Array } from '@/utils/export/b64z';

// Boundary: final artifact contract only. This module validates serialized Goblet
// payloads; it must not choose archive, persisted, or live runtime sources.
export type GobletColorCyclePayloadDiagnosticSeverity = 'info' | 'warning' | 'error';

export type GobletColorCyclePayloadDiagnostic = {
  code: string;
  severity: GobletColorCyclePayloadDiagnosticSeverity;
  message: string;
  documentVersion?: number;
};

export type GobletColorCyclePayloadStats = {
  payloadPixels: number;
  nonZeroPaint: number;
  usedSlots: number;
  paletteSlots: number;
};

export type GobletColorCyclePayloadValidationResult = {
  ok: boolean;
  reason?: string;
  diagnostics: GobletColorCyclePayloadDiagnostic[];
  stats?: GobletColorCyclePayloadStats;
};

export type GobletColorCycleMetadataContractInput = {
  format?: unknown;
  colorCycle?: {
    schemaVersion?: unknown;
  } | null;
};

type NumericPayloadValues = ArrayLike<number>;

type NumericPayloadResolution = {
  length: number | null;
  byteLength: number | null;
  values: NumericPayloadValues | null;
};

const resolveNumericPayload = (
  name: string,
  value: unknown,
  diagnostics: GobletColorCyclePayloadDiagnostic[]
): NumericPayloadResolution => {
  if (Array.isArray(value)) {
    return { length: value.length, byteLength: null, values: value };
  }

  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) {
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      return { length: bytes.length, byteLength: bytes.byteLength, values: bytes };
    }
    const view = value as unknown as NumericPayloadValues & { byteLength: number };
    const length = typeof view.length === 'number' ? view.length : view.byteLength;
    return { length, byteLength: view.byteLength, values: view };
  }

  if (typeof value === 'string' && value.length > 0) {
    if (!isB64ZString(value)) {
      return { length: null, byteLength: null, values: null };
    }
    try {
      const unpacked = unpackB64ZToUint8Array(value);
      return { length: unpacked.length, byteLength: unpacked.byteLength, values: unpacked };
    } catch {
      diagnostics.push({
        code: 'invalid-packed-buffer',
        severity: 'error',
        message: `${name} is not a valid packed b64z payload.`,
      });
      return { length: null, byteLength: null, values: null };
    }
  }

  return { length: 0, byteLength: 0, values: null };
};

const hasPayloadLength = (
  payload: NumericPayloadResolution,
  expectedElements: number,
  bytesPerElement: number = 1,
): boolean => {
  if (payload.length === null) {
    return true;
  }
  if (payload.length === 0) {
    return true;
  }
  if (payload.length === expectedElements) {
    return true;
  }
  return bytesPerElement > 1 && payload.byteLength === expectedElements * bytesPerElement;
};

const hasRequiredPayload = (payload: NumericPayloadResolution): boolean => (
  payload.length !== null && payload.length > 0
);

const describePayloadLength = (payload: NumericPayloadResolution): string => {
  if (payload.byteLength === null || payload.byteLength === payload.length) {
    return `length ${payload.length}`;
  }
  return `length ${payload.length}, byteLength ${payload.byteLength}`;
};

const countNonZero = (payload: NumericPayloadValues | null): number => {
  if (!payload) {
    return -1;
  }
  let count = 0;
  for (let index = 0; index < payload.length; index += 1) {
    if ((payload[index] ?? 0) !== 0) {
      count += 1;
    }
  }
  return count;
};

const collectUsedSlots = (
  gradientIds: NumericPayloadValues | null,
  paint: NumericPayloadValues | null,
  palettes: SerializedSlotPalette[] | undefined,
): Set<number> => {
  const slots = new Set<number>();
  if (gradientIds) {
    for (let index = 0; index < gradientIds.length; index += 1) {
      if (paint && (paint[index] ?? 0) === 0) {
        continue;
      }
      slots.add(Number(gradientIds[index] ?? 0) & FLOW_SLOT_MASK);
    }
  }
  if (slots.size === 0) {
    for (const palette of palettes ?? []) {
      slots.add(palette.slot);
    }
  }
  return slots;
};

const hasSlotSpeedPayload = (colorCycle: WebGLSerializedColorCycle): boolean => (
  colorCycle.speedMode === 'slot' &&
  Array.isArray(colorCycle.slotSpeeds) &&
  colorCycle.slotSpeeds.some((entry) => Number.isFinite(entry.slot) && Number.isFinite(entry.speed))
);

const getBrushBufferValue = (
  brushState: WebGLSerializedBrushState,
  name: string,
): unknown => {
  switch (name) {
    case 'indexBuffer':
      return brushState.indexBuffer;
    case 'gradientIdBuffer':
      return brushState.gradientIdBuffer;
    case 'gradientDefIdBuffer':
      return brushState.gradientDefIdBuffer;
    case 'speedBuffer':
      return brushState.speedBuffer;
    case 'flowBuffer':
      return brushState.flowBuffer;
    case 'phaseBuffer':
      return brushState.phaseBuffer;
    default:
      return undefined;
  }
};

const getMaskValue = (
  colorCycle: WebGLSerializedColorCycle,
  name: string,
) => {
  switch (name) {
    case 'alphaMask':
      return colorCycle.alphaMask;
    case 'softEdgeMask':
      return colorCycle.softEdgeMask;
    default:
      return undefined;
  }
};

const getMaskDiagnosticPrefix = (name: string): string => {
  switch (name) {
    case 'alphaMask':
      return 'alpha-mask';
    case 'softEdgeMask':
      return 'soft-edge-mask';
    default:
      return name;
  }
};

const getColorCycleScalarValue = (
  colorCycle: WebGLSerializedColorCycle,
  name: string,
): unknown => {
  switch (name) {
    case 'speedMin':
      return colorCycle.speedMin;
    case 'speedMax':
      return colorCycle.speedMax;
    default:
      return undefined;
  }
};

export const validateGobletColorCycleMetadataContract = (
  metadata: GobletColorCycleMetadataContractInput,
): GobletColorCyclePayloadValidationResult => {
  const diagnostics: GobletColorCyclePayloadDiagnostic[] = [];

  if (metadata.format !== GOBLET2_FORMAT) {
    diagnostics.push({
      code: 'invalid-goblet-format',
      severity: 'error',
      message: `Goblet2 color-cycle export requires format ${GOBLET2_FORMAT}.`,
    });
  }

  if (Number(metadata.colorCycle?.schemaVersion) !== GOBLET2_SCHEMA_VERSION) {
    diagnostics.push({
      code: 'invalid-color-cycle-schema-version',
      severity: 'error',
      message: `Goblet2 color-cycle export requires colorCycle.schemaVersion ${GOBLET2_SCHEMA_VERSION}.`,
    });
  }

  const failed = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  return {
    ok: !failed,
    reason: failed ? diagnostics.find((diagnostic) => diagnostic.severity === 'error')?.code : undefined,
    diagnostics,
  };
};

export const validateGobletColorCyclePayload = (
  colorCycle: WebGLSerializedColorCycle | undefined,
  options: {
    layerId: string;
    hasContent?: boolean;
  }
): GobletColorCyclePayloadValidationResult => {
  const diagnostics: GobletColorCyclePayloadDiagnostic[] = [];
  if (!colorCycle) {
    return {
      ok: false,
      reason: 'missing-color-cycle-payload',
      diagnostics: [{
        code: 'missing-color-cycle-payload',
        severity: 'error',
        message: 'Color-cycle metadata was not produced for this layer.',
      }],
    };
  }

  if (colorCycle.mode === GOBLET_COLOR_CYCLE_RECOLOR_MODE && !colorCycle.brushState) {
    return { ok: true, diagnostics };
  }

  if (colorCycle.mode !== GOBLET_COLOR_CYCLE_BRUSH_MODE) {
    diagnostics.push({
      code: 'invalid-brush-mode',
      severity: 'error',
      message: `Animated brush color-cycle export requires mode ${GOBLET_COLOR_CYCLE_BRUSH_MODE}.`,
    });
  }

  const brushState = colorCycle.brushState;
  if (!brushState) {
    const reason = colorCycle.isAnimating === false
      ? 'static-preview-without-brush-payload'
      : 'missing-brush-state';
    return {
      ok: colorCycle.isAnimating === false,
      reason,
      diagnostics: [{
        code: reason,
        severity: colorCycle.isAnimating === false ? 'warning' : 'error',
        message: 'Animated brush color-cycle export requires a brush payload.',
      }],
    };
  }

  const pixels = Math.max(1, Math.round(brushState.width)) * Math.max(1, Math.round(brushState.height));
  const resolvedBuffers = new Map<string, NumericPayloadResolution>();
  const canOmitSpeedBuffer = hasSlotSpeedPayload(colorCycle);

  for (const bufferContract of GOBLET_BRUSH_REQUIRED_BUFFERS) {
    const { name, bytesPerElement, optionalWhen } = bufferContract;
    const value = getBrushBufferValue(brushState, name);
    const resolved = resolveNumericPayload(name, value, diagnostics);
    resolvedBuffers.set(name, resolved);
    if (!hasRequiredPayload(resolved) && !(optionalWhen === 'slot-speed' && canOmitSpeedBuffer)) {
      diagnostics.push({
        code: 'missing-required-buffer',
        severity: 'error',
        message: `${name} is required for animated brush color-cycle export.`,
      });
    } else if (!hasPayloadLength(resolved, pixels, bytesPerElement)) {
      diagnostics.push({
        code: 'buffer-length-mismatch',
        severity: 'error',
        message: `${name} ${describePayloadLength(resolved)} does not match ${pixels} pixels.`,
      });
    }
  }

  for (const scalarContract of GOBLET_BRUSH_REQUIRED_SCALARS) {
    const { name, optionalWhen } = scalarContract;
    if (optionalWhen === 'slot-speed' && canOmitSpeedBuffer) {
      continue;
    }
    const value = Number(getColorCycleScalarValue(colorCycle, name));
    if (!Number.isFinite(value)) {
      diagnostics.push({
        code: 'missing-required-scalar',
        severity: 'error',
        message: `${name} is required for animated brush color-cycle export.`,
      });
    }
  }

  const paintValues = resolvedBuffers.get('indexBuffer')?.values ?? null;
  const gradientIdBuffer = resolvedBuffers.get('gradientIdBuffer')?.values ?? null;
  const nonZeroPaint = countNonZero(paintValues);
  if (options.hasContent && nonZeroPaint === 0) {
    diagnostics.push({
      code: 'empty-paint-with-content',
      severity: 'error',
      message: 'Layer is marked as having content but the exported paint buffer is empty.',
    });
  } else if (options.hasContent === false && nonZeroPaint > 0) {
    diagnostics.push({
      code: 'paint-without-content-flag',
      severity: 'warning',
      message: 'Layer is marked as empty but the exported paint buffer contains content.',
    });
  }

  const paletteSlots = new Set((colorCycle.slotPalettes ?? []).map((entry) => entry.slot));
  const usedSlots = collectUsedSlots(gradientIdBuffer, paintValues, colorCycle.slotPalettes);
  for (const slot of usedSlots) {
    if (!paletteSlots.has(slot) && (colorCycle.slotPalettes?.length ?? 0) > 0) {
      diagnostics.push({
        code: 'missing-slot-palette',
        severity: brushState.gradientStops?.length ? 'warning' : 'error',
        message: `Used color-cycle slot ${slot} does not have a palette.`,
      });
    }
  }

  for (const maskField of GOBLET_BRUSH_MASK_FIELDS) {
    const mask = getMaskValue(colorCycle, maskField);
    if (!mask) {
      continue;
    }
    const diagnosticPrefix = getMaskDiagnosticPrefix(maskField);
    if (mask.width !== brushState.width || mask.height !== brushState.height) {
      diagnostics.push({
        code: `${diagnosticPrefix}-size-mismatch`,
        severity: 'error',
        message: `${maskField} dimensions do not match the brush payload dimensions.`,
      });
    }
    const resolved = resolveNumericPayload(maskField, mask.data, diagnostics);
    if (!hasRequiredPayload(resolved)) {
      diagnostics.push({
        code: `${diagnosticPrefix}-missing-data`,
        severity: 'error',
        message: `${maskField} data is required when the mask is present.`,
      });
    } else if (!hasPayloadLength(resolved, pixels)) {
      diagnostics.push({
        code: `${diagnosticPrefix}-length-mismatch`,
        severity: 'error',
        message: `${maskField} ${describePayloadLength(resolved)} does not match ${pixels} pixels.`,
      });
    }
  }

  const failed = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  return {
    ok: !failed,
    reason: failed ? diagnostics.find((diagnostic) => diagnostic.severity === 'error')?.code : undefined,
    diagnostics,
    stats: {
      payloadPixels: pixels,
      nonZeroPaint,
      usedSlots: usedSlots.size,
      paletteSlots: paletteSlots.size,
    },
  };
};
