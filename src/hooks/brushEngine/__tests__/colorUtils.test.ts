/**
 * Unit tests for colorUtils module
 * Testing pure functions in isolation
 */

import {
  parseColor,
  srgbToLinear,
  linearToSrgb,
  applyThrottledColorJitter
} from '../colorUtils';

describe('Color Utilities', () => {
  describe('parseColor', () => {
    test('handles hex values correctly', () => {
      expect(parseColor('#FF0000')).toEqual([255, 0, 0]);
      expect(parseColor('#00FF00')).toEqual([0, 255, 0]);
      expect(parseColor('#0000FF')).toEqual([0, 0, 255]);
      expect(parseColor('#FFFFFF')).toEqual([255, 255, 255]);
      expect(parseColor('#000000')).toEqual([0, 0, 0]);
    });

    test('handles short hex values', () => {
      expect(parseColor('#F00')).toEqual([255, 0, 0]);
      expect(parseColor('#0F0')).toEqual([0, 255, 0]);
      expect(parseColor('#00F')).toEqual([0, 0, 255]);
    });

    test('handles rgb format', () => {
      expect(parseColor('rgb(255, 0, 0)')).toEqual([255, 0, 0]);
      expect(parseColor('rgb(0, 255, 0)')).toEqual([0, 255, 0]);
      expect(parseColor('rgb(0, 0, 255)')).toEqual([0, 0, 255]);
    });

    test('handles rgba format', () => {
      expect(parseColor('rgba(255, 0, 0, 1)')).toEqual([255, 0, 0]);
      expect(parseColor('rgba(0, 255, 0, 0.5)')).toEqual([0, 255, 0]);
      expect(parseColor('rgba(0, 0, 255, 0)')).toEqual([0, 0, 255]);
    });

    test('returns black for invalid input', () => {
      expect(parseColor('invalid')).toEqual([0, 0, 0]);
      expect(parseColor('')).toEqual([0, 0, 0]);
      expect(parseColor('notacolor')).toEqual([0, 0, 0]);
    });
  });

  describe('sRGB conversion', () => {
    test('sRGB to linear conversion is correct', () => {
      // Test known values
      expect(srgbToLinear(0)).toBe(0);
      expect(srgbToLinear(255)).toBe(1);
      
      // Test midpoint
      const mid = srgbToLinear(128);
      expect(mid).toBeGreaterThan(0.2);
      expect(mid).toBeLessThan(0.25);
    });

    test('linear to sRGB conversion is correct', () => {
      expect(linearToSrgb(0)).toBe(0);
      expect(linearToSrgb(1)).toBe(255);
      
      // Test midpoint
      const mid = linearToSrgb(0.5);
      expect(mid).toBeGreaterThan(180);
      expect(mid).toBeLessThan(190);
    });

    test('conversions are reversible', () => {
      const testValues = [0, 64, 128, 192, 255];
      
      for (const original of testValues) {
        const linear = srgbToLinear(original);
        const back = linearToSrgb(linear);
        expect(Math.round(back)).toBe(original);
      }
    });

    test('handles edge cases', () => {
      // Out of range values
      expect(srgbToLinear(-10)).toBe(0);
      expect(srgbToLinear(300)).toBe(1);
      expect(linearToSrgb(-0.1)).toBe(0);
      expect(linearToSrgb(1.5)).toBe(255);
    });
  });

  describe('applyThrottledColorJitter', () => {
    test('returns original color when jitter is 0', () => {
      const jitterState = {
        lastJitterColor: [0, 0, 0] as [number, number, number],
        nextJitterColor: [0, 0, 0] as [number, number, number],
        counter: 0,
        recalcFrequency: 5
      };
      
      const result = applyThrottledColorJitter('#FF0000', 0, jitterState);
      expect(result).toBe('#FF0000');
    });

    test('applies jitter when amount > 0', () => {
      const jitterState = {
        lastJitterColor: [0, 0, 0] as [number, number, number],
        nextJitterColor: [0, 0, 0] as [number, number, number],
        counter: 0,
        recalcFrequency: 5
      };
      
      const result = applyThrottledColorJitter('#FF0000', 50, jitterState);
      
      // Should return an rgb() string
      expect(result).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
      
      // Should modify the color
      expect(result).not.toBe('rgb(255, 0, 0)');
    });

    test('throttles jitter recalculation', () => {
      const jitterState = {
        lastJitterColor: [200, 50, 50] as [number, number, number],
        nextJitterColor: [210, 60, 60] as [number, number, number],
        counter: 1,
        recalcFrequency: 5
      };
      
      // First call - should interpolate
      const result1 = applyThrottledColorJitter('#FF0000', 25, jitterState);
      expect(jitterState.counter).toBe(2);
      
      // Second call - should still interpolate
      const result2 = applyThrottledColorJitter('#FF0000', 25, jitterState);
      expect(jitterState.counter).toBe(3);
      
      // Results should be different due to interpolation
      expect(result1).not.toBe(result2);
    });

    test('recalculates at frequency interval', () => {
      const jitterState = {
        lastJitterColor: [200, 50, 50] as [number, number, number],
        nextJitterColor: [210, 60, 60] as [number, number, number],
        counter: 4, // One before recalc
        recalcFrequency: 5
      };
      
      const oldNext = [...jitterState.nextJitterColor];
      
      // This should trigger recalculation
      applyThrottledColorJitter('#FF0000', 25, jitterState);
      
      // nextJitterColor should have changed
      expect(jitterState.nextJitterColor).not.toEqual(oldNext);
      expect(jitterState.counter).toBe(5);
    });

    test('handles invalid color gracefully', () => {
      const jitterState = {
        lastJitterColor: [0, 0, 0] as [number, number, number],
        nextJitterColor: [0, 0, 0] as [number, number, number],
        counter: 0,
        recalcFrequency: 5
      };
      
      const result = applyThrottledColorJitter('invalid', 50, jitterState);
      
      // Should still return a valid rgb string
      expect(result).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    });
  });
});