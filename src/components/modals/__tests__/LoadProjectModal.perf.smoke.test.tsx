/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

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

const createFileHandle = (name: string) => ({
  kind: 'file',
  name,
  getFile: jest.fn(async () => new File(['x'], name, { lastModified: Date.now() })),
});

const createDirectoryHandle = (count: number) => ({
  kind: 'directory',
  name: 'projects',
  entries: async function* () {
    for (let i = 0; i < count; i += 1) {
      const name = `project-${String(i).padStart(4, '0')}.vs`;
      yield [name, createFileHandle(name)] as unknown as [string, FileSystemHandle];
    }
  },
});

describe('LoadProjectModal performance smoke', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const first = args[0];
      if (typeof first === 'string' && first.includes('not wrapped in act')) {
        return;
      }
      console.warn(...args);
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    consoleErrorSpy.mockRestore();
  });

  it('renders folder list for 500 files within smoke threshold', async () => {
    jest.useRealTimers();
    (window as any).showDirectoryPicker = jest.fn(async () => createDirectoryHandle(500));

    render(<LoadProjectModal isOpen onClose={jest.fn()} />);
    await screen.findByRole('heading', { name: 'Load Project' });

    const start = performance.now();
    fireEvent.click(screen.getByText('Browse Folder'));
    await screen.findByText('project-0000.vs');
    const elapsedMs = performance.now() - start;

    // Smoke threshold: intentionally generous to catch regressions without flakiness.
    expect(elapsedMs).toBeLessThan(1000);
  });

  it('renders folder list for 1000 files within smoke threshold', async () => {
    jest.useRealTimers();
    (window as any).showDirectoryPicker = jest.fn(async () => createDirectoryHandle(1000));

    render(<LoadProjectModal isOpen onClose={jest.fn()} />);
    await screen.findByRole('heading', { name: 'Load Project' });

    const start = performance.now();
    fireEvent.click(screen.getByText('Browse Folder'));
    await screen.findByText('project-0000.vs');
    const elapsedMs = performance.now() - start;

    // Smoke threshold: intentionally generous to catch regressions without flakiness.
    expect(elapsedMs).toBeLessThan(1500);
  });

  it('renders sorted entries so first paint shows alphanumeric ordering', async () => {
    jest.useRealTimers();
    (window as any).showDirectoryPicker = jest.fn(async () => ({
      kind: 'directory',
      name: 'projects',
      entries: async function* () {
        yield ['project-10.vs', createFileHandle('project-10.vs')] as unknown as [string, FileSystemHandle];
        yield ['project-2.vs', createFileHandle('project-2.vs')] as unknown as [string, FileSystemHandle];
        yield ['project-1.vs', createFileHandle('project-1.vs')] as unknown as [string, FileSystemHandle];
      },
    }));

    render(<LoadProjectModal isOpen onClose={jest.fn()} />);
    await screen.findByRole('heading', { name: 'Load Project' });

    fireEvent.click(screen.getByText('Browse Folder'));
    await screen.findByText('project-1.vs');
    const buttons = screen.getAllByRole('button');
    const labels = buttons
      .map((button) => button.textContent ?? '')
      .filter((text) => text.includes('project-'));

    expect(labels[0]).toContain('project-1.vs');
    expect(labels[1]).toContain('project-2.vs');
    expect(labels[2]).toContain('project-10.vs');
  });
});
