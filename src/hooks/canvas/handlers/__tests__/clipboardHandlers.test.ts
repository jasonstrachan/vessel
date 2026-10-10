import { createClipboardHandlers } from '@/hooks/canvas/handlers/clipboardHandlers';
import type { EventHandlerDependencies } from '@/hooks/canvas/utils/types';
import studioExtension from '@/extensions/studioExtension';
import { getAppStoreState } from '@/stores/appStoreAccess';

jest.mock('@/stores/appStoreAccess', () => ({ getAppStoreState: jest.fn() }));

const liveState = { floatingPaste: null as EventHandlerDependencies['floatingPaste'] };

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
  beforeEach(() => {
    liveState.floatingPaste = null;
    jest.mocked(getAppStoreState).mockImplementation(() => liveState as ReturnType<typeof getAppStoreState>);
  });

  afterEach(() => {
    studioExtension.handleClipboardAction = undefined;
    jest.restoreAllMocks();
  });

  it('lets the active Studio extension claim paste before the pixel clipboard', async () => {
    const deps = createDeps();
    studioExtension.handleClipboardAction = jest.fn(() => true);
    const event = {
      target: document.body,
      preventDefault: jest.fn(),
      clipboardData: { items: [] },
    } as unknown as ClipboardEvent;

    await createClipboardHandlers(deps).handlePaste(event);

    expect(studioExtension.handleClipboardAction).toHaveBeenCalledWith({
      action: 'paste',
      event,
    });
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(deps.setFloatingPaste).not.toHaveBeenCalled();
  });

  it.each([
    ['textarea', document.createElement('textarea')],
    ['contenteditable text', Object.assign(document.createElement('div'), {
      contentEditable: 'plaintext-only',
    })],
  ])('leaves native paste alone for %s', async (_label, target) => {
    const deps = createDeps();
    studioExtension.handleClipboardAction = jest.fn(() => true);
    const event = {
      target,
      preventDefault: jest.fn(),
      clipboardData: {
        items: [{ type: 'text/plain', getAsFile: jest.fn(() => null) }],
      },
    } as unknown as ClipboardEvent;

    const handlers = createClipboardHandlers(deps);
    await handlers.handlePaste(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(studioExtension.handleClipboardAction).not.toHaveBeenCalled();
    expect(deps.setFloatingPaste).not.toHaveBeenCalled();
  });

  it('retains indexed metadata when the native clipboard identity matches', async () => {
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
        clipboardId: 'own-copy',
        colorCycleIndices: ccIndices,
        colorCycleGradientIds: ccGradientIds,
        colorCycleGradientDefIds: ccGradientDefIds,
        colorCycleGradientDefs: ccGradientDefs,
        colorCycleSpeed: ccSpeed,
        colorCycleFlow: ccFlow,
        colorCyclePhase: ccPhase,
        colorCycleSourceLayerId: 'layer-cc',
        colorCycleSelectionMasks: { membership: new Uint8Array([255, 0, 255, 255]), eraseAlpha: new Uint8Array([128, 0, 255, 0]), softEdgeAlpha: new Uint8Array([255, 255, 120, 255]) },
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

    Object.assign(event.clipboardData!, { getData: () => '<img data-vessel-selection="own-copy">' });
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
        colorCycleSelectionMasks: deps.selectionClipboardRef!.current!.colorCycleSelectionMasks,
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

  describe('native clipboard identity admission', () => {
    const setup = (html: string, type = 'image/png') => {
      const deps = createDeps();
      deps.selectionClipboardRef!.current = {
        imageData: new ImageData(2, 2), width: 2, height: 2,
        position: { x: 31, y: 27 }, mode: 'cut', clipboardId: 'current-copy',
        colorCycleIndices: new Uint8Array([1, 2, 3, 4]),
      };
      const external = new ImageData(3, 2);
      external.data.fill(129);
      jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
        (() => ({ drawImage: jest.fn(), getImageData: () => external })) as unknown as HTMLCanvasElement['getContext'],
      );
      class Reader {
        onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
        readAsDataURL() { this.onload?.({ target: { result: 'data:image/png;base64,fixture' } } as ProgressEvent<FileReader>); }
      }
      class DecodedImage {
        width = 3;
        height = 2;
        onload: (() => void) | null = null;
        set src(_value: string) { this.onload?.(); }
      }
      jest.spyOn(global, 'FileReader').mockImplementation(() => new Reader() as unknown as FileReader);
      jest.spyOn(global, 'Image').mockImplementation(() => new DecodedImage() as unknown as HTMLImageElement);
      const event = {
        target: document.body, preventDefault: jest.fn(),
        clipboardData: {
          getData: (format: string) => format === 'text/html' ? html : '',
          types: type ? [type] : [],
          items: type ? [{ type, getAsFile: () => new Blob(['external'], { type }) }] : [],
        },
      } as unknown as ClipboardEvent;
      return { deps, event, external };
    };
    const paste = async (deps: ClipboardDeps, event: ClipboardEvent) => {
      await createClipboardHandlers(deps).handlePaste(event);
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    };

    it.each(['', '<img data-vessel-selection="older-copy">'])(
      'uses the current external image when its marker is %s', async html => {
        const { deps, event, external } = setup(html);
        await paste(deps, event);
        expect(deps.setFloatingPaste).toHaveBeenCalledWith(expect.objectContaining({
          imageData: external, width: 3, height: 2, colorCycleIndices: null,
        }));
      },
    );
    it('retains the original Cut position when a raster copy identity matches', async () => {
      const { deps, event } = setup('<html><body><img data-vessel-selection="current-copy"></body></html>');
      deps.selectionClipboardRef!.current!.colorCycleIndices = null;
      await paste(deps, event);
      expect(deps.setFloatingPaste).toHaveBeenCalledWith(expect.objectContaining({
        width: 2, height: 2, position: { x: 31, y: 27 },
      }));
    });
    it('does not paste stale pixels over a newer nonimage clipboard', async () => {
      const { deps, event } = setup('', 'text/plain');
      await paste(deps, event);
      expect(deps.setFloatingPaste).not.toHaveBeenCalled();
      expect(deps.commitFloatingPaste).not.toHaveBeenCalled();
    });
    it('supports the internal fallback when the system provides no content', async () => {
      const { deps, event } = setup('', '');
      await paste(deps, event);
      expect(deps.setFloatingPaste).toHaveBeenCalledWith(expect.objectContaining({ width: 2, height: 2 }));
    });
  });

  describe('pending replacement admission', () => {
    const setup = (branch: 'internal' | 'cc' | 'image') => {
      const deps = createDeps();
      const pending = {
        active: true, imageData: new ImageData(4, 4), position: { x: 1, y: 2 },
        width: 4, height: 4, sourceLayerId: 'extracted-source',
      } as NonNullable<typeof liveState.floatingPaste>;
      liveState.floatingPaste = pending;
      deps.dynamicDepsRef.current.floatingPaste = pending;
      deps.selectionClipboardRef!.current = {
        imageData: new ImageData(2, 2), position: { x: 0, y: 0 }, width: 2, height: 2,
        mode: 'copy', clipboardId: 'pending-copy', colorCycleIndices: branch === 'cc' ? new Uint8Array([1, 2, 3, 4]) : null,
      };
      jest.mocked(deps.setFloatingPaste).mockImplementation(value => { liveState.floatingPaste = value; });
      const getAsFile = jest.fn(() => new Blob(['image'], { type: 'image/png' }));
      const event = {
        target: document.body, preventDefault: jest.fn(),
        clipboardData: { getData: () => branch === 'cc' ? '<img data-vessel-selection="pending-copy">' : '', items: branch === 'internal' ? [] : [{ type: 'image/png', getAsFile }] },
      } as unknown as ClipboardEvent;
      return { deps, pending, event };
    };
    const flushImageCallbacks = async () => {
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    };
    beforeEach(() => {
      // Decode is an I/O boundary; replacement still uses the real handler and live admission.
      class TestFileReader {
        onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
        readAsDataURL() {
          this.onload?.({ target: { result: 'data:image/png;base64,fixture' } } as ProgressEvent<FileReader>);
        }
      }
      class TestImage {
        width = 2;
        height = 2;
        onload: (() => void) | null = null;
        set src(_value: string) { this.onload?.(); }
      }
      jest.spyOn(global, 'FileReader').mockImplementation(() => new TestFileReader() as unknown as FileReader);
      jest.spyOn(global, 'Image').mockImplementation(() => new TestImage() as unknown as HTMLImageElement);
    });

    it.each(['internal', 'cc', 'image'] as const)('preserves a refused %s replacement and its selection', async branch => {
      const { deps, pending, event } = setup(branch);
      await createClipboardHandlers(deps).handlePaste(event);
      await flushImageCallbacks();
      expect(deps.commitFloatingPaste).toHaveBeenCalledTimes(1);
      expect(liveState.floatingPaste).toBe(pending);
      expect(deps.setFloatingPaste).not.toHaveBeenCalled();
      expect(deps.clearSelection).not.toHaveBeenCalled();
    });

    it.each(['internal', 'cc', 'image'] as const)('preserves a rejected %s replacement', async branch => {
      const { deps, pending, event } = setup(branch);
      jest.mocked(deps.commitFloatingPaste).mockRejectedValueOnce(new Error('commit rejected'));
      await createClipboardHandlers(deps).handlePaste(event);
      await flushImageCallbacks();
      expect(liveState.floatingPaste).toBe(pending);
      expect(deps.setFloatingPaste).not.toHaveBeenCalled();
      expect(deps.clearSelection).not.toHaveBeenCalled();
    });

    it.each(['internal', 'cc', 'image'] as const)('admits successful %s replacement despite a stale React snapshot', async branch => {
      const { deps, pending, event } = setup(branch);
      jest.mocked(deps.commitFloatingPaste).mockImplementation(async () => { liveState.floatingPaste = null; });
      await createClipboardHandlers(deps).handlePaste(event);
      await flushImageCallbacks();
      expect(deps.dynamicDepsRef.current.floatingPaste).toBe(pending);
      expect(deps.setFloatingPaste).toHaveBeenCalledTimes(1);
      expect(liveState.floatingPaste?.width).toBe(2);
    });

    it('consults live ownership when React has not observed an extraction', async () => {
      const { deps, pending, event } = setup('internal');
      deps.dynamicDepsRef.current.floatingPaste = null;
      await createClipboardHandlers(deps).handlePaste(event);
      expect(deps.commitFloatingPaste).toHaveBeenCalledTimes(1);
      expect(liveState.floatingPaste).toBe(pending);
      expect(deps.setFloatingPaste).not.toHaveBeenCalled();
    });

    it('does not overwrite a newly admitted float when overlapping pastes share a commit', async () => {
      const { deps, event } = setup('internal');
      let resolve!: () => void;
      const commit = new Promise<void>(done => { resolve = done; });
      jest.mocked(deps.commitFloatingPaste).mockReturnValue(commit);
      const first = createClipboardHandlers(deps).handlePaste(event);
      const second = createClipboardHandlers(deps).handlePaste(event);
      await flushImageCallbacks();
      expect(deps.commitFloatingPaste).toHaveBeenCalledTimes(2);
      liveState.floatingPaste = null;
      resolve();
      await Promise.all([first, second]);
      expect(deps.setFloatingPaste).toHaveBeenCalledTimes(1);
      expect(deps.clearSelection).toHaveBeenCalledTimes(1);
    });
  });
});
