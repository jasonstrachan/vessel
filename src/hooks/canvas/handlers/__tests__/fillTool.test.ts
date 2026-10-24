import * as colorCycleHistory from '@/history/helpers/colorCycle';
import * as layerHistory from '@/history/helpers/layerHistory';
import * as sequentialHistory from '@/history/helpers/sequentialLayerHistory';
import { waitForPendingHistoryCommits } from '@/history/pendingHistoryCommits';
import { createDefaultAdjustmentEffect } from '@/lib/adjustmentLayers';
import * as sequentialRenderer from '@/lib/sequential/SequentialLayerRenderer';
import { useAppStore } from '@/stores/useAppStore';
import {
  applyColorCycleFillEraseMask,
  createColorCycleFillMask,
  fillColorCycleLayer,
  runFillToolPointerDown,
  type ColorCycleFloodFillDeps,
} from '@/hooks/canvas/handlers/fillTool';
import type { EventHandlerDependencies, EventHandlerDynamicDeps } from '@/hooks/canvas/utils/types';
import type { AppState } from '@/stores/useAppStore';
import type { Layer, Project } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const makeImage = (pixels: Array<[number, number, number, number]>): ImageData => {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((pixel, index) => data.set(pixel, index * 4));
  return new ImageData(data, pixels.length, 1);
};

const makeLayer = (eraseMask?: HTMLCanvasElement): Layer => {
  const framebuffer = document.createElement('canvas');
  framebuffer.width = 3;
  framebuffer.height = 1;
  return {
    id: 'cc-layer',
    name: 'CC Layer',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    imageData: null,
    framebuffer,
    alignment: createDefaultLayerAlignment(),
    layerType: 'color-cycle',
    colorCycleData: {
      eraseMask,
      flowMode: 'forward',
    },
  };
};

const project = {
  id: 'project',
  name: 'Project',
  width: 3,
  height: 1,
  layers: [],
  backgroundColor: 'transparent',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  customBrushes: [],
  palette: {
    foregroundColor: '#ff0000',
    backgroundColor: '#ffffff',
    activeSlot: 'foreground',
  },
} as Project;

const makeDynamic = (
  layer: Layer,
  eraseInstead: boolean,
  selection?: Pick<EventHandlerDynamicDeps, 'selectionStart' | 'selectionEnd' | 'selectionMask' | 'selectionMaskBounds'>,
): EventHandlerDynamicDeps => ({
  project,
  canvas: { width: 3, height: 1, scale: 1, zoom: 1 },
  tools: {
    currentTool: 'fill',
    selectionMode: 'marquee',
    brushSettings: {
      color: '#ff0000',
      ccGradientSource: 'manual',
      colorCycleGradient: [
        { position: 0, color: '#112233' },
        { position: 1, color: '#ddeeff' },
      ],
      colorCycleSpeed: 0.25,
      colorCycleFlowMode: 'forward',
      colorCycleFgStops: 2,
      colorCycleFgLightness: 50,
      colorCycleFgVariance: 0,
    } as EventHandlerDynamicDeps['tools']['brushSettings'],
    fillSettings: { threshold: 0, contiguous: true, eraseInstead },
    wandSettings: { threshold: 0, contiguous: true },
    eraserSettings: {},
    shapeMode: false,
    customBrushCapture: {
      sampleAllLayers: false,
      mode: 'rectangle',
      freehandPath: null,
    },
  },
  layers: [layer],
  activeLayerId: layer.id,
  selectionStart: selection?.selectionStart ?? null,
  selectionEnd: selection?.selectionEnd ?? null,
  selectionMask: selection?.selectionMask ?? null,
  selectionMaskBounds: selection?.selectionMaskBounds ?? null,
  floatingPaste: null,
  isDraggingFloatingPaste: false,
  palette: {
    foregroundColor: '#ff0000',
    backgroundColor: '#ffffff',
    activeSlot: 'foreground',
  } as EventHandlerDynamicDeps['palette'],
  polygonGradientState: { drawingState: 'idle' } as EventHandlerDynamicDeps['polygonGradientState'],
  recolorSampling: {
    active: false,
    start: null,
    end: null,
    samples: 0,
    target: 'recolor',
  },
  currentBrushPresetId: null,
});

describe('Color Cycle flood fill', () => {
  it('builds a contiguous mask from the visible CC presentation', () => {
    const source = makeImage([
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ]);

    const mask = createColorCycleFillMask({
      source,
      point: { x: 0, y: 0 },
      threshold: 0,
      contiguous: true,
      selectionScope: { bounds: null, selectionMask: null, selectionMaskBounds: null },
      eraseInstead: false,
    });

    expect(mask).toEqual({
      data: new Uint8Array([255, 255]),
      width: 2,
      height: 1,
      bounds: { x: 0, y: 0, width: 2, height: 1 },
    });
  });

  it('writes the selected region into canonical CC buffers and heals its erase mask', () => {
    const eraseMask = document.createElement('canvas');
    eraseMask.width = 3;
    eraseMask.height = 1;
    const layer = makeLayer(eraseMask);
    const source = makeImage([
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ]);
    const writeRegion: ColorCycleFloodFillDeps['writeRegion'] = jest.fn(() => true);
    const clearEraseMask = jest.fn();
    const state = { layers: [layer] } as AppState;
    const deps: ColorCycleFloodFillDeps = {
      readPresentation: () => source,
      applyEraseMask: jest.fn(() => false),
      ensureGradientDefinition: jest.fn(() => ({
        def: {
          id: 9,
          kind: 'linear',
          stops: [
            { position: 0, color: '#ff0000' },
            { position: 1, color: '#ff0000' },
          ],
          hash: 'linear:red',
          source: 'manual',
          createdAtMs: 0,
          slot: 4,
        },
        slot: 4,
        hash: 'linear:red',
      })),
      requestGradientApply: jest.fn(),
      flushGradientApply: jest.fn(),
      getState: () => state,
      writeRegion,
      clearEraseMask,
    };

    const bounds = fillColorCycleLayer({
      layer,
      project,
      dynamic: makeDynamic(layer, false),
      point: { x: 0, y: 0 },
    }, deps);

    expect(bounds).toEqual({ x: 0, y: 0, width: 2, height: 1 });
    expect(deps.ensureGradientDefinition).toHaveBeenCalledWith(expect.objectContaining({
      source: 'manual',
      stops: [
        { position: 0, color: '#112233' },
        { position: 1, color: '#ddeeff' },
      ],
    }));
    expect(writeRegion).toHaveBeenCalledWith(
      state,
      layer,
      project,
      { x: 0, y: 0, width: 2, height: 1 },
      new Uint8Array([1, 1]),
      2,
      1,
      expect.objectContaining({
        alphaData: new Uint8Array([255, 255]),
        alphaStride: 1,
        gradientSlot: 4,
        sourceGradientIds: new Uint8Array([4, 4]),
        sourceGradientDefIds: new Uint16Array([9, 9]),
      }),
    );
    expect(clearEraseMask).toHaveBeenCalledWith(
      state,
      layer.id,
      expect.objectContaining({ data: new Uint8Array([255, 255]) }),
    );
  });

  it('preserves picked CC pixel motion when filling with its runtime palette', () => {
    const layer = makeLayer();
    const source = makeImage([
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ]);
    const writeRegion: ColorCycleFloodFillDeps['writeRegion'] = jest.fn(() => true);
    const state = { layers: [layer] } as AppState;
    const deps: ColorCycleFloodFillDeps = {
      readPresentation: () => source,
      applyEraseMask: jest.fn(() => false),
      ensureGradientDefinition: jest.fn(() => ({
        def: {
          id: 9,
          kind: 'linear',
          stops: [
            { position: 0, color: '#ff0000' },
            { position: 1, color: '#ff0000' },
          ],
          hash: 'linear:red',
          source: 'manual',
          createdAtMs: 0,
          slot: 4,
        },
        slot: 4,
        hash: 'linear:red',
      })),
      requestGradientApply: jest.fn(),
      flushGradientApply: jest.fn(),
      getState: () => state,
      writeRegion,
      clearEraseMask: jest.fn(),
    };
    const dynamic = makeDynamic(layer, false);
    dynamic.tools.brushSettings.colorCycleGradientIsRuntimePalette = true;
    dynamic.tools.brushSettings.colorCycleSampledMotion = {
      phaseByte: 91,
      speedByte: 17,
      flowByte: 2,
    };

    fillColorCycleLayer({
      layer,
      project,
      dynamic,
      point: { x: 0, y: 0 },
    }, deps);

    expect(writeRegion).toHaveBeenCalledWith(
      state,
      layer,
      project,
      { x: 0, y: 0, width: 2, height: 1 },
      new Uint8Array([1, 1]),
      2,
      1,
      expect.objectContaining({
        sourceSpeed: new Uint8Array([17, 17]),
        sourceFlow: new Uint8Array([2, 2]),
        sourcePhase: new Uint8Array([91, 91]),
      }),
    );
  });

  it('fills the erase mask only where selected CC pixels are visible', () => {
    const layer = makeLayer();
    const source = makeImage([
      [255, 0, 0, 255],
      [0, 0, 0, 0],
      [0, 0, 255, 255],
    ]);
    const applyEraseMask = jest.fn(() => true);
    const deps: ColorCycleFloodFillDeps = {
      readPresentation: () => source,
      applyEraseMask,
      ensureGradientDefinition: jest.fn(() => null),
      requestGradientApply: jest.fn(),
      flushGradientApply: jest.fn(),
      getState: () => ({ layers: [layer] } as AppState),
      writeRegion: jest.fn(() => false),
      clearEraseMask: jest.fn(),
    };

    const bounds = fillColorCycleLayer({
      layer,
      project,
      dynamic: makeDynamic(layer, true, {
        selectionStart: { x: 0, y: 0 },
        selectionEnd: { x: 3, y: 1 },
        selectionMask: null,
        selectionMaskBounds: null,
      }),
      point: { x: 1, y: 0 },
    }, deps);

    expect(bounds).toEqual({ x: 0, y: 0, width: 3, height: 1 });
    expect(applyEraseMask).toHaveBeenCalledWith(layer.id, {
      data: new Uint8Array([255, 0, 255]),
      width: 3,
      height: 1,
      bounds: { x: 0, y: 0, width: 3, height: 1 },
    });
    expect(deps.writeRegion).not.toHaveBeenCalled();
  });

  it('adds flood erase pixels without clearing an existing mask inside the ROI', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 3;
    canvas.height = 1;
    const initial = new ImageData(3, 1);
    initial.data[7] = 255;
    canvas.getContext('2d', { willReadFrequently: true })?.putImageData(initial, 0, 0);
    const bumpVersion = jest.fn();

    const changed = applyColorCycleFillEraseMask('cc-layer', {
      data: new Uint8Array([255, 0, 255]),
      width: 3,
      height: 1,
      bounds: { x: 0, y: 0, width: 3, height: 1 },
    }, {
      getMask: () => canvas,
      bumpVersion,
    });

    const result = canvas.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, 3, 1);
    expect(changed).toBe(true);
    expect([result?.data[3], result?.data[7], result?.data[11]]).toEqual([255, 255, 255]);
    expect(bumpVersion).toHaveBeenCalledWith('cc-layer');
  });
});


describe('Fill target admission before reading or authoring', () => {
  beforeEach(() => {
    jest.spyOn(colorCycleHistory, 'captureColorCycleBrushState').mockReturnValue(null);
    jest.spyOn(layerHistory, 'commitLayerHistory').mockResolvedValue(undefined);
    jest.spyOn(sequentialHistory, 'commitSequentialLayerHistory').mockResolvedValue(undefined);
    jest.spyOn(sequentialRenderer, 'getSequentialLayerRenderCanvas').mockReturnValue(null);
    jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  });

  afterEach(async () => {
    await waitForPendingHistoryCommits();
    jest.restoreAllMocks();
  });

  const fixture = (type: NonNullable<Layer['layerType']>, visible: boolean, locked: boolean) => {
    const width = type === 'adjustment' ? 1 : 3;
    const framebuffer = document.createElement('canvas');
    framebuffer.width = width;
    framebuffer.height = 1;
    const context = framebuffer.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Missing real Fill target Canvas I/O');
    const source = makeImage(Array.from({ length: width }, () => [0, 0, 255, 255]));
    context.putImageData(source, 0, 0);
    const layer: Layer = {
      ...makeLayer(),
      id: `entry-${type}`,
      layerType: type,
      visible,
      locked,
      framebuffer,
      imageData: source,
      colorCycleData: type === 'color-cycle'
        ? { ...makeLayer().colorCycleData, canvas: document.createElement('canvas') }
        : undefined,
      sequentialData: type === 'sequential'
        ? { frameCount: 1, fps: 1, durationMs: 1000, events: [], eventChunks: [] }
        : undefined,
      adjustmentData: type === 'adjustment'
        ? { effect: createDefaultAdjustmentEffect() }
        : undefined,
    };
    // A complete real store baseline supplies every dynamic field; no partial AppState cast.
    const state = useAppStore.getState();
    const dynamic: EventHandlerDynamicDeps = {
      project,
      canvas: { width: project.width, height: project.height, scale: 1, zoom: 1 },
      tools: {
        ...state.tools,
        currentTool: 'fill',
        fillSettings: { threshold: 0, contiguous: true, eraseInstead: type === 'color-cycle' },
      },
      layers: [layer],
      activeLayerId: layer.id,
      selectionStart: null,
      selectionEnd: null,
      selectionMask: null,
      selectionMaskBounds: null,
      floatingPaste: null,
      isDraggingFloatingPaste: false,
      palette: { ...state.palette, foregroundColor: '#ff0000', activeSlot: 'foreground' },
      polygonGradientState: state.polygonGradientState,
      recolorSampling: state.recolorSampling,
      currentBrushPresetId: state.currentBrushPreset?.id ?? null,
    };
    const updateLayer = jest.fn<ReturnType<EventHandlerDependencies['updateLayer']>, Parameters<EventHandlerDependencies['updateLayer']>>();
    // Fill dispatch consumes these three static I/O fields; a null composite skips display I/O.
    const io: Pick<EventHandlerDependencies, 'updateLayer' | 'compositeCanvasDirtyRef' | 'compositeCanvasRef'> = {
      updateLayer,
      compositeCanvasDirtyRef: { current: false },
      compositeCanvasRef: { current: null },
    };
    const readPixels = jest.spyOn(context, 'getImageData');
    const writePixels = jest.spyOn(context, 'putImageData');
    return { layer, dynamic, io, updateLayer, readPixels, writePixels, framebuffer, context, source };
  };

  it.each([
    { type: 'normal', visible: false, locked: false, label: 'hidden normal' },
    { type: 'normal', visible: true, locked: true, label: 'locked normal' },
    { type: 'color-cycle', visible: false, locked: false, label: 'hidden CC' },
    { type: 'color-cycle', visible: true, locked: true, label: 'locked CC' },
    { type: 'sequential', visible: false, locked: false, label: 'hidden sequential' },
    { type: 'sequential', visible: true, locked: true, label: 'locked sequential' },
    { type: 'adjustment', visible: true, locked: false, label: 'visible unlocked adjustment' },
  ] as const)('rejects $label before raster reads, CC capture, sequence materialization or history', ({ type, visible, locked }) => {
    const f = fixture(type, visible, locked);
    const before = new Uint8ClampedArray(f.source.data);
    const dimensions = [f.framebuffer.width, f.framebuffer.height];

    runFillToolPointerDown({
      deps: f.io as EventHandlerDependencies,
      dynamic: f.dynamic,
      worldPos: { x: 0, y: 0 },
    });

    expect(f.updateLayer).not.toHaveBeenCalled();
    expect(f.readPixels).not.toHaveBeenCalled();
    expect(f.writePixels).not.toHaveBeenCalled();
    expect(colorCycleHistory.captureColorCycleBrushState).not.toHaveBeenCalled();
    expect(sequentialRenderer.getSequentialLayerRenderCanvas).not.toHaveBeenCalled();
    expect(layerHistory.commitLayerHistory).not.toHaveBeenCalled();
    expect(sequentialHistory.commitSequentialLayerHistory).not.toHaveBeenCalled();
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(f.io.compositeCanvasDirtyRef.current).toBe(false);
    expect([f.framebuffer.width, f.framebuffer.height]).toEqual(dimensions);
    expect(f.layer.imageData).toBe(f.source);
    expect(f.source.data).toEqual(before);
  });

  it('still admits visible unlocked normal Fill with real raster output and one history request', async () => {
    const f = fixture('normal', true, false);
    runFillToolPointerDown({
      deps: f.io as EventHandlerDependencies,
      dynamic: f.dynamic,
      worldPos: { x: 0, y: 0 },
    });
    await waitForPendingHistoryCommits();

    const expected = makeImage([[255, 0, 0, 255], [255, 0, 0, 255], [255, 0, 0, 255]]);
    expect(f.context.getImageData(0, 0, 3, 1).data).toEqual(expected.data);
    expect(f.updateLayer).toHaveBeenCalledTimes(1);
    expect(f.updateLayer).toHaveBeenCalledWith(f.layer.id, { imageData: expected }, {
      dirtyRects: [{ x: 0, y: 0, width: 3, height: 1 }],
    });
    expect(layerHistory.commitLayerHistory).toHaveBeenCalledTimes(1);
    expect(sequentialHistory.commitSequentialLayerHistory).not.toHaveBeenCalled();
    expect(colorCycleHistory.captureColorCycleBrushState).not.toHaveBeenCalled();
    expect(f.io.compositeCanvasDirtyRef.current).toBe(true);
  });

  it.each([
    { type: 'normal', side: 'left' },
    { type: 'normal', side: 'right' },
    { type: 'color-cycle', side: 'left' },
    { type: 'color-cycle', side: 'right' },
    { type: 'sequential', side: 'left' },
    { type: 'sequential', side: 'right' },
  ] as const)('rejects explicit $side selection with no image intersection on $type before any source or authoring I/O', ({ type, side }) => {
    const f = fixture(type, true, false);
    const start = { x: side === 'left' ? -2 : 5, y: 0 };
    const end = { x: side === 'left' ? 0 : 3, y: 1 };
    f.dynamic.selectionStart = start;
    f.dynamic.selectionEnd = end;
    const before = new Uint8ClampedArray(f.source.data);

    runFillToolPointerDown({
      deps: f.io as EventHandlerDependencies,
      dynamic: f.dynamic,
      worldPos: { x: 0, y: 0 },
    });

    expect(f.updateLayer).not.toHaveBeenCalled();
    expect(f.readPixels).not.toHaveBeenCalled();
    expect(f.writePixels).not.toHaveBeenCalled();
    expect(colorCycleHistory.captureColorCycleBrushState).not.toHaveBeenCalled();
    expect(sequentialRenderer.getSequentialLayerRenderCanvas).not.toHaveBeenCalled();
    expect(layerHistory.commitLayerHistory).not.toHaveBeenCalled();
    expect(sequentialHistory.commitSequentialLayerHistory).not.toHaveBeenCalled();
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(f.io.compositeCanvasDirtyRef.current).toBe(false);
    expect(f.source.data).toEqual(before);
    expect(f.dynamic.selectionStart).toBe(start);
    expect(f.dynamic.selectionEnd).toBe(end);
  });

  it('admits a partly overlapping explicit selection and fills only its original one-pixel intersection', async () => {
    const f = fixture('normal', true, false);
    f.dynamic.selectionStart = { x: -1, y: 0 };
    f.dynamic.selectionEnd = { x: 1, y: 1 };
    runFillToolPointerDown({
      deps: f.io as EventHandlerDependencies,
      dynamic: f.dynamic,
      worldPos: { x: 0, y: 0 },
    });
    await waitForPendingHistoryCommits();

    const expected = makeImage([[255, 0, 0, 255], [0, 0, 255, 255], [0, 0, 255, 255]]);
    expect(f.context.getImageData(0, 0, 3, 1).data).toEqual(expected.data);
    expect(f.updateLayer).toHaveBeenCalledTimes(1);
    expect(f.updateLayer).toHaveBeenCalledWith(f.layer.id, { imageData: expected }, {
      dirtyRects: [{ x: 0, y: 0, width: 1, height: 1 }],
    });
    expect(layerHistory.commitLayerHistory).toHaveBeenCalledTimes(1);
    expect(colorCycleHistory.captureColorCycleBrushState).not.toHaveBeenCalled();
    expect(sequentialHistory.commitSequentialLayerHistory).not.toHaveBeenCalled();
    expect(f.dynamic.selectionStart).toEqual({ x: -1, y: 0 });
    expect(f.dynamic.selectionEnd).toEqual({ x: 1, y: 1 });
  });

});
