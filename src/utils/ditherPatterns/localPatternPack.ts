import JSZip from 'jszip';

import {
  decodeCumulativeThresholdPattern,
  hashCumulativeThresholdPayload,
  type CumulativeThresholdPatternRuntime,
} from './cumulativeThresholdPattern';

const MAX_PATTERN_PACK_BYTES = 8 * 1024 * 1024;
const MAX_PATTERN_PACK_MANIFEST_BYTES = 256 * 1024;
const MAX_PATTERN_PACK_PREVIEW_BYTES = 1024 * 1024;
const MAX_PATTERN_PACK_PATTERNS = 64;

type UnknownRecord = Record<string, unknown>;
type SizedZipEntry = JSZip.JSZipObject & {
  _data?: { uncompressedSize?: number };
};

export type ParsedLocalPatternPack = Readonly<{
  packId: string;
  name: string;
  contentHash: string;
  archiveBytes: Uint8Array;
  patterns: readonly CumulativeThresholdPatternRuntime[];
}>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: UnknownRecord, allowed: readonly string[]): boolean => {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
};

const isSafeId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value);

const validatePrivateMetadata = (value: unknown): boolean => {
  if (value === undefined) return true;
  if (!isRecord(value) || !hasOnlyKeys(value, ['text', 'fontAttribution', 'notes'])) return false;
  return Object.values(value).every((entry) => (
    typeof entry === 'string' &&
    entry.length <= 4096 &&
    !/(?:https?:\/\/|javascript:|<script)/i.test(entry)
  ));
};

const getUncompressedSize = (entry: JSZip.JSZipObject): number | null => {
  const size = (entry as SizedZipEntry)._data?.uncompressedSize;
  return typeof size === 'number' && Number.isFinite(size) ? size : null;
};

export const parseLocalPatternPack = async (
  archiveInput: Uint8Array | ArrayBuffer,
): Promise<ParsedLocalPatternPack> => {
  const archiveBytes = archiveInput instanceof Uint8Array
    ? new Uint8Array(archiveInput)
    : new Uint8Array(archiveInput.slice(0));
  if (archiveBytes.byteLength < 1 || archiveBytes.byteLength > MAX_PATTERN_PACK_BYTES) {
    throw new Error('Pattern pack archive size is invalid.');
  }
  const zip = await JSZip.loadAsync(archiveBytes, { checkCRC32: true, createFolders: false });
  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  const manifestEntry = zip.file('manifest.json');
  if (!manifestEntry) {
    throw new Error('Pattern pack manifest is missing.');
  }
  const manifestSize = getUncompressedSize(manifestEntry);
  if (manifestSize !== null && manifestSize > MAX_PATTERN_PACK_MANIFEST_BYTES) {
    throw new Error('Pattern pack manifest is too large.');
  }
  const manifestText = await manifestEntry.async('string');
  if (new TextEncoder().encode(manifestText).byteLength > MAX_PATTERN_PACK_MANIFEST_BYTES) {
    throw new Error('Pattern pack manifest is too large.');
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    throw new Error('Pattern pack manifest is not valid JSON.');
  }
  if (!isRecord(manifest) || !hasOnlyKeys(manifest, ['schemaVersion', 'pack', 'patterns'])) {
    throw new Error('Pattern pack manifest shape is invalid.');
  }
  if (manifest.schemaVersion !== 1 || !isRecord(manifest.pack) || !Array.isArray(manifest.patterns)) {
    throw new Error('Pattern pack schema version is unsupported.');
  }
  if (!hasOnlyKeys(manifest.pack, ['id', 'name', 'createdAt'])) {
    throw new Error('Pattern pack metadata shape is invalid.');
  }
  const packId = manifest.pack.id;
  const name = typeof manifest.pack.name === 'string' ? manifest.pack.name.trim() : '';
  if (!isSafeId(packId) || name.length < 1 || name.length > 128) {
    throw new Error('Pattern pack identity is invalid.');
  }
  if (manifest.patterns.length < 1 || manifest.patterns.length > MAX_PATTERN_PACK_PATTERNS) {
    throw new Error('Pattern pack pattern count is invalid.');
  }

  const patternIds = new Set<string>();
  const payloadHashes = new Set<string>();
  const expectedPaths = new Set(['manifest.json']);
  const patterns: CumulativeThresholdPatternRuntime[] = [];
  for (const value of manifest.patterns) {
    if (!isRecord(value) || !hasOnlyKeys(value, [
      'id',
      'name',
      'kind',
      'width',
      'height',
      'coveragePolicy',
      'payloadPath',
      'payloadHash',
      'fixedTone',
      'toneMap',
      'previewPath',
      'privateMetadata',
    ])) {
      throw new Error('Pattern pack contains an invalid pattern descriptor.');
    }
    if (!isSafeId(value.id) || patternIds.has(value.id)) {
      throw new Error('Pattern pack contains a duplicate or invalid pattern id.');
    }
    if (typeof value.payloadHash !== 'string' || payloadHashes.has(value.payloadHash)) {
      throw new Error('Pattern pack contains a duplicate or invalid payload hash.');
    }
    if (!validatePrivateMetadata(value.privateMetadata)) {
      throw new Error('Pattern pack private metadata is invalid.');
    }
    const expectedPayloadPath = `patterns/${value.id}.thresholds.bin`;
    if (value.payloadPath !== expectedPayloadPath) {
      throw new Error('Pattern pack payload path is invalid.');
    }
    const payloadEntry = zip.file(expectedPayloadPath);
    if (!payloadEntry) {
      throw new Error('Pattern pack payload is missing.');
    }
    expectedPaths.add(expectedPayloadPath);
    patternIds.add(value.id);
    payloadHashes.add(value.payloadHash);

    if (value.previewPath !== undefined) {
      const expectedPreviewPath = `previews/${value.id}.png`;
      if (value.previewPath !== expectedPreviewPath) {
        throw new Error('Pattern pack preview path is invalid.');
      }
      const previewEntry = zip.file(expectedPreviewPath);
      if (!previewEntry) {
        throw new Error('Pattern pack preview is missing.');
      }
      const previewSize = getUncompressedSize(previewEntry);
      if (previewSize !== null && previewSize > MAX_PATTERN_PACK_PREVIEW_BYTES) {
        throw new Error('Pattern pack preview is too large.');
      }
      const preview = await previewEntry.async('uint8array');
      if (
        preview.byteLength > MAX_PATTERN_PACK_PREVIEW_BYTES ||
        preview[0] !== 0x89 ||
        preview[1] !== 0x50 ||
        preview[2] !== 0x4e ||
        preview[3] !== 0x47
      ) {
        throw new Error('Pattern pack preview is not a valid PNG.');
      }
      expectedPaths.add(expectedPreviewPath);
    }

    const payload = await payloadEntry.async('uint8array');
    const runtime = await decodeCumulativeThresholdPattern({
      definition: {
        ...value,
        storageScope: 'local-library',
      },
      payload,
    });
    patterns.push(runtime);
  }
  if (files.some((entry) => !expectedPaths.has(entry.name))) {
    throw new Error('Pattern pack contains an unexpected file.');
  }

  return {
    packId,
    name,
    contentHash: await hashCumulativeThresholdPayload(archiveBytes),
    archiveBytes,
    patterns,
  };
};
