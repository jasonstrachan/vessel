import studioExtension from '@/extensions/studioExtension';
import { alignSampledStampPositions } from '@/hooks/canvas/handlers/colorCycle/alignSampledStroke';
import { beginMarkGradientSession, cancelMarkGradientSession, finalizeMarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

import { bindLayerStrokeBuffersToAnimator, createLayerStrokeState } from '../colorCycleLayerStrokeBuffers';
import { createSampledStrokePreview } from '../sampledStrokePreview';
import { createStampDitherRuntime, finalizeStampDither, type StampDitherAlgorithm } from '../strokeStampDither';

type PreviewCase = {
  source: 'sampled' | 'manual' | 'fg';
  unresolve: boolean;
  algorithm: StampDitherAlgorithm;
  bristles: boolean;
  intent?: number[];
  flowBits?: number;
};
const previewCases: PreviewCase[] = (['sampled', 'manual', 'fg'] as const).flatMap(source =>
  [false, true].flatMap(unresolve => (['sierra-lite', 'bayer', 'pattern'] as StampDitherAlgorithm[])
    .flatMap(algorithm => [false, true].map(bristles => ({ source, unresolve, algorithm, bristles })))));
previewCases.push(
  { source: 'sampled', unresolve: false, algorithm: 'bayer', bristles: true, intent: [9, 17, 28, 99], flowBits: 3 },
  { source: 'sampled', unresolve: false, algorithm: 'bayer', bristles: true, intent: [0, 0, 0, 99], flowBits: 0 },
);

it.each(previewCases)('previews committed $source $algorithm inks with Unresolve $unresolve and Bristles $bristles (intent $intent) without touching authoring', ({ source: gradientSource, unresolve, algorithm, bristles, intent, flowBits }) => {
  const layer: Layer = {
    id: 'preview-inks', name: 'Inks', visible: true, opacity: 1, blendMode: 'source-over',
    locked: false, transparencyLocked: false, order: 0, imageData: null,
    framebuffer: document.createElement('canvas'), alignment: createDefaultLayerAlignment(),
    layerType: 'color-cycle', version: 1,
    colorCycleData: { gradientDefs: [], slotPalettes: [], gradientDefStore: [], nextGradientDefId: 1, paintSlot: 0 },
  };
  const previousAlignment = studioExtension.sampledStrokeAlignment;
  studioExtension.sampledStrokeAlignment = () => unresolve ? { speedCps: 0.063 } : undefined;
  useAppStore.setState((state) => ({ layers: [layer], activeLayerId: layer.id,
    tools: { ...state.tools, brushSettings: { ...state.tools.brushSettings,
      colorCycleStampDitherEnabled: true, colorCycleStampDitherBgFill: true,
      colorCyclePencilEnabled: false, colorCycleBristlesEnabled: bristles, colorCyclePickupEnabled: false,
      ccGradientRangeContrast: 40, ditherPaletteSpread: 50, colorCycleBandSpacingPx: 20,
      colorCycleGradientSeamProfile: 'soft',
    } },
  }));
  const source = [{ position: 0, color: '#606060' }, { position: 1, color: '#a08080' }];
  const session = beginMarkGradientSession({ layerId: layer.id, markKind: 'stroke', gradientKind: 'linear', source: gradientSource, stops: source });
  if (!session) throw new Error('Missing session');
  session.previewStopsStored = source;
  const stroke = createLayerStrokeState({ bufferSize: 4, strokeCycleSpeed: 0.05, strokeSpeedByte: 8 });
  const animator = new ColorCycleAnimator({ width: 4, height: 1, forceCanvas2D: true });
  bindLayerStrokeBuffersToAnimator(stroke, animator, 4);
  stroke.buffers.paint.set([20, 84, 100, 9]);
  stroke.buffers.gid.set([254, 254, 254, 3]);
  stroke.buffers.def.set([0, 0, 0, 7]);
  stroke.buffers.phase.set([1, 1, 2, 3]);
  stroke.buffers.flow.fill(2);
  stroke.buffers.spd.fill(8);
  stroke.stampDither = { stampDitherTag: new Uint32Array([65537, 65537, 65538, 0]),
    stampDitherPrimaryBuffer: new Uint8Array([20, 20, 100, 0]),
    stampDitherStrokeEpoch: 1, stampDitherStampSeq: 2,
    stampDitherBounds: { minX: 0, minY: 0, maxX: 2, maxY: 0 } };
  if (intent) stroke.stampDither.stampDitherPhaseIntent = Uint8Array.from(intent);
  if (flowBits !== undefined) stroke.stampDither.stampDitherFlowBits = flowBits;
  const originalIntent = stroke.stampDither.stampDitherPhaseIntent?.slice();
  const original = Object.fromEntries(Object.entries(stroke.buffers).map(([key, buffer]) => [key, [...buffer]]));
  const setDefIdData = jest.spyOn(animator, 'setDefIdData');
  const setGradientSlot = jest.spyOn(animator, 'setGradientSlot').mockImplementation(() => {});
  const dither = { config: { algorithm, pixelSize: 1, bgFill: true, pressureLinked: false, seed: 42, diversity: 1 },
    runtime: createStampDitherRuntime(), ditherStrength: 1, cycleSpeed: 0.05 };
  let mapped: Uint8Array | undefined;
  let mappedGid: Uint8Array | undefined;
  try {
    expect(session.source).toBe(gradientSource);
    if (gradientSource === 'fg') {
      expect(session.sampledPairedInks).toBeUndefined();
      expect(session.seamProfile).toBe('hard');
      expect(createSampledStrokePreview(layer.id, animator, stroke, 1, () => dither)).toBeUndefined();
      expect(finalizeMarkGradientSession(layer.id)!.frozenStopsStored).toEqual(source);
      expect(Object.fromEntries(Object.entries(stroke.buffers).map(([key, buffer]) => [key, [...buffer]]))).toEqual(original);
      return;
    }
    expect(session.sampledPairedInks).toBe(true);
    expect(session.sampledSourceSeamProfile).toBe('soft');
    expect(session.seamProfile).toBe('hard');
    if (gradientSource !== 'sampled') {
      expect(session.previewStopsStored).toEqual(source);
      expect(session.sampledAlignment).toBeUndefined();
      expect(session.speedCps).toBeUndefined();
    }
    const preview = createSampledStrokePreview(layer.id, animator, stroke, 1, () => dither);
    expect(preview).toBeDefined();
    preview!(() => {
      const { data: paint, gid } = animator.getIndexBuffers();
      mapped = paint.slice();
      mappedGid = gid!.slice();
      if (bristles) expect([...animator.getIndexBuffers().phase!]).toEqual(intent
        ? [...intent.slice(0, 3), original.phase[3]] : original.phase);
      expect([...animator.getIndexBuffers().flow!]).toEqual(session.sampledAlignment
        ? [1, 1, 1, original.flow[3]]
        : flowBits !== undefined ? [flowBits, flowBits, flowBits, original.flow[3]] : original.flow);
      expect(paint).not.toBe(stroke.buffers.paint);
      expect([...stroke.buffers.paint]).toEqual(original.paint);
      expect(gid![3]).toBe(3);
      expect([...paint]).toEqual([20, 20, 100, 9]);
      expect(paint[3]).toBe(9);
      expect([...setDefIdData.mock.calls.at(-1)![0]!]).toEqual([0, 0, 0, 7]);
    });
    expect(animator.getIndexBuffers().data).toBe(stroke.buffers.paint);
    expect(() => preview!(() => { throw new Error('render failed'); })).toThrow('render failed');
    expect(setDefIdData.mock.calls.at(-1)![0]).toBe(stroke.buffers.def);
    expect(Object.fromEntries(Object.entries(stroke.buffers).map(([key, buffer]) => [key, [...buffer]]))).toEqual(original);
    expect(stroke.stampDither.stampDitherPhaseIntent).toEqual(originalIntent);
    expect(stroke.stampDither.stampDitherFlowBits).toBe(flowBits);
    if (gradientSource === 'sampled' && unresolve && !bristles) {
      stroke.stampDither.stampSourceDistances = [0, 0, 600];
      const sourcePreview = createSampledStrokePreview(layer.id, animator, stroke, 2, () => dither);
      sourcePreview!(() => {
        expect([...animator.getIndexBuffers().data]).toEqual([5, 5, 255, 9]);
        expect([...stroke.buffers.paint]).toEqual(original.paint);
      });
      delete stroke.stampDither.stampSourceDistances;
    }
    finalizeStampDither({ ...dither, animator, width: 4, height: 1, flowSlot: 254, state: {
      ...stroke.stampDither, paint: stroke.buffers.paint, gradientIdBuffer: stroke.buffers.gid,
      gradientDefIdBuffer: stroke.buffers.def, speedBuffer: stroke.buffers.spd,
    } });
    const final = finalizeMarkGradientSession(layer.id)!;
    expect(setGradientSlot).toHaveBeenCalledWith(254, final.frozenStopsStored, final.seamProfile);
    expect(setGradientSlot).toHaveBeenCalledWith(255, final.sampledSecondaryStops, final.seamProfile);
    const aligned = alignSampledStampPositions({
      paintBuffer: stroke.buffers.paint.buffer as ArrayBuffer,
      gradientIdBuffer: stroke.buffers.gid.buffer as ArrayBuffer,
    }, { tags: stroke.stampDither.stampDitherTag!, primary: stroke.stampDither.stampDitherPrimaryBuffer!,
      epoch: 1 },
    { slot: 5, defId: 12 });
    expect(mapped).toEqual(new Uint8Array(aligned.paintBuffer));
    expect(mappedGid).toEqual(new Uint8Array(aligned.gradientIdBuffer!).map((slot) => slot === 5 ? 255 : slot));
    expect(createSampledStrokePreview(layer.id, animator, stroke, 1)).toBeUndefined();
  } finally {
    animator.cleanup();
    cancelMarkGradientSession(layer.id);
    studioExtension.sampledStrokeAlignment = previousAlignment;
  }
});
