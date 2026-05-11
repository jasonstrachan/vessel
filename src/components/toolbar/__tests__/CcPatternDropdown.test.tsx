import { act, fireEvent, render, screen } from '@testing-library/react';

import CcPatternDropdown, {
  renderTilePreviewImageData,
  resizeTilePatternImageData,
  resolveVisibleTilePreviewColors,
} from '@/components/toolbar/CcPatternDropdown';
import { useAppStore } from '@/stores/useAppStore';
import { encodeRgbaToBase64 } from '@/utils/colorCycle/ccCustomTilePattern';

describe('CcPatternDropdown', () => {
  const originalCreateImageBitmap = global.createImageBitmap;

  beforeEach(() => {
    global.createImageBitmap = jest.fn(async () => ({
      width: 1,
      height: 1,
      close: jest.fn(),
    })) as unknown as typeof createImageBitmap;
    useAppStore.getState().newProject(32, 32, 'Tile Dropdown Test');
    useAppStore.setState((state) => ({
      project: state.project
        ? {
            ...state.project,
            ccCustomTilePatterns: [
              {
                id: 'tile-1',
                name: 'Tile 1',
                width: 1,
                height: 1,
                rgbaBase64: encodeRgbaToBase64(Uint8Array.from([0, 0, 0, 255])),
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          }
        : state.project,
    }));
  });

  afterEach(() => {
    global.createImageBitmap = originalCreateImageBitmap;
  });

  it('renders add-new, built-ins, custom tiles, and removes a tile without selecting it', () => {
    const onChange = jest.fn();
    render(
      <CcPatternDropdown
        value="dots"
        patternTileId={null}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('+ Add New')).toBeInTheDocument();
    expect(screen.getAllByText('Dots').length).toBeGreaterThan(0);
    expect(screen.getByText('Tile 1')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Remove Tile 1'));

    expect(onChange).not.toHaveBeenCalled();
    expect(useAppStore.getState().project?.ccCustomTilePatterns).toEqual([]);
  });

  it('captures image paste while add-new modal is open so the canvas paste handler does not run', async () => {
    render(
      <CcPatternDropdown
        value="dots"
        patternTileId={null}
        onChange={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button'));
    const addNewOption = screen.getByText('+ Add New').closest('[role="option"]');
    expect(addNewOption).not.toBeNull();
    const pointerUp = new Event('pointerup', { bubbles: true, cancelable: true });
    Object.defineProperty(pointerUp, 'button', { value: 0 });
    act(() => {
      (addNewOption as Element).dispatchEvent(pointerUp);
    });
    expect(screen.getByText('Add Tile Pattern')).toBeInTheDocument();

    const canvasPasteListener = jest.fn();
    document.addEventListener('paste', canvasPasteListener);

    const file = new File([new Uint8Array([1])], 'tile.png', { type: 'image/png' });
    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      value: {
        items: [
          {
            type: 'image/png',
            getAsFile: () => file,
          },
        ],
      },
    });

    await act(async () => {
      document.dispatchEvent(event);
      await Promise.resolve();
    });

    expect(event.defaultPrevented).toBe(true);
    expect(canvasPasteListener).not.toHaveBeenCalled();
    document.removeEventListener('paste', canvasPasteListener);
  });

  it('uses visible preview colors when selected inks would render as a dark block', () => {
    expect(resolveVisibleTilePreviewColors(['#000000', '#111111'])).toEqual(['#ff1f1f', '#9f00e8']);
    expect(resolveVisibleTilePreviewColors(['rgba(0, 0, 0, 0)', '#111111'])).toEqual(['#ff1f1f', '#9f00e8']);
    expect(resolveVisibleTilePreviewColors(['hsl(0, 0%, 0%)', 'black'])).toEqual(['#ff1f1f', '#9f00e8']);
    expect(resolveVisibleTilePreviewColors(['#ff0000', '#9900ff'])).toEqual(['#ff0000', '#9900ff']);
  });

  it('renders a visible tiled preview without changing tile threshold data', () => {
    const tile = new ImageData(2, 1);
    tile.data.set([
      0, 0, 0, 255,
      255, 255, 255, 0,
    ]);

    const preview = renderTilePreviewImageData(tile, 4, 1, ['rgba(0, 0, 0, 0)', '#050505']);

    expect(Array.from(preview.data)).toEqual([
      255, 31, 31, 255,
      159, 0, 232, 255,
      255, 31, 31, 255,
      159, 0, 232, 255,
    ]);
    expect(Array.from(tile.data)).toEqual([
      0, 0, 0, 255,
      255, 255, 255, 0,
    ]);
  });

  it('scales tile pattern image data up with nearest-neighbor pixels', () => {
    const tile = new ImageData(2, 1);
    tile.data.set([
      10, 20, 30, 255,
      200, 210, 220, 128,
    ]);

    const scaled = resizeTilePatternImageData(tile, 2);

    expect(scaled.width).toBe(4);
    expect(scaled.height).toBe(2);
    expect(Array.from(scaled.data)).toEqual([
      10, 20, 30, 255,
      10, 20, 30, 255,
      200, 210, 220, 128,
      200, 210, 220, 128,
      10, 20, 30, 255,
      10, 20, 30, 255,
      200, 210, 220, 128,
      200, 210, 220, 128,
    ]);
  });

  it('scales tile pattern image data down on pixel-safe half steps', () => {
    const tile = new ImageData(4, 4);
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const idx = (y * 4 + x) * 4;
        tile.data[idx] = x + y * 4;
        tile.data[idx + 1] = 0;
        tile.data[idx + 2] = 0;
        tile.data[idx + 3] = 255;
      }
    }

    const half = resizeTilePatternImageData(tile, 0.5);
    const quarter = resizeTilePatternImageData(tile, 0.25);
    const sixteenth = resizeTilePatternImageData(tile, 0.0625);

    expect(half.width).toBe(2);
    expect(half.height).toBe(2);
    expect(Array.from(half.data)).toEqual([
      0, 0, 0, 255,
      2, 0, 0, 255,
      8, 0, 0, 255,
      10, 0, 0, 255,
    ]);
    expect(quarter.width).toBe(1);
    expect(quarter.height).toBe(1);
    expect(Array.from(quarter.data)).toEqual([0, 0, 0, 255]);
    expect(sixteenth.width).toBe(1);
    expect(sixteenth.height).toBe(1);
    expect(Array.from(sixteenth.data)).toEqual([0, 0, 0, 255]);
  });

});
