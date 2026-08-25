import { fireEvent, render, screen } from '@testing-library/react';

import LabeledRangeSlider from '@/components/ui/LabeledRangeSlider';

describe('LabeledRangeSlider', () => {
  beforeAll(() => {
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  it('exposes both endpoints and updates either thumb as one ordered range', () => {
    const onChange = jest.fn();
    render(
      <LabeledRangeSlider
        label="Res"
        value={[2, 8]}
        min={1}
        max={64}
        onChange={onChange}
        minAriaLabel="Resolution minimum"
        maxAriaLabel="Resolution maximum"
      />,
    );

    const minimum = screen.getByRole('slider', { name: 'Resolution minimum' });
    const maximum = screen.getByRole('slider', { name: 'Resolution maximum' });
    expect(minimum).toHaveAttribute('aria-valuenow', '2');
    expect(maximum).toHaveAttribute('aria-valuenow', '8');
    expect(screen.getByText('2–8')).toBeInTheDocument();

    minimum.focus();
    fireEvent.keyDown(minimum, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith([3, 8]);

    maximum.focus();
    fireEvent.keyDown(maximum, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith([2, 7]);
  });
});
