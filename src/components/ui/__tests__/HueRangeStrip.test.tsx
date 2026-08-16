import React from 'react';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';

import HueRangeStrip from '@/components/ui/HueRangeStrip';

describe('HueRangeStrip', () => {
  it('keeps the two handles separated for the full 0 to 360 range', () => {
    render(
      <HueRangeStrip
        value={[0, 360]}
        onValueChange={jest.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Hue range start' })).toHaveStyle({
      left: '0%',
    });
    expect(screen.getByRole('button', { name: 'Hue range end' })).toHaveStyle({
      left: '100%',
    });
  });

  it('drags a handle across the strip and commits once at pointer end', () => {
    const onValueChange = jest.fn();
    const onCommit = jest.fn();
    render(
      <HueRangeStrip
        value={[0, 360]}
        onValueChange={onValueChange}
        onCommit={onCommit}
      />,
    );

    const track = screen.getByLabelText('Target hue range').firstElementChild as HTMLDivElement;
    jest.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 360,
      bottom: 24,
      width: 360,
      height: 24,
      toJSON: () => ({}),
    });

    const startHandle = screen.getByRole('button', { name: 'Hue range start' });
    const pointerDown = createEvent.pointerDown(startHandle);
    Object.defineProperties(pointerDown, {
      pointerId: { value: 7 },
      clientX: { value: 0 },
    });
    fireEvent(startHandle, pointerDown);

    const pointerMove = createEvent.pointerMove(window);
    Object.defineProperties(pointerMove, {
      pointerId: { value: 7 },
      clientX: { value: 180 },
    });
    fireEvent(window, pointerMove);
    expect(onValueChange).toHaveBeenLastCalledWith([180, 360]);

    const pointerUp = createEvent.pointerUp(window);
    Object.defineProperties(pointerUp, {
      pointerId: { value: 7 },
      clientX: { value: 180 },
    });
    fireEvent(window, pointerUp);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
