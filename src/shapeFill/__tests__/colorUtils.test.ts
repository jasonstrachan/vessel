import { computeShapeFillColors, toOpaqueColorString } from '@/shapeFill/colorUtils';
import type { PaletteState } from '@/types';

describe('computeShapeFillColors', () => {
  const defaultPalette: PaletteState = {
    foregroundColor: '#123456',
    backgroundColor: '#ABCDEF',
    activeSlot: 'foreground',
  };

  it('returns palette colors when sampling is disabled', () => {
    const result = computeShapeFillColors({
      points: [],
      palette: defaultPalette,
      brushColor: '#FF00FF',
      sampleUnderShape: false,
      useBackgroundColor: true,
      sampleColorAtPosition: () => '#000000',
      fallbackBackground: '#FFFFFF',
    });

    expect(result.foreground).toBe(toOpaqueColorString(defaultPalette.foregroundColor));
    expect(result.background).toBe(toOpaqueColorString(defaultPalette.backgroundColor));
    expect(result.sampledForeground).toBe(false);
    expect(result.sampledBackground).toBe(false);
    expect(result.primary).toBe('background');
  });

  it('keeps foreground as primary when background toggle is off', () => {
    const result = computeShapeFillColors({
      points: [],
      palette: defaultPalette,
      brushColor: '#FF00FF',
      sampleUnderShape: false,
      useBackgroundColor: false,
      sampleColorAtPosition: () => '#000000',
      fallbackBackground: '#FFFFFF',
    });

    expect(result.primary).toBe('foreground');
    expect(result.foreground).toBe(toOpaqueColorString(defaultPalette.foregroundColor));
  });

  it('samples contrasting foreground and background colors when enabled', () => {
    const sampleColorAtPosition = jest.fn((x: number, y: number) => {
      if (Math.abs(x) < 1 && Math.abs(y) < 1) {
        return '#222222';
      }
      return '#F5F5F5';
    });

    const square = [
      { x: -8, y: -8 },
      { x: 8, y: -8 },
      { x: 8, y: 8 },
      { x: -8, y: 8 },
    ];

    const result = computeShapeFillColors({
      points: square,
      palette: defaultPalette,
      brushColor: '#FF00FF',
      sampleUnderShape: true,
      useBackgroundColor: true,
      sampleColorAtPosition,
      fallbackBackground: '#FFFFFF',
    });

    expect(result.foreground).toBe('rgb(34, 34, 34)');
    expect(result.background).toBe('rgb(245, 245, 245)');
    expect(result.sampledForeground).toBe(true);
    expect(result.sampledBackground).toBe(true);
    expect(result.primary).toBe('background');
    expect(sampleColorAtPosition).toHaveBeenCalled();
  });

  it('falls back to high-contrast background when samples match foreground', () => {
    const sampleColorAtPosition = jest.fn(() => '#888888');
    const square = [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 12 },
      { x: 0, y: 12 },
    ];

    const result = computeShapeFillColors({
      points: square,
      palette: {
        foregroundColor: '#888888',
        backgroundColor: '#444444',
        activeSlot: 'foreground',
      },
      brushColor: '#888888',
      sampleUnderShape: true,
      useBackgroundColor: true,
      sampleColorAtPosition,
      fallbackBackground: '#444444',
    });

    expect(result.foreground).toBe('rgb(136, 136, 136)');
    expect(result.background).toBe('rgb(30, 30, 30)');
    expect(result.sampledForeground).toBe(true);
    expect(result.sampledBackground).toBe(true);
    expect(result.primary).toBe('background');
    expect(sampleColorAtPosition).toHaveBeenCalled();
  });
});
