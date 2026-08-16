import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { HueSlider } from '@/components/ui/HueSlider';

describe('HueSlider', () => {
  beforeAll(() => {
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  it('supports keyboard preview and commit through its visible thumb', () => {
    const onValueChange = jest.fn();
    const onValueCommit = jest.fn();
    render(
      <HueSlider
        value={[0]}
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
        aria-label="Hue adjustment"
      />,
    );

    const slider = screen.getByRole('slider', { name: 'Hue adjustment' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });

    expect(onValueChange).toHaveBeenCalledWith([1]);
    expect(onValueCommit).toHaveBeenCalledWith([1]);
  });
});
