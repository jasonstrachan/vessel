import React from 'react';
import { render, screen } from '@testing-library/react';
import { ModuleHeader } from '../ModuleHeader';

test('collapsed module keeps recording and failure status accessible without changing its name', () => {
  const { rerender } = render(<ModuleHeader title="Replay" expanded={false} onToggle={() => {}} status="Rec" statusLabel="Recording painting" />);
  expect(screen.getByRole('button', { name: 'Replay' })).toHaveAccessibleDescription('Recording painting');
  rerender(<ModuleHeader title="Replay" expanded={false} onToggle={() => {}} status="!" statusLabel="Recording paused: storage full" />);
  expect(screen.getByRole('button', { name: 'Replay' })).toHaveAccessibleDescription('Recording paused: storage full');
});

test('sequence status is described without announcing every animation frame', () => {
  render(<ModuleHeader title="Sequence" expanded={false} onToggle={() => {}} status="3/16 • Capturing" />);
  const button = screen.getByRole('button', { name: 'Sequence' });
  expect(button).toHaveAccessibleDescription('3/16 • Capturing');
  expect(document.getElementById(button.getAttribute('aria-describedby')!)).not.toHaveAttribute('aria-live');
});
