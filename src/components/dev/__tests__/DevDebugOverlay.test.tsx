import { act, fireEvent, render, screen } from '@testing-library/react';

import DevDebugOverlay from '@/components/dev/DevDebugOverlay';
import {
  appendDevDebugOverlayEntry,
  clearDevDebugOverlayEntries,
  setDevDebugOverlayEnabled,
} from '@/utils/dev/debugOverlayStore';

describe('DevDebugOverlay', () => {
  beforeEach(() => {
    window.localStorage.clear();
    act(() => {
      clearDevDebugOverlayEntries();
      setDevDebugOverlayEnabled(false);
    });
  });

  afterEach(() => {
    act(() => {
      clearDevDebugOverlayEntries();
      setDevDebugOverlayEnabled(false);
    });
  });

  it('renders a vertically scrollable log window when enabled', () => {
    act(() => {
      setDevDebugOverlayEnabled(true);

      for (let index = 0; index < 30; index += 1) {
        appendDevDebugOverlayEntry({
          source: 'cc',
          level: 'log',
          message: `entry-${index}`,
        });
      }
    });

    render(<DevDebugOverlay />);

    act(() => {
      window.dispatchEvent(new CustomEvent('dev-debug-overlay-update'));
    });

    expect(screen.getByLabelText('dev-debug-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('dev-debug-overlay-scroll-region')).toHaveClass(
      'overflow-y-auto',
      'overscroll-contain',
    );
  });

  it('stays mounted while minimized and expands again', () => {
    act(() => {
      setDevDebugOverlayEnabled(true);
      appendDevDebugOverlayEntry({
        source: 'cc',
        level: 'log',
        message: 'entry-0',
      });
    });

    render(<DevDebugOverlay />);

    act(() => {
      window.dispatchEvent(new CustomEvent('dev-debug-overlay-update'));
    });

    expect(screen.getByLabelText('dev-debug-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('dev-debug-overlay-scroll-region')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'minimize' }));

    expect(screen.getByLabelText('dev-debug-overlay')).toBeInTheDocument();
    expect(screen.queryByTestId('dev-debug-overlay-scroll-region')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'expand' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'expand' }));

    expect(screen.getByTestId('dev-debug-overlay-scroll-region')).toBeInTheDocument();
  });
});
