import { ColorCycleCoreBrushSettingsState } from '../colorCycleCoreBrushSettingsState';

describe('ColorCycleCoreBrushSettingsState', () => {
  it('owns core brush settings defaults', () => {
    const state = new ColorCycleCoreBrushSettingsState();

    expect(state.getSettings()).toMatchObject({
      brushSize: 20,
      cycleSpeed: 0.1,
      layerBaseSpeed: 1,
      pressureEnabled: false,
      minPressure: 1,
      maxPressure: 200,
      stampShape: 'square',
      preserveGradientPhaseOnChange: false,
    });
  });

  it('normalizes brush size, speed, and layer base speed', () => {
    const state = new ColorCycleCoreBrushSettingsState({ brushSize: 12 });

    expect(state.getBrushSize()).toBe(12);
    expect(state.setBrushSize(0)).toBeNull();
    expect(state.getBrushSize()).toBe(12);
    expect(state.setBrushSize(5.5)).toBe(5.5);

    expect(state.setCycleSpeed(-1)).toBeNull();
    expect(state.setCycleSpeed(0.25)).toBe(0.25);

    const change = state.setLayerBaseSpeed(4);
    expect(change).toEqual({
      previousBaseSpeed: 1,
      nextBaseSpeed: 4,
    });
    expect(state.getResolvedWriteCycleSpeed()).toBe(0.25);

    expect(state.setLayerBaseSpeed(8)).toEqual({
      previousBaseSpeed: 4,
      nextBaseSpeed: 4,
    });

    expect(state.setLayerBaseSpeed(0)).toEqual({
      previousBaseSpeed: 4,
      nextBaseSpeed: 0,
    });
    expect(state.getLayerBaseSpeed()).toBe(0);
    expect(state.getResolvedWriteCycleSpeed()).toBe(0.25);
  });

  it('owns pressure normalization and pressure-adjusted brush size', () => {
    const state = new ColorCycleCoreBrushSettingsState({ brushSize: 10 });

    expect(state.resolvePressureBrushSize(0)).toBe(10);
    state.setPressureEnabled(true);
    state.setMinPressure(25);
    state.setMaxPressure(250);

    expect(state.getMinPressure()).toBe(25);
    expect(state.getMaxPressure()).toBe(250);
    expect(state.resolvePressureBrushSize(1)).toBeCloseTo(25);

    state.setMaxPressure(10);
    expect(state.getMaxPressure()).toBe(25);
  });

  it('resolves a 1% minimum on a 50px brush to the 1px floor', () => {
    const state = new ColorCycleCoreBrushSettingsState({ brushSize: 50 });
    state.setPressureEnabled(true);
    state.setMinPressure(1);
    state.setMaxPressure(98);

    expect(state.resolvePressureBrushSize(0)).toBe(1);
    expect(state.resolvePressureBrushSize(1)).toBe(49);
  });

  it.each([
    'square',
    'checkered',
    'round',
    'diamond',
    'diamond5',
    'diamond7',
    'diamond9',
    'triangle',
  ] as const)('applies pressure-adjusted size to the %s stamp', (stampShape) => {
    const state = new ColorCycleCoreBrushSettingsState({ brushSize: 60 });
    state.setStampShape(stampShape);
    state.setPressureEnabled(true);
    state.setMinPressure(50);
    state.setMaxPressure(200);

    expect(state.resolvePressureBrushSize(0.2)).toBeCloseTo(48);
    expect(state.resolvePressureBrushSize(1)).toBeCloseTo(120);
  });

  it('normalizes stamp shape and gradient phase preservation', () => {
    const state = new ColorCycleCoreBrushSettingsState();

    expect(state.setStampShape('diamond7')).toBe('diamond7');
    expect(state.getStampShape()).toBe('diamond7');

    state.setPreserveGradientPhaseOnChange(true);
    expect(state.shouldPreserveGradientPhaseOnChange()).toBe(true);
  });
});
