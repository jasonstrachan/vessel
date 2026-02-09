/* eslint-disable @typescript-eslint/no-explicit-any */
import { __TESTING__ } from '../useDrawingHandlers';

const { resolveActiveCustomBrushData } = __TESTING__;

describe('useDrawingHandlers custom brush resolution', () => {
  const baseSettings = {
    brushSettings: {
      brushShape: 'custom',
      useSwatchColor: false,
      customBrushColorCycle: false,
      selectedCustomBrush: null,
    },
  } as any;

  it('returns temporary custom brush data when selected', () => {
    const tempBrush = {
      id: 'temp-1',
      imageData: new ImageData(2, 2),
      width: 2,
      height: 2,
      naturalWidth: 2,
      naturalHeight: 2,
      isColorizable: false,
    } as any;

    const state = {
      tools: { ...baseSettings, brushSettings: { ...baseSettings.brushSettings, selectedCustomBrush: 'temp-1' } },
      temporaryCustomBrush: tempBrush,
      project: null,
    } as any;

    const result = resolveActiveCustomBrushData(state);
    expect(result?.cacheKey).toMatch(/^temp:temp-1:\d+x\d+:[a-f0-9]{8}$/);
    expect(result?.width).toBe(2);
  });

  it('returns saved project brush when matching id', () => {
    const savedBrush = {
      id: 'saved-1',
      imageData: new ImageData(1, 1),
      width: 1,
      height: 1,
    } as any;

    const state = {
      tools: { ...baseSettings, brushSettings: { ...baseSettings.brushSettings, selectedCustomBrush: 'saved-1' } },
      project: { customBrushes: [savedBrush] },
      getCustomBrushById: (id: string) => (id === 'saved-1' ? savedBrush : null),
    } as any;

    const result = resolveActiveCustomBrushData(state);
    expect(result?.cacheKey).toMatch(/^project:saved-1:\d+x\d+:[a-f0-9]{8}$/);
    expect(result?.isColorizable).toBe(false);
  });

  it('returns undefined when no matching brush exists', () => {
    const state = {
      tools: { ...baseSettings, brushSettings: { ...baseSettings.brushSettings, selectedCustomBrush: 'missing' } },
      project: { customBrushes: [] },
      getCustomBrushById: () => null,
    } as any;

    expect(resolveActiveCustomBrushData(state)).toBeUndefined();
  });
});
