import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { AppNotifications } from '@/components/AppNotifications';
import { useAppStore } from '@/stores/useAppStore';
import type { Notification } from '@/types';

const originalUI = useAppStore.getState().ui;
const notify = (type: Notification['type'], title: string, message: string) => {
  act(() => { useAppStore.getState().addNotification({ type, title, message, timestamp: new Date(0) }); });
  return useAppStore.getState().ui.notifications.at(-1)!;
};

describe('AppNotifications', () => {
  beforeEach(() => { act(() => { useAppStore.setState({ ui: { ...originalUI, notifications: [] } }); }); });
  afterEach(() => { act(() => { useAppStore.setState({ ui: originalUI }); }); });

  it('displays the actual merge warning published after mounting', () => {
    render(<AppNotifications />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    notify('warning', 'Layers were not merged', 'These layers cannot be merged without changing their current appearance.');
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Layers were not merged')).toBeInTheDocument();
    expect(within(alert).getByText('These layers cannot be merged without changing their current appearance.')).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Dismiss notification' })).toHaveClass('h-6', 'w-6');
  });

  it('dismisses only the current actionable item and advances the queue past informational items', () => {
    const info = notify('info', 'Information', 'Informational state');
    const warning = notify('warning', 'First warning', 'First warning message');
    const error = notify('error', 'Next error', 'Next error message');
    const otherUI = useAppStore.getState().ui;
    render(<AppNotifications />);
    expect(screen.getByRole('alert')).toHaveTextContent('First warning');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(useAppStore.getState().ui.notifications.map(item => item.id)).toEqual([info.id, error.id]);
    expect(useAppStore.getState().ui.notifications.some(item => item.id === warning.id)).toBe(false);
    expect(useAppStore.getState().ui.modals).toBe(otherUI.modals);
    expect(screen.getByRole('alert')).toHaveTextContent('Next error');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(useAppStore.getState().ui.notifications).toEqual([info]);
  });

  it('shows a generic error title and message', () => {
    notify('error', 'Save failed', 'The destination is unavailable.');
    render(<AppNotifications />);
    expect(screen.getByRole('alert')).toHaveTextContent('Save failed');
    expect(screen.getByRole('alert')).toHaveTextContent('The destination is unavailable.');
    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeEnabled();
  });

  it('keeps critical history recovery first and non-dismissible with the existing fatal alert style', () => {
    notify('warning', 'Queued warning', 'Queued warning message');
    const critical = notify('error', 'History recovery failed', 'Save a copy before continuing.');
    notify('error', 'Queued error', 'Queued error message');
    render(<AppNotifications />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('History recovery failed');
    expect(alert).toHaveTextContent('Save a copy before continuing.');
    expect(alert).toHaveClass('border-red-400', 'bg-[#2a1111]', 'z-[100]');
    expect(screen.queryByRole('button', { name: 'Dismiss notification' })).not.toBeInTheDocument();
    expect(screen.queryByText('Queued warning')).not.toBeInTheDocument();
    act(() => { useAppStore.getState().removeNotification(critical.id); });
    expect(screen.getByRole('alert')).toHaveTextContent('Queued warning');
  });

  it('does not render an empty notification host', () => {
    const { container } = render(<AppNotifications />);
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps informational and success notifications hidden', () => {
    notify('info', 'Info only', 'Info message');
    notify('success', 'Success only', 'Success message');
    render(<AppNotifications />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismiss notification' })).not.toBeInTheDocument();
    expect(screen.queryByText('Info only')).not.toBeInTheDocument();
    expect(screen.queryByText('Success only')).not.toBeInTheDocument();
  });
});
