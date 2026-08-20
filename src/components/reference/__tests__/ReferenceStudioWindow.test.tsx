import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ReferenceStudioWindow } from '@/components/reference/ReferenceStudioWindow';
import type { ReferenceStudioMainMessage, ReferenceStudioSnapshot } from '@/referenceStudio/referenceStudioChannel';
import type { ReferenceAsset } from '@/types';

const mockPostMessage = jest.fn();
const mockClose = jest.fn();
const mockChannel = {
  onmessage: null as ((event: MessageEvent<ReferenceStudioMainMessage>) => void) | null,
  postMessage: mockPostMessage,
  close: mockClose,
};

jest.mock('@/components/canvas/GridOverlay', () => ({
  __esModule: true,
  default: () => <div data-testid="grid-overlay" />,
}));

jest.mock('@/components/reference/ReferenceAssetCanvas', () => ({
  ReferenceAssetCanvas: ({
    asset,
    isSelected,
    onSelect,
  }: {
    asset: ReferenceAsset;
    isSelected: boolean;
    onSelect: (id: string) => void;
  }) => (
    <div
      role="button"
      tabIndex={0}
      aria-label={asset.name}
      data-testid="reference-asset"
      data-reference-asset="true"
      data-scale={asset.scale}
      data-opacity={asset.opacity}
      data-selected={isSelected ? 'true' : 'false'}
      onPointerDown={() => onSelect(asset.id)}
    />
  ),
}));

jest.mock('@/referenceStudio/referenceStudioChannel', () => ({
  createReferenceStudioChannel: () => mockChannel,
  getReferenceStudioSessionIdFromLocation: () => 'test-session',
}));

const snapshot: ReferenceStudioSnapshot = {
  project: {
    id: 'project-1',
    name: 'Portrait',
    width: 800,
    height: 1000,
  },
  grid: {
    enabled: true,
    rows: 4,
    columns: 4,
  },
  layers: [],
  referenceAssets: [],
  samplingSource: { kind: 'canvas' },
};

const connectStudio = (nextSnapshot = snapshot) => {
  act(() => {
    mockChannel.onmessage?.({
      data: { type: 'snapshot', snapshot: nextSnapshot },
    } as MessageEvent<ReferenceStudioMainMessage>);
  });
};

const resizeBoard = (width: number, height: number) => {
  const board = screen.getByTestId('reference-board');
  Object.defineProperty(board, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(board, 'clientHeight', { configurable: true, value: height });
  Object.defineProperty(board, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      bottom: height,
      height,
      left: 0,
      right: width,
      top: 0,
      width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
  fireEvent(window, new Event('resize'));
  return board;
};

describe('ReferenceStudioWindow', () => {
  const NativeFileReader = global.FileReader;
  const NativeImage = global.Image;

  beforeEach(() => {
    jest.clearAllMocks();
    mockChannel.onmessage = null;
  });

  afterEach(() => {
    global.FileReader = NativeFileReader;
    global.Image = NativeImage;
  });

  it('opens image-first with editing controls hidden and no help copy', () => {
    render(<ReferenceStudioWindow />);
    connectStudio();

    expect(screen.queryByTestId('reference-controls')).not.toBeInTheDocument();
    expect(screen.queryByText('Import an image to begin.')).not.toBeInTheDocument();
    expect(screen.queryByText(/Drag unlocked references/)).not.toBeInTheDocument();
    expect(screen.queryByText('+ Image')).not.toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'Zoom' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open controls' }).className).not.toContain('border');
    expect(screen.getByRole('button', { name: 'Open controls' })).toHaveClass('focus-visible:outline');
    expect(screen.getByTestId('reference-document-frame').className).not.toContain('border');
    expect(screen.getByTestId('reference-document-outline')).toHaveClass('pointer-events-none');
    expect(screen.getByTestId('reference-document-outline')).toHaveStyle({ zIndex: 10 });
    expect(screen.getByRole('main')).toHaveClass('min-w-0');
    expect(screen.getByRole('main')).not.toHaveClass('min-w-[760px]');

    fireEvent.click(screen.getByRole('button', { name: 'Open controls' }));
    expect(screen.getByTestId('reference-controls')).toBeInTheDocument();
    expect(screen.getByText('Add image')).toBeInTheDocument();
    expect(screen.getByTestId('reference-controls')).toHaveClass('w-[260px]');

    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByTestId('reference-controls')).not.toBeInTheDocument();
  });

  it('deselects references from empty board space until an image is selected again', () => {
    const asset: ReferenceAsset = {
      id: 'reference-1',
      name: 'Portrait reference',
      dataUrl: 'data:image/png;base64,AAAA',
      naturalWidth: 400,
      naturalHeight: 600,
      visible: true,
      locked: false,
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      flipX: false,
      flipY: false,
      createdAt: 1,
      updatedAt: 1,
    };
    const connectedSnapshot = { ...snapshot, referenceAssets: [asset] };

    render(<ReferenceStudioWindow />);
    connectStudio(connectedSnapshot);

    const reference = screen.getByTestId('reference-asset');
    expect(reference).toHaveAttribute('data-selected', 'true');

    fireEvent.pointerDown(screen.getByTestId('reference-board-surface'));
    expect(reference).toHaveAttribute('data-selected', 'false');

    connectStudio({
      ...connectedSnapshot,
      referenceAssets: [{ ...asset, updatedAt: 2 }],
    });
    expect(reference).toHaveAttribute('data-selected', 'false');

    fireEvent.pointerDown(reference);
    expect(reference).toHaveAttribute('data-selected', 'true');
  });

  it('keeps the coordinate under the pointer fixed while wheel zooming', () => {
    render(<ReferenceStudioWindow />);
    connectStudio();

    const board = resizeBoard(1200, 900);
    const frame = screen.getByTestId('reference-document-frame');
    const widthBeforeZoom = Number.parseFloat(frame.style.width);
    const scaleBeforeZoom = widthBeforeZoom / snapshot.project!.width;
    const leftBeforeZoom = Number.parseFloat(frame.style.left);
    const pointerX = 600;
    const documentXBeforeZoom = (pointerX - leftBeforeZoom) / scaleBeforeZoom;

    fireEvent.wheel(board, {
      clientX: pointerX,
      clientY: 450,
      deltaX: 0,
      deltaY: -1000,
    });

    const widthAfterZoom = Number.parseFloat(frame.style.width);
    const scaleAfterZoom = widthAfterZoom / snapshot.project!.width;
    const leftAfterZoom = Number.parseFloat(frame.style.left);
    const documentXAfterZoom = (pointerX - leftAfterZoom) / scaleAfterZoom;
    expect(widthAfterZoom).toBeGreaterThan(widthBeforeZoom);
    expect(documentXAfterZoom).toBeCloseTo(documentXBeforeZoom, 5);
  });

  it('keeps the document centered when the window is resized in fit view', () => {
    render(<ReferenceStudioWindow />);
    connectStudio();

    resizeBoard(1200, 900);
    const frame = screen.getByTestId('reference-document-frame');
    expect(Number.parseFloat(frame.style.left) + Number.parseFloat(frame.style.width) / 2).toBeCloseTo(600, 5);
    expect(Number.parseFloat(frame.style.top) + Number.parseFloat(frame.style.height) / 2).toBeCloseTo(450, 5);

    resizeBoard(1600, 1100);
    expect(Number.parseFloat(frame.style.left) + Number.parseFloat(frame.style.width) / 2).toBeCloseTo(800, 5);
    expect(Number.parseFloat(frame.style.top) + Number.parseFloat(frame.style.height) / 2).toBeCloseTo(550, 5);
  });

  it('pans the camera without a finite board fence while Space is held', () => {
    render(<ReferenceStudioWindow />);
    connectStudio();

    const board = resizeBoard(1200, 900);
    const frame = screen.getByTestId('reference-document-frame');
    const leftBeforePan = Number.parseFloat(frame.style.left);
    const topBeforePan = Number.parseFloat(frame.style.top);

    fireEvent.keyDown(window, { code: 'Space' });
    const overlay = screen.getByTestId('reference-pan-overlay');
    expect(overlay).toHaveStyle({ cursor: 'grab' });

    const pointerDown = new MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 });
    const pointerMove = new MouseEvent('pointermove', { bubbles: true, clientX: 5100, clientY: -2900 });
    Object.defineProperty(pointerDown, 'pointerId', { value: 1 });
    Object.defineProperty(pointerMove, 'pointerId', { value: 1 });
    fireEvent(overlay, pointerDown);
    fireEvent(overlay, pointerMove);
    expect(Number.parseFloat(frame.style.left)).toBeCloseTo(leftBeforePan + 5000, 5);
    expect(Number.parseFloat(frame.style.top)).toBeCloseTo(topBeforePan - 3000, 5);
    expect(board).toHaveClass('overflow-hidden');

    resizeBoard(1600, 1100);
    expect(Number.parseFloat(frame.style.left)).toBeCloseTo(leftBeforePan + 5200, 5);
    expect(Number.parseFloat(frame.style.top)).toBeCloseTo(topBeforePan - 2900, 5);

    fireEvent.keyUp(window, { code: 'Space' });
    expect(screen.queryByTestId('reference-pan-overlay')).not.toBeInTheDocument();
  });

  it('does not start Space-pan from a focused control', () => {
    render(<ReferenceStudioWindow />);
    connectStudio();
    fireEvent.click(screen.getByRole('button', { name: 'Open controls' }));

    const hideButton = screen.getByRole('button', { name: 'Hide' });
    hideButton.focus();
    fireEvent.keyDown(hideButton, { code: 'Space' });

    expect(screen.queryByTestId('reference-pan-overlay')).not.toBeInTheDocument();
    fireEvent.keyUp(hideButton, { code: 'Space' });
  });

  it('imports an image pasted from the clipboard', async () => {
    class TestFileReader {
      result: string | ArrayBuffer | null = null;
      error: DOMException | null = null;
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

      readAsDataURL() {
        this.result = 'data:image/png;base64,dGVzdA==';
        this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>);
      }
    }

    class TestImage {
      naturalWidth = 400;
      naturalHeight = 600;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        this.onload?.();
      }
    }

    global.FileReader = TestFileReader as unknown as typeof FileReader;
    global.Image = TestImage as unknown as typeof Image;

    render(<ReferenceStudioWindow />);
    connectStudio();
    mockPostMessage.mockClear();

    const image = new File(['image'], 'portrait.png', { type: 'image/png' });
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
        files: [],
      },
    });

    act(() => {
      window.dispatchEvent(pasteEvent);
    });

    await waitFor(() => expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'add-reference',
      asset: expect.objectContaining({
        name: 'portrait',
        naturalWidth: 400,
        naturalHeight: 600,
      }),
    })));
    expect(pasteEvent.defaultPrevented).toBe(true);
  });

  it('fits the selected reference inside the Vessel canvas and centers it', () => {
    const asset: ReferenceAsset = {
      id: 'reference-1',
      name: 'Portrait reference',
      dataUrl: 'data:image/png;base64,AAAA',
      naturalWidth: 1000,
      naturalHeight: 800,
      visible: true,
      locked: false,
      opacity: 1,
      x: -40,
      y: 25,
      scale: 0.75,
      crop: { x: 0.25, y: 0.1, width: 0.5, height: 0.5 },
      flipX: false,
      flipY: false,
      createdAt: 1,
      updatedAt: 1,
    };

    render(<ReferenceStudioWindow />);
    connectStudio({ ...snapshot, referenceAssets: [asset] });
    fireEvent.click(screen.getByRole('button', { name: 'Open controls' }));
    mockPostMessage.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));

    const updateMessage = mockPostMessage.mock.calls[0]?.[0];
    expect(updateMessage).toMatchObject({
      type: 'update-reference',
      id: asset.id,
    });
    expect(updateMessage.updates.scale).toBeCloseTo(1.6);
    expect(updateMessage.updates.x).toBeCloseTo(0);
    expect(updateMessage.updates.y).toBeCloseTo(180);
  });

  it('previews reference sliders locally and commits one project update', () => {
    const asset: ReferenceAsset = {
      id: 'reference-1',
      name: 'Portrait reference',
      dataUrl: 'data:image/png;base64,AAAA',
      naturalWidth: 400,
      naturalHeight: 600,
      visible: true,
      locked: false,
      opacity: 1,
      x: 0,
      y: 0,
      scale: 0.75,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      flipX: false,
      flipY: false,
      createdAt: 1,
      updatedAt: 1,
    };

    render(<ReferenceStudioWindow />);
    connectStudio({ ...snapshot, referenceAssets: [asset] });
    fireEvent.click(screen.getByRole('button', { name: 'Open controls' }));
    mockPostMessage.mockClear();

    const scaleSlider = screen.getByRole('slider', { name: 'Reference scale' });
    fireEvent.pointerDown(scaleSlider);
    fireEvent.change(scaleSlider, { target: { value: `${50 + (50 / 6)}` } });

    expect(Number(screen.getByTestId('reference-asset').getAttribute('data-scale'))).toBeCloseTo(2);
    expect(mockPostMessage).not.toHaveBeenCalled();

    fireEvent.pointerUp(scaleSlider);
    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'update-reference',
      id: asset.id,
    }));
    expect(mockPostMessage.mock.calls[0]?.[0].updates.scale).toBeCloseTo(2);
  });

  it('clears a no-op slider preview so later snapshots remain authoritative', () => {
    const asset: ReferenceAsset = {
      id: 'reference-1',
      name: 'Portrait reference',
      dataUrl: 'data:image/png;base64,AAAA',
      naturalWidth: 400,
      naturalHeight: 600,
      visible: true,
      locked: false,
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      flipX: false,
      flipY: false,
      createdAt: 1,
      updatedAt: 1,
    };

    render(<ReferenceStudioWindow />);
    connectStudio({ ...snapshot, referenceAssets: [asset] });
    fireEvent.click(screen.getByRole('button', { name: 'Open controls' }));
    mockPostMessage.mockClear();

    const scaleSlider = screen.getByRole('slider', { name: 'Reference scale' });
    fireEvent.pointerDown(scaleSlider);
    fireEvent.change(scaleSlider, { target: { value: '60' } });
    fireEvent.change(scaleSlider, { target: { value: '50' } });
    fireEvent.pointerUp(scaleSlider);

    expect(mockPostMessage).not.toHaveBeenCalled();
    connectStudio({
      ...snapshot,
      referenceAssets: [{ ...asset, scale: 2, updatedAt: 2 }],
    });
    expect(screen.getByTestId('reference-asset')).toHaveAttribute('data-scale', '2');
  });

  it('clears local previews when the connected Vessel project changes', () => {
    const asset: ReferenceAsset = {
      id: 'shared-reference-id',
      name: 'First project reference',
      dataUrl: 'data:image/png;base64,AAAA',
      naturalWidth: 400,
      naturalHeight: 600,
      visible: true,
      locked: false,
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      flipX: false,
      flipY: false,
      createdAt: 1,
      updatedAt: 1,
    };

    render(<ReferenceStudioWindow />);
    connectStudio({ ...snapshot, referenceAssets: [asset] });
    fireEvent.click(screen.getByRole('button', { name: 'Open controls' }));
    fireEvent.pointerDown(screen.getByRole('slider', { name: 'Reference scale' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Reference scale' }), {
      target: { value: '60' },
    });
    expect(screen.getByTestId('reference-asset')).not.toHaveAttribute('data-scale', '1');

    connectStudio({
      ...snapshot,
      project: { ...snapshot.project!, id: 'project-2' },
      referenceAssets: [{ ...asset, name: 'Second project reference', scale: 0.5 }],
    });

    expect(screen.getByTestId('reference-asset')).toHaveAttribute('data-scale', '0.5');
  });
});
