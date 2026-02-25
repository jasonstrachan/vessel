import {
  decodeColorCycleSpeedByte,
  encodeColorCycleSpeedByte,
} from '@/utils/colorCycleSpeed';

describe('colorCycleSpeed encoding', () => {
  it('maps zero and invalid inputs to speed byte 0', () => {
    expect(encodeColorCycleSpeedByte(0)).toBe(0);
    expect(encodeColorCycleSpeedByte(-1)).toBe(0);
    expect(encodeColorCycleSpeedByte(undefined)).toBe(0);
    expect(encodeColorCycleSpeedByte(Number.NaN)).toBe(0);
  });

  it('decodes speed byte 0 as static speed', () => {
    expect(decodeColorCycleSpeedByte(0)).toBe(0);
    expect(decodeColorCycleSpeedByte(-2)).toBe(0);
    expect(decodeColorCycleSpeedByte(Number.NaN)).toBe(0);
  });

  it('is monotonic for positive speeds and round-trips within quantization bounds', () => {
    const speeds = [0.005, 0.1, 0.35, 0.8, 1.2, 2.2];
    const bytes = speeds.map((speed) => encodeColorCycleSpeedByte(speed));

    for (let i = 1; i < bytes.length; i += 1) {
      expect(bytes[i]).toBeGreaterThanOrEqual(bytes[i - 1]);
      expect(bytes[i]).toBeGreaterThan(0);
    }

    const decoded = bytes.map((byte) => decodeColorCycleSpeedByte(byte));
    for (let i = 0; i < decoded.length; i += 1) {
      expect(decoded[i]).toBeGreaterThanOrEqual(0);
      // 1 byte quantization in a 254-step range.
      expect(Math.abs(decoded[i] - speeds[i])).toBeLessThanOrEqual(0.02);
      if (i > 0) {
        expect(decoded[i]).toBeGreaterThanOrEqual(decoded[i - 1]);
      }
    }
  });
});
