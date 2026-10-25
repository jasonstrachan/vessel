import { RecolorEngine } from '../RecolorEngine';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

let mockFailGPU = false;
let mockLostGPU = false;
let mockLoseDuringRender = false;
const mockRecolorUploads = jest.fn();
jest.mock('../rendering/WebGLColorCycleRenderer', () => ({
  WebGLColorCycleRenderer: class {
    static isSupported() { return true; }
    canvas = document.createElement('canvas');
    palette = new Uint8Array(1024);
    indices: Uint8Array = new Uint8Array();
    alpha: Uint8Array | undefined;
    constructor({ width, height }: { width: number; height: number }) { this.resize(width, height); }
    resize(width: number, height: number) { this.canvas.width = width; this.canvas.height = height; }
    setPaletteColors(bytes: Uint8Array) { this.palette = bytes.slice(); }
    setIndexData(bytes: Uint8Array) { this.indices = bytes; }
    setRecolorData(bytes: Uint8Array, alpha?: Uint8Array) {
      mockRecolorUploads(bytes.slice(), alpha?.slice()); this.indices = bytes; this.alpha = alpha;
    }
    render() {
      if (mockLoseDuringRender) mockLostGPU = true;
      if (mockFailGPU) throw Error('GPU I/O failed');
      const image = new ImageData(this.canvas.width, this.canvas.height);
      for (let i = 0; i < this.indices.length; i++) {
        image.data.set(this.palette.slice(this.indices[i] * 4, this.indices[i] * 4 + 4), i * 4);
        if (this.alpha) image.data[i * 4 + 3] = Math.round(image.data[i * 4 + 3] * this.alpha[i] / 255);
      }
      this.canvas.getContext('2d')!.putImageData(image, 0, 0);
    }
    isContextLost() { return mockLostGPU; }
    getCanvas() { return this.canvas; }
    dispose() {}
  },
}));

const layer = (id: string, width = 3): Layer => ({
  id, name: id, layerType: 'color-cycle', visible: true, opacity: 1, locked: false,
  blendMode: 'source-over', order: 0, alignment: createDefaultLayerAlignment(),
  imageData: new ImageData(width, 1), framebuffer: document.createElement('canvas'),
  colorCycleData: { mode: 'recolor', recolorSettings: {
    quantizationMode: 'rgb332', ditherMode: 'off', currentLOD: 'full', cycleColors: 16,
    gradient: [{ position: 0, color: '#ff0000' }, { position: 1, color: '#0000ff' }],
    animation: { speed: 0.1, fps: 30, ticksPerFrame: 0.05, currentTick: 0, isPlaying: false, flowDirection: 'forward' },
    indexBuffer: new Uint8Array(width).fill(12), palette: new Uint32Array(256),
    originalImageData: new ImageData(new Uint8ClampedArray(Array.from({ length: width }, (_, i) => [20, 40, 60, [0, 128, 255][i % 3]]).flat()), width, 1),
    mappingMode: 'banded', flowMapping: 'palette',
  } },
});
const pixels = (l: Layer) => Array.from(l.colorCycleData!.canvas!.getContext('2d')!.getImageData(0, 0, l.imageData!.width, 1).data);

describe('Recolor GPU source semantics and output ownership', () => {
  const rasterGlobal = globalThis as typeof globalThis & { __VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__?: boolean };
  let previousRasterize: boolean | undefined;
  beforeEach(() => { previousRasterize = rasterGlobal.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__; rasterGlobal.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true; mockFailGPU = false; mockLostGPU = false; mockLoseDuringRender = false; mockRecolorUploads.mockClear(); });
  afterEach(() => { rasterGlobal.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = previousRasterize; });
  it('transports original alpha and uses CPU palette phases for natural ticks', () => {
    const engine = new RecolorEngine(), l = layer('alpha');
    engine.renderFrame(l, 0);
    expect(mockRecolorUploads).toHaveBeenLastCalledWith(new Uint8Array([12, 12, 12]), new Uint8Array([0, 128, 255]));
    expect(pixels(l)).toEqual([64, 0, 191, 0, 64, 0, 191, 128, 64, 0, 191, 255]);
    engine.renderFrame(l, 2);
    expect(pixels(l)).toEqual([32, 0, 223, 0, 32, 0, 223, 128, 32, 0, 223, 255]);
  });
  it('keeps alternating layers, rebound metadata and separate engines output independent through resize', () => {
    const first = new RecolorEngine(), second = new RecolorEngine(), a = layer('a'), b = layer('b', 1);
    first.renderFrame(a, 0); const saved = a.colorCycleData!.canvas; const before = pixels(a);
    first.renderFrame(b, 2);
    expect(a.colorCycleData!.canvas).toBe(saved); expect(pixels(a)).toEqual(before);
    const rebound = { ...a, colorCycleData: { ...a.colorCycleData! } };
    second.renderFrame(rebound, 2);
    expect(rebound.colorCycleData.canvas).not.toBe(saved); expect(pixels(a)).toEqual(before);
    first.renderFrame(a, 4); expect(pixels(rebound)).toEqual([32, 0, 223, 0, 32, 0, 223, 128, 32, 0, 223, 255]);
    const priorA = a.colorCycleData!.canvas!, priorAPixels = Array.from(priorA.getContext('2d')!.getImageData(0, 0, 3, 1).data);
    second.renderFrame(a, 2); // Same current metadata, another Engine owns a distinct completed output.
    expect(a.colorCycleData!.canvas).not.toBe(priorA);
    expect(Array.from(priorA.getContext('2d')!.getImageData(0, 0, 3, 1).data)).toEqual(priorAPixels);
    const oldB = b.colorCycleData!.canvas!, oldBPixels = Array.from(oldB.getContext('2d')!.getImageData(0, 0, 1, 1).data);
    const metadata = b.colorCycleData!;
    b.imageData = new ImageData(2, 1);
    metadata.recolorSettings!.indexBuffer = new Uint8Array([12, 12]);
    metadata.recolorSettings!.originalImageData = new ImageData(new Uint8ClampedArray([10, 20, 30, 128, 40, 50, 60, 255]), 2, 1);
    first.renderFrame(b, 2);
    expect(b.colorCycleData).toBe(metadata);
    expect(b.colorCycleData!.canvas).not.toBe(oldB);
    expect([b.colorCycleData!.canvas!.width, b.colorCycleData!.canvas!.height]).toEqual([2, 1]);
    expect(pixels(b)).toEqual([32, 0, 223, 128, 32, 0, 223, 255]);
    expect([oldB.width, oldB.height]).toEqual([1, 1]);
    expect(Array.from(oldB.getContext('2d')!.getImageData(0, 0, 1, 1).data)).toEqual(oldBPixels);
    expect(Array.from(priorA.getContext('2d')!.getImageData(0, 0, 3, 1).data)).toEqual(priorAPixels);
    expect(pixels(rebound)).toEqual([32, 0, 223, 0, 32, 0, 223, 128, 32, 0, 223, 255]);
  });
  it.each([
    ['reverse', 'banded', 2, 96, 159],
    ['pingpong', 'banded', 2, 32, 223],
    ['bounce', 'banded', 6, 32, 223],
    ['forward', 'continuous', 2, 211, 44],
  ] as const)('shares literal %s/%s phase semantics at tick%s', (flow, mapping, tick, red, blue) => {
    const engine = new RecolorEngine(), l = layer('phase', 1), settings = l.colorCycleData!.recolorSettings!;
    settings.animation.flowDirection = flow; settings.mappingMode = mapping;
    settings.originalImageData!.data[3] = 255;
    engine.renderFrame(l, tick);
    expect(pixels(l)).toEqual([red, 0, blue, 255]);
  });
  it('uses the shared directional phase source rather than palette indices', () => {
    const engine = new RecolorEngine(), l = layer('direction'), settings = l.colorCycleData!.recolorSettings!;
    settings.flowMapping = 'directional'; settings.mappingMode = 'continuous'; settings.directionAngle = 0; settings.bandWidthPx = 2;
    engine.renderFrame(l, 0);
    expect(mockRecolorUploads).toHaveBeenLastCalledWith(new Uint8Array([0, 128, 0]), new Uint8Array([0, 128, 255]));
    expect(pixels(l)).toEqual([255, 0, 0, 0, 127, 0, 128, 128, 255, 0, 0, 255]);
  });
  it('uses shared luminance phases from the original image', () => {
    const engine = new RecolorEngine(), l = layer('luminance'), settings = l.colorCycleData!.recolorSettings!;
    settings.flowMapping = 'luminance'; settings.mappingMode = 'continuous';
    settings.originalImageData!.data.set([0, 0, 0, 0, 255, 255, 255, 128, 255, 0, 0, 255]);
    engine.renderFrame(l, 0);
    expect(mockRecolorUploads).toHaveBeenLastCalledWith(new Uint8Array([0, 255, 54]), new Uint8Array([0, 128, 255]));
    expect(pixels(l)).toEqual([255, 0, 0, 0, 255, 0, 0, 128, 201, 0, 54, 255]);
  });
  it.each([[0, [0, 0, 0]], [0.5, [0, 64, 128]], [1, [0, 128, 255]]] as const)('multiplies source alpha by public gradient opacity%s in GPU and CPU fallback', (opacity, alphas) => {
    const l = layer('transparent'), settings = l.colorCycleData!.recolorSettings!;
    settings.gradient = [{ position: 0, color: '#ff0000', opacity }, { position: 1, color: '#ff0000', opacity }];
    const engine = new RecolorEngine(); engine.renderFrame(l, 0);
    expect(pixels(l).filter((_, i) => i % 4 === 3)).toEqual(alphas);
    mockFailGPU = true;
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try { expect(Array.from(engine.renderFrame(l, 0)!.data).filter((_, i) => i % 4 === 3)).toEqual(alphas); }
    finally { error.mockRestore(); }
  });
  it('combines parsed CSS alpha with stop opacity and source alpha', () => {
    const l = layer('css-alpha'), settings = l.colorCycleData!.recolorSettings!;
    settings.gradient = [{ position: 0, color: 'rgba(255,0,0,0.5)', opacity: 0.5 }];
    new RecolorEngine().renderFrame(l, 0);
    expect(pixels(l).filter((_, i) => i % 4 === 3)).toEqual([0, 32, 64]);
  });
  it('retains palette alpha when original alpha is absent and uses an explicit index phase map', () => {
    const l = layer('phase-map', 1), settings = l.colorCycleData!.recolorSettings!;
    settings.originalImageData = undefined;
    settings.mappingMode = 'continuous'; settings.indexPhaseMap = new Uint8Array(256); settings.indexPhaseMap[12] = 64;
    settings.gradient = [{ position: 0, color: '#ff0000', opacity: 0.5 }, { position: 1, color: '#0000ff', opacity: 0.5 }];
    new RecolorEngine().renderFrame(l, 2);
    expect(mockRecolorUploads).toHaveBeenLastCalledWith(new Uint8Array([12]), undefined);
    expect(pixels(l)).toEqual([159, 0, 96, 128]);
  });
  it.each(['before', 'during'] as const)('falls back when context is lost %s rendering without publishing stale GPU pixels', (phase) => {
    const engine = new RecolorEngine(), l = layer('lost'); engine.renderFrame(l, 0);
    const stale = l.colorCycleData!.canvas;
    if (phase === 'before') mockLostGPU = true;
    else mockLoseDuringRender = true;
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const cpu = engine.renderFrame(l, 2);
      expect(cpu?.data).toEqual(new Uint8ClampedArray([32, 0, 223, 0, 32, 0, 223, 128, 32, 0, 223, 255]));
      expect(l.colorCycleData!.canvas).toBeUndefined();
      expect(stale).toBeDefined();
    } finally { error.mockRestore(); }
  });
  it('falls back to CPU without publishing stale scratch output', () => {
    const engine = new RecolorEngine(), l = layer('fallback'); engine.renderFrame(l, 0);
    mockFailGPU = true;
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const actual = engine.renderFrame(l, 2);
      expect(actual?.data).toEqual(new Uint8ClampedArray([32, 0, 223, 0, 32, 0, 223, 128, 32, 0, 223, 255]));
      expect(l.colorCycleData!.canvas).toBeUndefined();
    } finally { error.mockRestore(); }
  });
});
