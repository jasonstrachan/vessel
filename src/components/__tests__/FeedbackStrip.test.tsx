import { act, render, screen } from '@testing-library/react';

import FeedbackStrip from '@/components/FeedbackStrip';

describe('FeedbackStrip', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('dismisses default canvas feedback quickly', () => {
    const onClose = jest.fn();

    render(<FeedbackStrip message="Canvas warning" onClose={onClose} />);

    expect(screen.getByText('Canvas warning')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1199);
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(151);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('restarts the timer when the message changes', () => {
    const onClose = jest.fn();
    const { rerender } = render(<FeedbackStrip message="First warning" onClose={onClose} />);

    act(() => {
      jest.advanceTimersByTime(800);
    });

    rerender(<FeedbackStrip message="Second warning" onClose={onClose} />);

    act(() => {
      jest.advanceTimersByTime(550);
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(800);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending fade close when the message changes', () => {
    const onClose = jest.fn();
    const { rerender } = render(<FeedbackStrip message="First warning" onClose={onClose} />);

    act(() => {
      jest.advanceTimersByTime(1200);
    });

    rerender(<FeedbackStrip message="Second warning" onClose={onClose} />);

    act(() => {
      jest.advanceTimersByTime(151);
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1048);
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(151);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
