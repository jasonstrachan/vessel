import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { DocumentModal } from '@/components/modals/DocumentModal';

jest.mock('@/hooks/useKeyboardScope', () => ({
  useKeyboardScope: jest.fn(),
}));

const mockNewProject = jest.fn();

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: () => ({
    project: {
      width: 2000,
      height: 2000,
    },
    newProject: mockNewProject,
    resizeCanvas: jest.fn(),
    beginCanvasShapeEdit: jest.fn(),
  }),
}));

describe('DocumentModal', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('selects a proportional size variant and creates that document', () => {
    render(<DocumentModal isOpen onClose={jest.fn()} />);

    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'New Document',
      'Resize Canvas',
      'Canvas Shape',
    ]);

    const preset = screen.getByRole('button', {
      name: 'Set 4:3 Landscape to 512×384',
    });
    const qhdPreset = screen.getByRole('button', {
      name: 'Set 16:9 Cinematic to 2560×1440',
    });
    const fourKPreset = screen.getByRole('button', {
      name: 'Set 16:9 Cinematic to 3840×2160',
    });

    expect(preset).toHaveAttribute('aria-pressed', 'false');
    expect(preset).not.toHaveAttribute('title');
    expect(preset.className).not.toMatch(/\brounded(?:-|$)/);
    expect(qhdPreset).toBeInTheDocument();

    fireEvent.click(fourKPreset);
    const memoryWarning = screen.getByText(/Large document/).parentElement;
    expect(memoryWarning).not.toHaveAttribute('title');
    expect(memoryWarning).toHaveTextContent(/Editing may slow down/);

    fireEvent.click(preset);

    expect(preset).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'New Document' }));

    expect(mockNewProject).toHaveBeenCalledWith(512, 384);
  });
});
