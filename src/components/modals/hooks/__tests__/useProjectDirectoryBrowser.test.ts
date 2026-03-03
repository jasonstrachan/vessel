import { sortDirectoryProjectEntries } from '@/components/modals/hooks/useProjectDirectoryBrowser';
import type { DirectoryProjectEntry } from '@/components/modals/types';

const createEntry = (name: string): DirectoryProjectEntry => ({
  name,
  handle: {} as FileSystemFileHandle,
});

describe('sortDirectoryProjectEntries', () => {
  it('places number-prefixed files at the top in natural alphanumeric order', () => {
    const sorted = sortDirectoryProjectEntries([
      createEntry('Project 2.vessel'),
      createEntry('10-intro.vessel'),
      createEntry('2-intro.vessel'),
      createEntry('Alpha.vessel'),
      createEntry('1-intro.vessel'),
      createEntry('beta.vessel'),
    ]);

    expect(sorted.map((entry) => entry.name)).toEqual([
      '1-intro.vessel',
      '2-intro.vessel',
      '10-intro.vessel',
      'Alpha.vessel',
      'beta.vessel',
      'Project 2.vessel',
    ]);
  });
});
