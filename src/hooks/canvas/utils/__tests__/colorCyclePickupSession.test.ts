import { initializeStrokeSamplingState } from '@/hooks/canvas/handlers/strokeSamplingStart';
import { useAppStore } from '@/stores/useAppStore';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer } from '@/types';
import { beginMarkGradientSession, cancelMarkGradientSession, finalizeMarkGradientSession, getPreviewGradientForActiveMark } from '../colorCycleMarkSession';
import { updateCcSampledSession } from '@/hooks/canvas/handlers/colorCycle/ccSampling';
import { parseCssColorToRgba } from '../colorCycleHelpers';

const baseStops = [{ position: 0, color: '#0000ff' }, { position: 1, color: '#0000ff' }];

beforeEach(() => {
  const layer: Layer = {
    id: 'pickup-test', name: 'Pickup', visible: true, opacity: 1, blendMode: 'source-over',
    locked: false, order: 0, imageData: null, framebuffer: document.createElement('canvas'),
    alignment: createDefaultLayerAlignment(), layerType: 'color-cycle',
    colorCycleData: { gradientDefs: [], slotPalettes: [], gradientDefStore: [], nextGradientDefId: 1, paintSlot: 0 },
  };
  useAppStore.setState((s) => ({ layers: [layer], activeLayerId: layer.id, tools: {
    ...s.tools, ccGradientSource: 'manual', brushSettings: {
      ...s.tools.brushSettings, colorCyclePickupEnabled: true, size: 10, ditherEnabled: false,
      colorCycleGradientIsRuntimePalette: false, ccGradientRangeContrast: 70,
    },
  } }));
});

afterEach(() => cancelMarkGradientSession('pickup-test'));

it('uses a sampled immutable binding while retaining the selected brush source', () => {
  const session = beginMarkGradientSession({ layerId: 'pickup-test', markKind: 'stroke', gradientKind: 'linear', source: 'manual', stops: baseStops });
  expect(session?.source).toBe('sampled');
  expect(session?.binding).toBeNull();
  expect(session?.colourPickup?.baseStops).toEqual(baseStops);
  expect(useAppStore.getState().tools.ccGradientSource).toBe('manual');
});

it('never calls the composite/reference sampler and finalizes the complete path even inside the throttle', () => {
  const session = beginMarkGradientSession({ layerId: 'pickup-test', markKind: 'stroke', gradientKind: 'linear', source: 'manual', stops: baseStops })!;
  const pixels = new Uint8ClampedArray(200 * 40 * 4);
  for (let y = 0; y < 40; y += 1) for (let x = 40; x < 60; x += 1) pixels.set([255, 0, 0, 255], (y * 200 + x) * 4);
  session.colourPickup!.image = { width: 200, height: 40, data: pixels } as ImageData;
  // Model the indices authored by the brush; this session test supplies no runtime brush.
  session.colourPickup!.strokePaletteIndicesAt = (x) => [1 + Math.round(x)];
  const compositeSampler = jest.fn(() => '#00ff00');
  const lastUpdateRef = { current: 0 };
  updateCcSampledSession({ session, sourcePts: [{ x: 0, y: 20 }], sampleColor: compositeSampler, now: 200, lastUpdateRef, allowTiny: true });
  updateCcSampledSession({ session, sourcePts: [{ x: 0, y: 20 }, { x: 190, y: 20 }], sampleColor: compositeSampler, now: 210, lastUpdateRef, allowTiny: true });
  const committed = finalizeMarkGradientSession('pickup-test')!;
  expect(compositeSampler).not.toHaveBeenCalled();
  expect(committed.binding).not.toBeNull();
  const rgb = committed.frozenStopsStored.map((s) => parseCssColorToRgba(s.color));
  expect(rgb.some((c) => c[0] > 100)).toBe(true);
  expect(rgb.every((c) => c[1] === 0)).toBe(true);
  expect(rgb[rgb.length - 1][0]).toBeLessThan(10);
});

it('does not apply sampled contrast again to visible pickup colours in the preview', () => {
  const session = beginMarkGradientSession({ layerId: 'pickup-test', markKind: 'shape', gradientKind: 'linear', source: 'manual', stops: baseStops })!;
  session.previewStopsStored = [{ position: 0, color: '#774499' }, { position: 1, color: '#3333aa' }];
  useAppStore.getState().setBrushSettings({ ccGradientRangeContrast: 100 });
  expect(getPreviewGradientForActiveMark('pickup-test')?.stopsStored).toEqual(session.previewStopsStored);
});

it('does not revive old sampled motion just because pickup is enabled', () => {
  useAppStore.setState((state) => ({ tools: { ...state.tools, brushSettings: {
    ...state.tools.brushSettings, colorCycleGradientIsRuntimePalette: false,
    colorCycleSampledMotion: { phaseByte: 91, speedByte: 17, flowByte: 2 },
  } } }));
  const session = beginMarkGradientSession({ layerId: 'pickup-test', markKind: 'shape', gradientKind: 'linear', source: 'sampled', stops: baseStops });
  expect(session?.sampledMotion).toBeUndefined();
});

it('suppresses composite auto-sampling when pickup is enabled in Sample mode', () => {
  const state = useAppStore.getState();
  const renderBrushSamplingPreview = jest.fn();
  const updateCcSampledGradient = jest.fn();
  const autoSamplePointsRef = { current: [] as Array<{ x: number; y: number }> };
  initializeStrokeSamplingState({
    currentState: { ...state, tools: { ...state.tools, ccGradientSource: 'sampled', brushSettings: {
      ...state.tools.brushSettings, autoSampleGradient: true, autoSampleGradientRealtime: true,
    } } },
    ccFlags: { isAny: true }, worldPos: { x: 10, y: 20 }, autoSamplePointsRef,
    autoSampleLastUpdateRef: { current: 0 }, autoSampleForkRef: { current: false },
    brushSamplingPreviewActiveRef: { current: false }, renderBrushSamplingPreview,
    ccSampledPointsRef: { current: [] }, ccSampledLastUpdateRef: { current: 0 }, updateCcSampledGradient,
  });
  expect(autoSamplePointsRef.current).toEqual([]);
  expect(renderBrushSamplingPreview).not.toHaveBeenCalled();
  expect(updateCcSampledGradient).toHaveBeenCalledWith([{ x: 10, y: 20 }], { markKind: 'stroke' });
});

it('keeps Sample as the brush load while pickup remains restricted to the active layer', () => {
  useAppStore.setState((state) => ({ tools: { ...state.tools, ccGradientSource: 'sampled' } }));
  const session = beginMarkGradientSession({ layerId: 'pickup-test', markKind: 'stroke', gradientKind: 'linear', source: 'sampled', stops: baseStops })!;
  const sampleColor = jest.fn(() => '#00ff00');
  updateCcSampledSession({ session, sourcePts: [{ x: 0, y: 20 }, { x: 190, y: 20 }], sampleColor, now: 200, lastUpdateRef: { current: 0 }, allowTiny: true });
  const committed = finalizeMarkGradientSession('pickup-test')!;
  expect(sampleColor).toHaveBeenCalled();
  expect(committed.frozenStopsStored.every((stop) => parseCssColorToRgba(stop.color)[1] > 0)).toBe(true);
  expect(committed.frozenStopsStored.every((stop) => parseCssColorToRgba(stop.color)[2] === 0)).toBe(true);
});
