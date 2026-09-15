import { commitColorCycleLayerStroke } from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';
import { finalizeMarkGradientSession, getActiveMarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import { registerColorCycleBrushLayerSnapshotRuntime } from '@/lib/colorCycle/document';
import { useAppStore } from '@/stores/useAppStore';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import * as gradientDefs from '@/utils/colorCycleGradientDefs';
import type { Layer } from '@/types';

jest.mock('@/hooks/canvas/utils/colorCycleMarkSession', () => ({
  finalizeMarkGradientSession: jest.fn(),
  getActiveMarkGradientSession: jest.fn(),
}));

it.each((['sampled', 'manual', 'fg'] as const).flatMap(source => [false, true].flatMap((unresolve) => [false, true].flatMap((atCapacity) => [false, true].map(bristles => ({ source, unresolve, atCapacity, bristles }))))) )('keeps $source ink slots with Unresolve $unresolve and capacity fallback $atCapacity with bristles $bristles', async ({ source, unresolve, atCapacity, bristles }) => {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const stops = [{ position: 0, color: '#123456' }, { position: 1, color: '#abcdef' }];
  const primaryDef: gradientDefs.ColorCycleGradientDefStore = {
    id: 22, kind: 'linear', stops, hash: 'sampled', source: 'sampled',
    createdAtMs: 1, slot: 6, speedCps: 0.063,
  };
  const layer = {
    id: 'layer-1', name: 'Layer 1', visible: true, opacity: 1, order: 0,
    imageData: null, layerType: 'color-cycle', framebuffer: canvas,
    colorCycleData: { canvas, hasContent: true, gradient: stops, gradientDefStore: [primaryDef] },
  } as Layer;
  const stateSpy = jest.spyOn(useAppStore, 'getState').mockReturnValue({
    layers: [layer], updateLayer: jest.fn(), setCcGradientSampleCount: jest.fn(),
    colorCyclePlayback: { desiredPlaying: true, suspendDepth: 0 },
  } as unknown as ReturnType<typeof useAppStore.getState>);
  const gids = new Uint8Array(64).fill(9);
  gids[0] = TEMP_SAMPLE_SLOT;
  const snapshot = {
    width: 8, height: 8, hasContent: true,
    paintBuffer: new Uint8Array(64).fill(20).buffer,
    phaseBuffer: new Uint8Array(64).fill(27).buffer,
    gradientIdBuffer: gids.buffer, gradientDefIdBuffer: new Uint16Array(64).buffer,
  };
  const reusedStops = [{ position: 0, color: '#eeeecc' }, { position: 1, color: '#eeddaa' }];
  const allocatorSpy = jest.spyOn(gradientDefs, 'ensureGradientDefForStops').mockImplementation((params) => {
    if (atCapacity && params.sampledCapacityFallback !== 'reuse-nearest-compatible') return null;
    // Slot allocation may compact the existing runtime and definition store.
    gids.fill(8, 1);
    primaryDef.slot = 7;
    return { slot: 9, hash: 'secondary', reusedForCapacity: atCapacity,
      def: { ...primaryDef, id: 23, slot: 9, stops: atCapacity ? reusedStops : stops } };
  });
  const brush = {
    commitCurrentStroke: jest.fn(), finalizeCurrentStroke: jest.fn(),
    setGradientSlotStops: jest.fn(), bindGradientDefIdToSlot: jest.fn(),
    commitToLayer: jest.fn(), renderDirectToCanvas: jest.fn(),
    getColorCycleLayerDocument: () => ({ read: () => ({ snapshot: {
      ...snapshot, gradientIdBuffer: snapshot.gradientIdBuffer.slice(0),
    }, version: 1 }) }),
    getSampledStrokePositions: () => ({
      tags: Uint32Array.from({ length: 64 }, (_, i) => i === 0 ? 65537 : 0),
      epoch: 1, primary: new Uint8Array(64).fill(20),
      points: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 }],
    }),
  };
  const applySnapshot = jest.fn();
  registerColorCycleBrushLayerSnapshotRuntime(brush, { apply: applySnapshot });
  const activeSession: NonNullable<ReturnType<typeof finalizeMarkGradientSession>> = {
    markId: 'sampled', layerId: layer.id, markKind: 'stroke', gradientKind: 'linear', source,
    frozenStopsStored: stops, frozenHash: 'sampled', binding: { kind: 'def', defId: 22, slot: 6 },
    sampledAlignment: unresolve ? { speedCps: 0.063, bandPx: 1 } : undefined,
    sampledSecondaryStops: stops, speedCps: 0.063, sampledPairedInks: true, sampledBristles: bristles,
    sampledStrokePoints: [{ x: 1.1, y: 1.2 }, { x: 2.3, y: 3.4 }],
  };
  jest.mocked(finalizeMarkGradientSession).mockReturnValue(activeSession);
  jest.mocked(getActiveMarkGradientSession).mockReturnValue(activeSession);
  try {
    await commitColorCycleLayerStroke({
      layer, drawingCanvas: canvas, brushSettings: { opacity: 1 } as never,
      project: { width: 8, height: 8 }, strokeBoundingBox: null,
      strokeCapturePadding: 0, roiPadding: 0, enableCaptureRoi: false, shouldBuildEraseMask: false,
    }, {
      getBrushForLayer: () => brush as never, bindBrushToCanvas: jest.fn(), markLayerHasContent: jest.fn(),
      perfMark: jest.fn(), perfMeasure: jest.fn(), startFinalizeVisibleTimer: jest.fn(),
      endFinalizeVisibleTimer: jest.fn(), dispatchFrameUpdate: jest.fn(),
    });
    expect(activeSession.sampledPrimaryCoverage).toBe(1);
    expect(activeSession.sampledStrokePoints).toEqual(unresolve && !bristles
      ? [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 }]
      : [{ x: 1.1, y: 1.2 }, { x: 2.3, y: 3.4 }]);
    expect(allocatorSpy).toHaveBeenCalledWith(expect.objectContaining({ source }));
    expect(allocatorSpy).toHaveBeenCalledTimes(1);
    expect(allocatorSpy).toHaveBeenCalledWith(expect.objectContaining({ retainedDefIds: [22] }));
    expect(applySnapshot).toHaveBeenCalledTimes(1);
    expect(brush.setGradientSlotStops).toHaveBeenCalledWith(layer.id, 9, atCapacity ? reusedStops : stops, undefined);
    const applied = applySnapshot.mock.calls[0][1];
    expect(applied.paintBuffer).toEqual(snapshot.paintBuffer);
    expect([...new Uint8Array(applied.phaseBuffer)]).toEqual([unresolve && !bristles ? 0 : 27, ...Array(63).fill(27)]);
    expect([...new Uint8Array(applied.gradientIdBuffer)]).toEqual([TEMP_SAMPLE_SLOT, ...Array(63).fill(8)]);
    expect(brush.bindGradientDefIdToSlot).toHaveBeenCalledWith(layer.id, 22, 7, undefined, TEMP_SAMPLE_SLOT);
  } finally {
    stateSpy.mockRestore();
    allocatorSpy.mockRestore();
  }
});
