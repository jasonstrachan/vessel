import { sortDirectoryProjectEntries } from '@/components/modals/hooks/useProjectDirectoryBrowser';
import type { DirectoryProjectEntry } from '@/components/modals/types';

const createEntry = (name: string): DirectoryProjectEntry => ({
  name,
  handle: {} as FileSystemFileHandle,
});

describe('sortDirectoryProjectEntries', () => {
  it('sorts reverse alphanumeric with dotted numeric names in expected order', () => {
    const sorted = sortDirectoryProjectEntries([
      createEntry('7.vessel'),
      createEntry('7.1.vessel'),
      createEntry('7.2.vessel'),
      createEntry('6.9.vessel'),
    ]);

    expect(sorted.map((entry) => entry.name)).toEqual([
      '7.2.vessel',
      '7.1.vessel',
      '7.vessel',
      '6.9.vessel',
    ]);
  });

  it('keeps number-prefixed names below letter-prefixed names', () => {
    const sorted = sortDirectoryProjectEntries([
      createEntry('7.vessel'),
      createEntry('7.1.vessel'),
      createEntry('7.2.vessel'),
      createEntry('Alpha.vessel'),
    ]);

    expect(sorted.map((entry) => entry.name)).toEqual([
      'Alpha.vessel',
      '7.2.vessel',
      '7.1.vessel',
      '7.vessel',
    ]);
  });
});
