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

  it('prefers unsafe brush lookup for saved custom brushes', () => {
    const savedBrush = {
      id: 'saved-fast',
      imageData: new ImageData(2, 1),
      width: 2,
      height: 1,
    } as any;
    const getUnsafe = jest.fn((id: string) => (id === 'saved-fast' ? savedBrush : null));
    const getSafe = jest.fn(() => null);

    const state = {
      tools: { ...baseSettings, brushSettings: { ...baseSettings.brushSettings, selectedCustomBrush: 'saved-fast' } },
      project: { customBrushes: [savedBrush] },
      getCustomBrushByIdUnsafe: getUnsafe,
      getCustomBrushById: getSafe,
    } as any;

    const result = resolveActiveCustomBrushData(state);
    expect(result?.width).toBe(2);
    expect(getUnsafe).toHaveBeenCalledWith('saved-fast');
    expect(getSafe).not.toHaveBeenCalled();
  });

  it('prefers selected brush source when current tip points to a different brush', () => {
    const staleTip = {
      brushId: 'old-tip',
      imageData: new ImageData(4, 4),
      width: 4,
      height: 4,
      naturalWidth: 4,
      naturalHeight: 4,
      isColorizable: false,
    } as any;

    const selectedBrush = {
      id: 'saved-2',
      imageData: new ImageData(3, 2),
      width: 3,
      height: 2,
      naturalWidth: 3,
      naturalHeight: 2,
    } as any;

    const state = {
      tools: {
        ...baseSettings,
        brushSettings: {
          ...baseSettings.brushSettings,
          selectedCustomBrush: 'saved-2',
          currentBrushTip: staleTip,
        },
      },
      project: { customBrushes: [selectedBrush] },
      getCustomBrushById: (id: string) => (id === 'saved-2' ? selectedBrush : null),
    } as any;

    const result = resolveActiveCustomBrushData(state);
    expect(result?.width).toBe(3);
    expect(result?.height).toBe(2);
    expect(result?.cacheKey).toMatch(/^project:saved-2:\d+x\d+:[a-f0-9]{8}$/);
  });

  it('applies custom brush color-cycle mode override to current tip data', () => {
    const state = {
      tools: {
        ...baseSettings,
        brushSettings: {
          ...baseSettings.brushSettings,
          selectedCustomBrush: 'tip-cc',
          customBrushColorCycleMode: 'tip',
          customBrushUseCapturedAlphaMask: false,
          currentBrushTip: {
            brushId: 'tip-cc',
            imageData: new ImageData(2, 2),
            width: 2,
            height: 2,
            colorCycle: {
              schemaVersion: 2,
              mode: 'captured-data',
              source: 'color-cycle-layer',
              sourceCycleLength: 256,
              mapWidth: 2,
              mapHeight: 2,
              phaseMap: new Uint16Array(4),
              useAlphaMask: true,
            },
          },
        },
      },
    } as any;

    const result = resolveActiveCustomBrushData(state);
    expect(result?.colorCycle?.schemaVersion).toBe(2);
    if (!result?.colorCycle || result.colorCycle.schemaVersion !== 2) {
      throw new Error('Expected schema v2 color cycle payload');
    }
    expect(result.colorCycle.mode).toBe('tip');
    expect(result.colorCycle.useAlphaMask).toBe(false);
  });

  it('applies custom brush color-cycle mode override to saved brush data', () => {
    const savedBrush = {
      id: 'saved-cc',
      imageData: new ImageData(2, 2),
      width: 2,
      height: 2,
      colorCycle: {
        schemaVersion: 2 as const,
        mode: 'tip' as const,
        source: 'color-cycle-layer' as const,
        sourceCycleLength: 256,
        mapWidth: 2,
        mapHeight: 2,
        phaseMap: new Uint16Array(4),
        useAlphaMask: false,
      },
    };

    const state = {
      tools: {
        ...baseSettings,
        brushSettings: {
          ...baseSettings.brushSettings,
          selectedCustomBrush: 'saved-cc',
          customBrushColorCycleMode: 'captured-data',
          customBrushUseCapturedAlphaMask: true,
        },
      },
      project: { customBrushes: [savedBrush] },
      getCustomBrushByIdUnsafe: (id: string) => (id === 'saved-cc' ? savedBrush : null),
    } as any;

    const result = resolveActiveCustomBrushData(state);
    expect(result?.colorCycle?.schemaVersion).toBe(2);
    if (!result?.colorCycle || result.colorCycle.schemaVersion !== 2) {
      throw new Error('Expected schema v2 color cycle payload');
    }
    expect(result.colorCycle.mode).toBe('captured-data');
    expect(result.colorCycle.useAlphaMask).toBe(true);
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
