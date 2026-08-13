import {
  resolveColorCycleGradientRenderSession,
  resolveColorCycleGradientSource,
  resolveColorCycleGradientSourceBehavior,
  resolveColorCycleGradientSourceState,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleGradientSourceContract';
import type { BrushSettings, Layer } from '@/types';
import { buildCcDitherRenderPalette, resolveCcDitherBandMode } from '@/utils/colorCycle/ccDitherRenderPalette';
import { hashStops } from '@/utils/colorCycleGradientDefs';

const makeLayer = (overrides?: Partial<Layer>): Layer => ({
  id: 'layer-1',
  name: 'Layer 1',
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  canvas: null,
  layerType: 'color-cycle',
  colorCycleData: {
    gradient: [
      { position: 0, color: '#111111' },
      { position: 1, color: '#eeeeee' },
    ],
    gradientDefs: [{ id: 'g0', currentSlot: 3 }],
    slotPalettes: [
      {
        slot: 3,
        stops: [
          { position: 0, color: '#112233' },
          { position: 1, color: '#ddeeff' },
        ],
      },
    ],
    activeGradientId: 'g0',
    paintSlot: 3,
  },
  ...overrides,
} as Layer);

const makeBrushSettings = (overrides?: Partial<BrushSettings>): BrushSettings => ({
  colorCycleUseForegroundGradient: false,
  colorCycleGradient: [
    { position: 0, color: '#000000' },
    { position: 1, color: '#ffffff' },
  ],
  ...overrides,
} as BrushSettings);

describe('colorCycleGradientSourceContract', () => {
  it('resolves sampled, foreground, and manual source priority from UI state flags', () => {
    expect(resolveColorCycleGradientSource({
      ccGradientSource: 'sampled',
      useForegroundGradient: true,
    })).toBe('sampled');
    expect(resolveColorCycleGradientSource({
      ccGradientSource: 'fg',
      useForegroundGradient: false,
    })).toBe('fg');
    expect(resolveColorCycleGradientSource({
      ccGradientSource: 'manual',
      useForegroundGradient: true,
    })).toBe('fg');
    expect(resolveColorCycleGradientSource({
      ccGradientSource: 'manual',
      useForegroundGradient: false,
    })).toBe('manual');
  });

  it('keeps sampled-only render behavior isolated from manual and foreground sources', () => {
    expect(resolveColorCycleGradientSourceBehavior('sampled')).toEqual({
      source: 'sampled',
      usesSampledStops: true,
      usesSampledBaseOffset: true,
      requiresDeferredBinding: true,
    });

    expect(resolveColorCycleGradientSourceBehavior('manual')).toEqual({
      source: 'manual',
      usesSampledStops: false,
      usesSampledBaseOffset: false,
      requiresDeferredBinding: false,
    });

    expect(resolveColorCycleGradientSourceBehavior('fg')).toEqual({
      source: 'fg',
      usesSampledStops: false,
      usesSampledBaseOffset: false,
      requiresDeferredBinding: false,
    });
  });

  it('returns source behavior with the active gradient stops in one contract', () => {
    const result = resolveColorCycleGradientSourceState({
      layer: makeLayer(),
      brushSettings: makeBrushSettings(),
      ccGradientSource: 'sampled',
    });

    expect(result.source).toBe('sampled');
    expect(result.behavior.usesSampledStops).toBe(true);
    expect(result.activeSlot).toBe(3);
    expect(result.activeStops).toEqual([
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ]);
  });

  it.each([
    { source: 'manual', stops: [{ position: 0, color: '#123456' }] },
    {
      source: 'manual',
      stops: [
        { position: 0, color: '#123456' },
        { position: 1, color: '#abcdef' },
      ],
    },
    { source: 'sampled', stops: [{ position: 0, color: '#654321' }] },
    {
      source: 'sampled',
      stops: [
        { position: 0, color: '#654321' },
        { position: 1, color: '#fedcba' },
      ],
    },
  ])('uses shared active stops for $source source/mode matrix coverage', ({ source, stops }) => {
    const result = resolveColorCycleGradientSourceState({
      layer: makeLayer({
        colorCycleData: {
          gradient: stops,
          gradientDefs: [{ id: 'g0', currentSlot: 3 }],
          slotPalettes: [{ slot: 3, stops }],
          activeGradientId: 'g0',
          paintSlot: 3,
        },
      }),
      brushSettings: makeBrushSettings(),
      ccGradientSource: source,
    });

    expect(result.source).toBe(source);
    expect(result.activeStops).toEqual(makeBrushSettings().colorCycleGradient);
    expect(result.behavior.usesSampledStops).toBe(source === 'sampled');
  });

  it('resolves foreground-derived stops when foreground mode is active', () => {
    const result = resolveColorCycleGradientSourceState({
      layer: makeLayer(),
      brushSettings: makeBrushSettings({
        colorCycleUseForegroundGradient: true,
        colorCycleFgStops: 2,
      }),
      fgParams: {
        fgColorHex: '#808080',
        fgStops: 2,
      },
      ccGradientSource: 'fg',
    });

    expect(result.source).toBe('fg');
    expect(result.behavior.usesSampledStops).toBe(false);
    expect(result.activeStops.length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    { requestedStops: 1, expectedMinimumStops: 2 },
    { requestedStops: 4, expectedMinimumStops: 4 },
  ])('resolves foreground source matrix coverage for requested $requestedStops stop mode', ({
    requestedStops,
    expectedMinimumStops,
  }) => {
    const result = resolveColorCycleGradientSourceState({
      layer: makeLayer(),
      brushSettings: makeBrushSettings({
        colorCycleUseForegroundGradient: true,
        colorCycleFgStops: requestedStops,
      }),
      fgParams: {
        fgColorHex: '#808080',
        fgStops: requestedStops,
      },
      ccGradientSource: 'fg',
    });

    expect(result.source).toBe('fg');
    expect(result.behavior.usesSampledStops).toBe(false);
    expect(result.activeStops.length).toBeGreaterThanOrEqual(expectedMinimumStops);
  });

  it('resolves dither runtime stops through the shared render-session contract', () => {
    const session = makeMarkSession({
      source: 'manual',
      ditherRenderConfig: {
        enabled: true,
        pairBandCount: 2,
        spread: 20,
        algorithm: 'sierra-lite',
      },
    });

    const result = resolveColorCycleGradientRenderSession({
      layerId: 'layer-1',
      session,
      brushSettings: makeBrushSettings({
        ditherEnabled: true,
        gradientBands: 4,
      }),
    });

    expect(result).toBeDefined();
    expect(result?.source).toBe('manual');
    expect(result?.frozenStopsStored.length).toBeGreaterThanOrEqual(2);
  });

  it('applies intermediate contrast once to sampled CC Flat Dither stops', () => {
    const rawStops = [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ];
    const contrastedStops = [
      { position: 0, color: 'rgb(47, 47, 47)' },
      { position: 1, color: 'rgb(209, 209, 209)' },
    ];
    const session = makeMarkSession({
      source: 'sampled',
      rawStopsStored: rawStops,
      frozenStopsStored: contrastedStops,
      frozenHash: hashStops(contrastedStops, 'linear'),
      binding: { kind: 'def', defId: 41, slot: 15 },
      ditherRenderConfig: {
        enabled: false,
        pairBandCount: resolveCcDitherBandMode(16).pairBandCount,
        spread: 0,
        rangeContrast: 50,
        algorithm: 'bayer',
      },
    });

    const result = resolveColorCycleGradientRenderSession({
      layerId: 'layer-1',
      session,
      brushSettings: makeBrushSettings({
        ditherEnabled: true,
        ccFlatCycleDither: true,
        ccGradientRangeContrast: 50,
        gradientBands: 16,
      }),
    });

    expect(result?.frozenStopsStored).toEqual(contrastedStops);
    expect(result?.sourceStopsStored).toEqual(contrastedStops);
  });

  it('applies intermediate contrast before rebuilding sampled dither render stops', () => {
    const rawStops = [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ];
    const contrastedStops = [
      { position: 0, color: 'rgb(47, 47, 47)' },
      { position: 1, color: 'rgb(209, 209, 209)' },
    ];
    const pairBandCount = resolveCcDitherBandMode(16).pairBandCount;
    const runtimeStops = buildCcDitherRenderPalette({
      baseStops: contrastedStops,
      bands: pairBandCount,
      spread: 0,
    }).renderStops;
    const session = makeMarkSession({
      source: 'sampled',
      rawStopsStored: rawStops,
      frozenStopsStored: runtimeStops,
      frozenHash: hashStops(runtimeStops, 'linear'),
      binding: { kind: 'def', defId: 41, slot: 15 },
      ditherRenderConfig: {
        enabled: true,
        pairBandCount,
        spread: 0,
        rangeContrast: 50,
        algorithm: 'bayer',
      },
    });

    const result = resolveColorCycleGradientRenderSession({
      layerId: 'layer-1',
      session,
      brushSettings: makeBrushSettings({
        ditherEnabled: true,
        ccFlatCycleDither: false,
        ccGradientRangeContrast: 50,
        gradientBands: 16,
        ditherPaletteSpread: 0,
        ditherAlgorithm: 'bayer',
      }),
    });

    expect(result?.frozenStopsStored).toEqual(runtimeStops);
    expect(result?.sourceStopsStored).toEqual(contrastedStops);
  });

  it('compresses sampled non-dither render stops with range contrast', () => {
    const session = makeMarkSession({
      source: 'sampled',
      ditherRenderConfig: {
        enabled: false,
        pairBandCount: 0,
        spread: 0,
        rangeContrast: 0,
        algorithm: 'sierra-lite',
      },
      frozenStopsStored: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      frozenHash: 'linear:0:#000000|1:#ffffff',
    });

    const result = resolveColorCycleGradientRenderSession({
      layerId: 'layer-1',
      session,
      brushSettings: makeBrushSettings({
        ditherEnabled: false,
        ccGradientRangeContrast: 0,
      }),
    });

    expect(result?.source).toBe('sampled');
    expect(result?.frozenStopsStored).toEqual([
      { position: 0, color: 'rgb(128, 128, 128)' },
      { position: 1, color: 'rgb(128, 128, 128)' },
    ]);
    expect(result?.sourceStopsStored).toEqual(result?.frozenStopsStored);
  });

  it('uses live range contrast instead of stale sampled session config', () => {
    const session = makeMarkSession({
      source: 'sampled',
      ditherRenderConfig: {
        enabled: false,
        pairBandCount: 0,
        spread: 0,
        rangeContrast: 0,
        algorithm: 'sierra-lite',
      },
      frozenStopsStored: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      frozenHash: 'linear:0:#000000|1:#ffffff',
    });

    const result = resolveColorCycleGradientRenderSession({
      layerId: 'layer-1',
      session,
      brushSettings: makeBrushSettings({
        ditherEnabled: false,
        ccGradientRangeContrast: 70,
      }),
    });

    expect(result?.frozenStopsStored).toEqual([
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ]);
  });
});

const makeMarkSession = (overrides?: Partial<import('@/hooks/canvas/utils/colorCycleMarkSession').MarkGradientSession>) => ({
  markId: 'mark-1',
  layerId: 'layer-1',
  markKind: 'shape',
  gradientKind: 'linear',
  source: 'manual',
  frozenStopsStored: [
    { position: 0, color: '#111111' },
    { position: 1, color: '#eeeeee' },
  ],
  frozenHash: 'linear:0:#111111|1:#eeeeee',
  binding: null,
  ...overrides,
} as import('@/hooks/canvas/utils/colorCycleMarkSession').MarkGradientSession);
