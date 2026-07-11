import { performCanvasUndo } from '@/components/canvas/useDrawingCanvasKeyboard';

describe('performCanvasUndo', () => {
  it('cancels an active direction-selection operation before consulting history', async () => {
    const cancelActiveOperations = jest.fn(() => true);
    const canUndo = jest.fn(() => false);
    const undo = jest.fn(async () => undefined);

    await performCanvasUndo({ cancelActiveOperations, canUndo, undo });

    expect(cancelActiveOperations).toHaveBeenCalledWith({
      includeFloatingPaste: false,
      dispatchInteractionEnd: true,
    });
    expect(canUndo).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
  });

  it('replays history when no active operation needs cancellation', async () => {
    const cancelActiveOperations = jest.fn(() => false);
    const canUndo = jest.fn(() => true);
    const undo = jest.fn(async () => undefined);

    await performCanvasUndo({ cancelActiveOperations, canUndo, undo });

    expect(canUndo).toHaveBeenCalledTimes(1);
    expect(undo).toHaveBeenCalledTimes(1);
  });
});
