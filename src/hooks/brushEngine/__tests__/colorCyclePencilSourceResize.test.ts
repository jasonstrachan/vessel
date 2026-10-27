import { buildSampledPathStroke } from '@/hooks/canvas/handlers/colorCycle/sampledPathStroke';
import { createDefPaletteCache } from '../colorCycleDefPaletteCache';
import { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import { useAppStore } from '@/stores/useAppStore';
import { runColorCyclePaintStroke, type ColorCyclePaintStrokeContext } from '../colorCyclePaintStrokeRuntime';
import { bindLayerStrokeBuffersToAnimator, createLayerStrokeState, resizeLayerStrokeBuffersAfterTargetCanvasChange } from '../colorCycleLayerStrokeBuffers';
import { ensureColorCycleStampDitherState, getColorCycleStampDitherStrokeData } from '../colorCycleStrokeStateRuntime';
import { createStampDitherRuntime } from '../strokeStampDither';

it.each(['pencil', 'bristles', 'both'].flatMap(mode => [0.25, 1].map(pressure => ({ mode, pressure }))))('preserves $mode source colours and pressure $pressure after canvas resize', ({ mode, pressure }) => {
  const original = useAppStore.getState().tools;
  useAppStore.setState({ tools: { ...original, brushSettings: { ...original.brushSettings,
    size: 8, colorCyclePencilEnabled: mode !== 'bristles', colorCycleBristlesEnabled: mode !== 'pencil',
  } } });
  const stroke = createLayerStrokeState({ strokeCycleSpeed: 0.1, strokeSpeedByte: 17 });
  const runtime = createStampDitherRuntime();
  try {
    for (const size of [32, 64]) {
      const animator = new ColorCycleAnimator({ width: size, height: size, forceCanvas2D: true, autoStart: false });
      try {
        resizeLayerStrokeBuffersAfterTargetCanvasChange(stroke, size * size);
        bindLayerStrokeBuffersToAnimator(stroke, animator, size * size);
        stroke.lastPoint = null;
        stroke.paintMask = null;
        const context: ColorCyclePaintStrokeContext = {
          getActiveLayerId: () => 'pencil', prepareStrokeContext: () => ({ id: 'pencil', animator, strokeData: stroke }),
          applyStrokeFlowSpeed: () => {}, resolveActiveStrokeSlot: () => 254, resolveFlowSlot: () => 254,
          isStampDitherEnabled: () => false, getStampShape: () => 'diamond',
          computeColorBandIndex: () => 1, getNonDitherStrokeColorIndex: () => 1, advanceStrokePhase: () => {},
          getWriteSpeedByte: () => 17, getWriteCycleSpeed: () => 0.1, getFlowMode: () => 'forward',
          resolvePressureBrushSize: () => 8, getGradientBands: () => 255, getStrokeBandSpacing: () => 1,
          createStampDitherConfig: () => ({ algorithm: 'sierra-lite', pixelSize: 1, bgFill: false, pressureLinked: false, seed: 0 }),
          getPerfStroke: () => null, getStampDitherStrokeData: getColorCycleStampDitherStrokeData,
          getStampDitherRuntime: () => runtime, ensureStampDitherState: ensureColorCycleStampDitherState,
          updateStampPerfBounds: () => {}, markStrokeStateContentWritten: () => {}, markPresenterLayerDirty: () => {},
          isAnimating: () => false, hasScheduledFrame: () => false, hasConnectedTarget: () => false,
          forceLayerRender: () => {}, renderFromDirtyBatches: () => {}, render: () => {}, scheduleDirtyRender: () => {},
          getCanvasWidth: () => size, getCanvasHeight: () => size,
        };
        runColorCyclePaintStroke(context, size - 6, size - 6, 'pencil', pressure);
        const ownership = stroke.stampDither!;
        expect(ownership.stampDitherTag).toHaveLength(size * size);
        expect(ownership.stampDitherPrimaryBuffer).toHaveLength(size * size);
        let painted = 0;
        stroke.buffers.paint.forEach((value, index) => {
          if (!value) return;
          painted++;
          expect(ownership.stampDitherTag![index] & 65535).toBe(1);
          expect(ownership.stampDitherPrimaryBuffer![index]).toBe(value);
        });
        expect(painted).toBeGreaterThan(0);
        const mask = stroke.buffers.paint.map(value => value ? 1 : 0);
        const phases = stroke.buffers.phase.slice();
        const bound = buildSampledPathStroke({
          snapshot: { paintBuffer: stroke.buffers.paint.slice().buffer,
            gradientIdBuffer: stroke.buffers.gid.slice().buffer, phaseBuffer: phases.buffer },
          ownership: { tags: ownership.stampDitherTag!, primary: ownership.stampDitherPrimaryBuffer!,
            epoch: ownership.stampDitherStrokeEpoch ?? 1, distances: ownership.stampSourceDistances },
          bandPx: 1, bristleBands: mode === 'pencil' ? undefined : 12,
          primary: [{ position: 0, color: '#2c4d6e' }], definitions: [], speedByte: 17,
        });
        const snapshot = bound.snapshot;
        expect(new Uint8Array(snapshot.paintBuffer).map(value => value ? 1 : 0)).toEqual(mask);
        expect(new Uint8Array(snapshot.phaseBuffer!)).toEqual(phases);
        animator.setIndexBufferFromArray(new Uint8Array(snapshot.paintBuffer),
          new Uint8Array(snapshot.gradientIdBuffer!), new Uint8Array(snapshot.speedBuffer!),
          new Uint8Array(snapshot.flowBuffer!), new Uint8Array(snapshot.phaseBuffer!));
        animator.setDefIdData(new Uint16Array(snapshot.gradientDefIdBuffer!));
        animator.setDefPaletteCache(createDefPaletteCache(bound.definitions, 1));
        (animator as unknown as { renderFrame(offset: number, seconds: number): void }).renderFrame(0, 0);
        const pixels = animator.getImageData().data;
        mask.forEach((value, index) => {
          if (value) expect([...pixels.slice(index * 4, index * 4 + 4)]).toEqual([44, 77, 110, 255]);
          else expect(pixels[index * 4 + 3]).toBe(0);
        });
      } finally { animator.cleanup(); }
    }
  } finally { useAppStore.setState({ tools: original }); }
});
