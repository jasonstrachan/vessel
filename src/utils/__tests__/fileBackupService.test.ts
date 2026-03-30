import { FileBackupService } from '@/utils/fileBackupService';

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
