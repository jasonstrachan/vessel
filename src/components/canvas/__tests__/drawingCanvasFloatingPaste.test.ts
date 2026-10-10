import {
  drawFloatingPasteMarquee,
  renderFloatingPasteLayerOverlay,
} from '../drawingCanvasFloatingPaste';
import { strokeMarqueeRect } from '@/utils/marqueeStroke';

jest.mock('@/utils/marqueeStroke', () => ({
  strokeMarqueePath: jest.fn(),
  strokeMarqueeRect: jest.fn(),
}));

describe('drawFloatingPasteMarquee', () => {
  it('draws the outline at display size without scaling its stroke', () => {
    const ctx = {
      save: jest.fn(),
      restore: jest.fn(),
      translate: jest.fn(),
      rotate: jest.fn(),
      scale: jest.fn(),
    } as unknown as CanvasRenderingContext2D;

    drawFloatingPasteMarquee({
      ctx,
      floatingPaste: {
        imageData: {} as ImageData,
        position: { x: 10, y: 20 },
        width: 10,
        height: 6,
        displayWidth: 40,
        displayHeight: 18,
        rotation: 0,
      },
      contextIsWorldTransformed: true,
      scale: 12,
      offsetX: 0,
      offsetY: 0,
      marchingAntsOffset: 0,
    });

    expect(ctx.scale).not.toHaveBeenCalled();
    expect(strokeMarqueeRect).toHaveBeenCalledWith(
      ctx,
      0,
      0,
      40,
      18,
      expect.objectContaining({ scale: 12 }),
    );
  });
});

describe('renderFloatingPasteLayerOverlay', () => {
  it('combines an existing live layer overlay with the floating paste bitmap', () => {
    const base = document.createElement('canvas');
    base.width = 2;
    base.height = 1;
    const baseContext = base.getContext('2d');
    baseContext!.fillStyle = '#ff0000';
    baseContext!.fillRect(0, 0, 2, 1);
    const imageData = new ImageData(1, 1);
    imageData.data.set([0, 255, 0, 255]);
    const outputCanvas = document.createElement('canvas');
    const outputContext = outputCanvas.getContext('2d', { willReadFrequently: true });
    const drawImage = jest.spyOn(outputContext!, 'drawImage');
    const outputCanvasRef = { current: outputCanvas as HTMLCanvasElement | null };

    const output = renderFloatingPasteLayerOverlay({
      outputCanvasRef,
      baseOverlay: base,
      floatingPaste: {
        imageData,
        position: { x: 1, y: 0 },
        width: 1,
        height: 1,
      },
      project: { width: 2, height: 1 },
      pasteCanvasRef: { current: null },
      lastPasteInfoRef: { current: { imageData: null, width: 0, height: 0 } },
      activeCanvasShape: null,
      applyCanvasShapeClip: jest.fn(),
    });

    expect(output).toBe(outputCanvas);
    expect(drawImage).toHaveBeenCalledWith(base, 0, 0);
    expect(drawImage).toHaveBeenCalledTimes(2);
  });
});

describe('indexed floating replacement coverage', () => {
  const rasterGlobals = globalThis as typeof globalThis & {
    __VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__?: boolean;
  };
  beforeEach(() => { rasterGlobals.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true; });
  afterEach(() => {
    delete rasterGlobals.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__;
    jest.restoreAllMocks();
  });

  it.each([
    { label: 'unscaled', displayWidth: 4, displayHeight: 1, rotation: 0, clears: [[1, 1, 2, 1]] },
    { label: 'scaled', displayWidth: 8, displayHeight: 2, rotation: 0, clears: [[1, 1, 4, 1], [1, 2, 4, 1]] },
    { label: 'quarter turn', displayWidth: 4, displayHeight: 2, rotation: 90, clears: [[2, 0, 2, 1], [2, 1, 2, 1]] },
  ])('clears occupied members independently of covered alpha: $label', ({ displayWidth, displayHeight, rotation, clears }) => {
    const base = document.createElement('canvas');
    base.width = 10;
    base.height = 6;
    const baseContext = base.getContext('2d')!;
    baseContext.fillStyle = '#ff0000';
    baseContext.fillRect(0, 0, 10, 6);
    const before = baseContext.getImageData(0, 0, 10, 6).data.slice();
    const imageData = new ImageData(4, 1);
    imageData.data.set([0, 255, 0, 128], 4);
    // First member is fully erased; second has fractional coverage. The remaining
    // cells are a selection hole and an empty indexed cell, respectively.
    const membership = new Uint8Array([255, 1, 0, 255]);
    const indices = new Uint8Array([163, 100, 200, 0]);
    const outputCanvas = document.createElement('canvas');
    const context = outputCanvas.getContext('2d')!;
    const clear = jest.spyOn(context, 'clearRect');
    const options = {
      outputCanvasRef: { current: outputCanvas },
      baseColorCycleCanvas: base,
      floatingPaste: {
        imageData, position: { x: 1, y: 1 }, width: 4, height: 1,
        displayWidth, displayHeight, rotation,
        colorCycleIndices: indices,
        colorCycleSelectionMasks: { membership, eraseAlpha: new Uint8Array([255, 127, 0, 0]), softEdgeAlpha: null },
      },
      project: { width: 10, height: 6 },
      pasteCanvasRef: { current: null },
      lastPasteInfoRef: { current: { imageData: null, width: 0, height: 0 } },
      activeCanvasShape: null,
      applyCanvasShapeClip: jest.fn(),
    };

    renderFloatingPasteLayerOverlay(options);

    // Canvas mock does not implement source-over; assert hand-authored removal
    // geometry here and leave blended alpha/holes to production browser checks.
    expect(clear.mock.calls.slice(1)).toEqual(clears);
    expect(Array.from(context.getImageData(9, 5, 1, 1).data)).toEqual([255, 0, 0, 255]);
    expect(baseContext.getImageData(0, 0, 10, 6).data).toEqual(before);
    expect(indices).toEqual(new Uint8Array([163, 100, 200, 0]));
    expect(membership).toEqual(new Uint8Array([255, 1, 0, 255]));
    expect(imageData.data[7]).toBe(128);
  });
});


describe('floating layer shape authority', () => {
  it.each([true, false])('defers shape clipping only for a full indexed replacement (%s)', (indexed) => {
    const clip = jest.fn();
    renderFloatingPasteLayerOverlay({
      outputCanvasRef: { current: null },
      baseColorCycleCanvas: indexed ? document.createElement('canvas') : null,
      floatingPaste: {
        imageData: new ImageData(1, 1), position: { x: 1, y: 1 }, width: 1, height: 1,
        ...(indexed ? { colorCycleIndices: new Uint8Array([1]), colorCycleSelectionMasks: { membership: new Uint8Array([255]) } } : {}),
      },
      project: { width: 4, height: 4 }, pasteCanvasRef: { current: null },
      lastPasteInfoRef: { current: { imageData: null, width: 0, height: 0 } },
      activeCanvasShape: { kind: 'circle', center: { x: 2, y: 2 }, radius: 1.5, bounds: { x: 0.5, y: 0.5, width: 3, height: 3 } },
      applyCanvasShapeClip: clip,
    });
    expect(clip).toHaveBeenCalledTimes(indexed ? 0 : 1);
  });
});
