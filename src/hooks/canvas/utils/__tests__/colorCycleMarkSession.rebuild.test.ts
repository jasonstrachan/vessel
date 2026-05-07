import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer } from '@/types';
import {
  beginMarkGradientSession,
  finalizeMarkGradientSession,
  getPreviewGradientForActiveMark,
} from '@/hooks/canvas/utils/colorCycleMarkSession';
import { useAppStore } from '@/stores/useAppStore';
import { buildCcDitherRenderPalette, resolveCcDitherBandMode } from '@/utils/colorCycle/ccDitherRenderPalette';

describe('colorCycleMarkSession rebuild', () => {
  const stops = [
    { position: 0, color: '#000000' },
    { position: 1, color: '#ffffff' },
  ];

  const createLayer = (overrides?: Partial<Layer>): Layer => ({
    id: 'layer-cc',
    name: 'Layer 1',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    transparencyLocked: false,
    order: 0,
    imageData: null,
    framebuffer: document.createElement('canvas'),
    alignment: createDefaultLayerAlignment(),
    layerType: 'color-cycle',
    colorCycleData: {
      gradientDefs: [],
      slotPalettes: [],
      gradientDefStore: [],
      nextGradientDefId: 1,
      gradientDefIdBuffer: new Uint16Array([0, 0, 0, 0]).buffer,
      paintSlot: 0,
    },
    version: 1,
    ...(overrides ?? {}),
  });

  beforeEach(() => {
    useAppStore.setState((state) => ({
      layers: [],
      activeLayerId: null,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          ditherPaletteSpread: 0,
        },
      },
      project: state.project
        ? { ...state.project, width: 2, height: 2 }
        : state.project,
    }));
  });

  it('begins sampled session without preallocating a slot', () => {
    const layer = createLayer({
      colorCycleData: {
        gradientDefs: [],
        slotPalettes: [],
        gradientDefStore: [],
        nextGradientDefId: 1,
        gradientDefIdBuffer: new Uint16Array([0, 0, 0, 0]).buffer,
        paintSlot: 0,
      },
    });

    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      project: state.project
        ? { ...state.project, width: 2, height: 2, layers: [layer] }
        : state.project,
    }));

    const session = beginMarkGradientSession({
      layerId: layer.id,
      markKind: 'shape',
      gradientKind: 'linear',
      source: 'sampled',
      stops,
    });

    expect(session).not.toBeNull();
    expect(session?.seamProfile).toBe('soft');
    expect(session?.binding).toBeNull();
    expect(useAppStore.getState().layers[0]?.colorCycleData?.gradientDefStore).toEqual([]);

    const finalized = finalizeMarkGradientSession(layer.id);
    const finalizedLayer = useAppStore.getState().layers[0];

    expect(finalized?.binding).not.toBeNull();
    expect(finalizedLayer?.colorCycleData?.gradientDefStore).toHaveLength(1);
    expect(finalizedLayer?.colorCycleData?.gradientDefStore?.[0]?.source).toBe('sampled');
    expect(finalizedLayer?.colorCycleData?.gradientDefStore?.[0]?.seamProfile).toBe('soft');
  });

  it('keeps sampled preview and finalized sampled stops unchanged', () => {
    const layer = createLayer();

    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          ditherPaletteSpread: 100,
        },
      },
      project: state.project
        ? { ...state.project, width: 2, height: 2, layers: [layer] }
        : state.project,
    }));

    const session = beginMarkGradientSession({
      layerId: layer.id,
      markKind: 'shape',
      gradientKind: 'linear',
      source: 'sampled',
      stops,
    });

    if (!session) {
      throw new Error('Expected sampled mark session');
    }

    session.previewStopsStored = [
      { position: 0, color: '#556270' },
      { position: 1, color: '#88939f' },
    ];

    const preview = getPreviewGradientForActiveMark(layer.id);
    expect(preview?.stopsStored.map((stop) => stop.color)).toEqual(
      session.previewStopsStored.map((stop) => stop.color)
    );

    finalizeMarkGradientSession(layer.id);
    const finalizedStops = useAppStore.getState().layers[0]?.colorCycleData?.gradientDefStore?.[0]?.stops;
    expect(finalizedStops?.map((stop) => stop.color)).toEqual(
      session.previewStopsStored.map((stop) => stop.color)
    );
  });

  it('uses a hard seam for sampled sessions when sampled soft seam is disabled', () => {
    const layer = createLayer();

    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          ccSampledSoftSeamEnabled: false,
        },
      },
      project: state.project
        ? { ...state.project, width: 2, height: 2, layers: [layer] }
        : state.project,
    }));

    const session = beginMarkGradientSession({
      layerId: layer.id,
      markKind: 'shape',
      gradientKind: 'linear',
      source: 'sampled',
      stops,
    });

    expect(session?.seamProfile).toBe('hard');
    finalizeMarkGradientSession(layer.id);
  });

  it('freezes sampled dither render settings at mark start so later slider changes do not recolor the mark', () => {
    const layer = createLayer();

    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          ditherEnabled: true,
          ditherPaletteSpread: 100,
        },
      },
      project: state.project
        ? { ...state.project, width: 2, height: 2, layers: [layer] }
        : state.project,
    }));

    const session = beginMarkGradientSession({
      layerId: layer.id,
      markKind: 'shape',
      gradientKind: 'linear',
      source: 'sampled',
      stops,
    });

    if (!session) {
      throw new Error('Expected sampled mark session');
    }

    useAppStore.setState((state) => ({
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          ditherEnabled: true,
          ditherPaletteSpread: 0,
        },
      },
    }));

    finalizeMarkGradientSession(layer.id);
    const finalizedStops = useAppStore.getState().layers[0]?.colorCycleData?.gradientDefStore?.[0]?.stops;
    const expectedFrozenStops = buildCcDitherRenderPalette({
      baseStops: stops,
      bands: resolveCcDitherBandMode(16).pairBandCount,
      spread: 100,
    }).renderStops;
    const expectedCurrentStops = buildCcDitherRenderPalette({
      baseStops: stops,
      bands: resolveCcDitherBandMode(16).pairBandCount,
      spread: 0,
    }).renderStops;

    expect(finalizedStops).toEqual(expectedFrozenStops);
    expect(finalizedStops).not.toEqual(expectedCurrentStops);
  });

  it('prefers richer fallback stops over a poorer 2-stop sampled preview', () => {
    const layer = createLayer();
    const richStops = [
      { position: 0, color: '#111111' },
      { position: 0.33, color: '#333333' },
      { position: 0.66, color: '#777777' },
      { position: 1, color: '#ffffff' },
    ];

    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      project: state.project
        ? { ...state.project, width: 2, height: 2, layers: [layer] }
        : state.project,
    }));

    const session = beginMarkGradientSession({
      layerId: layer.id,
      markKind: 'shape',
      gradientKind: 'linear',
      source: 'sampled',
      stops: richStops,
    });

    if (!session) {
      throw new Error('Expected sampled mark session');
    }

    session.fallbackStopsStored = richStops;
    session.previewStopsStored = [
      { position: 0, color: '#556270' },
      { position: 1, color: '#88939f' },
    ];

    const preview = getPreviewGradientForActiveMark(layer.id);
    expect(preview?.stopsStored).toEqual(session.previewStopsStored);
    expect(preview?.source).toBe('sampled');

    finalizeMarkGradientSession(layer.id);
    const finalizedStops = useAppStore.getState().layers[0]?.colorCycleData?.gradientDefStore?.[0]?.stops;
    expect(finalizedStops?.length).toBeGreaterThan(session.previewStopsStored.length);
    expect(finalizedStops?.[0]?.color).not.toBe(session.previewStopsStored[0]?.color);
    expect(finalizedStops?.[finalizedStops.length - 1]?.color).not.toBe(
      session.previewStopsStored[session.previewStopsStored.length - 1]?.color
    );
    expect(finalizedStops?.[0]?.color).not.toBe(richStops[0]?.color);
    expect(finalizedStops?.[finalizedStops.length - 1]?.color).not.toBe(
      richStops[richStops.length - 1]?.color
    );
  });

  it('returns null during sampled preview when sampled stops are missing', () => {
    const layer = createLayer();

    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      project: state.project
        ? { ...state.project, width: 2, height: 2, layers: [layer] }
        : state.project,
    }));

    const session = beginMarkGradientSession({
      layerId: layer.id,
      markKind: 'shape',
      gradientKind: 'linear',
      source: 'sampled',
      stops,
    });

    if (!session) {
      throw new Error('Expected sampled mark session');
    }

    expect(session.fallbackStopsStored).toEqual([]);
    expect(getPreviewGradientForActiveMark(layer.id)).toBeNull();
  });
});
