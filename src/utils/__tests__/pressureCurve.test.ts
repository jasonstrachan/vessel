/**
 * Tests for pressure curve utilities
 */

import { applyPressureCurve, calculatePressureSize } from '../pressureCurve';

describe('Pressure Curve Utilities', () => {
  describe('applyPressureCurve', () => {
    it('should apply linear curve correctly', () => {
      const result = applyPressureCurve(0.5, 50, 200, 'linear');
      // Linear: exactly halfway between 0.5 (50%) and 2.0 (200%)
      expect(result).toBeCloseTo(1.25, 2);
    });

    it('should apply soft curve with ease-in', () => {
      const result = applyPressureCurve(0.5, 50, 200, 'soft');
      // Soft curve should be less than linear at 0.5
      expect(result).toBeLessThan(1.25);
      expect(result).toBeGreaterThan(0.5);
    });

    it('should apply hard curve with ease-out', () => {
      const result = applyPressureCurve(0.5, 50, 200, 'hard');
      // Hard curve should be more than linear at 0.5
      expect(result).toBeGreaterThan(1.25);
      expect(result).toBeLessThan(2.0);
    });

    it('should apply s-curve smoothly', () => {
      // At extremes, should match min/max
      expect(applyPressureCurve(0, 50, 200, 's-curve')).toBeCloseTo(0.5, 2);
      expect(applyPressureCurve(1, 50, 200, 's-curve')).toBeCloseTo(2.0, 2);
      
      // At middle, should be near middle but slightly different due to curve
      const middle = applyPressureCurve(0.5, 50, 200, 's-curve');
      expect(middle).toBeGreaterThan(1.0);
      expect(middle).toBeLessThan(1.5);
    });

    it('should handle edge cases', () => {
      // Pressure beyond bounds
      expect(applyPressureCurve(-0.5, 50, 200, 's-curve')).toBeCloseTo(0.5, 2);
      expect(applyPressureCurve(1.5, 50, 200, 's-curve')).toBeCloseTo(2.0, 2);
      
      // Same min and max
      expect(applyPressureCurve(0.5, 100, 100, 's-curve')).toBeCloseTo(1.0, 2);
      
      // Inverted min/max (max < min)
      const inverted = applyPressureCurve(0.5, 200, 50, 's-curve');
      expect(inverted).toBeGreaterThan(0.5);
      expect(inverted).toBeLessThan(2.0);
    });
  });

  describe('edge case pressure values', () => {
    it('should reach minimum at very low pressure', () => {
      // Test with different min/max values
      expect(applyPressureCurve(0, 50, 200, 's-curve')).toBeCloseTo(0.5, 2);
      expect(applyPressureCurve(0.001, 50, 200, 's-curve')).toBeCloseTo(0.5, 2);
      expect(applyPressureCurve(0.0001, 50, 200, 's-curve')).toBeCloseTo(0.5, 2);
      
      // Different percentage values
      expect(applyPressureCurve(0, 10, 500, 's-curve')).toBeCloseTo(0.1, 2);
      expect(applyPressureCurve(0, 100, 100, 's-curve')).toBeCloseTo(1.0, 2);
    });
    
    it('should reach maximum at very high pressure', () => {
      expect(applyPressureCurve(1, 50, 200, 's-curve')).toBeCloseTo(2.0, 2);
      expect(applyPressureCurve(0.999, 50, 200, 's-curve')).toBeCloseTo(2.0, 2);
      expect(applyPressureCurve(0.9999, 50, 200, 's-curve')).toBeCloseTo(2.0, 2);
      
      // Different percentage values
      expect(applyPressureCurve(1, 10, 500, 's-curve')).toBeCloseTo(5.0, 2);
      expect(applyPressureCurve(1, 100, 100, 's-curve')).toBeCloseTo(1.0, 2);
    });
  });

  describe('calculatePressureSize', () => {
    it('should calculate size with pressure curve', () => {
      const baseSize = 20;
      
      // No pressure (0) should give minimum size
      const minSize = calculatePressureSize(baseSize, 0, 50, 200, 's-curve');
      expect(minSize).toBe(10); // 20 * 0.5 = 10
      
      // Full pressure (1) should give maximum size
      const maxSize = calculatePressureSize(baseSize, 1, 50, 200, 's-curve');
      expect(maxSize).toBe(40); // 20 * 2.0 = 40
      
      // Medium pressure should give intermediate size
      const midSize = calculatePressureSize(baseSize, 0.5, 50, 200, 's-curve');
      expect(midSize).toBeGreaterThan(10);
      expect(midSize).toBeLessThan(40);
    });

    it('should ensure minimum size of 1 pixel', () => {
      const tinySize = calculatePressureSize(1, 0, 10, 100, 's-curve');
      expect(tinySize).toBeGreaterThanOrEqual(1);
    });

    it('should round to nearest pixel', () => {
      const size = calculatePressureSize(10, 0.7, 100, 100, 'linear');
      expect(Number.isInteger(size)).toBe(true);
    });
  });
});