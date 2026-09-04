import {
  applyColorCycleFillEraseMask,
  createColorCycleFillMask,
  fillColorCycleLayer,
  type ColorCycleFloodFillDeps,
} from '@/hooks/canvas/handlers/fillTool';
import type { EventHandlerDynamicDeps } from '@/hooks/canvas/utils/types';
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
