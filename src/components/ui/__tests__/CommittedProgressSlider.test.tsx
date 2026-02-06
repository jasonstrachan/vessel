import React from 'react';
import { fireEvent, render } from '@testing-library/react';

import CommittedProgressSlider from '../CommittedProgressSlider';

describe('CommittedProgressSlider', () => {
  it('commits latest value when pointer is released outside slider', () => {
    const onChange = jest.fn();
    const onCommit = jest.fn();
    const { getByRole } = render(
      <CommittedProgressSlider
        value={0.2}
        min={0.1}
        max={1}
        step={0.01}
        onChange={onChange}
        onCommit={onCommit}
        aria-label="Speed"
      />
    );

    const slider = getByRole('slider');
    fireEvent.pointerDown(slider, { pointerId: 1 });
    fireEvent.change(slider, { target: { value: '0.62' } });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(onChange).toHaveBeenCalledWith(0.62);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
