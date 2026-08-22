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

  it('offers a Smallish preset for every format', () => {
    render(<DocumentModal isOpen onClose={jest.fn()} />);

    expect(screen.getByText('Smallish')).toBeInTheDocument();

    const expectedSmallishPresets = [
      'Set 1:1 Square to 768×768',
      'Set 3:4 Tablet / Portrait to 1152×1536',
      'Set 4:5 Portrait to 768×960',
      'Set 2:3 Vertical Art to 768×1152',
      'Set 9:16 Mobile to 540×960',
      'Set 1:√2 Print Portrait to 768×1086',
      'Set 4:3 Landscape to 1536×1152',
      'Set 5:4 Landscape to 960×768',
      'Set 3:2 Landscape to 1152×768',
      'Set 2:1 Wide Landscape to 1280×640',
      'Set 16:9 Cinematic to 1280×720',
      'Set 16:10 Display to 960×600',
      'Set √2:1 Print Landscape to 1086×768',
    ];

    expectedSmallishPresets.forEach((name) => {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    });
  });
});
