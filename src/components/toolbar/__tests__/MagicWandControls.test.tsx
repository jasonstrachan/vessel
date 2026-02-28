import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import MagicWandControls from '@/components/toolbar/MagicWandControls';

const mockSetWandSettings = jest.fn();

const mockStore = {
  tools: {
    wandSettings: {
      threshold: 42,
      contiguous: true,
    },
  },
  setWandSettings: mockSetWandSettings,
};

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: (selector: (state: typeof mockStore) => unknown) => selector(mockStore),
}));

describe('MagicWandControls', () => {
  beforeEach(() => {
    mockSetWandSettings.mockReset();
  });

  it('updates threshold via slider', () => {
    render(<MagicWandControls />);

    const slider = screen.getByLabelText('Magic Wand Threshold') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '64' } });

    expect(mockSetWandSettings).toHaveBeenCalledWith({ threshold: 64 });
  });

  it('updates connected pixels toggle', () => {
    render(<MagicWandControls />);

    const connectedToggle = screen.getByRole('checkbox');
    fireEvent.click(connectedToggle);

    expect(mockSetWandSettings).toHaveBeenCalledWith({ contiguous: false });
  });
});
