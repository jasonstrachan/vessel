import {
  __setActiveMarkSessionGetterForTests,
  buildRuntimeSnapshot,
} from '@/hooks/brushEngine/ccGradientRuntime';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import { buildCcDitherRuntimePalette } from '@/utils/colorCycle/ccDitherRenderPalette';
import type { BrushSettings, Layer } from '@/types';
import type { MarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';

const makeBrushSettings = (overrides: Partial<BrushSettings> = {}): BrushSettings =>
  ({
    brushShape: 'color_cycle',
    colorCycleUseForegroundGradient: false,
    colorCycleGradient: [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ],
    ...overrides,
  } as unknown as BrushSettings);

const makeLayer = (overrides: Partial<Layer> = {}): Layer =>
  ({
    id: 'layer-cc',
    name: 'Layer',
    visible: true,
    opacity: 1,
    layerType: 'color-cycle',
    colorCycleData: {
      gradientDefs: [{ id: 'g0', currentSlot: 0 }],
      activeGradientId: 'g0',
      paintSlot: 0,
      slotPalettes: [
        {
          slot: 0,
          stops: [
            { position: 0, color: '#000000' },
            { position: 1, color: '#ffffff' },
          ],
        },
      ],
    },
    ...overrides,
  } as unknown as Layer);

describe('ccGradientRuntime', () => {
  afterEach(() => {
    __setActiveMarkSessionGetterForTests(null);
  });

  it('preserves runtime slot palettes without stop-count normalization', () => {
    const layer = makeLayer();
    const brushSettings = makeBrushSettings();

    const snapshot = buildRuntimeSnapshot(layer, brushSettings);
    const slot0 = snapshot.slotPalettes.find((entry) => entry.slot === 0);

    expect(slot0).toBeTruthy();
    expect(slot0?.stops.length).toBe(2);
    expect(slot0?.stops[0]?.position).toBe(0);
    expect(slot0?.stops[1]?.position).toBe(1);
  });

  it('adds a fallback paint-slot palette when missing', () => {
    const layer = makeLayer({
      colorCycleData: {
        gradientDefs: [{ id: 'g0', currentSlot: 5 }],
        activeGradientId: 'g0',
        paintSlot: 5,
        slotPalettes: [],
      },
    } as Partial<Layer>);
    const brushSettings = makeBrushSettings({
      colorCycleGradient: [
        { position: 0, color: '#ff0000' },
        { position: 0.5, color: '#00ff00' },
        { position: 1, color: '#0000ff' },
      ],
    });

    const snapshot = buildRuntimeSnapshot(layer, brushSettings);
    const slot5 = snapshot.slotPalettes.find((entry) => entry.slot === 5);

    expect(snapshot.paintSlot).toBe(5);
    expect(slot5).toBeTruthy();
    expect(slot5?.stops.length).toBe(3);
  });

  it('uses sampled preview stops directly for active sampled sessions', () => {
    const layer = makeLayer();
    const brushSettings = makeBrushSettings({
      ditherPaletteSpread: 100,
    });
    const session: MarkGradientSession = {
      markId: 'session-1',
      layerId: layer.id,
      markKind: 'shape',
      gradientKind: 'linear',
      source: 'sampled',
      frozenStopsStored: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      frozenHash: '',
      binding: null,
      previewStopsStored: [
        { position: 0, color: '#556270' },
        { position: 1, color: '#88939f' },
      ],
      previewHash: '',
      fallbackStopsStored: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
    };

    __setActiveMarkSessionGetterForTests(() => session);

    const snapshot = buildRuntimeSnapshot(layer, brushSettings);

    expect(snapshot.paintSlot).toBe(TEMP_SAMPLE_SLOT);
    expect(snapshot.slotPalettes[0]?.stops.map((stop) => stop.color)).toEqual(
      session.previewStopsStored?.map((stop) => stop.color)
    );
  });

  it('uses live dither spread for active session runtime palettes while editing', () => {
    const layer = makeLayer();
    const brushSettings = makeBrushSettings({
      ditherEnabled: true,
      gradientBands: 1,
      ditherAlgorithm: 'sierra-lite',
      ditherPaletteSpread: 0,
    });
    const session: MarkGradientSession = {
      markId: 'session-2',
      layerId: layer.id,
      markKind: 'shape',
      gradientKind: 'linear',
      source: 'sampled',
      frozenStopsStored: [
        { position: 0, color: '#111111' },
        { position: 1, color: '#eeeeee' },
      ],
      frozenHash: '',
      binding: null,
      previewStopsStored: [
        { position: 0, color: '#111111' },
        { position: 1, color: '#eeeeee' },
      ],
      previewHash: '',
      fallbackStopsStored: [
        { position: 0, color: '#111111' },
        { position: 1, color: '#eeeeee' },
      ],
      ditherRenderConfig: {
        enabled: true,
        pairBandCount: 0,
        spread: 100,
      },
    };

    __setActiveMarkSessionGetterForTests(() => session);

    const snapshot = buildRuntimeSnapshot(layer, brushSettings);
    const expectedStops = buildCcDitherRuntimePalette({
      baseStops: session.previewStopsStored ?? [],
      bands: session.ditherRenderConfig?.pairBandCount ?? 0,
      spread: brushSettings.ditherPaletteSpread,
      algorithm: brushSettings.ditherAlgorithm,
      preserveSourceStops: false,
    }).renderStops;

    expect(snapshot.paintSlot).toBe(TEMP_SAMPLE_SLOT);
    expect(snapshot.slotPalettes[0]?.stops).toEqual(expectedStops);
  });

  it('preserves flat FG source stops for active bound sessions', () => {
    const layer = makeLayer({
      colorCycleData: {
        gradientDefs: [{ id: 'g0', currentSlot: 1 }],
        activeGradientId: 'g0',
        paintSlot: 1,
        fgActiveSlot: 2,
        slotPalettes: [
          {
            slot: 1,
            stops: [
              { position: 0, color: '#101010' },
              { position: 0.5, color: '#505050' },
              { position: 1, color: '#f0f0f0' },
            ],
          },
        ],
      },
    } as Partial<Layer>);
    const brushSettings = makeBrushSettings({
      colorCycleUseForegroundGradient: true,
      ditherEnabled: true,
      gradientBands: 1,
      ditherAlgorithm: 'sierra-lite',
      ditherPaletteSpread: 75,
    });
    const session: MarkGradientSession = {
      markId: 'session-fg',
      layerId: layer.id,
      markKind: 'shape',
      gradientKind: 'linear',
      source: 'fg',
      frozenStopsStored: [
        { position: 0, color: '#112233' },
        { position: 0.5, color: '#445566' },
        { position: 1, color: '#778899' },
      ],
      frozenHash: '',
      binding: { kind: 'def', defId: 2, slot: 1 },
      ditherRenderConfig: {
        enabled: true,
        pairBandCount: 0,
        spread: 75,
        algorithm: 'sierra-lite',
      },
    };

    __setActiveMarkSessionGetterForTests(() => session);

    const snapshot = buildRuntimeSnapshot(layer, brushSettings);

    expect(snapshot.paintSlot).toBe(1);
    expect(snapshot.slotPalettes[0]?.stops).toEqual(session.frozenStopsStored);
  });
});
