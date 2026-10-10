import type { HistoryDelta } from '@/history/actionTypes';
import { createBitmapTileDelta } from '@/history/deltas/bitmapDelta';
import { finalizeEraserStroke } from '@/hooks/canvas/handlers/eraserFinalize';
import { prepareStrokeCapture } from '@/hooks/canvas/handlers/strokeCapture';
import {
  boundingBoxToCaptureRegion,
  rectToCaptureRegion,
  unionCaptureRegions,
} from '@/hooks/canvas/utils/captureRegions';
import { captureLayerRegionImageData } from '@/hooks/canvas/utils/snapshots';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';

describe('stroke capture at canvas boundaries', () => {
  const originalLayers = useAppStore.getState().layers;
  const originalActiveLayerId = useAppStore.getState().activeLayerId;

  afterEach(() => {
    useAppStore.setState({ layers: originalLayers, activeLayerId: originalActiveLayerId });
  });

  it.each([
    { x: 1, y: 1 },
    { x: 62, y: 1 },
    { x: 1, y: 62 },
    { x: 62, y: 62 },
  ])('keeps pixels outside a corner erase intact through undo/redo at $x,$y', async ({ x, y }) => {
    const before = new ImageData(64, 64);
    for (let pixel = 0; pixel < 64 * 64; pixel += 1) {
      before.data[pixel * 4] = 255;
      before.data[pixel * 4 + 3] = 255;
    }
    const layer = { id: 'edge-eraser', layerType: 'normal', imageData: before } as Layer;
    const eraserRoi = { x: x - 12, y: y - 12, width: 24, height: 24 };
    const expectedRoi = rectToCaptureRegion(eraserRoi, 0, { width: 64, height: 64 })!;
    const capture = await prepareStrokeCapture({
      activeLayer: layer,
      project: { width: 64, height: 64 },
      drawingCanvas: null,
      overlayHasContent: true,
      strokeBoundingBox: null,
      strokeCapturePadding: 0,
      roiPadding: 0,
      engineStrokeBounds: null,
      captureRegionOverride: eraserRoi,
      layerBeforeImage: null,
      skipSave: false,
    }, {
      boundingBoxToCaptureRegion,
      rectToCaptureRegion,
      unionCaptureRegions,
      captureLayerRegionImageData,
      ensureLayerSnapshotWithRetry: jest.fn(async () => null),
      logError: jest.fn(),
    });
    expect(capture.captureRoi).toEqual(expectedRoi);
    expect(capture.layerBeforeImage?.width).toBe(expectedRoi.width);
    expect(capture.layerBeforeImage?.height).toBe(expectedRoi.height);

    const after = new ImageData(new Uint8ClampedArray(before.data), 64, 64);
    const erasedAlphaOffset = (y * 64 + x) * 4 + 3;
    const outsideAlphaOffset = (30 * 64 + 30) * 4 + 3;
    after.data[erasedAlphaOffset] = 127;
    const drawingCanvas = document.createElement('canvas');
    drawingCanvas.width = 64;
    drawingCanvas.height = 64;
    const deltas: HistoryDelta[] = [];

    await finalizeEraserStroke({
      activeLayer: layer,
      activeLayerId: layer.id,
      drawingCanvas,
      layerBeforeImage: capture.layerBeforeImage,
      layerBeforeColorState: null,
      captureRoi: capture.captureRoi,
      eraserRoi,
      isEraserV2: true,
      skipSave: false,
    }, {
      captureCanvasToActiveLayer: async () => {
        useAppStore.setState({ layers: [{ ...layer, imageData: after }], activeLayerId: layer.id });
      },
      scheduleHistoryCommit: async (payload) => {
        expect(payload.bitmapRoi).toEqual(expectedRoi);
        const delta = await createBitmapTileDelta({
          layerId: layer.id,
          before: payload.beforeImage,
          after,
          roi: payload.bitmapRoi ?? undefined,
        });
        if (delta) deltas.push(delta);
      },
      withTiming: async (_label, task) => task(),
      logError: jest.fn(),
    });
    const delta = deltas[0];
    expect(delta).toBeDefined();
    if (!delta) throw new Error('Expected an eraser history delta');
    try {
      await (await delta.prepare('backward')).apply();
      const undone = useAppStore.getState().layers[0].imageData!;
      expect(undone.data[erasedAlphaOffset]).toBe(255);
      expect(undone.data[outsideAlphaOffset]).toBe(255);

      await (await delta.prepare('forward')).apply();
      const redone = useAppStore.getState().layers[0].imageData!;
      expect(redone.data[erasedAlphaOffset]).toBe(127);
      expect(redone.data[outsideAlphaOffset]).toBe(255);
    } finally {
      delta.dispose?.();
    }
  });
});
