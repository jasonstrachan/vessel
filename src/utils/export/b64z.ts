import { deflateSync } from 'fflate';

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

const toUint8Array = (value: Uint8Array | number[]): Uint8Array => {
  return value instanceof Uint8Array ? value : Uint8Array.from(value);
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
    const sourceStream = typeof Blob !== 'undefined' && typeof Blob.prototype.stream === 'function'
      ? new Blob([bytes]).stream()
      : new Response(bytes).body;
    if (!sourceStream) {
      return null;
    }
    const stream = sourceStream.pipeThrough(compressor);
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  } catch (error) {
    console.warn('[b64z] CompressionStream failed, falling back to fflate', error);
    return null;
  }
};

const compressWithFflate = (bytes: Uint8Array): Uint8Array | null => {
  try {
    return deflateSync(bytes, { level: 9 });
  } catch (error) {
    console.warn('[b64z] fflate deflateSync failed', error);
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

export const B64Z_MIN_LENGTH = DEFAULT_THRESHOLD;
export const B64Z_HEADER_PREFIX = B64Z_PREFIX;
