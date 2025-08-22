/**
 * Unit tests for utilities module
 * Testing brush utility functions
 */

import {
  calculateGridSpacing,
  shouldApplyGridSnapPure,
  snapToGridPure,
  calculateBrushSpacing,
  calculatePressureSize,
  calculatePressureOpacity,
  checkTransparencyLock,
  createBrushUtilities
} from '../utilities';
import type { BrushSettings } from '@/types';

describe('Brush Utilities', () => {
  // Mock brush settings
  const mockBrushSettings: BrushSettings = {
    size: 10,
    opacity: 100,
    color: '#000000',
    blendMode: 'normal' as any,
    spacing: 0.1,
    pressure: 1,
    rotation: 0,
    antialiasing: true,
    pressureEnabled: false,
    minPressure: 1,
    maxPressure: 10,
    rotationEnabled: false,
    dashedEnabled: false,
    dashLength: 3,
    dashGap: 2,
    gridSnapEnabled: false,
    shapeEnabled: false,
    useSwatchColor: false
  };

  describe('calculateGridSpacing', () => {
    test('returns default spacing when gridSize not set', () => {
      expect(calculateGridSpacing(mockBrushSettings)).toBe(16);
    });

    test('returns minimum spacing of 2', () => {
      const settings = { ...mockBrushSettings, gridSize: 1 } as any;
      expect(calculateGridSpacing(settings)).toBe(2);
    });

    test('returns gridSize when valid', () => {
      const settings = { ...mockBrushSettings, gridSize: 32 } as any;
      expect(calculateGridSpacing(settings)).toBe(32);
    });
  });

  describe('shouldApplyGridSnapPure', () => {
    test('returns false when gridSnapEnabled is false', () => {
      expect(shouldApplyGridSnapPure(mockBrushSettings)).toBe(false);
    });

    test('returns true when gridSnapEnabled is true', () => {
      const settings = { ...mockBrushSettings, gridSnapEnabled: true };
      expect(shouldApplyGridSnapPure(settings)).toBe(true);
    });
  });

  describe('snapToGridPure', () => {
    test('snaps to nearest grid point', () => {
      expect(snapToGridPure(15, 15, 10)).toEqual({ x: 20, y: 20 });
      expect(snapToGridPure(14, 14, 10)).toEqual({ x: 10, y: 10 });
      expect(snapToGridPure(5, 5, 10)).toEqual({ x: 10, y: 10 });
      expect(snapToGridPure(4, 4, 10)).toEqual({ x: 0, y: 0 });
    });

    test('handles negative coordinates', () => {
      expect(snapToGridPure(-5, -5, 10)).toEqual({ x: -10, y: -10 });
      expect(snapToGridPure(-15, -15, 10)).toEqual({ x: -20, y: -20 });
    });

    test('works with different grid sizes', () => {
      expect(snapToGridPure(7, 7, 5)).toEqual({ x: 5, y: 5 });
      expect(snapToGridPure(8, 8, 5)).toEqual({ x: 10, y: 10 });
      expect(snapToGridPure(17, 17, 8)).toEqual({ x: 16, y: 16 });
    });
  });

  describe('calculateBrushSpacing', () => {
    test('calculates spacing as percentage of size', () => {
      const settings = { ...mockBrushSettings, spacing: 0.2 };
      expect(calculateBrushSpacing(settings, 10)).toBe(2); // 10 * 0.2
    });

    test('enforces minimum spacing of 0.5', () => {
      const settings = { ...mockBrushSettings, spacing: 0.01 };
      expect(calculateBrushSpacing(settings, 10)).toBe(0.5);
    });

    test('handles zero spacing', () => {
      const settings = { ...mockBrushSettings, spacing: 0 };
      expect(calculateBrushSpacing(settings, 10)).toBe(0.5);
    });

    test('scales with brush size', () => {
      const settings = { ...mockBrushSettings, spacing: 0.1 };
      expect(calculateBrushSpacing(settings, 20)).toBe(2);
      expect(calculateBrushSpacing(settings, 50)).toBe(5);
    });
  });

  describe('calculatePressureSize', () => {
    test('returns base size when pressure disabled', () => {
      const size = calculatePressureSize(10, 0.5, 1, 20, false);
      expect(size).toBe(10);
    });

    test('applies pressure when enabled', () => {
      const size = calculatePressureSize(10, 1.0, 1, 20, true);
      expect(size).toBe(20); // Max pressure = max size
    });

    test('applies pressure deadzone', () => {
      const size = calculatePressureSize(10, 0.1, 1, 20, true);
      expect(size).toBe(1); // Below threshold = min size
    });

    test('interpolates pressure correctly', () => {
      const size = calculatePressureSize(10, 0.6, 1, 20, true);
      expect(size).toBeGreaterThan(1);
      expect(size).toBeLessThan(20);
    });

    test('handles full pressure range', () => {
      const minSize = calculatePressureSize(10, 0, 5, 15, true);
      expect(minSize).toBe(5);
      
      const maxSize = calculatePressureSize(10, 1, 5, 15, true);
      expect(maxSize).toBe(15);
    });
  });

  describe('calculatePressureOpacity', () => {
    test('returns base opacity when pressure disabled', () => {
      const opacity = calculatePressureOpacity(0.5, 0.3, false, false);
      expect(opacity).toBe(0.5);
    });

    test('returns base opacity when pressure opacity not enabled', () => {
      const opacity = calculatePressureOpacity(0.5, 0.3, true, false);
      expect(opacity).toBe(0.5);
    });

    test('applies pressure curve to opacity', () => {
      const opacity = calculatePressureOpacity(1.0, 0.5, true, true);
      expect(opacity).toBeGreaterThan(0);
      expect(opacity).toBeLessThanOrEqual(1);
    });

    test('clamps opacity to valid range', () => {
      const opacity = calculatePressureOpacity(2.0, 1.0, true, true);
      expect(opacity).toBe(1);
      
      const lowOpacity = calculatePressureOpacity(0.1, 0, true, true);
      expect(lowOpacity).toBeGreaterThanOrEqual(0);
    });
  });

  describe('checkTransparencyLock', () => {
    test('returns false when transparency lock disabled', () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      
      const result = checkTransparencyLock(ctx, 10, 10, false);
      expect(result).toBe(false);
    });

    test('returns false for out of bounds coordinates', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 100;
      const ctx = canvas.getContext('2d')!;
      
      const result = checkTransparencyLock(ctx, 200, 200, true);
      expect(result).toBe(false);
    });

    test('checks pixel transparency when enabled', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 100;
      const ctx = canvas.getContext('2d')!;
      
      // Draw something opaque
      ctx.fillStyle = 'black';
      ctx.fillRect(10, 10, 10, 10);
      
      // Should allow drawing on opaque pixel
      const opaqueResult = checkTransparencyLock(ctx, 15, 15, true);
      expect(opaqueResult).toBe(false);
      
      // Should prevent drawing on transparent pixel
      const transparentResult = checkTransparencyLock(ctx, 50, 50, true);
      expect(transparentResult).toBe(true);
    });
  });

  describe('createBrushUtilities factory', () => {
    test('creates utilities with injected settings', () => {
      const getSettings = () => mockBrushSettings;
      const utils = createBrushUtilities(getSettings);
      
      expect(utils.calculateGridSpacing).toBeDefined();
      expect(utils.shouldApplyGridSnap).toBeDefined();
      expect(utils.snapToGrid).toBeDefined();
      expect(utils.calculateBrushSpacing).toBeDefined();
      expect(utils.calculatePressureSize).toBeDefined();
      expect(utils.calculatePressureOpacity).toBeDefined();
    });

    test('utilities use current settings', () => {
      let settings = { ...mockBrushSettings };
      const getSettings = () => settings;
      const utils = createBrushUtilities(getSettings);
      
      // Initial state
      expect(utils.shouldApplyGridSnap()).toBe(false);
      
      // Update settings
      settings = { ...settings, gridSnapEnabled: true };
      
      // Should reflect new settings
      expect(utils.shouldApplyGridSnap()).toBe(true);
    });

    test('snap to grid uses calculated spacing', () => {
      const settings = { ...mockBrushSettings, gridSize: 20 } as any;
      const getSettings = () => settings;
      const utils = createBrushUtilities(getSettings);
      
      const result = utils.snapToGrid(15, 15);
      expect(result).toEqual({ x: 20, y: 20 });
    });
  });
});