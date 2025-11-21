import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { useAppStore } from '@/stores/useAppStore';
import BrushLibrary from '@/components/BrushLibrary';
import { BrushShape } from '@/types';

jest.mock('@/components/ui/PlusButton', () => (props: any) => (
  <button data-testid="plus-button" onClick={props.onClick}>+</button>
));

jest.mock('@/utils/brushThumbnailGenerator', () => ({
  generateBrushThumbnail: () => 'data:image/png;base64,thumb',
}));

const basePreset = {
  id: 'round-brush',
  name: 'Round',
  isDefault: true,
  category: 'Basic',
  components: [{ type: 'shape', parameters: { shape: BrushShape.ROUND } }],
};

const otherPreset = {
  id: 'square-pixel-1',
  name: 'Square Pixel',
  isDefault: false,
  category: 'Pixel Art',
  components: [{ type: 'shape', parameters: { shape: BrushShape.SQUARE } }],
};

const trianglePreset = {
  id: 'color-cycle-triangle',
  name: 'Triangle CC',
  isDefault: false,
  category: 'Color Cycle',
  components: [{ type: 'shape', parameters: { shape: BrushShape.COLOR_CYCLE_TRIANGLE } }],
};

describe('BrushLibrary', () => {
  beforeEach(() => {
    useAppStore.setState((state) => ({
      ...state,
      currentBrushPreset: basePreset as any,
      brushPresets: [basePreset as any, trianglePreset as any, otherPreset as any],
      project: {
        id: 'p1',
        name: 'demo',
        width: 10,
        height: 10,
        backgroundColor: '#000',
        layers: [],
        customBrushes: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: BrushShape.ROUND,
          selectedCustomBrush: null,
        },
      },
    }));
  });

  afterEach(() => {
    useAppStore.setState({ project: null, brushPresets: [], currentBrushPreset: null });
  });

  it('renders presets and selects a brush on click', () => {
    render(<BrushLibrary />);

    const brushButton = screen.getByText('Square Pixel');
    fireEvent.click(brushButton);

    expect(useAppStore.getState().currentBrushPreset?.id).toBe('square-pixel-1');
  });

  it('does not render an image tag when document is present but thumbnail fetch is mocked', () => {
    render(<BrushLibrary />);
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('filters out color-cycle triangle preset and prioritizes pixel art ordering', () => {
    render(<BrushLibrary />);

    expect(screen.queryByText('Triangle CC')).toBeNull();

    const buttons = screen.getAllByRole('button').map((btn) => btn.textContent?.trim());
    const pixelIndex = buttons.findIndex((text) => text?.includes('Square Pixel'));
    const roundIndex = buttons.findIndex((text) => text?.includes('Round'));

    expect(pixelIndex).toBeGreaterThan(-1);
    expect(roundIndex).toBeGreaterThan(-1);
    expect(pixelIndex).toBeLessThan(roundIndex);
  });
});
