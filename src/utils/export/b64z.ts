import { debugWarn } from '@/utils/debug';
import { deflateSync, inflateSync } from 'fflate';

const B64Z_PREFIX = 'b64z:';
const DEFAULT_THRESHOLD = 1024;

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const decodeBase64 = (base64: string): Uint8Array => {
  const binary = atob(base64.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const toUint8Array = (value: Uint8Array | number[]): Uint8Array => {
  return value instanceof Uint8Array ? value : Uint8Array.from(value);
};

const toConsumableArrayBuffer = (view: Uint8Array): ArrayBuffer => {
  const { buffer, byteOffset, byteLength } = view;
  if (buffer instanceof ArrayBuffer) {
    if (byteOffset === 0 && byteLength === buffer.byteLength) {
      return buffer;
    }
    return buffer.slice(byteOffset, byteOffset + byteLength);
  }

  const copy = new Uint8Array(byteLength);
  copy.set(view);
  return copy.buffer;
};

type CompressionStreamConstructor = new (format: 'deflate' | 'deflate-raw' | 'gzip') => {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
};

const getCompressionStreamCtor = (): CompressionStreamConstructor | undefined => {
  const global = globalThis as { CompressionStream?: CompressionStreamConstructor };
  return global.CompressionStream;
};

const compressWithStream = async (bytes: Uint8Array): Promise<Uint8Array | null> => {
  const CompressionStreamCtor = getCompressionStreamCtor();
  if (!CompressionStreamCtor) {
    return null;
  }

  try {
    const compressor = new CompressionStreamCtor('deflate-raw');
    const arrayBuffer = toConsumableArrayBuffer(bytes);
    const sourceStream = typeof Blob !== 'undefined' && typeof Blob.prototype.stream === 'function'
      ? new Blob([arrayBuffer]).stream()
      : new Response(arrayBuffer).body;
    if (!sourceStream) {
      return null;
    }
    const stream = sourceStream.pipeThrough(compressor);
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  } catch (error) {
    debugWarn('raw-console', '[b64z] CompressionStream failed, falling back to fflate', error);
    return null;
  }
};

const compressWithFflate = (bytes: Uint8Array): Uint8Array | null => {
  try {
    return deflateSync(bytes, { level: 9 });
  } catch (error) {
    debugWarn('raw-console', '[b64z] fflate deflateSync failed', error);
    return null;
  }
};

const compressBytes = async (bytes: Uint8Array): Promise<Uint8Array | null> => {
  const streamResult = await compressWithStream(bytes);
  if (streamResult && streamResult.length > 0) {
    return streamResult;
  }

  const fallbackResult = compressWithFflate(bytes);
  if (fallbackResult && fallbackResult.length > 0) {
    return fallbackResult;
  }

  return null;
};

export const packArrayToB64Z = async (
  source: Uint8Array | number[],
  threshold: number = DEFAULT_THRESHOLD
): Promise<string | null> => {
  const bytes = toUint8Array(source);
  if (bytes.length < threshold) {
    return null;
  }

  const compressed = await compressBytes(bytes);
  if (!compressed || compressed.length === 0) {
    return null;
  }

  if (compressed.length >= bytes.length) {
    return null;
  }

  return `${B64Z_PREFIX}${encodeBase64(compressed)}`;
};

export const isB64ZString = (value: unknown): value is string => {
  return typeof value === 'string' && value.startsWith(B64Z_PREFIX);
};

export const unpackB64ZToUint8Array = (payload: string): Uint8Array => {
  if (!isB64ZString(payload)) {
    throw new Error('Expected b64z payload');
  }

  const compressed = decodeBase64(payload.slice(B64Z_PREFIX.length));
  return inflateSync(compressed);
};

export const B64Z_MIN_LENGTH = DEFAULT_THRESHOLD;
export const B64Z_HEADER_PREFIX = B64Z_PREFIX;
