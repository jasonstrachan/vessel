import { syncStrokeStartPalette } from '@/hooks/canvas/handlers/strokeStartPalette';
import type { AppState } from '@/stores/useAppStore';

const createState = (overrides?: {
  paletteColor?: string;
  brushColor?: string;
  eraserColor?: string;
  autoSampleColor?: boolean;
  brushShape?: string;
}): AppState => {
  const paletteColor = overrides?.paletteColor ?? '#112233';
  const brushColor = overrides?.brushColor ?? '#445566';
  const eraserColor = overrides?.eraserColor ?? '#778899';
  const autoSampleColor = overrides?.autoSampleColor ?? false;
  const brushShape = overrides?.brushShape ?? 'round';

  return {
    palette: {
      activeSlot: 'foreground',
      foregroundColor: paletteColor,
    },
    tools: {
      brushSettings: {
        color: brushColor,
        autoSampleColor,
        brushShape,
      },
      eraserSettings: {
        color: eraserColor,
      },
    },
    setBrushSettings: jest.fn(),
    setEraserSettings: jest.fn(),
    setPaletteColor: jest.fn(),
  } as unknown as AppState;
};

describe('syncStrokeStartPalette', () => {
  it('does not call setBrushSettings when brush color already matches palette', () => {
    const state = createState({ paletteColor: '#abcdef', brushColor: '#abcdef' });

    syncStrokeStartPalette({
      currentState: state,
      currentTool: 'brush',
      isColorCycleBrush: false,
    });

    expect(state.setBrushSettings).not.toHaveBeenCalled();
  });

  it('does not call setEraserSettings when eraser color already matches palette', () => {
    const state = createState({ paletteColor: '#abcdef', eraserColor: '#abcdef' });

    syncStrokeStartPalette({
      currentState: state,
      currentTool: 'eraser',
      isColorCycleBrush: false,
    });

    expect(state.setEraserSettings).not.toHaveBeenCalled();
  });

  it('keeps auto-sampled brush palette sync behavior', () => {
    const state = createState({
      paletteColor: '#101010',
      brushColor: '#202020',
      autoSampleColor: true,
      brushShape: 'round',
    });

    syncStrokeStartPalette({
      currentState: state,
      currentTool: 'brush',
      isColorCycleBrush: false,
    });

    expect(state.setPaletteColor).toHaveBeenCalledWith('foreground', '#202020');
  });
});
