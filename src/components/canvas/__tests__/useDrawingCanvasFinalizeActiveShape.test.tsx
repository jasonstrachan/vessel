import { act, renderHook } from '@testing-library/react';

import { useDrawingCanvasFinalizeActiveShape } from '@/components/canvas/useDrawingCanvasFinalizeActiveShape';
import { useAppStore } from '@/stores/useAppStore';
import { registerToolFlush, unregisterToolFlush } from '@/utils/toolFlushRegistry';

const COMMIT_KEY = 'shape-tool:shape-fill-commit';
const OTHER_KEY = 'shape-enter-test:unrelated';
const originalState = useAppStore.getState();
type Options = Parameters<typeof useDrawingCanvasFinalizeActiveShape>[0];

const beginSession = () => {
  const store = useAppStore.getState();
  store.setShapeFillActiveFill('hatch');
  store.setShapeFillParamValue('hatch', 'thickness', 4);
  store.beginShapeFillSession([{ x: 8, y: 8 }, { x: 40, y: 8 }, { x: 40, y: 40 }, { x: 8, y: 40 }]);
  return useAppStore.getState().shapeFill.session;
};

const mount = (overrides: Partial<Options> = {}) => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const options: Options = {
    finalizeRectangleGradientFromState: jest.fn<Promise<boolean>, []>().mockResolvedValue(true),
    drawingHandlers: {
      initDrawingCanvas: jest.fn(), drawingCanvasRef: { current: canvas },
      drawingCanvasHasContent: { current: false },
      finalizeDrawing: jest.fn<Promise<void>, [boolean]>().mockResolvedValue(undefined),
      isDrawingShapeRef: { current: false },
      finalizeShapeDrawing: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    },
    sampleColorAtPosition: jest.fn(() => '#000000'),
    stateMachine: { finalizationComplete: jest.fn() },
    overlayCanvasRef: { current: null },
    rebuildStaticComposite: jest.fn(() => false), compositeCanvasDirtyRef: { current: true },
    setNeedsRedraw: jest.fn(), interactionDispatch: jest.fn(), tools: { shapeMode: false },
    ...overrides,
  };
  const hook = renderHook(() => useDrawingCanvasFinalizeActiveShape(options));
  return { ...hook, options };
};

describe('Shape Pattern keyboard finalization ownership', () => {
  beforeEach(() => {
    useAppStore.getState().cancelShapeFillSession();
    useAppStore.setState(originalState, true);
  });
  afterEach(() => {
    unregisterToolFlush(COMMIT_KEY);
    unregisterToolFlush(OTHER_KEY);
    useAppStore.getState().cancelShapeFillSession();
    useAppStore.setState(originalState, true);
  });

  it('awaits only the active ShapeFill owner without finalizing or painting through the stale canvas path', async () => {
    const session = beginSession();
    let release = () => {};
    const owner = jest.fn(async () => { await new Promise<void>(resolve => { release = resolve; }); });
    const other = jest.fn();
    registerToolFlush(COMMIT_KEY, owner, { passive: false });
    registerToolFlush(OTHER_KEY, other, { passive: false });
    const { result, options } = mount();
    let pending: Promise<boolean> | undefined;
    await act(async () => { pending = result.current(); await Promise.resolve(); });
    expect(owner).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    expect(useAppStore.getState().shapeFill.session).toBe(session);
    expect(options.drawingHandlers.finalizeDrawing).not.toHaveBeenCalled();
    expect(options.sampleColorAtPosition).not.toHaveBeenCalled();
    expect(options.drawingHandlers.drawingCanvasHasContent.current).toBe(false);
    release();
    await act(async () => { await expect(pending).resolves.toBe(true); });
  });

  it('reports a missing owner without consuming the draft or publishing existing preview pixels', async () => {
    const session = beginSession();
    const { result, options } = mount();
    await act(async () => { await expect(result.current()).resolves.toBe(false); });
    expect(useAppStore.getState().shapeFill.session).toBe(session);
    expect(options.drawingHandlers.finalizeDrawing).not.toHaveBeenCalled();
    expect(options.stateMachine.finalizationComplete).not.toHaveBeenCalled();
  });

  it('propagates owner failure and preserves the draft instead of falling back to stale raster publication', async () => {
    const session = beginSession(), error = new Error('Shape commit rejected');
    registerToolFlush(COMMIT_KEY, async () => { throw error; }, { passive: false });
    const { result, options } = mount();
    await act(async () => { await expect(result.current()).rejects.toBe(error); });
    expect(useAppStore.getState().shapeFill.session).toBe(session);
    expect(options.drawingHandlers.finalizeDrawing).not.toHaveBeenCalled();
  });

  it('retains Rectangle finalization priority over other shape sessions', async () => {
    beginSession();
    useAppStore.getState().setRectangleBrushState({ drawingState: 'definingWidth' });
    const owner = jest.fn();
    registerToolFlush(COMMIT_KEY, owner, { passive: false });
    const { result, options } = mount();
    await act(async () => { await expect(result.current()).resolves.toBe(true); });
    expect(options.finalizeRectangleGradientFromState).toHaveBeenCalledTimes(1);
    expect(owner).not.toHaveBeenCalled();
  });

  it('retains ordinary shape finalization and interaction cleanup', async () => {
    const { result, options } = mount({ tools: { shapeMode: true } });
    options.drawingHandlers.isDrawingShapeRef.current = true;
    await act(async () => { await expect(result.current()).resolves.toBe(true); });
    expect(options.drawingHandlers.finalizeShapeDrawing).toHaveBeenCalledTimes(1);
    expect(options.stateMachine.finalizationComplete).toHaveBeenCalledTimes(1);
    expect(options.interactionDispatch).toHaveBeenCalledWith({ type: 'DRAWING_END' });
  });

  it('leaves an idle canvas unhandled', async () => {
    const { result, options } = mount();
    await act(async () => { await expect(result.current()).resolves.toBe(false); });
    expect(options.drawingHandlers.finalizeDrawing).not.toHaveBeenCalled();
    expect(options.drawingHandlers.finalizeShapeDrawing).not.toHaveBeenCalled();
  });
});
