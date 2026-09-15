import { ensurePalette } from '@/lib/colorCycle/paletteService';
import { parseCssColorToRgba } from '@/hooks/canvas/utils/colorCycleHelpers';
import studioExtension from '@/extensions/studioExtension';
import { applyCcSampledRangeContrast } from '@/utils/colorCycle/ccSampledRangeContrast';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer } from '@/types';
import {
  beginMarkGradientSession,
  cancelMarkGradientSession,
  captureFrozenCcDitherRenderConfig,
  finalizeMarkGradientSession,
  getPreviewGradientForActiveMark,
  resolveMarkSessionRuntimeStops,
  resolveSampledStrokeInkPalettes,
} from '@/hooks/canvas/utils/colorCycleMarkSession';
import { useAppStore } from '@/stores/useAppStore';
import { buildCcDitherRenderPalette, resolveCcDitherBandMode } from '@/utils/colorCycle/ccDitherRenderPalette';
import { attachLegacyColorCycleTopLevelBuffers } from '@/lib/colorCycle/document';
import { updateCcSampledSession } from '@/hooks/canvas/handlers/colorCycle/ccSampling';

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
          colorCycleStampDitherEnabled: false,
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

  it('freezes shared cycle speed only for enabled sampled dither strokes', () => {
    const previous = studioExtension.sampledStrokeAlignment;
    const previousPalette = studioExtension.preserveSampledStrokePalette;
    studioExtension.preserveSampledStrokePalette = true;
    studioExtension.sampledStrokeAlignment = () => ({ speedCps: 0.063 });
    try {
      const layer = createLayer();
      useAppStore.setState((state) => ({ layers: [layer], activeLayerId: layer.id, tools: { ...state.tools,
        brushSettings: { ...state.tools.brushSettings, colorCyclePickupEnabled: false,
          colorCycleStampDitherEnabled: true, colorCycleStampDitherBgFill: true,
          colorCyclePencilEnabled: false, colorCycleBristlesEnabled: false, colorCycleBandSpacingPx: 4 } } }));
      const session = beginMarkGradientSession({ layerId: layer.id, markKind: 'stroke', gradientKind: 'linear', source: 'sampled', stops });
      expect(session?.sampledAlignment).toEqual({ speedCps: 0.063, bandPx: 4 });
      expect(session?.speedCps).toBe(0.063);
      studioExtension.sampledStrokeAlignment = () => undefined;
      expect(session?.sampledAlignment?.speedCps).toBe(0.063);
      cancelMarkGradientSession(layer.id);
      const ordinary = beginMarkGradientSession({ layerId: layer.id, markKind: 'stroke', gradientKind: 'linear', source: 'sampled', stops });
      expect(ordinary?.sampledAlignment).toBeUndefined();
      cancelMarkGradientSession(layer.id);
    } finally {
      studioExtension.sampledStrokeAlignment = previous;
      studioExtension.preserveSampledStrokePalette = previousPalette;
    }
  });

  it.each([0, 50, 100].flatMap((spread) => [false, true].map((unresolve) => ({ spread, unresolve }))))('freezes sampled ink spread $spread with Unresolve $unresolve and applies contrast once', ({ spread, unresolve }) => {
    const previous = studioExtension.sampledStrokeAlignment;
    const previousPalette = studioExtension.preserveSampledStrokePalette;
    studioExtension.sampledStrokeAlignment = () => unresolve ? { speedCps: 0.063 } : undefined;
    studioExtension.preserveSampledStrokePalette = unresolve;
    const source = [{ position: 0, color: '#5070a0' }, { position: 1, color: '#b05030' }];
    const layer = createLayer();
    try {
      useAppStore.setState((state) => ({ layers: [layer], activeLayerId: layer.id,
        tools: { ...state.tools, brushSettings: { ...state.tools.brushSettings,
          colorCyclePickupEnabled: false, colorCycleStampDitherEnabled: true,
          colorCycleStampDitherBgFill: true, colorCyclePencilEnabled: false,
          colorCycleBristlesEnabled: false, ditherPaletteSpread: spread,
          ccGradientRangeContrast: 40,
        } },
      }));
      const session = beginMarkGradientSession({ layerId: layer.id, markKind: 'stroke',
        gradientKind: 'linear', source: 'sampled', stops: source });
      if (!session) throw new Error('Expected sampled session');
      session.previewStopsStored = source;
      expect(resolveMarkSessionRuntimeStops(session, source, { rangeContrast: 40 }))
        .toEqual(applyCcSampledRangeContrast(source, 40));
      useAppStore.getState().setBrushSettings({ ditherPaletteSpread: 100 - spread });
      const result = finalizeMarkGradientSession(layer.id);
      const expected = resolveSampledStrokeInkPalettes(session, source, 40);
      expect(result?.frozenStopsStored).toEqual(expected.primary);
      expect(result?.sampledSecondaryStops).toEqual(expected.secondary);
      expect(result?.rawStopsStored).toEqual(source);
    } finally {
      cancelMarkGradientSession(layer.id);
      studioExtension.sampledStrokeAlignment = previous;
      studioExtension.preserveSampledStrokePalette = previousPalette;
    }
  });

  it.each((['sampled', 'manual', 'fg'] as const).flatMap(source =>
    (['hard', 'soft'] as const).map(seamProfile => ({ source, seamProfile }))))(
    'preserves the rendered target throughout the $source $seamProfile loop', ({ source, seamProfile }) => {
      const layer = createLayer();
      const stops = [{ position: 0, color: '#a06060' }, { position: 1, color: '#6060a0' }];
      useAppStore.setState(state => ({ layers: [layer], activeLayerId: layer.id,
        tools: { ...state.tools, brushSettings: { ...state.tools.brushSettings,
          colorCyclePickupEnabled: false, colorCycleStampDitherEnabled: true,
          colorCycleStampDitherBgFill: true, colorCyclePencilEnabled: false,
          colorCycleBristlesEnabled: false, ditherPaletteSpread: 100,
          colorCycleGradientSeamProfile: seamProfile,
        } },
      }));
      const session = beginMarkGradientSession({ layerId: layer.id, markKind: 'stroke',
        gradientKind: 'linear', source, stops });
      if (!session) throw new Error('Missing session');
      session.previewStopsStored = stops;
      const result = finalizeMarkGradientSession(layer.id)!;
      const expected = ensurePalette({ stops, seamProfile }).rgba;
      const primary = ensurePalette({ stops: result.frozenStopsStored, seamProfile: result.seamProfile }).rgba;
      const secondary = ensurePalette({ stops: result.sampledSecondaryStops!, seamProfile: result.seamProfile }).rgba;
      const linear = (byte: number) => byte <= 10.31475 ? byte / 3294.6 : ((byte / 255 + 0.055) / 1.055) ** 2.4;
      let maxError = 0;
      for (let i = 0; i < expected.length; i++) {
        if (i % 4 === 3) continue;
        maxError = Math.max(maxError, Math.abs((linear(primary[i]) + linear(secondary[i])) / 2 - linear(expected[i])));
      }
      expect(maxError).toBeLessThan(0.004);
    },
  );

  it('commits the complete sampled stroke when all moves arrive inside the preview throttle', () => {
    const layer = createLayer();
    useAppStore.setState({ layers: [layer], activeLayerId: layer.id });
    const session = beginMarkGradientSession({
      layerId: layer.id,
      markKind: 'stroke',
      gradientKind: 'linear',
      source: 'sampled',
      stops,
    });
    if (!session) throw new Error('Expected a sampled mark session');
    const lastUpdateRef = { current: 0 };
    const sampleColor = jest.fn((x: number) => x < 32 ? '#3c7295' : '#508bab');
    updateCcSampledSession({
      session,
      sourcePts: [{ x: 0, y: 0 }],
      sampleColor,
      now: 200,
      lastUpdateRef,
      allowTiny: true,
    });
    expect(updateCcSampledSession({
      session,
      sourcePts: [{ x: 0, y: 0 }, { x: 64, y: 0 }],
      sampleColor,
      now: 205,
      lastUpdateRef,
      allowTiny: true,
    })).toBeNull();
    expect(session.samples).toHaveLength(1);

    const committed = finalizeMarkGradientSession(layer.id);

    expect(committed?.samples?.[0].rgba).toEqual([60, 114, 149, 255]);
    expect(committed?.samples?.at(-1)?.rgba).toEqual([80, 139, 171, 255]);
    expect(committed?.rawStopsStored?.[0].color).toBe(committed?.rawStopsStored?.at(-1)?.color);
    expect(committed?.samples?.length).toBeGreaterThan(1);
    expect(sampleColor).toHaveBeenLastCalledWith(64, 0);
    expect(committed?.sampledStrokeColorAt).toBeUndefined();
  });

  it.each([1, 4, 20].flatMap(bandPx => (['hard', 'soft'] as const).map(seam => ({ bandPx, seam }))))('finalizes every $bandPx px source band with a $seam seam without capping at 256', ({ bandPx, seam }) => {
    const previous = studioExtension.sampledStrokeAlignment;
    studioExtension.sampledStrokeAlignment = () => ({ speedCps: 0.063 });
    const layer = createLayer();
    useAppStore.setState((state) => ({ layers: [layer], activeLayerId: layer.id,
      tools: { ...state.tools, brushSettings: { ...state.tools.brushSettings,
        colorCycleStampDitherEnabled: true, colorCycleStampDitherBgFill: true,
        colorCyclePencilEnabled: false, colorCycleBristlesEnabled: false,
        colorCyclePickupEnabled: false, colorCycleBandSpacingPx: bandPx, colorCycleGradientSeamProfile: seam,
      } },
    }));
    try {
      const session = beginMarkGradientSession({ layerId: layer.id, markKind: 'stroke',
        gradientKind: 'linear', source: 'sampled', stops });
      if (!session) throw new Error('Expected sampled session');
      const sampleColor = (x: number) => `rgb(${Math.floor(x) % 251},80,120)`;
      const lastUpdateRef = { current: 0 };
      updateCcSampledSession({ session, sourcePts: [{ x: 0, y: 0 }], sampleColor,
        now: 200, lastUpdateRef, allowTiny: true });
      updateCcSampledSession({ session, sourcePts: [{ x: 0, y: 0 }, { x: 5999, y: 0 }],
        sampleColor, now: 205, lastUpdateRef, allowTiny: true });
      const result = finalizeMarkGradientSession(layer.id)!;
      expect(result.sampledPathStops).toHaveLength(Math.floor(5999 / bandPx) + 1);
      if (seam === 'soft') expect(result.sampledPathStops!.at(-1)?.color).toBe(result.sampledPathStops![0].color);
      result.sampledPathStops!.forEach((stop, band) => {
        if (seam === 'soft' && band >= Math.floor(result.sampledPathStops!.length * 0.875) - 2) return;
        const expected = parseCssColorToRgba(sampleColor(Math.min(5999, (band + 0.5) * bandPx)));
        const actual = parseCssColorToRgba(stop.color);
        actual.forEach((channel, i) => expect(Math.abs(channel - expected[i])).toBeLessThanOrEqual(1));
      });
      expect(result.sampledStrokeColorAt).toBeUndefined();
    } finally {
      cancelMarkGradientSession(layer.id);
      studioExtension.sampledStrokeAlignment = previous;
    }
  });

  it('freezes a separate full-path gradient for each differently sampled stroke', () => {
    const layer = createLayer();
    useAppStore.setState({ layers: [layer], activeLayerId: layer.id });
    const draw = (channel: 'red' | 'blue') => {
      const session = beginMarkGradientSession({ layerId: layer.id, markKind: 'stroke', gradientKind: 'linear', source: 'sampled', stops });
      if (!session) throw new Error('Expected a sampled mark session');
      updateCcSampledSession({
        session, sourcePts: [{ x: 0, y: 0 }, { x: 300, y: 0 }], now: 200,
        lastUpdateRef: { current: 0 }, allowTiny: true,
        sampleColor: (x) => channel === 'red' ? `rgb(${Math.round(x / 300 * 255)},0,0)` : `rgb(0,0,${Math.round(x / 300 * 255)})`,
      });
      return finalizeMarkGradientSession(layer.id);
    };
    const first = draw('red');
    const firstStops = JSON.stringify(first?.frozenStopsStored);
    const second = draw('blue');
    expect(first?.samples).toHaveLength(256);
    expect(second?.samples).toHaveLength(256);
    expect(first?.binding?.kind).toBe('def');
    expect(second?.binding?.kind).toBe('def');
    expect(first?.binding?.defId).not.toBe(second?.binding?.defId);
    expect(JSON.stringify(first?.frozenStopsStored)).toBe(firstStops);
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
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          colorCycleGradientSeamProfile: 'soft',
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

  it('uses the shared brush seam for sampled sessions', () => {
    const layer = createLayer();

    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          colorCycleGradientSeamProfile: 'hard',
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
          colorCycleSampledMotion: { phaseByte: 91, speedByte: 17, flowByte: 2 },
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
    expect(session?.sampledMotion).toEqual({ phaseByte: 91, speedByte: 17, flowByte: 2 });

    useAppStore.setState((state) => ({
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          colorCycleSampledMotion: { phaseByte: 7, speedByte: 8, flowByte: 3 },
        },
      },
    }));
    expect(session?.sampledMotion).toEqual({ phaseByte: 91, speedByte: 17, flowByte: 2 });
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

it.each([0, 40, 70, 100])('preserves the contrast-adjusted mixture at Contrast %s', (contrast) => {
  const stops = [{ position: 0, color: '#405060' }, { position: 1, color: '#a09080' }];
  const expected = applyCcSampledRangeContrast(stops, contrast);
  const linear = (byte: number) => byte <= 10.31475 ? byte / 3294.6 : ((byte / 255 + 0.055) / 1.055) ** 2.4;
  for (const spread of [0, 50, 100]) {
    const pair = resolveSampledStrokeInkPalettes({ source: 'sampled', sampledPrimaryCoverage: 0.25,
      ditherRenderConfig: { enabled: true, pairBandCount: 2, spread, rangeContrast: contrast },
    }, stops);
    expected.forEach((stop, i) => {
      const target = parseCssColorToRgba(stop.color);
      const a = parseCssColorToRgba(pair.primary[i * 255].color);
      const b = parseCssColorToRgba(pair.secondary[i * 255].color);
      for (let channel = 0; channel < 3; channel++) {
        expect(Math.abs(0.25 * linear(a[channel]) + 0.75 * linear(b[channel]) - linear(target[channel])))
          .toBeLessThan(0.004);
      }
    });
  }
});

it.each(['manual', 'fg'] as const)('reconstructs colours between sparse %s gradient nodes', (source) => {
  const stops = [{ position: 0, color: '#a06060' }, { position: 1, color: '#6060a0' }];
  const pair = resolveSampledStrokeInkPalettes({ source, sampledPrimaryCoverage: 0.5,
    ditherRenderConfig: { enabled: true, pairBandCount: 2, spread: 100, rangeContrast: 70 },
  }, stops);
  const linear = (byte: number) => byte <= 10.31475 ? byte / 3294.6 : ((byte / 255 + 0.055) / 1.055) ** 2.4;
  expect(pair.primary).toHaveLength(256);
  for (let i = 0; i < 256; i++) {
    const a = parseCssColorToRgba(pair.primary[i].color);
    const b = parseCssColorToRgba(pair.secondary[i].color);
    const target = [Math.round(160 - 64 * i / 255), 96, Math.round(96 + 64 * i / 255)];
    target.forEach((value, channel) => {
      expect(Math.abs((linear(a[channel]) + linear(b[channel])) / 2 - linear(value))).toBeLessThan(0.004);
    });
  }
});
