/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import LoadProjectModal from '../LoadProjectModal';

jest.mock('@/hooks/useKeyboardScope', () => ({
  useKeyboardScope: jest.fn(),
}));

const mockStore = {
  importProject: jest.fn(),
  toggleModal: jest.fn(),
};

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: (selector: any) => selector(mockStore),
}));

describe('LoadProjectModal', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders headings and primary actions when open', () => {
    render(<LoadProjectModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    expect(screen.getAllByText('Load Project')[0]).toBeInTheDocument();
    expect(screen.getByText('Browse Files')).toBeInTheDocument();
    expect(screen.getByText('Browse Folder')).toBeInTheDocument();
  });

  it('invokes onClose when Close button is clicked', () => {
    const onClose = jest.fn();
    render(<LoadProjectModal isOpen onClose={onClose} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getAllByText('Close')[0]);
    expect(onClose).toHaveBeenCalled();
  });
});
