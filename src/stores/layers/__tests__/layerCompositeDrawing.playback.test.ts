import { createLayerCompositeDrawing } from '../layerCompositeDrawing';
import { DEFAULT_INTERLACE_SETTINGS } from '@/lib/interlace/interlaceSettings';
import { selectEffectiveColorCyclePlaying } from '@/runtime/playback/playbackSelectors';
import type { AppState } from '@/stores/useAppStore';
import type { ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type { Layer, Project } from '@/types';

jest.mock('@/lib/interlace/interlaceRenderer', () => ({ drawSierraLiteInterlace: jest.fn() }));

jest.mock('@/stores/layers/layerColorCycleMaskState', () => ({
  prepareColorCycleCompositeSource: jest.fn((_layer, canvas) => canvas),
}));

describe('Color Cycle composite playback authority', () => {
  it.each(['stack', 'overlay'] as const)('%s follows global play, suspend and pause despite stale layer flags', (path) => {
    let playing = false;
    const brush = {
      isPlaying: () => playing,
      startAnimation: jest.fn(() => { playing = true; }),
      stopAnimation: jest.fn(() => { playing = false; }),
      updateAnimation: jest.fn(),
      renderDirectToCanvas: jest.fn(),
    };
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    const layer = {
      id: 'cc', visible: true, layerType: 'color-cycle', opacity: 1,
      blendMode: 'source-over', framebuffer: canvas,
      colorCycleData: { mode: 'brush', canvas, isAnimating: true },
    } as Layer;
    const project = { width: 2, height: 2, layers: [layer] } as Project;
    const state = {
      layers: [layer], activeLayerId: null,
      colorCyclePlayback: { desiredPlaying: false, suspendDepth: 0 },
    } as AppState;
    const manager = { getSurfaceBrush: () => brush } as unknown as ColorCycleBrushManager;
    const drawing = createLayerCompositeDrawing({
      getEffectiveColorCyclePlaying: () => selectEffectiveColorCyclePlaying(state),
      createLayerTransferCanvas: () => null,
      hasValidFramebuffer: (value): value is HTMLCanvasElement => Boolean(value),
    });
    const ctx = canvas.getContext('2d')!;
    const draw = () => path === 'stack'
      ? drawing.drawAllLayersInOrder(ctx, [layer], project, manager, 0)
      : drawing.drawColorCycleLayers(ctx, [layer], project, manager);

    draw();
    expect(brush.startAnimation).not.toHaveBeenCalled();
    expect(brush.updateAnimation).not.toHaveBeenCalled();
    layer.colorCycleData!.isAnimating = false;
    state.colorCyclePlayback.desiredPlaying = true;
    draw();
    expect(playing).toBe(true);
    expect(brush.updateAnimation).toHaveBeenCalledTimes(1);
    state.colorCyclePlayback.suspendDepth = 1;
    layer.colorCycleData!.isAnimating = true;
    draw();
    expect(playing).toBe(false);
    expect(brush.updateAnimation).toHaveBeenCalledTimes(1);
    state.colorCyclePlayback.suspendDepth = 0;
    draw();
    expect(playing).toBe(true);
    expect(brush.updateAnimation).toHaveBeenCalledTimes(2);
    state.colorCyclePlayback.desiredPlaying = false;
    draw();
    expect(playing).toBe(false);
    expect(brush.updateAnimation).toHaveBeenCalledTimes(2);
    expect(brush.renderDirectToCanvas).toHaveBeenCalledTimes(5);
  });
  it('does not advance interlaced Color Cycle sources while globally suspended', () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    const layers = ['a', 'b'].map(id => ({
      id, visible: true, layerType: 'color-cycle', groupId: 'interlace',
      opacity: 1, blendMode: 'source-over',
      colorCycleData: { mode: 'brush', canvas, isAnimating: true },
    } as Layer));
    const project = {
      width: 2, height: 2, layers,
      layerGroups: [{ id: 'interlace', kind: 'interlace', interlace: DEFAULT_INTERLACE_SETTINGS }],
    } as Project;
    const state = {
      layers, activeLayerId: null,
      colorCyclePlayback: { desiredPlaying: true, suspendDepth: 1 },
    } as AppState;
    const brush = { updateAnimation: jest.fn(), renderDirectToCanvas: jest.fn() };
    const manager = { getSurfaceBrush: () => brush } as unknown as ColorCycleBrushManager;
    const drawing = createLayerCompositeDrawing({
      getEffectiveColorCyclePlaying: () => selectEffectiveColorCyclePlaying(state),
      createLayerTransferCanvas: () => null,
      hasValidFramebuffer: (value): value is HTMLCanvasElement => Boolean(value),
    });
    drawing.drawAllLayersInOrder(canvas.getContext('2d')!, layers, project, manager, 0);
    expect(brush.updateAnimation).not.toHaveBeenCalled();
    state.colorCyclePlayback.suspendDepth = 0;
    layers.forEach(layer => { layer.colorCycleData!.isAnimating = false; });
    drawing.drawAllLayersInOrder(canvas.getContext('2d')!, layers, project, manager, 0);
    expect(brush.updateAnimation).toHaveBeenCalledTimes(2);
  });

});
