/* eslint-disable @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import LoadProjectModal from '../LoadProjectModal';

jest.mock('@/hooks/useKeyboardScope', () => ({
  useKeyboardScope: jest.fn(),
}));

const mockStore = {
  importProject: jest.fn(),
  toggleModal: jest.fn(),
  addNotification: jest.fn(),
};

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: (selector: any) => selector(mockStore),
}));

const createDirectoryHandle = (count: number) => {
  const fileHandles = Array.from({ length: count }, (_, index) => {
    const name = `project-${String(index).padStart(4, '0')}.vs`;
    return {
      kind: 'file',
      name,
      getFile: jest.fn(async () => new File(['project'], name, {
        lastModified: 1704067200000 + index,
      })),
    };
  });
  return {
    fileHandles,
    directoryHandle: {
      kind: 'directory',
      name: 'projects',
      entries: async function* () {
        for (const handle of fileHandles) {
          yield [handle.name, handle] as unknown as [string, FileSystemHandle];
        }
      },
    } as unknown as FileSystemDirectoryHandle,
  };
};

describe('LoadProjectModal large-folder performance', () => {
  it.each([
    { fileCount: 500, firstPaintBudgetMs: 250 },
    { fileCount: 1000, firstPaintBudgetMs: 450 },
  ])('renders a virtualized $fileCount-file list within budget', async ({
    fileCount,
    firstPaintBudgetMs,
  }) => {
    const { directoryHandle, fileHandles } = createDirectoryHandle(fileCount);
    (window as Window & {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker = jest.fn(async () => directoryHandle);
    render(<LoadProjectModal isOpen onClose={jest.fn()} />);
    const startedAt = performance.now();

    fireEvent.click(await screen.findByRole('button', { name: 'Browse Folder' }));
    await waitFor(() => {
      const projectButtons = screen.queryAllByRole('button')
        .filter((button) => button.textContent?.includes('project-'));
      expect(projectButtons.length).toBeGreaterThan(0);
    });
    const firstPaintMs = performance.now() - startedAt;

    expect(firstPaintMs).toBeLessThan(firstPaintBudgetMs);
    const renderedProjectButtons = screen.getAllByRole('button')
      .filter((button) => button.textContent?.includes('project-'));
    expect(renderedProjectButtons.length).toBeGreaterThan(0);
    expect(renderedProjectButtons.length).toBeLessThan(30);
    await waitFor(() => {
      const timestampReads = fileHandles.reduce(
        (total, handle) => total + handle.getFile.mock.calls.length,
        0,
      );
      expect(timestampReads).toBe(40);
    });
  });
});
