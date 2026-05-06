import { inflateSync } from 'fflate';

import { B64Z_HEADER_PREFIX } from '@/utils/export/b64z';
import type { WebGLExportMetadata } from '@/utils/export/goblet/gobletTypes';

export interface GobletBinaryPayloadRef {
  ref: string;
  encoding: 'u8';
  byteLength: number;
}

export interface GobletBinaryPayloadEntry {
  path: string;
  bytes: Uint8Array;
  sourcePath: string;
}

export interface GobletSizeReport {
  format: 'json' | 'zip' | 'single-html';
  totalBytes: number;
  metadataBytes: number;
  runtimeBytes: number;
  htmlBytes: number;
  ccBufferBytes: number;
  maskBytes: number;
  textureBytes: number;
  sequentialFrameBytes: number;
  previewBytes: number;
  fallbackBytes: number;
  binarySidecarBytes: number;
  binarySidecarCount: number;
  duplicatedMetadataBytes: number;
}

export interface GobletZipPayloadPlan {
  metadata: WebGLExportMetadata;
  binaryEntries: GobletBinaryPayloadEntry[];
  report: GobletSizeReport;
}

const DEFAULT_BINARY_SIDECAR_THRESHOLD = 1024;
const BYTE_BUFFER_KEYS = new Set([
  'indexBuffer',
  'gradientIdBuffer',
  'gradientDefIdBuffer',
  'speedBuffer',
  'flowBuffer',
  'phaseBuffer',
  'indexPhaseMap',
  'phaseMap',
]);

const textBytes = (value: string | undefined): number =>
  value ? new TextEncoder().encode(value).byteLength : 0;

const dataUrlPayloadBytes = (value: unknown): number => {
  if (typeof value !== 'string') {
    return 0;
  }
  const comma = value.indexOf(',');
  if (comma < 0) {
    return textBytes(value);
  }
  const payload = value.slice(comma + 1);
  if (value.slice(0, comma).includes(';base64')) {
    return Math.floor((payload.length * 3) / 4);
  }
  return textBytes(payload);
};

const base64ToBytes = (base64: string): Uint8Array => {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const decodeNumericPayload = (value: unknown): Uint8Array | null => {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return new Uint8Array();
    }
    for (const entry of value) {
      if (!Number.isFinite(entry) || entry < 0 || entry > 255) {
        return null;
      }
    }
    return Uint8Array.from(value as number[]);
  }

  if (typeof value === 'string' && value.startsWith(B64Z_HEADER_PREFIX)) {
    const compressed = base64ToBytes(value.slice(B64Z_HEADER_PREFIX.length));
    return inflateSync(compressed);
  }

  return null;
};

const cloneMetadata = (metadata: WebGLExportMetadata): WebGLExportMetadata =>
  JSON.parse(JSON.stringify(metadata)) as WebGLExportMetadata;

const sanitizePathPart = (value: string): string => {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || 'layer';
};

const replacePayload = (
  target: Record<string, unknown> | undefined,
  key: string,
  path: string,
  entries: GobletBinaryPayloadEntry[],
  minByteLength: number
): number => {
  if (!target || !(key in target)) {
    return 0;
  }
  const bytes = decodeNumericPayload(target[key]);
  if (!bytes || bytes.byteLength < minByteLength) {
    return 0;
  }

  target[key] = {
    ref: path,
    encoding: 'u8',
    byteLength: bytes.byteLength,
  } satisfies GobletBinaryPayloadRef;
  entries.push({
    path,
    bytes,
    sourcePath: key,
  });
  return bytes.byteLength;
};

const externalizeLayerPayloads = (
  metadata: WebGLExportMetadata,
  minByteLength: number
): { binaryEntries: GobletBinaryPayloadEntry[]; sidecarBytes: number } => {
  const binaryEntries: GobletBinaryPayloadEntry[] = [];
  let sidecarBytes = 0;

  metadata.layers.forEach((layer, layerIndex) => {
    const layerPart = `${String(layerIndex).padStart(3, '0')}-${sanitizePathPart(layer.id)}`;
    const colorCycle = layer.colorCycle;
    if (!colorCycle) {
      return;
    }

    const brushState = colorCycle.brushState as Record<string, unknown> | undefined;
    if (brushState) {
      for (const key of BYTE_BUFFER_KEYS) {
        sidecarBytes += replacePayload(
          brushState,
          key,
          `buffers/${layerPart}/brush-${key}.bin`,
          binaryEntries,
          minByteLength
        );
      }
    }

    const recolorSettings = colorCycle.recolorSettings as Record<string, unknown> | undefined;
    if (recolorSettings) {
      for (const key of BYTE_BUFFER_KEYS) {
        sidecarBytes += replacePayload(
          recolorSettings,
          key,
          `buffers/${layerPart}/recolor-${key}.bin`,
          binaryEntries,
          minByteLength
        );
      }
    }

    const alphaMask = colorCycle.alphaMask as Record<string, unknown> | undefined;
    sidecarBytes += replacePayload(
      alphaMask,
      'data',
      `buffers/${layerPart}/alpha-mask.bin`,
      binaryEntries,
      minByteLength
    );

    const softEdgeMask = colorCycle.softEdgeMask as Record<string, unknown> | undefined;
    sidecarBytes += replacePayload(
      softEdgeMask,
      'data',
      `buffers/${layerPart}/soft-edge-mask.bin`,
      binaryEntries,
      minByteLength
    );
  });

  return { binaryEntries, sidecarBytes };
};

const sumCcBufferBytes = (metadata: WebGLExportMetadata): number => {
  let total = 0;
  metadata.layers.forEach((layer) => {
    const colorCycle = layer.colorCycle;
    if (!colorCycle) {
      return;
    }
    const brushState = colorCycle.brushState as Record<string, unknown> | undefined;
    const recolorSettings = colorCycle.recolorSettings as Record<string, unknown> | undefined;
    for (const key of BYTE_BUFFER_KEYS) {
      total += decodeNumericPayload(brushState?.[key])?.byteLength ?? 0;
      total += decodeNumericPayload(recolorSettings?.[key])?.byteLength ?? 0;
    }
  });
  return total;
};

const sumMaskBytes = (metadata: WebGLExportMetadata): number => {
  let total = 0;
  metadata.layers.forEach((layer) => {
    const colorCycle = layer.colorCycle;
    if (!colorCycle) {
      return;
    }
    total += decodeNumericPayload(colorCycle.alphaMask?.data)?.byteLength ?? 0;
    total += decodeNumericPayload(colorCycle.softEdgeMask?.data)?.byteLength ?? 0;
  });
  return total;
};

const sumTextureBytes = (metadata: WebGLExportMetadata): number => {
  let total = 0;
  metadata.layers.forEach((layer) => {
    total += dataUrlPayloadBytes(layer.assets?.texture);
  });
  return total;
};

const sumSequentialFrameBytes = (metadata: WebGLExportMetadata): number => {
  let total = 0;
  metadata.layers.forEach((layer) => {
    layer.assets?.textureFrames?.forEach((frame) => {
      total += dataUrlPayloadBytes(frame);
    });
  });
  return total;
};

export const createGobletSizeReport = ({
  metadata,
  metadataJson,
  format,
  runtimeBytes = 0,
  htmlBytes = 0,
  totalBytes,
  binaryEntries = [],
  duplicatedMetadataBytes = 0,
}: {
  metadata: WebGLExportMetadata;
  metadataJson: string;
  format: GobletSizeReport['format'];
  runtimeBytes?: number;
  htmlBytes?: number;
  totalBytes?: number;
  binaryEntries?: GobletBinaryPayloadEntry[];
  duplicatedMetadataBytes?: number;
}): GobletSizeReport => {
  const metadataBytes = textBytes(metadataJson);
  const binarySidecarBytes = binaryEntries.reduce((sum, entry) => sum + entry.bytes.byteLength, 0);
  return {
    format,
    totalBytes: totalBytes ?? metadataBytes + runtimeBytes + htmlBytes + binarySidecarBytes,
    metadataBytes,
    runtimeBytes,
    htmlBytes,
    ccBufferBytes: sumCcBufferBytes(metadata),
    maskBytes: sumMaskBytes(metadata),
    textureBytes: sumTextureBytes(metadata),
    sequentialFrameBytes: sumSequentialFrameBytes(metadata),
    previewBytes: dataUrlPayloadBytes(metadata.preview?.dataUrl),
    fallbackBytes: dataUrlPayloadBytes(metadata.fallback?.dataUrl),
    binarySidecarBytes,
    binarySidecarCount: binaryEntries.length,
    duplicatedMetadataBytes,
  };
};

export const updateGobletSizeReportPayloadTotals = (
  report: GobletSizeReport,
  metadataJson: string,
  binaryEntries: GobletBinaryPayloadEntry[]
): GobletSizeReport => {
  const metadataBytes = textBytes(metadataJson);
  const binarySidecarBytes = binaryEntries.reduce((sum, entry) => sum + entry.bytes.byteLength, 0);
  return {
    ...report,
    totalBytes: metadataBytes + report.runtimeBytes + report.htmlBytes + binarySidecarBytes,
    metadataBytes,
    binarySidecarBytes,
    binarySidecarCount: binaryEntries.length,
  };
};

export const createGobletZipPayloadPlan = ({
  metadata,
  metadataJson,
  runtimeBytes,
  htmlBytes,
  minByteLength = DEFAULT_BINARY_SIDECAR_THRESHOLD,
}: {
  metadata: WebGLExportMetadata;
  metadataJson: string;
  runtimeBytes: number;
  htmlBytes: number;
  minByteLength?: number;
}): GobletZipPayloadPlan => {
  const metadataWithRefs = cloneMetadata(metadata);
  const { binaryEntries } = externalizeLayerPayloads(metadataWithRefs, minByteLength);
  const report = createGobletSizeReport({
    metadata: metadataWithRefs,
    metadataJson,
    format: 'zip',
    runtimeBytes,
    htmlBytes,
    binaryEntries,
  });
  return {
    metadata: metadataWithRefs,
    binaryEntries,
    report,
  };
};
