import {
  __setActiveMarkSessionGetterForTests,
  buildRuntimeSnapshot,
} from '@/hooks/brushEngine/ccGradientRuntime';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
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
});
