import { createBitmapTileDelta } from '@/history/deltas/bitmapDelta';
import * as blobs from '@/history/blobStore';

describe('bitmap delta preparation ownership', () => {
  beforeEach(() => blobs.clearBlobStore());
  afterEach(() => { jest.restoreAllMocks(); blobs.clearBlobStore(); });

  it.each([2, 3, 4])('releases every acquired reference when allocation %i rejects', async (failureAt) => {
    const before = new ImageData(new Uint8ClampedArray(4 * 2 * 4).fill(1), 4, 2);
    const after = new ImageData(new Uint8ClampedArray(4 * 2 * 4).fill(2), 4, 2);
    // Both tiles dedupe against this independent live history owner. Failure
    // cleanup must drop only the candidate delta's references.
    const existing = await createBitmapTileDelta({ layerId: 'existing', before, after, tileSize: 2 });
    const baseline = blobs.getHistoryBlobMetrics();
    const originalStore = blobs.storeBlob;
    let calls = 0;
    const storage = jest.spyOn(blobs, 'storeBlob').mockImplementation((buffer) => {
      calls += 1;
      return calls === failureAt ? Promise.reject(new Error('allocation refused')) : originalStore(buffer);
    });
    await expect(createBitmapTileDelta({ layerId: 'candidate', before, after, tileSize: 2 }))
      .rejects.toThrow('allocation refused');
    const failed = blobs.getHistoryBlobMetrics();
    expect([failed.blobCount, failed.totalBytes, failed.refCount])
      .toEqual([baseline.blobCount, baseline.totalBytes, baseline.refCount]);
    storage.mockRestore();
    const retried = await createBitmapTileDelta({ layerId: 'candidate', before, after, tileSize: 2 });
    expect(retried).not.toBeNull();
    retried!.dispose?.();
    existing!.dispose?.();
    expect(blobs.getHistoryBlobMetrics()).toMatchObject({ blobCount: 0, totalBytes: 0, refCount: 0 });
  });
});
