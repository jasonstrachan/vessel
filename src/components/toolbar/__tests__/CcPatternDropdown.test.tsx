import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import CcPatternDropdown, {
  renderTilePreviewImageData,
  resizeTilePatternImageData,
  resolveVisibleTilePreviewColors,
} from '@/components/toolbar/CcPatternDropdown';
import { useAppStore } from '@/stores/useAppStore';
import { encodeRgbaToBase64 } from '@/utils/colorCycle/ccCustomTilePattern';
import {
  localPatternLibrary,
  type LocalPatternPackSummary,
} from '@/utils/ditherPatterns/localPatternLibrary';

jest.mock('@/utils/ditherPatterns/localPatternLibrary', () => ({
  localPatternLibrary: {
    hydrate: jest.fn(),
    list: jest.fn(),
    install: jest.fn(),
    remove: jest.fn(),
    exportBackup: jest.fn(),
  },
}));

const localPack: LocalPatternPackSummary = {
  packId: 'private-pack',
  name: 'Private Pack',
  contentHash: 'sha256:pack',
  patterns: [{
    id: 'local-threshold',
    name: 'Local Threshold',
    payloadHash: 'sha256:pattern',
  }, {
    id: 'local-threshold-two',
    name: 'Another Local Threshold',
    payloadHash: 'sha256:pattern-two',
  }],
};

const mockHydrate = localPatternLibrary.hydrate as jest.MockedFunction<typeof localPatternLibrary.hydrate>;
const mockList = localPatternLibrary.list as jest.MockedFunction<typeof localPatternLibrary.list>;
const mockInstall = localPatternLibrary.install as jest.MockedFunction<typeof localPatternLibrary.install>;
const mockRemove = localPatternLibrary.remove as jest.MockedFunction<typeof localPatternLibrary.remove>;
const mockExportBackup = localPatternLibrary.exportBackup as jest.MockedFunction<typeof localPatternLibrary.exportBackup>;

const chooseDropdownOption = (label: string) => {
  const option = screen.getByText(label).closest('[role="option"]');
  expect(option).not.toBeNull();
  const pointerUp = new Event('pointerup', { bubbles: true, cancelable: true });
  Object.defineProperty(pointerUp, 'button', { value: 0 });
  act(() => {
    (option as Element).dispatchEvent(pointerUp);
  });
};

describe('CcPatternDropdown', () => {
  const originalCreateImageBitmap = global.createImageBitmap;
  const originalIndexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: {},
    });
    mockHydrate.mockImplementation(() => new Promise(() => {}));
    mockList.mockResolvedValue([]);
    mockRemove.mockResolvedValue();
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
            ccCustomTilePatternPacks: [
              {
                id: 'pack-1',
                name: 'Pack 1',
                patternIds: ['tile-1'],
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
    if (originalIndexedDbDescriptor) {
      Object.defineProperty(globalThis, 'indexedDB', originalIndexedDbDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'indexedDB');
    }
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
    expect(screen.getByText('Pack 1')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Remove Tile 1'));

    expect(onChange).not.toHaveBeenCalled();
    expect(useAppStore.getState().project?.ccCustomTilePatterns).toEqual([]);
  });

  it('selects pack-random mode from a pattern pack option', () => {
    const onChange = jest.fn();
    render(
      <CcPatternDropdown
        value="dots"
        patternTileId={null}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('button'));
    chooseDropdownOption('Pack 1');

    expect(onChange).toHaveBeenCalledWith({
      ditherAlgorithm: 'pattern',
      patternStyle: 'image-tile',
      patternTileId: 'tile-1',
      patternTilePackId: 'pack-1',
      patternTileSelectionMode: 'pack-random',
    });
  });

  it('falls back to a built-in pattern when a selected pack has no valid tiles', () => {
    useAppStore.setState((state) => ({
      project: state.project
        ? {
            ...state.project,
            ccCustomTilePatterns: [],
            ccCustomTilePatternPacks: [
              {
                id: 'pack-empty',
                name: 'Empty Pack',
                patternIds: [],
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          }
        : state.project,
    }));
    const onChange = jest.fn();
    render(
      <CcPatternDropdown
        value="dots"
        patternTileId={null}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('button'));
    chooseDropdownOption('Empty Pack');

    expect(onChange).toHaveBeenCalledWith({
      ditherAlgorithm: 'pattern',
      patternStyle: 'dots',
      patternTileId: null,
      patternTilePackId: 'pack-empty',
      patternTileSelectionMode: 'pack-random',
    });
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
    chooseDropdownOption('+ Add New');
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

  it('loads local patterns in a marked group and selects through the shared image-tile seam', async () => {
    mockHydrate.mockResolvedValueOnce([localPack]);
    const onChange = jest.fn();
    render(
      <CcPatternDropdown
        value="dots"
        patternTileId={null}
        onChange={onChange}
      />
    );

    await waitFor(() => expect(mockHydrate).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('Local')).toBeInTheDocument();
    expect(screen.getByText('Private Pack')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Back up Private Pack')).toHaveLength(1);
    expect(screen.getAllByLabelText('Remove Private Pack')).toHaveLength(1);
    chooseDropdownOption('Local Threshold');

    expect(onChange).toHaveBeenCalledWith({
      ditherAlgorithm: 'pattern',
      patternStyle: 'image-tile',
      patternTileId: 'local-threshold',
      patternTilePackId: null,
      patternTileSelectionMode: 'single',
    });
  });

  it('imports a private pack and selects its first local pattern', async () => {
    mockInstall.mockResolvedValueOnce(localPack);
    mockList.mockResolvedValueOnce([localPack]);
    const onChange = jest.fn();
    render(
      <CcPatternDropdown
        value="dots"
        patternTileId={null}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('button'));
    chooseDropdownOption('+ Import Private Pack');
    const file = new File([Uint8Array.from([1, 2, 3])], 'private.vpatternpack', {
      type: 'application/zip',
    });
    Object.defineProperty(file, 'arrayBuffer', {
      value: jest.fn(async () => Uint8Array.from([1, 2, 3]).buffer),
    });
    fireEvent.change(screen.getByLabelText('Import private pattern pack'), {
      target: { files: [file] },
    });

    await waitFor(() => expect(mockInstall).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith({
      ditherAlgorithm: 'pattern',
      patternStyle: 'image-tile',
      patternTileId: 'local-threshold',
      patternTilePackId: null,
      patternTileSelectionMode: 'single',
    });
  });

  it('preserves a missing local reference and shows an unavailable-replay warning', async () => {
    mockHydrate.mockResolvedValueOnce([]);
    render(
      <CcPatternDropdown
        value="image-tile"
        patternTileId="missing-local-pattern"
        onChange={jest.fn()}
      />
    );

    expect(await screen.findByText(/This local pattern is not installed/)).toBeInTheDocument();
  });

  it('backs up and removes an installed local pack from its group header', async () => {
    mockHydrate.mockResolvedValueOnce([localPack]);
    mockList.mockResolvedValueOnce([]);
    mockExportBackup.mockResolvedValueOnce(Uint8Array.from([4, 5, 6]));
    const createObjectUrl = jest.fn(() => 'blob:local-pack');
    const revokeObjectUrl = jest.fn();
    const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
    const onChange = jest.fn();
    render(
      <CcPatternDropdown
        value="image-tile"
        patternTileId="local-threshold"
        onChange={onChange}
      />
    );

    await waitFor(() => expect(mockHydrate).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByLabelText('Back up Private Pack'));
    await waitFor(() => expect(mockExportBackup).toHaveBeenCalledWith('private-pack'));
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:local-pack');

    fireEvent.click(screen.getByLabelText('Remove Private Pack'));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('private-pack'));
    expect(onChange).not.toHaveBeenCalled();
    anchorClick.mockRestore();
  });

});
