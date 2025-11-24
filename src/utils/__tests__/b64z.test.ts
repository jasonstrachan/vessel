import { packArrayToB64Z, isB64ZString, B64Z_HEADER_PREFIX } from '@/utils/export/b64z';
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

  it('falls back to null when compression fails', async () => {
    const deflateSpy = jest.spyOn(fflate, 'deflateSync').mockImplementation(() => {
      throw new Error('boom');
    });
    const originalCompressionStream = (globalThis as any).CompressionStream;
    (globalThis as any).CompressionStream = undefined;

    const data = new Uint8Array(2048).fill(1);
    const result = await packArrayToB64Z(data, 32);
    expect(result).toBeNull();

    (globalThis as any).CompressionStream = originalCompressionStream;
    deflateSpy.mockRestore();
  });

  it('isB64ZString guards non-strings', () => {
    expect(isB64ZString(null)).toBe(false);
    expect(isB64ZString('b64z:abc')).toBe(true);
    expect(isB64ZString('plain')).toBe(false);
  });
});
