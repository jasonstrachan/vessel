import { writeFileInRevisionOrder } from '@/utils/revisionedFileWrite';

const makeHandle = (): FileSystemFileHandle => (
  { kind: 'file', name: 'project.vs' } as FileSystemFileHandle
);

describe('writeFileInRevisionOrder', () => {
  it('runs a newer revision after an older write already in progress', async () => {
    const handle = makeHandle();
    let releaseOlder: (() => void) | undefined;
    let markOlderStarted: (() => void) | undefined;
    const olderGate = new Promise<void>((resolve) => {
      releaseOlder = resolve;
    });
    const olderStarted = new Promise<void>((resolve) => {
      markOlderStarted = resolve;
    });
    const writes: number[] = [];

    const older = writeFileInRevisionOrder(
      handle,
      { projectId: 'project', revision: 1 },
      async () => {
        markOlderStarted?.();
        await olderGate;
        writes.push(1);
      },
    );
    await olderStarted;
    const newer = writeFileInRevisionOrder(
      handle,
      { projectId: 'project', revision: 2 },
      async () => {
        writes.push(2);
      },
    );

    releaseOlder?.();
    await Promise.all([older, newer]);

    expect(writes).toEqual([1, 2]);
  });

  it('suppresses an older revision once a newer write is scheduled', async () => {
    const handle = makeHandle();
    const newerWrite = jest.fn(async () => undefined);
    const olderWrite = jest.fn(async () => undefined);

    const newer = writeFileInRevisionOrder(
      handle,
      { projectId: 'project', revision: 2 },
      newerWrite,
    );
    const older = await writeFileInRevisionOrder(
      handle,
      { projectId: 'project', revision: 1 },
      olderWrite,
    );
    await newer;

    expect(older).toEqual({ status: 'superseded' });
    expect(olderWrite).not.toHaveBeenCalled();
    expect(newerWrite).toHaveBeenCalledTimes(1);
  });

  it('coordinates distinct handles that point to the same file entry', async () => {
    const first = makeHandle();
    const second = {
      kind: 'file',
      name: 'project.vs',
      isSameEntry: jest.fn(async (candidate: FileSystemHandle) => candidate === first),
    } as unknown as FileSystemFileHandle;
    const newerWrite = jest.fn(async () => undefined);
    const olderWrite = jest.fn(async () => undefined);

    const newer = writeFileInRevisionOrder(
      first,
      { projectId: 'project', revision: 4 },
      newerWrite,
    );
    const older = await writeFileInRevisionOrder(
      second,
      { projectId: 'project', revision: 3 },
      olderWrite,
    );
    await newer;

    expect(second.isSameEntry).toHaveBeenCalledWith(first);
    expect(older).toEqual({ status: 'superseded' });
    expect(olderWrite).not.toHaveBeenCalled();
  });
});
