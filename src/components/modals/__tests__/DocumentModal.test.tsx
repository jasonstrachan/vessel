import React from 'react';
import userEvent from '@testing-library/user-event';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { DocumentModal } from '@/components/modals/DocumentModal';

jest.mock('@/hooks/useKeyboardScope', () => ({
  useKeyboardScope: jest.fn(),
}));

const mockNewProject = jest.fn();
const mockResizeCanvas = jest.fn();

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: () => ({
    project: {
      width: 2000,
      height: 2000,
    },
    newProject: mockNewProject,
    resizeCanvas: mockResizeCanvas,
    beginCanvasShapeEdit: jest.fn(),
  }),
}));

describe('DocumentModal', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    localStorage.removeItem('vessel-settings');
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('keeps an early opened Document mounted beyond the startup close deadline', () => {
    const onClose = jest.fn();
    const { rerender } = render(<DocumentModal isOpen={false} onClose={onClose} />);
    act(() => { jest.advanceTimersByTime(100); });
    rerender(<DocumentModal isOpen onClose={onClose} />);
    act(() => { jest.advanceTimersByTime(10); });
    expect(screen.getByRole('heading', { name: 'Document' })).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(290); });
    expect(screen.getByRole('heading', { name: 'Document' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps a quickly reopened Document mounted after the superseded close deadline', () => {
    const onClose = jest.fn();
    const { rerender } = render(<DocumentModal isOpen onClose={onClose} />);
    act(() => { jest.advanceTimersByTime(10); });
    rerender(<DocumentModal isOpen={false} onClose={onClose} />);
    act(() => { jest.advanceTimersByTime(100); });
    rerender(<DocumentModal isOpen onClose={onClose} />);
    act(() => { jest.advanceTimersByTime(300); });
    expect(screen.getByRole('heading', { name: 'Document' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not reveal a closing Document through its superseded show timer', () => {
    const { rerender } = render(<DocumentModal isOpen onClose={jest.fn()} />);
    act(() => { jest.advanceTimersByTime(5); });
    rerender(<DocumentModal isOpen={false} onClose={jest.fn()} />);
    act(() => { jest.advanceTimersByTime(5); });
    const heading = screen.getByRole('heading', { name: 'Document' });
    expect(heading.closest('.fixed.inset-0')).toHaveClass('opacity-0');
  });

  it('retains the ordinary 300ms close transition', () => {
    const onClose = jest.fn();
    const { rerender } = render(<DocumentModal isOpen onClose={onClose} />);
    act(() => { jest.advanceTimersByTime(10); });
    rerender(<DocumentModal isOpen={false} onClose={onClose} />);
    act(() => { jest.advanceTimersByTime(299); });
    expect(screen.getByRole('heading', { name: 'Document' })).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(1); });
    expect(screen.queryByRole('heading', { name: 'Document' })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([true, false])('releases its own pending transition on unmount (open=%s)', (isOpen) => {
    const scheduled = jest.spyOn(window, 'setTimeout');
    const cleared = jest.spyOn(window, 'clearTimeout');
    const unrelated = window.setTimeout(jest.fn(), 500);
    const { unmount } = render(<DocumentModal isOpen={isOpen} onClose={jest.fn()} />);
    const index = scheduled.mock.calls.findIndex(([, delay]) => delay === (isOpen ? 10 : 300));
    expect(index).toBeGreaterThanOrEqual(0);
    const owned = scheduled.mock.results[index].value as number;
    unmount();
    expect(cleared).toHaveBeenCalledWith(owned);
    expect(cleared).not.toHaveBeenCalledWith(unrelated);
    scheduled.mockRestore();
    cleared.mockRestore();
  });

  it.each([
    ['New document width', 'Width', 'New Document', [320, 960]],
    ['New document height', 'Height', 'New Document', [768, 320]],
    ['Resize canvas width', 'Width', 'Resize', [320, 2000]],
    ['Resize canvas height', 'Height', 'Resize', [2000, 320]],
  ] as const)('associates %s with its visible label and preserves dimension callbacks', async (name, text, action, dimensions) => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<DocumentModal isOpen onClose={jest.fn()} />);
    const input = screen.getByRole('spinbutton', { name }) as HTMLInputElement;
    const label = input.labels?.[0];
    expect(label).toBeDefined();
    expect(label).toHaveTextContent(text);
    expect(label?.control).toBe(input);
    expect(input.id).not.toBe('');
    await user.click(label!);
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: '320' } });
    await user.click(screen.getByRole('button', { name: action }));
    expect(action === 'Resize' ? mockResizeCanvas : mockNewProject).toHaveBeenCalledWith(...dimensions);
  });

  it('defaults new documents to the 768×960 portrait preset', () => {
    render(<DocumentModal isOpen onClose={jest.fn()} />);

    const defaultPreset = screen.getByRole('button', {
      name: 'Set 4:5 Portrait to 768×960',
    });

    expect(defaultPreset).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getAllByRole('spinbutton').map((input) => (input as HTMLInputElement).value),
    ).toEqual(['768', '960', '2000', '2000']);

    fireEvent.click(screen.getByRole('button', { name: 'New Document' }));

    expect(mockNewProject).toHaveBeenCalledWith(768, 960);
  });

  it('defaults new documents to the last used canvas size', () => {
    localStorage.setItem(
      'vessel-settings',
      JSON.stringify({
        canvas: { lastDocumentSize: { width: 1920, height: 1080 } },
      }),
    );

    render(<DocumentModal isOpen onClose={jest.fn()} />);

    expect(
      screen.getAllByRole('spinbutton').map((input) => (input as HTMLInputElement).value),
    ).toEqual(['1920', '1080', '2000', '2000']);

    fireEvent.click(screen.getByRole('button', { name: 'New Document' }));

    expect(mockNewProject).toHaveBeenCalledWith(1920, 1080);
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
    const memoryWarnings = screen.getAllByText(/Large document/).map((warning) => warning.parentElement);
    expect(memoryWarnings).toHaveLength(2);
    memoryWarnings.forEach((warning) => {
      expect(warning).not.toHaveAttribute('title');
      expect(warning).toHaveTextContent(/Editing may slow down/);
    });

    fireEvent.click(preset);

    expect(preset).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getAllByRole('spinbutton').map((input) => (input as HTMLInputElement).value),
    ).toEqual(['512', '384', '512', '384']);

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
