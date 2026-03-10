import { createClipboardHandlers } from '@/hooks/canvas/handlers/clipboardHandlers';
import type { EventHandlerDependencies } from '@/hooks/canvas/utils/types';

type ClipboardDeps = EventHandlerDependencies;

const createDeps = (): ClipboardDeps => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;

  return {
    getViewportPastePosition: jest.fn(() => ({ x: 10, y: 12 })),
    selectionClipboardRef: { current: null },
    dynamicDepsRef: {
      current: {
        project: { width: 64, height: 64 },
        floatingPaste: null,
      },
    },
    commitFloatingPaste: jest.fn().mockResolvedValue(undefined),
    clearSelection: jest.fn(),
    setFloatingPaste: jest.fn(),
    canvasRef: { current: canvas },
    viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
    draw: jest.fn(),
  } as unknown as ClipboardDeps;
};

describe('createClipboardHandlers', () => {
  it('prefers internal clipboard payload with CC indices over image clipboard items', async () => {
    const deps = createDeps();
    const ccIndices = new Uint8Array([5, 6, 7, 8]);
    const ccGradientIds = new Uint8Array([9, 10, 11, 12]);
    const ccGradientDefIds = new Uint16Array([101, 102, 103, 104]);
    const ccSpeed = new Uint8Array([13, 14, 15, 16]);
    const ccFlow = new Uint8Array([17, 18, 19, 20]);
    deps.selectionClipboardRef = {
      current: {
        imageData: new ImageData(2, 2),
        position: { x: 1, y: 2 },
        width: 2,
        height: 2,
        mode: 'copy',
        colorCycleIndices: ccIndices,
        colorCycleGradientIds: ccGradientIds,
        colorCycleGradientDefIds: ccGradientDefIds,
        colorCycleSpeed: ccSpeed,
        colorCycleFlow: ccFlow,
        colorCycleSourceLayerId: 'layer-cc',
      },
    } as ClipboardDeps['selectionClipboardRef'];

    const getAsFile = jest.fn(() => new Blob(['fake'], { type: 'image/png' }));
    const event = {
      preventDefault: jest.fn(),
      clipboardData: {
        items: [
          {
            type: 'image/png',
            getAsFile,
          },
        ],
      },
    } as unknown as ClipboardEvent;

    const handlers = createClipboardHandlers(deps);
    await handlers.handlePaste(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(getAsFile).not.toHaveBeenCalled();
    expect(deps.setFloatingPaste).toHaveBeenCalledTimes(1);
    expect(deps.setFloatingPaste).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLayerId: 'layer-cc',
        colorCycleIndices: ccIndices,
        colorCycleGradientIds: ccGradientIds,
        colorCycleGradientDefIds: ccGradientDefIds,
        colorCycleSpeed: ccSpeed,
        colorCycleFlow: ccFlow,
      })
    );
  });
});
