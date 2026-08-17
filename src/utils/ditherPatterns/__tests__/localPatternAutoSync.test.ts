import {
  LOCAL_PATTERN_LIBRARY_CHANGED_EVENT,
  startLocalPatternLibraryAutoSync,
  syncLocalPatternLibrary,
} from '@/utils/ditherPatterns/localPatternAutoSync';
import { localPatternDirectory } from '@/utils/ditherPatterns/localPatternDirectory';
import { localPatternLibrary } from '@/utils/ditherPatterns/localPatternLibrary';

jest.mock('@/utils/ditherPatterns/localPatternDirectory', () => ({
  localPatternDirectory: {
    sync: jest.fn(),
  },
}));

jest.mock('@/utils/ditherPatterns/localPatternLibrary', () => ({
  localPatternLibrary: {
    hydrate: jest.fn(),
  },
}));

const hydrate = localPatternLibrary.hydrate as jest.MockedFunction<typeof localPatternLibrary.hydrate>;
const syncDirectory = localPatternDirectory.sync as jest.MockedFunction<typeof localPatternDirectory.sync>;

describe('local pattern library auto-sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    hydrate.mockResolvedValue([]);
    syncDirectory.mockResolvedValue({
      status: 'not-connected',
      loadedPacks: 0,
      failedPacks: 0,
    });
  });

  it('hydrates cached packs before synchronizing a connected local folder', async () => {
    const changed = jest.fn();
    window.addEventListener(LOCAL_PATTERN_LIBRARY_CHANGED_EVENT, changed);
    syncDirectory.mockResolvedValueOnce({
      status: 'connected',
      loadedPacks: 1,
      failedPacks: 0,
    });

    await syncLocalPatternLibrary();

    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(syncDirectory).toHaveBeenCalledTimes(1);
    expect(hydrate.mock.invocationCallOrder[0]).toBeLessThan(syncDirectory.mock.invocationCallOrder[0]);
    expect(changed).toHaveBeenCalledTimes(1);
    window.removeEventListener(LOCAL_PATTERN_LIBRARY_CHANGED_EVENT, changed);
  });

  it('coalesces focus events while a startup synchronization is still running', async () => {
    let releaseHydration: (() => void) | undefined;
    hydrate.mockImplementationOnce(() => new Promise((resolve) => {
      releaseHydration = () => resolve([]);
    }));

    const stop = startLocalPatternLibraryAutoSync();
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('focus'));

    expect(hydrate).toHaveBeenCalledTimes(1);
    releaseHydration?.();
    await Promise.resolve();
    await Promise.resolve();
    stop();
  });
});
