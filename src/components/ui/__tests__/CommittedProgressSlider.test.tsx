import React from 'react';
import { fireEvent, render } from '@testing-library/react';

import CommittedProgressSlider from '../CommittedProgressSlider';

describe('CommittedProgressSlider', () => {
  it('commits latest value when pointer is released outside slider', () => {
    const onChange = jest.fn();
    const onPreview = jest.fn();
    const onCommit = jest.fn();
    const { getByRole } = render(
      <CommittedProgressSlider
        value={0.2}
        min={0.1}
        max={1}
        step={0.01}
        onChange={onChange}
        onPreview={onPreview}
        onCommit={onCommit}
        aria-label="Speed"
      />
    );

    const slider = getByRole('slider');
    fireEvent.pointerDown(slider, { pointerId: 1 });
    fireEvent.change(slider, { target: { value: '0.62' } });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(onPreview).toHaveBeenCalledWith(0.62);
    expect(onChange).toHaveBeenCalledWith(0.62, 0.2);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('keeps the drag baseline when live preview updates the controlled value', () => {
    const onChange = jest.fn();
    const Harness = () => {
      const [value, setValue] = React.useState(10);
      return (
        <CommittedProgressSlider
          value={value}
          min={2}
          max={64}
          onChange={onChange}
          onPreview={setValue}
          aria-label="Pattern size"
        />
      );
    };
    const { getByRole } = render(<Harness />);
    const slider = getByRole('slider');

    fireEvent.pointerDown(slider, { pointerId: 1 });
    fireEvent.change(slider, { target: { value: '16' } });
    expect(slider).toHaveValue('16');
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(onChange).toHaveBeenCalledWith(16, 10);
  });
});
