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
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('prefers internal clipboard payload with CC indices over image clipboard items', async () => {
    const deps = createDeps();
    const ccIndices = new Uint8Array([5, 6, 7, 8]);
    const ccGradientIds = new Uint8Array([9, 10, 11, 12]);
    const ccGradientDefIds = new Uint16Array([101, 102, 103, 104]);
    const ccGradientDefs = [{
      id: 101,
      kind: 'linear' as const,
      stops: [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }],
      hash: 'linear:black-white',
      source: 'manual' as const,
      createdAtMs: 1,
    }];
    const ccSpeed = new Uint8Array([13, 14, 15, 16]);
    const ccFlow = new Uint8Array([17, 18, 19, 20]);
    const ccPhase = new Uint8Array([21, 22, 23, 24]);
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
        colorCycleGradientDefs: ccGradientDefs,
        colorCycleSpeed: ccSpeed,
        colorCycleFlow: ccFlow,
        colorCyclePhase: ccPhase,
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
        colorCycleGradientDefs: ccGradientDefs,
        colorCycleSpeed: ccSpeed,
        colorCycleFlow: ccFlow,
        colorCyclePhase: ccPhase,
      })
    );
  });

  it('keeps pasted image clipboard content at intrinsic size instead of fitting to the project', async () => {
    const deps = createDeps();
    const originalFileReader = global.FileReader;
    const originalImage = global.Image;

    const mockGetImageData = jest.fn(() => new ImageData(200, 150));
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      ((contextId: string) => {
        if (contextId !== '2d') {
          return null;
        }
        return {
          drawImage: jest.fn(),
          getImageData: mockGetImageData,
        } as unknown as CanvasRenderingContext2D;
      }) as HTMLCanvasElement['getContext']
    );

    class MockFileReader {
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;

      readAsDataURL() {
        this.onload?.({ target: { result: 'data:image/png;base64,fake' } } as ProgressEvent<FileReader>);
      }
    }

    class MockImage {
      width = 200;
      height = 150;
      onload: (() => void) | null = null;

      set src(_value: string) {
        this.onload?.();
      }
    }

    try {
      global.FileReader = MockFileReader as unknown as typeof FileReader;
      global.Image = MockImage as unknown as typeof Image;

      const event = {
        preventDefault: jest.fn(),
        clipboardData: {
          items: [
            {
              type: 'image/png',
              getAsFile: jest.fn(() => new Blob(['fake'], { type: 'image/png' })),
            },
          ],
        },
      } as unknown as ClipboardEvent;

      const handlers = createClipboardHandlers(deps);
      await handlers.handlePaste(event);
      await Promise.resolve();
      await Promise.resolve();

      expect(deps.getViewportPastePosition).toHaveBeenCalledWith(200, 150);
      expect(mockGetImageData).toHaveBeenCalledWith(0, 0, 200, 150);
      expect(deps.setFloatingPaste).toHaveBeenCalledWith(
        expect.objectContaining({
          width: 200,
          height: 150,
          displayWidth: 200,
          displayHeight: 150,
        })
      );
    } finally {
      global.FileReader = originalFileReader;
      global.Image = originalImage;
    }
  });
});
