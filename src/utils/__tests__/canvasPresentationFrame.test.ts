import { getCanvasPresentationFrame, setCanvasPresentationFrame } from '../canvasPresentationFrame';
import { dispatchCanvasFrameUpdate } from '@/hooks/canvas/handlers/animation/animationRuntime';

jest.mock('@/hooks/canvas/handlers/animation/animationRuntime', () => ({ dispatchCanvasFrameUpdate: jest.fn() }));

afterEach(() => { setCanvasPresentationFrame(null); jest.clearAllMocks(); });

test('a presentation belongs only to its project and clearing it requests the original painting', () => {
  const canvas = document.createElement('canvas');
  setCanvasPresentationFrame({ projectId: 'one', canvas });
  expect(getCanvasPresentationFrame('one')).toBe(canvas);
  expect(getCanvasPresentationFrame('two')).toBeNull();
  setCanvasPresentationFrame(null);
  expect(getCanvasPresentationFrame('one')).toBeNull();
  expect(dispatchCanvasFrameUpdate).toHaveBeenCalledTimes(2);
});
