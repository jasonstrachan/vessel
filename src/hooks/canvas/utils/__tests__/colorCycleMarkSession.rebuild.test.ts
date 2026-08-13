import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer } from '@/types';
import {
  beginMarkGradientSession,
  cancelMarkGradientSession,
  captureFrozenCcDitherRenderConfig,
  finalizeMarkGradientSession,
  getPreviewGradientForActiveMark,
  resolveMarkSessionRuntimeStops,
} from '@/hooks/canvas/utils/colorCycleMarkSession';
import { useAppStore } from '@/stores/useAppStore';
import { buildCcDitherRenderPalette, resolveCcDitherBandMode } from '@/utils/colorCycle/ccDitherRenderPalette';
import { attachLegacyColorCycleTopLevelBuffers } from '@/lib/colorCycle/document';

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
    colorCycleData: attachLegacyColorCycleTopLevelBuffers(
      {
        gradientDefs: [],
        slotPalettes: [],
        gradientDefStore: [],
        nextGradientDefId: 1,
        paintSlot: 0,
      },
      { gradientDefIdBuffer: new Uint16Array([0, 0, 0, 0]).buffer },
    ),
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
          ditherEnabled: false,
          ditherPaletteSpread: 0,
          ccGradientRangeContrast: 70,
          ccFlatCycleDither: false,
        },
      },
      project: state.project
        ? { ...state.project, width: 2, height: 2 }
        : state.project,
    }));
  });

  it('captures the CC gradient background-fill toggle for the whole mark', () => {
    useAppStore.setState((state) => ({
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          ditherGradBgFill: false,
        },
      },
    }));
    expect(captureFrozenCcDitherRenderConfig().fillBackground).toBe(false);

    useAppStore.setState((state) => ({
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          ditherGradBgFill: true,
        },
      },
    }));
    expect(captureFrozenCcDitherRenderConfig().fillBackground).toBe(true);
  });

  it('keeps Flat Cycle manual alpha while applying its frozen background-fill policy', () => {
    useAppStore.setState((state) => ({
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          ditherEnabled: true,
          ccFlatCycleDither: true,
          ditherGradBgFill: true,
        },
      },
    }));

    const config = captureFrozenCcDitherRenderConfig();
    const runtimeStops = resolveMarkSessionRuntimeStops(
      {
        source: 'manual',
        ditherRenderConfig: config,
      },
      [
        { position: 0, color: 'rgba(0, 255, 0, 0.5)' },
        { position: 1, color: '#0000ff', opacity: 0 },
      ],
    );

    expect(config.enabled).toBe(true);
    expect(config.useDitherRenderPalette).toBe(false);
    expect(runtimeStops).toEqual([
      { position: 0, color: 'rgba(0, 255, 0, 0.5)' },
      { position: 1, color: '#0000ff', opacity: 0 },
    ]);
  });

  it.each(['manual', 'fg'] as const)(
    'applies gradient contrast to %s source stops',
    (source) => {
      const runtimeStops = resolveMarkSessionRuntimeStops(
        {
          source,
          ditherRenderConfig: {
            enabled: false,
            pairBandCount: 0,
            rangeContrast: 0,
          },
        },
        stops,
      );

      expect(runtimeStops).toEqual([
        { position: 0, color: 'rgb(128, 128, 128)' },
        { position: 1, color: 'rgb(128, 128, 128)' },
      ]);
    },
  );

  it('applies gradient contrast before building the dither render palette', () => {
    const pairBandCount = resolveCcDitherBandMode(16).pairBandCount;
    const runtimeStops = resolveMarkSessionRuntimeStops(
      {
        source: 'manual',
        ditherRenderConfig: {
          enabled: true,
          pairBandCount,
          spread: 0,
          rangeContrast: 0,
          algorithm: 'bayer',
        },
      },
      stops,
    );
    const expectedStops = buildCcDitherRenderPalette({
      baseStops: [
        { position: 0, color: 'rgb(128, 128, 128)' },
        { position: 1, color: 'rgb(128, 128, 128)' },
      ],
      bands: pairBandCount,
      spread: 0,
    }).renderStops;

    expect(runtimeStops).toEqual(expectedStops);
  });

  it('begins sampled session without preallocating a slot', () => {
    const layer = createLayer({
      colorCycleData: attachLegacyColorCycleTopLevelBuffers(
        {
          gradientDefs: [],
          slotPalettes: [],
          gradientDefStore: [],
          nextGradientDefId: 1,
          paintSlot: 0,
        },
        { gradientDefIdBuffer: new Uint16Array([0, 0, 0, 0]).buffer },
      ),
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

  it('preserves a picked soft seam when the reused gradient begins a Manual mark', () => {
    const layer = createLayer();

    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          ditherEnabled: true,
          gradientBands: 16,
          colorCycleGradientSeamProfile: 'soft',
          colorCycleGradientIsRuntimePalette: true,
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
      source: 'manual',
      stops,
    });

    expect(session?.seamProfile).toBe('soft');
    expect(session?.frozenStopsStored).toEqual(stops);
    expect(
      useAppStore.getState().layers[0]?.colorCycleData?.gradientDefStore?.[0]?.seamProfile,
    ).toBe('soft');
    cancelMarkGradientSession(layer.id);
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
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          ditherEnabled: true,
          ccFlatCycleDither: false,
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

  it('uses live range contrast for sampled preview while a session is active', () => {
    const layer = createLayer();

    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          ditherEnabled: false,
          ccGradientRangeContrast: 0,
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

    session.previewStopsStored = stops;

    expect(getPreviewGradientForActiveMark(layer.id)?.stopsStored).toEqual([
      { position: 0, color: 'rgb(128, 128, 128)' },
      { position: 1, color: 'rgb(128, 128, 128)' },
    ]);

    useAppStore.setState((state) => ({
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          ccGradientRangeContrast: 70,
        },
      },
    }));

    expect(getPreviewGradientForActiveMark(layer.id)?.stopsStored).toEqual(stops);
    cancelMarkGradientSession(layer.id);
  });

  it('freezes range-compressed stops when non-dither sampled sessions finalize', () => {
    const layer = createLayer();

    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          ditherEnabled: false,
          ccGradientRangeContrast: 0,
        },
      },
      project: state.project
        ? { ...state.project, width: 2, height: 2, layers: [layer] }
        : state.project,
    }));

    const session = beginMarkGradientSession({
      layerId: layer.id,
      markKind: 'stroke',
      gradientKind: 'linear',
      source: 'sampled',
      stops,
    });

    if (!session) {
      throw new Error('Expected sampled mark session');
    }

    session.previewStopsStored = stops;

    const finalized = finalizeMarkGradientSession(layer.id);
    const finalizedLayer = useAppStore.getState().layers[0];

    expect(finalized?.frozenStopsStored).toEqual([
      { position: 0, color: 'rgb(128, 128, 128)' },
      { position: 1, color: 'rgb(128, 128, 128)' },
    ]);
    expect(finalizedLayer?.colorCycleData?.gradientDefStore?.[0]?.stops).toEqual(
      finalized?.frozenStopsStored
    );
  });

  it('uses live range contrast instead of session-start range when sampled sessions finalize', () => {
    const layer = createLayer();

    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          ditherEnabled: false,
          ccGradientRangeContrast: 100,
        },
      },
      project: state.project
        ? { ...state.project, width: 2, height: 2, layers: [layer] }
        : state.project,
    }));

    const session = beginMarkGradientSession({
      layerId: layer.id,
      markKind: 'stroke',
      gradientKind: 'linear',
      source: 'sampled',
      stops,
    });

    if (!session) {
      throw new Error('Expected sampled mark session');
    }

    session.previewStopsStored = stops;

    useAppStore.setState((state) => ({
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          ccGradientRangeContrast: 0,
        },
      },
    }));

    const finalized = finalizeMarkGradientSession(layer.id);

    expect(finalized?.frozenStopsStored).toEqual([
      { position: 0, color: 'rgb(128, 128, 128)' },
      { position: 1, color: 'rgb(128, 128, 128)' },
    ]);
  });

  it('applies intermediate gradient contrast once to sampled CC Flat Dither preview and final stops', () => {
    const layer = createLayer();

    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          ditherEnabled: true,
          ccFlatCycleDither: true,
          ccGradientRangeContrast: 50,
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
      throw new Error('Expected sampled CC Flat Dither mark session');
    }

    session.previewStopsStored = stops;

    expect(getPreviewGradientForActiveMark(layer.id)?.stopsStored).toEqual([
      { position: 0, color: 'rgb(47, 47, 47)' },
      { position: 1, color: 'rgb(209, 209, 209)' },
    ]);

    const finalized = finalizeMarkGradientSession(layer.id);
    const finalizedStops = useAppStore.getState().layers[0]?.colorCycleData?.gradientDefStore?.[0]?.stops;

    expect(finalized?.rawStopsStored).toEqual(stops);
    expect(finalized?.frozenStopsStored).toEqual([
      { position: 0, color: 'rgb(47, 47, 47)' },
      { position: 1, color: 'rgb(209, 209, 209)' },
    ]);
    expect(finalizedStops).toEqual(finalized?.frozenStopsStored);
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
