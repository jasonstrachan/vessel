import { MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM } from '@/constants/canvas';
import { useAppStore } from '@/stores/useAppStore';

describe('canvas slice invariants', () => {
  const reset = () => {
    useAppStore.setState({
      canvas: { ...useAppStore.getState().canvas, zoom: 1, offsetX: 0, offsetY: 0, showRulers: false, showFPSMeter: true },
      canvasViewport: { left: 0, top: 0, width: 0, height: 0 },
    });
  };

  afterEach(() => {
    reset();
  });

  it('clamps zoom between MIN and MAX', () => {
    useAppStore.getState().setZoom(0.01);
    expect(useAppStore.getState().canvas.zoom).toBe(MIN_CANVAS_ZOOM);

    useAppStore.getState().setZoom(100);
    expect(useAppStore.getState().canvas.zoom).toBe(MAX_CANVAS_ZOOM);
  });

  it('avoids needless updates when offset is unchanged', () => {
    const before = useAppStore.getState().canvas;
    useAppStore.getState().setCanvasOffset(0, 0);
    expect(useAppStore.getState().canvas).toBe(before);

    useAppStore.getState().setCanvasOffset(10, -5);
    expect(useAppStore.getState().canvas).not.toBe(before);
    expect(useAppStore.getState().canvas.offsetX).toBe(10);
    expect(useAppStore.getState().canvas.offsetY).toBe(-5);
  });

  it('skips viewport updates when values match', () => {
    const before = useAppStore.getState().canvasViewport;
    useAppStore.getState().setCanvasViewport({ left: 0, top: 0, width: 0, height: 0 });
    expect(useAppStore.getState().canvasViewport).toBe(before);

    useAppStore.getState().setCanvasViewport({ left: 1, top: 2, width: 3, height: 4 });
    expect(useAppStore.getState().canvasViewport).not.toBe(before);
    expect(useAppStore.getState().canvasViewport).toEqual({ left: 1, top: 2, width: 3, height: 4 });
  });

  it('toggles rulers visibility', () => {
    expect(useAppStore.getState().canvas.showRulers).toBe(false);
    useAppStore.getState().toggleRulers();
    expect(useAppStore.getState().canvas.showRulers).toBe(true);
  });

  it('keeps fps meter setter idempotent when unchanged', () => {
    const before = useAppStore.getState().canvas;
    useAppStore.getState().setShowFPSMeter(true);
    expect(useAppStore.getState().canvas).toBe(before);

    useAppStore.getState().setShowFPSMeter(false);
    expect(useAppStore.getState().canvas.showFPSMeter).toBe(false);
  });
});
