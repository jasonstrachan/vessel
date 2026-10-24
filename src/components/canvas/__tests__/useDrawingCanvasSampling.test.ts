import { act, renderHook } from '@testing-library/react';
import type React from 'react';

import { useDrawingCanvasSampling } from '@/components/canvas/useDrawingCanvasSampling';
import { BrushShape, type Layer, type Project } from '@/types';
import { drawVisibleCompositeStack } from '@/components/canvas/drawingCanvasCompositeStack';
import { useDrawingCanvasRenderSetupBridge } from '@/components/canvas/useDrawingCanvasRenderSetupBridge';
import type { CompositeSegment } from '@/stores/slices/layersSlice';
import { withCanvasSamplingBatch } from '@/utils/canvasSamplingBatch';
import { setSequentialFrameCursor } from '@/runtime/playback/sequentialFrameCursor';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const fillCanvas = (canvas: HTMLCanvasElement, color: string): void => {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Expected Canvas2D context');
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
};

const createCanvas = (color: string): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  fillCanvas(canvas, color);
  return canvas;
};

const createCcLayer = ({
  runtimeCanvas,
  framebuffer,
  imageData,
  visible = true,
}: {
  runtimeCanvas: HTMLCanvasElement;
  framebuffer: HTMLCanvasElement;
  imageData: ImageData;
  visible?: boolean;
}): Layer => ({
  id: 'cc-reference',
  name: 'CC Reference',
  visible,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  order: 0,
  imageData,
  framebuffer,
  alignment: createDefaultLayerAlignment(),
  layerType: 'color-cycle',
  colorCycleData: {
    canvas: runtimeCanvas,
    runtimeHydrationState: 'warm',
  },
});

const createLastSampleRef = (): React.MutableRefObject<{
  x: number;
  y: number;
  color: string;
  layerId: string | null;
  preferReference: boolean;
}> => ({
  current: {
    x: -1,
    y: -1,
    color: '#000000',
    layerId: null,
    preferReference: true,
  },
});

describe('useDrawingCanvasSampling', () => {
  it('samples the live CC presentation instead of stale layer raster data', () => {
    const runtimeCanvas = createCanvas('#123456');
    const framebuffer = createCanvas('#ff0000');
    const imageData = framebuffer.getContext('2d')!.getImageData(0, 0, 2, 2);
    const layer = createCcLayer({ runtimeCanvas, framebuffer, imageData, visible: false });
    const compositeCanvasRef = { current: createCanvas('#ffffff') };
    const lastSampleRef = createLastSampleRef();

    const { result } = renderHook(() => useDrawingCanvasSampling({
      compositeCanvasRef,
      lastSampleRef,
      layers: [layer],
      referenceLayerId: layer.id,
      preferReferenceSampling: true,
    }));

    expect(result.current.sampleColorAtPosition(0, 0)).toBe('#123456');
  });

  it('does not reuse a stale same-coordinate sample from an animated CC reference', () => {
    const runtimeCanvas = createCanvas('#112233');
    const framebuffer = createCanvas('#ff0000');
    const imageData = framebuffer.getContext('2d')!.getImageData(0, 0, 2, 2);
    const layer = createCcLayer({ runtimeCanvas, framebuffer, imageData });
    const compositeCanvasRef = { current: createCanvas('#ffffff') };
    const lastSampleRef = createLastSampleRef();

    const { result } = renderHook(() => useDrawingCanvasSampling({
      compositeCanvasRef,
      lastSampleRef,
      layers: [layer],
      referenceLayerId: layer.id,
      preferReferenceSampling: true,
    }));

    expect(result.current.sampleColorAtPosition(1, 1)).toBe('#112233');
    act(() => fillCanvas(runtimeCanvas, '#44aa66'));
    expect(result.current.sampleColorAtPosition(1, 1)).toBe('#44aa66');
  });

  it('does not reuse a stale same-coordinate sample from a hidden regular reference', () => {
    const referenceRaster = createCanvas('#112233');
    const imageData = referenceRaster.getContext('2d')!.getImageData(0, 0, 2, 2);
    const layer: Layer = {
      id: 'regular-reference',
      name: 'Regular Reference',
      visible: false,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData,
      framebuffer: undefined as unknown as HTMLCanvasElement,
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal',
    };
    const compositeCanvasRef = { current: createCanvas('#ffffff') };
    const lastSampleRef = createLastSampleRef();

    const { result } = renderHook(() => useDrawingCanvasSampling({
      compositeCanvasRef,
      lastSampleRef,
      layers: [layer],
      referenceLayerId: layer.id,
      preferReferenceSampling: true,
    }));

    expect(result.current.sampleColorAtPosition(1, 1)).toBe('#112233');
    imageData.data.set([68, 170, 102, 255], (1 * imageData.width + 1) * 4);
    expect(result.current.sampleColorAtPosition(1, 1)).toBe('#44aa66');
  });

  it('samples persisted pixels from a hidden regular reference with a blank framebuffer', () => {
    const referenceRaster = createCanvas('#123456');
    const imageData = referenceRaster.getContext('2d')!.getImageData(0, 0, 2, 2);
    const layer: Layer = {
      id: 'regular-reference',
      name: 'Regular Reference',
      visible: false,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData,
      framebuffer: createCanvas('rgba(0, 0, 0, 0)'),
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal',
    };
    const compositeCanvasRef = { current: createCanvas('#ffffff') };
    const lastSampleRef = createLastSampleRef();

    const { result } = renderHook(() => useDrawingCanvasSampling({
      compositeCanvasRef,
      lastSampleRef,
      layers: [layer],
      referenceLayerId: layer.id,
      preferReferenceSampling: true,
    }));

    expect(result.current.sampleColorAtPosition(1, 1)).toBe('#123456');
  });
});


const mockSamplingState = jest.fn();
const mockSequenceCanvas = jest.fn<HTMLCanvasElement | null, [{ frameIndex: number }]>();

jest.mock('@/stores/useAppStore', () => ({
  selectSequentialPlaybackActive: () => false,
  useAppStore: { getState: () => mockSamplingState() },
}));
jest.mock('@/lib/sequential/SequentialLayerRenderer', () => ({
  getSequentialLayerRenderCanvas: (options: { frameIndex: number }) => mockSequenceCanvas(options),
}));
jest.mock('@/lib/sequential/SequentialLivePreviewRuntime', () => ({
  getSequentialLivePreviewFrame: () => null,
}));

// The shared Canvas double omits transform, clipping and compositing. Supply those
// Canvas I/O operations here; the production stack, presentation and sampler stay real.
const installRegionalCanvasIO = () => {
  const original = HTMLCanvasElement.prototype.getContext;
  const decorated = new WeakSet<CanvasRenderingContext2D>();
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
    ...args: [contextId: string, options?: unknown]
  ) {
    const context = Reflect.apply(original, this, args) as CanvasRenderingContext2D | null;
    if (!context || args[0] !== '2d' || decorated.has(context)) return context;
    decorated.add(context);
    context.globalCompositeOperation = 'source-over';
    let offset = { x: 0, y: 0 };
    type ClipRect = { x: number; y: number; width: number; height: number };
    let clip: ClipRect | null = null;
    let path: ClipRect | null = null;
    const stack: Array<{ offset: typeof offset; clip: ClipRect | null; alpha: number; blend: GlobalCompositeOperation }> = [];
    jest.spyOn(context, 'save').mockImplementation(() => {
      stack.push({ offset: { ...offset }, clip, alpha: context.globalAlpha, blend: context.globalCompositeOperation });
    });
    jest.spyOn(context, 'restore').mockImplementation(() => {
      const previous = stack.pop();
      if (!previous) throw Error('Unbalanced Canvas restore');
      offset = previous.offset; clip = previous.clip;
      context.globalAlpha = previous.alpha; context.globalCompositeOperation = previous.blend;
    });
    jest.spyOn(context, 'translate').mockImplementation((x, y) => { offset = { x: offset.x + x, y: offset.y + y }; });
    jest.spyOn(context, 'beginPath').mockImplementation(() => { path = null; });
    jest.spyOn(context, 'rect').mockImplementation((x, y, width, height) => { path = { x: x + offset.x, y: y + offset.y, width, height }; });
    jest.spyOn(context, 'clip').mockImplementation(() => { clip = path; });
    jest.spyOn(context, 'drawImage').mockImplementation((source: CanvasImageSource, ...values: number[]) => {
      if (!(source instanceof HTMLCanvasElement)) throw Error('Expected actual source canvas');
      const sourceContext = source.getContext('2d')!;
      const [sx, sy, sw, sh, dx, dy, dw, dh] = values.length === 8 ? values
        : [0, 0, source.width, source.height, values[0], values[1], values[2] ?? source.width, values[3] ?? source.height];
      const pixels = sourceContext.getImageData(sx, sy, sw, sh).data;
      const target = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
      for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
        const tx = Math.floor(dx + offset.x + x), ty = Math.floor(dy + offset.y + y);
        if (tx < 0 || ty < 0 || tx >= target.width || ty >= target.height ||
          (clip && (tx < clip.x || ty < clip.y || tx >= clip.x + clip.width || ty >= clip.y + clip.height))) continue;
        const si = (Math.floor(y * sh / dh) * sw + Math.floor(x * sw / dw)) * 4;
        const ti = (ty * target.width + tx) * 4;
        const sa = pixels[si + 3] / 255 * context.globalAlpha, da = target.data[ti + 3] / 255;
        const operation = context.globalCompositeOperation;
        const oa = operation === 'destination-out' ? da * (1 - sa) : operation === 'destination-in' ? da * sa : sa + da * (1 - sa);
        for (let channel = 0; channel < 3; channel++) {
          const s = pixels[si + channel], d = target.data[ti + channel];
          const blend = operation === 'multiply' ? s * d / 255 : s;
          target.data[ti + channel] = oa === 0 ? 0 : operation.startsWith('destination-') ? d
            : (sa * ((1 - da) * s + da * blend) + (1 - sa) * da * d) / oa;
        }
        target.data[ti + 3] = oa * 255;
      }
      context.putImageData(target, 0, 0);
    });
    return context;
  } as HTMLCanvasElement['getContext']);
};

const sceneCanvas = (color: string) => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 12;
  fillCanvas(canvas, color); return canvas;
};
const canvasBytes = (canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data];
const sceneLayer = (id: string, overrides: Partial<Layer> = {}): Layer => ({
  id, name: id, visible: true, locked: false, opacity: 1, blendMode: 'source-over', order: 0,
  alignment: createDefaultLayerAlignment(), imageData: null, framebuffer: sceneCanvas('transparent'), layerType: 'normal', ...overrides,
});

const createSamplingScene = (kind: 'color-cycle' | 'sequential') => {
  const blue = sceneCanvas('#0000ff'), staticCanvas = sceneCanvas('#ffffff');
  const dynamic = sceneLayer('animated', kind === 'color-cycle'
    ? { layerType: kind, colorCycleData: { canvas: blue, runtimeHydrationState: 'warm' } }
    : { layerType: kind, sequentialData: { frameCount: 2, fps: 1, durationMs: 2000, events: [] } });
  const active = sceneLayer('normal', { order: 1 });
  const layers = [dynamic, active];
  const project: Project = { id: 'sampling', name: 'sampling', width: 12, height: 12, layers, backgroundColor: 'transparent', customBrushes: [], createdAt: new Date(0), updatedAt: new Date(0) };
  const state = { project, layers, activeLayerId: active.id, layerGroups: [], colorCyclePlayback: { desiredPlaying: false }, sequentialRecord: { currentFrame: 0, isPointerDown: false }, history: { undo: ['unchanged'] }, currentCompositeBitmap: { id: 'unchanged-bitmap' }, setCurrentCompositeBitmap: jest.fn() };
  setSequentialFrameCursor({ nextFrame: 0, nextFrameCount: 2, nextFps: 1 });
  mockSamplingState.mockImplementation(() => state);
  mockSequenceCanvas.mockReturnValue(blue);
  const segments: CompositeSegment[] = [{ kind, id: 'animated-segment', layerId: dynamic.id, opacity: 1, blendMode: 'source-over' }];
  const layerMapRef = { current: new Map(layers.map(layer => [layer.id, layer])) };
  const compositeSegmentsRef = { current: segments };
  const drawNonActiveVisibleLayers = jest.fn((ctx: CanvasRenderingContext2D) => ctx.drawImage(blue, 0, 0));
  const renderSamplingComposite = jest.fn((ctx: CanvasRenderingContext2D, rect: { x: number; y: number; width: number; height: number }) => {
    drawVisibleCompositeStack({ ctx, visibleRect: rect, useSplitOverlay: false, underCompositeCanvas: null, isActivelyErasing: false, drawNonActiveVisibleLayers, segments: compositeSegmentsRef.current, layerMap: layerMapRef.current, compositeBitmap: null, compositeCanvas: staticCanvas });
  });
  const options = { compositeCanvasRef: { current: staticCanvas }, lastSampleRef: createLastSampleRef(), layers, referenceLayerId: null, preferReferenceSampling: false, renderSamplingComposite };
  return { kind, blue, staticCanvas, dynamic, active, layers, project, state, compositeSegmentsRef, layerMapRef, renderSamplingComposite, drawNonActiveVisibleLayers, options };
};

const bridgeOptions = (scene: ReturnType<typeof createSamplingScene>): Parameters<typeof useDrawingCanvasRenderSetupBridge>[0] => {
  const shared = { project: scene.project, layers: scene.layers, activeLayerId: scene.state.activeLayerId, brushShape: BrushShape.SQUARE, antialiasing: false, displayMode: 'pixelated' as const, layerTransferCacheRef: { current: new Map() } };
  return {
    layers: scene.layers, referenceLayerId: null, preferReferenceSampling: false, referenceAssets: [], referenceSamplingSource: { kind: 'canvas' }, compositeCanvasRef: scene.options.compositeCanvasRef,
    compositeBuffersOptions: { ...shared, compositeCanvasRef: scene.options.compositeCanvasRef, underCompositeCanvasRef: { current: null }, overCompositeCanvasRef: { current: null }, underCompositeHasContentRef: { current: false }, overCompositeHasContentRef: { current: false }, renderStaticComposite: jest.fn(() => true), setCurrentOffscreenCanvas: jest.fn() },
    layerRenderingOptions: shared,
    baseRendererOptions: { ...shared, compositeCanvasRef: scene.options.compositeCanvasRef, activeCanvasShape: null, canvasShapeEditor: { active: false, draft: null }, checkerPatternCanvasRef: { current: null }, checkerPatternCacheRef: { current: new WeakMap() }, displayFilters: [], transparencyBackgroundMode: 'checker', frameColor: '#000000', currentTool: 'color-picker', underCompositeCanvasRef: { current: null }, underCompositeHasContentRef: { current: false }, compositeCanvasDirtyRef: { current: false }, compositeSegmentsRef: scene.compositeSegmentsRef, layerMapRef: scene.layerMapRef, compositeBitmap: null, overCompositeHasContentRef: { current: false }, overCompositeCanvasRef: { current: null }, colorCycleManagerRef: { current: null }, floatingPaste: null, marchingAntsOffset: 0, pasteCanvasRef: { current: null }, lastPasteInfoRef: { current: { imageData: null, width: 0, height: 0 } }, selectionStart: null, selectionEnd: null, selectionMask: null, selectionMaskBounds: null, selectionVectorPath: null },
  };
};

describe('visible project Canvas sampling through the real composite stack', () => {
  beforeEach(() => { installRegionalCanvasIO(); mockSequenceCanvas.mockReset(); });
  afterEach(() => { jest.restoreAllMocks(); });

  it.each(['color-cycle', 'sequential'] as const)('samples visible %s blue instead of the white static cache without modifying sources', kind => {
    const scene = createSamplingScene(kind), original = canvasBytes(scene.staticCanvas), source = canvasBytes(scene.blue), history = JSON.stringify(scene.state.history), bitmap = scene.state.currentCompositeBitmap;
    const { result } = renderHook(() => useDrawingCanvasSampling(scene.options));
    expect(result.current.sampleColorAtPosition(6, 6)).toBe('#0000ff');
    const ctx = scene.renderSamplingComposite.mock.calls[0][0];
    expect([ctx.canvas.width, ctx.canvas.height]).toEqual([3, 3]);
    expect(scene.renderSamplingComposite.mock.calls[0][1]).toEqual({ x: 5, y: 5, width: 3, height: 3 });
    expect(canvasBytes(scene.staticCanvas)).toEqual(original); expect(canvasBytes(scene.blue)).toEqual(source);
    expect(JSON.stringify(scene.state.history)).toBe(history);
    expect(scene.state.currentCompositeBitmap).toBe(bitmap);
    expect(scene.state.setCurrentCompositeBitmap).not.toHaveBeenCalled();
    expect(scene.options.compositeCanvasRef.current).toBe(scene.staticCanvas);
  });

  it('reads the current sequence frame again at the same coordinate', () => {
    const scene = createSamplingScene('sequential'), red = sceneCanvas('#ff0000');
    mockSequenceCanvas.mockImplementation(({ frameIndex }) => frameIndex === 0 ? scene.blue : red);
    const { result } = renderHook(() => useDrawingCanvasSampling(scene.options));
    expect(result.current.sampleColorAtPosition(6, 6)).toBe('#0000ff');
    scene.state.sequentialRecord.currentFrame = 1;
    setSequentialFrameCursor({ nextFrame: 1, nextFrameCount: 2, nextFps: 1 });
    expect(result.current.sampleColorAtPosition(6, 6)).toBe('#ff0000');
  });

  it('reads different fresh scratch regions inside one Canvas sampling batch', () => {
    const scene = createSamplingScene('color-cycle');
    const ctx = scene.blue.getContext('2d')!; ctx.fillStyle = '#ff0000'; ctx.fillRect(8, 0, 4, 12);
    const { result } = renderHook(() => useDrawingCanvasSampling(scene.options));
    expect(withCanvasSamplingBatch(() => result.current.sampleColorsAlongLine(2, 6, 9, 6, 2))).toEqual(['#0000ff', '#ff0000']);
    expect(scene.renderSamplingComposite.mock.calls[0][0].canvas).toBe(scene.renderSamplingComposite.mock.calls[1][0].canvas);
  });

  it('preserves segment order, multiply blend and layer opacity in the sampled material', () => {
    const scene = createSamplingScene('color-cycle'), red = sceneCanvas('#ff0000');
    scene.compositeSegmentsRef.current.unshift({ kind: 'static', id: 'under', layerIds: ['red'], includeBackground: true, orderRange: { start: -1, end: -1 }, canvas: red, bitmap: null, dirty: false });
    const cc = scene.compositeSegmentsRef.current[1];
    if (cc.kind !== 'color-cycle') throw Error('Expected Color Cycle segment');
    cc.opacity = .5; cc.blendMode = 'multiply';
    const { result } = renderHook(() => useDrawingCanvasSampling(scene.options));
    expect(result.current.sampleColorAtPosition(6, 6)).toBe('#800000');
    scene.compositeSegmentsRef.current.reverse();
    expect(result.current.sampleColorAtPosition(6, 6)).toBe('#ff0000');
  });

  it('uses the real Color Cycle erase mask and transparent-reference Canvas fallback', () => {
    const scene = createSamplingScene('color-cycle'), erase = sceneCanvas('transparent');
    erase.getContext('2d')!.fillStyle = '#ffffff'; erase.getContext('2d')!.fillRect(4, 4, 5, 5);
    scene.dynamic.colorCycleData!.eraseMask = erase;
    const reference = sceneLayer('reference', { visible: false });
    scene.layers.push(reference);
    const options = { ...scene.options, referenceLayerId: reference.id, preferReferenceSampling: true };
    const { result } = renderHook(() => useDrawingCanvasSampling(options));
    expect(result.current.sampleColorAtPosition(6, 6)).toBe('#ffffff');
    expect(result.current.sampleColorAtPosition(1, 1)).toBe('#0000ff');
    expect(canvasBytes(scene.blue)).toEqual(Array.from({ length: 144 }, () => [0, 0, 255, 255]).flat());
  });

  it('keeps a nontransparent designated reference authoritative over visible animation', () => {
    const scene = createSamplingScene('color-cycle'), reference = sceneLayer('reference', { visible: false, framebuffer: sceneCanvas('#00ff00') });
    scene.layers.push(reference);
    const { result } = renderHook(() => useDrawingCanvasSampling({ ...scene.options, referenceLayerId: reference.id, preferReferenceSampling: true }));
    expect(result.current.sampleColorAtPosition(6, 6)).toBe('#00ff00');
    expect(scene.renderSamplingComposite).not.toHaveBeenCalled();
  });

  it('wires production render setup to the same real segment and layer-map refs', () => {
    const scene = createSamplingScene('color-cycle'), options = bridgeOptions(scene);
    const { result } = renderHook(() => useDrawingCanvasRenderSetupBridge(options));
    expect(result.current.sampleColorAtPosition(6, 6)).toBe('#0000ff');
    scene.layerMapRef.current = new Map([[scene.dynamic.id, { ...scene.dynamic, visible: false }]]);
    expect(result.current.sampleColorAtPosition(6, 6)).toBe('#ffffff');
    expect(options.compositeBuffersOptions.renderStaticComposite).not.toHaveBeenCalled();
    expect(options.compositeBuffersOptions.setCurrentOffscreenCanvas).not.toHaveBeenCalled();
  });

  it('keeps project-coordinate clipping in the no-segment active-sequence fallback', () => {
    const scene = createSamplingScene('sequential');
    scene.state.activeLayerId = scene.dynamic.id; scene.state.sequentialRecord.isPointerDown = true;
    scene.compositeSegmentsRef.current = [];
    // The captured sequence is transparent here; the blue nonactive normal layer
    // can reach the small sampling surface only through the existing world clip.
    scene.active.framebuffer = scene.blue;
    mockSequenceCanvas.mockReturnValue(sceneCanvas('transparent'));
    const { result } = renderHook(() => useDrawingCanvasRenderSetupBridge(bridgeOptions(scene)));
    expect(result.current.sampleColorAtPosition(6, 6)).toBe('#0000ff');
    expect(scene.options.compositeCanvasRef.current).toBe(scene.staticCanvas);
  });
});
