import { FileBackupService } from '@/utils/fileBackupService';
import { serializeProject } from '@/utils/projectIO';

jest.mock('@/utils/projectIO', () => ({
  __esModule: true as const,
  serializeProject: jest.fn(),
}));

describe('FileBackupService permission checks', () => {
  it('does not request file permission unless explicitly allowed', async () => {
    const service = new FileBackupService();
    const requestPermission = jest.fn().mockResolvedValue('granted');
    const handle = {
      queryPermission: jest.fn().mockResolvedValue('prompt'),
      requestPermission,
    } as unknown as FileSystemFileHandle;

    const hasPermission = await service.ensureFileWritePermission(handle);

    expect(hasPermission).toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('requests file permission when explicitly allowed', async () => {
    const service = new FileBackupService();
    const requestPermission = jest.fn().mockResolvedValue('granted');
    const handle = {
      queryPermission: jest.fn().mockResolvedValue('prompt'),
      requestPermission,
    } as unknown as FileSystemFileHandle;

    const hasPermission = await service.ensureFileWritePermission(handle, { requestIfNeeded: true });

    expect(hasPermission).toBe(true);
    expect(requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
  });

  it('does not request directory permission unless explicitly allowed', async () => {
    const service = new FileBackupService();
    const requestPermission = jest.fn().mockResolvedValue('granted');
    const handle = {
      queryPermission: jest.fn().mockResolvedValue('prompt'),
      requestPermission,
    } as unknown as FileSystemDirectoryHandle;

    const hasPermission = await service.ensureDirectoryWritePermission(handle);

    expect(hasPermission).toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();
  });
});

describe('FileBackupService backup targets', () => {
  it('keeps an in-flight backup bound to the handle selected at capture time', async () => {
    let resolveSerialization: ((data: Uint8Array) => void) | undefined;
    (serializeProject as jest.Mock).mockReturnValueOnce(new Promise((resolve) => {
      resolveSerialization = resolve;
    }));
    const writable = {
      write: jest.fn().mockResolvedValue(undefined),
      truncate: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      abort: jest.fn().mockResolvedValue(undefined),
    };
    const firstHandle = {
      name: 'first.vs',
      createWritable: jest.fn().mockResolvedValue(writable),
    } as unknown as FileSystemFileHandle;
    const secondHandle = {
      name: 'second.vs',
      createWritable: jest.fn(),
    } as unknown as FileSystemFileHandle;
    const service = new FileBackupService();
    service.setFileHandle(firstHandle);

    const backup = service.saveProjectBackup(
      { id: 'project-1', name: 'Project' } as never,
      [],
    );
    service.setFileHandle(secondHandle);
    resolveSerialization?.(new Uint8Array([1, 2, 3]));

    await expect(backup).resolves.toEqual({ success: true, filename: 'first.vs' });
    expect(firstHandle.createWritable).toHaveBeenCalledTimes(1);
    expect(secondHandle.createWritable).not.toHaveBeenCalled();
  });
});
