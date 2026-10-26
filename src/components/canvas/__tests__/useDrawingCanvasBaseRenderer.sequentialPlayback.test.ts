import { renderHook } from '@testing-library/react';

import { useDrawingCanvasBaseRenderer } from '@/components/canvas/useDrawingCanvasBaseRenderer';
import {
  advanceSequentialTransport,
  getSequentialFrameCursor,
  getSequentialLayerRenderFrame,
  setSequentialFrameCursor,
} from '@/runtime/playback/sequentialFrameCursor';
import { BrushShape, type Layer, type Project } from '@/types';

const mockGetState = jest.fn();
jest.mock('@/stores/appStoreAccess', () => ({ getAppStoreState: () => mockGetState() }));
// Transparent live overlay is an I/O boundary: the shared shim copies instead of alpha blending.
jest.mock('@/components/canvas/drawingCanvasOverlay', () => ({ drawCanvasOverlayLayer: jest.fn() }));
jest.mock('@/components/canvas/drawingCanvasSelection', () => ({ drawSelectionLayer: jest.fn() }));
jest.mock('@/utils/marqueeStroke', () => ({ strokeMarqueeRect: jest.fn(), strokeMarqueePath: jest.fn() }));

const canvas = () => {
  const value = document.createElement('canvas');
  value.width = value.height = 16;
  return value;
};
const sequence = (id: string, fps = 1, visible = true) => ({
  id, visible, opacity: 1, blendMode: 'source-over', order: 1, layerType: 'sequential',
  sequentialData: { fps, frameCount: 4, durationMs: 4000 / fps, events: [] },
} as unknown as Layer);

const mount = ({ activeSequence = false, floating = false, idleOverlay = false, clips = [sequence('seq')] } = {}) => {
  const normal = { id: 'normal', layerType: 'normal', visible: true, opacity: 1,
    blendMode: 'source-over', order: 0, framebuffer: canvas() } as Layer;
  const layers = [normal, ...clips];
  const active = activeSequence ? clips[0] : normal;
  const project = { id: 'split', width: 16, height: 16 } as Project;
  const state = {
    project, layers, layerGroups: [], activeLayerId: active.id, layersNeedRecomposition: false,
    sequentialRecord: { currentFrame: 0, isPointerDown: false },
    colorCyclePlayback: { desiredPlaying: true, suspendDepth: 1 },
  };
  mockGetState.mockImplementation(() => state);
  const under = canvas();
  const renderedFrames: number[][] = [];
  // Split-render I/O boundary: real Canvas pixels encode the actual clip input.
  // Literal expectations below independently select the known frame colors.
  const renderSplitComposites = jest.fn(() => {
    const frames = clips.filter(layer => layer.visible).map(layer => getSequentialLayerRenderFrame(state, layer));
    renderedFrames.push(frames);
    const context = under.getContext('2d')!;
    context.fillStyle = ['#ff0000', '#0000ff', '#00ff00', '#ffffff'][frames.at(-1) ?? 0];
    context.fillRect(0, 0, 16, 16);
  });
  const dirty = { current: false };
  const { result, unmount } = renderHook(() => useDrawingCanvasBaseRenderer({
    project, layers, activeLayerId: active.id, activeCanvasShape: null,
    canvasShapeEditor: { active: false, draft: null },
    checkerPatternCanvasRef: { current: null }, checkerPatternCacheRef: { current: new WeakMap() },
    brushShape: BrushShape.SQUARE, antialiasing: false, displayMode: 'pixelated', displayFilters: [],
    transparencyBackgroundMode: 'gray', frameColor: '#000000', currentTool: 'brush',
    underCompositeCanvasRef: { current: under }, underCompositeHasContentRef: { current: true },
    compositeCanvasDirtyRef: dirty, renderSplitComposites, drawNonActiveVisibleLayers: jest.fn(),
    compositeSegmentsRef: { current: [] }, layerMapRef: { current: new Map(layers.map(layer => [layer.id, layer])) },
    compositeBitmap: null, compositeCanvasRef: { current: null }, overCompositeHasContentRef: { current: false },
    overCompositeCanvasRef: { current: null }, colorCycleManagerRef: { current: null },
    floatingPaste: floating ? { imageData: new ImageData(1, 1), position: { x: 15, y: 15 }, width: 1, height: 1 } : null,
    marchingAntsOffset: 0, pasteCanvasRef: { current: null },
    lastPasteInfoRef: { current: { imageData: null, width: 0, height: 0 } },
    selectionStart: null, selectionEnd: null, selectionMask: null, selectionMaskBounds: null, selectionVectorPath: null,
  }));
  const output = canvas();
  const overlay = canvas();
  const draw = (split = true) => {
    result.current(output.getContext('2d')!, { scale: 1, offsetX: 0, offsetY: 0 }, false,
      split && !floating ? overlay : null, split && !floating && !idleOverlay, split && !floating);
    return Array.from(output.getContext('2d')!.getImageData(4, 4, 1, 1).data);
  };
  return { state, clips, draw, renderSplitComposites, renderedFrames, dirty, unmount };
};
const advance = (deltaMs: number) => advanceSequentialTransport({ deltaMs, sourceFps: 1, sourceFrameCount: 4 });

describe('split cache follows every visible Sequence clip', () => {
  const globals = globalThis as typeof globalThis & { __VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__?: boolean };
  beforeEach(() => {
    globals.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true;
    setSequentialFrameCursor({ nextFrame: 0, nextFrameCount: 4, nextFps: 1 });
  });
  afterEach(() => { delete globals.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__; jest.restoreAllMocks(); });

  it.each([false, true])('refreshes inactive clip pixels during normal edit/paste (paste %s)', floating => {
    const h = mount({ floating });
    expect(h.draw()).toEqual([255, 0, 0, 255]);
    advance(1100);
    expect(h.draw()).toEqual([0, 0, 255, 255]);
    expect(h.renderedFrames).toEqual([[0], [1]]);
    expect(h.state.colorCyclePlayback).toEqual({ desiredPlaying: true, suspendDepth: 1 });
    h.unmount();
  });

  it('refreshes a retained idle normal overlay after the final CC owner has been removed', () => {
    const h = mount({ idleOverlay: true });
    // Post-removal owner: normal active, visible Sequence, no CC, retained empty overlay.
    // isDrawing=false while drawingCanvasHasContent=true still requests split composition.
    expect(h.draw()).toEqual([255, 0, 0, 255]);
    advance(1100);
    expect(h.draw()).toEqual([0, 0, 255, 255]);
    expect(h.renderedFrames).toEqual([[0], [1]]);
    h.unmount();
  });

  it('uses each clip FPS even while global cursor and slower clip remain on the same frame', () => {
    const h = mount({ clips: [sequence('slow'), sequence('fast', 4)] });
    expect(h.draw()).toEqual([255, 0, 0, 255]);
    advance(300);
    expect(getSequentialFrameCursor().frame).toBe(0);
    expect(h.draw()).toEqual([0, 0, 255, 255]);
    expect(h.renderedFrames).toEqual([[0, 0], [0, 1]]);
    h.unmount();
  });

  it('wraps each clip at its own frame count without adopting global cursor count', () => {
    const clip = sequence('three-frame', 2);
    clip.sequentialData!.frameCount = 3;
    const h = mount({ clips: [clip] });
    h.draw(); advance(600);
    expect(h.draw()).toEqual([0, 0, 255, 255]);
    advance(1000);
    expect(getSequentialFrameCursor().frameCount).toBe(4);
    expect(h.draw()).toEqual([255, 0, 0, 255]);
    expect(h.renderedFrames).toEqual([[0], [1], [0]]);
    h.unmount();
  });

  it('drops frame dependencies when split mode ends and refreshes on reentry', () => {
    const h = mount();
    h.draw(); h.draw(false); h.draw();
    expect(h.renderSplitComposites).toHaveBeenCalledTimes(2);
    h.unmount();
  });

  it('keeps active Sequence refresh and paused editing-frame ownership', () => {
    const h = mount({ activeSequence: true });
    h.draw(); advance(1100); expect(h.draw()).toEqual([0, 0, 255, 255]);
    h.state.colorCyclePlayback.desiredPlaying = false;
    h.state.sequentialRecord.currentFrame = 3;
    expect(h.draw()).toEqual([255, 255, 255, 255]);
    h.unmount();
  });

  it('does not rebuild for unchanged frames or a hidden inactive clip', () => {
    const h = mount({ clips: [sequence('visible'), sequence('hidden', 4, false)] });
    h.draw(); advance(300); h.draw(); h.draw();
    expect(h.renderSplitComposites).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it('does not rebuild a clean normal-only cache', () => {
    const h = mount({ clips: [] });
    h.draw(); advance(1100); h.draw();
    expect(h.renderSplitComposites).not.toHaveBeenCalled();
    h.unmount();
  });

  it('does not accept failed split rebuilds into the frame dependency cache', () => {
    const h = mount();
    h.renderSplitComposites.mockImplementationOnce(() => { throw Error('I/O failed'); });
    expect(() => h.draw()).toThrow('I/O failed');
    h.draw();
    expect(h.renderSplitComposites).toHaveBeenCalledTimes(2);
    h.unmount();
  });
});
