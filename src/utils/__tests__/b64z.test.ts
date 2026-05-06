jest.mock('fflate', () => {
  const actual = jest.requireActual('fflate');
  return { ...actual, deflateSync: jest.fn(actual.deflateSync) };
});

import { packArrayToB64Z, unpackB64ZToUint8Array, isB64ZString, B64Z_HEADER_PREFIX } from '@/utils/export/b64z';
import * as fflate from 'fflate';

describe('b64z utilities', () => {
  it('returns null when buffer is below the threshold', async () => {
    const result = await packArrayToB64Z(new Uint8Array([1, 2, 3, 4]), 10);
    expect(result).toBeNull();
  });

  it('encodes large repeated data and prefixes with b64z:', async () => {
    const data = new Uint8Array(2048).fill(0);
    const result = await packArrayToB64Z(data, 32);
    expect(result).not.toBeNull();
    expect(result?.startsWith(B64Z_HEADER_PREFIX)).toBe(true);
    expect(isB64ZString(result)).toBe(true);
  });

  it('decodes packed b64z data back to bytes', async () => {
    const data = new Uint8Array(2048).fill(7);
    const result = await packArrayToB64Z(data, 32);
    expect(result).not.toBeNull();

    expect(Array.from(unpackB64ZToUint8Array(result ?? ''))).toEqual(Array.from(data));
  });

  it('falls back to null when compression fails', async () => {
    const actual = jest.requireActual('fflate') as typeof import('fflate');
    const deflateMock = fflate.deflateSync as jest.Mock;
    deflateMock.mockImplementation(() => {
      throw new Error('boom');
    });
    const globalWithCompression = globalThis as typeof globalThis & { CompressionStream?: typeof CompressionStream };
    const originalCompressionStream = globalWithCompression.CompressionStream;
    globalWithCompression.CompressionStream = undefined as unknown as typeof CompressionStream;

    const data = new Uint8Array(2048).fill(1);
    const result = await packArrayToB64Z(data, 32);
    expect(result).toBeNull();

    globalWithCompression.CompressionStream = originalCompressionStream;
    deflateMock.mockImplementation(actual.deflateSync);
  });

  it('isB64ZString guards non-strings', () => {
    expect(isB64ZString(null)).toBe(false);
    expect(isB64ZString('b64z:abc')).toBe(true);
    expect(isB64ZString('plain')).toBe(false);
  });
});
