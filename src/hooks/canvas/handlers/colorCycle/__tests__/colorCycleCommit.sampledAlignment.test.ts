import { commitColorCycleLayerStroke } from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';
import { finalizeMarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import { registerColorCycleBrushLayerSnapshotRuntime } from '@/lib/colorCycle/document';
import { useAppStore } from '@/stores/useAppStore';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import * as gradientDefs from '@/utils/colorCycleGradientDefs';
import type { Layer } from '@/types';

jest.mock('@/hooks/canvas/utils/colorCycleMarkSession', () => ({
  finalizeMarkGradientSession: jest.fn(),
}));

it('keeps compacted palette slots when allocating the secondary sampled ink', async () => {
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
    paintBuffer: new Uint8Array(64).fill(1).buffer,
    gradientIdBuffer: gids.buffer, gradientDefIdBuffer: new Uint16Array(64).buffer,
  };
  const allocatorSpy = jest.spyOn(gradientDefs, 'ensureGradientDefForStops').mockImplementation(() => {
    // Slot allocation may compact the existing runtime and definition store.
    gids.fill(8, 1);
    primaryDef.slot = 7;
    return { slot: 9, hash: 'secondary', def: { ...primaryDef, id: 23, slot: 9 } };
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
      epoch: 1, distances: [0, 0], primary: new Uint8Array(64).fill(1),
    }),
  };
  const applySnapshot = jest.fn();
  registerColorCycleBrushLayerSnapshotRuntime(brush, { apply: applySnapshot });
  jest.mocked(finalizeMarkGradientSession).mockReturnValue({
    markId: 'sampled', layerId: layer.id, markKind: 'stroke', gradientKind: 'linear', source: 'sampled',
    frozenStopsStored: stops, frozenHash: 'sampled', binding: { kind: 'def', defId: 22, slot: 6 },
    sampledAlignment: { bandPx: 1, pairedInks: true, speedCps: 0.063 },
    sampledSecondaryStops: stops, speedCps: 0.063,
  });
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
    expect(allocatorSpy).toHaveBeenCalledTimes(1);
    expect(applySnapshot).toHaveBeenCalledTimes(1);
    const applied = applySnapshot.mock.calls[0][1];
    expect([...new Uint8Array(applied.gradientIdBuffer)]).toEqual([TEMP_SAMPLE_SLOT, ...Array(63).fill(8)]);
    expect(brush.bindGradientDefIdToSlot).toHaveBeenCalledWith(layer.id, 22, 7, undefined, TEMP_SAMPLE_SLOT);
  } finally {
    stateSpy.mockRestore();
    allocatorSpy.mockRestore();
  }
});
