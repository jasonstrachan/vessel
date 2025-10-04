import { ShapeFillScheduler } from '../ShapeFillScheduler';
import type { StrokeJob, FieldGeneratorResult } from '../types';

describe('ShapeFillScheduler', () => {
  const makeStubResult = (jobId: string): FieldGeneratorResult => ({
    jobId,
    tiles: [],
    vertexBuffer: {} as unknown as GPUBuffer,
    metrics: {
      tilesProcessed: 0,
      workgroupsDispatched: 0,
      generationTimeMs: 0,
    },
    release: jest.fn(),
  });

  const baseJob: StrokeJob = {
    id: 'job-1',
    vertices: new Float32Array([0, 0, 1, 0, 0, 1]),
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    brushSettings: {} as any,
    previewResolution: { width: 1, height: 1, scale: 0.5, fieldResolution: 1 },
    finalResolution: { width: 1, height: 1, scale: 1, fieldResolution: 1 },
    pixelMode: true,
  };

  it('processes preview jobs through the injected generator', async () => {
    const stubResult = makeStubResult(baseJob.id);
    const generate = jest.fn().mockResolvedValue(stubResult);
    const scheduler = new ShapeFillScheduler({ fieldGenerator: { generate } });

    const result = await scheduler.queueJob(baseJob, { priority: 'preview', cacheResult: false });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.fieldResult).toBe(stubResult);
    result.release();
    expect(stubResult.release).toHaveBeenCalledTimes(1);
  });

  it('reuses cached results when available', async () => {
    const stubResult = makeStubResult(baseJob.id);
    const generate = jest.fn().mockResolvedValue(stubResult);
    const scheduler = new ShapeFillScheduler({ fieldGenerator: { generate }, cacheResultsByDefault: false });

    const first = await scheduler.queueJob(baseJob, { priority: 'final', cacheResult: true });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(stubResult.release).not.toHaveBeenCalled();

    const second = await scheduler.queueJob(baseJob, { priority: 'final', reuseCache: true });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(second.diagnostics.fromCache).toBe(true);

    second.release();
    first.release();
    expect(stubResult.release).not.toHaveBeenCalled();

    scheduler.invalidate(baseJob.id);
    expect(stubResult.release).toHaveBeenCalledTimes(1);
  });

  it('cancels stale preview jobs when newer previews are queued', async () => {
    const firstResult = makeStubResult(baseJob.id);
    const secondResult = makeStubResult(baseJob.id);

    let resolveFirst: ((value: FieldGeneratorResult) => void) | null = null;
    const generate = jest
      .fn<Promise<FieldGeneratorResult | null>, [StrokeJob]>()
      .mockImplementationOnce(() => new Promise<FieldGeneratorResult>(resolve => {
        resolveFirst = resolve;
      }))
      .mockResolvedValue(secondResult);

    const scheduler = new ShapeFillScheduler({ fieldGenerator: { generate }, cacheResultsByDefault: false });

    const firstPromise = scheduler.queueJob(baseJob, { priority: 'preview', cacheResult: false });
    await Promise.resolve();

    const secondPromise = scheduler.queueJob(baseJob, { priority: 'preview', cacheResult: false });

    expect(resolveFirst).not.toBeNull();
    resolveFirst!(firstResult);

    await expect(firstPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(firstResult.release).toHaveBeenCalledTimes(1);

    const second = await secondPromise;
    expect(generate).toHaveBeenCalledTimes(2);
    expect(second.fieldResult).toBe(secondResult);

    second.release();
  });

  it('merges job updates before execution', async () => {
    const stubResult = makeStubResult(baseJob.id);
    const generate = jest
      .fn<Promise<FieldGeneratorResult | null>, [StrokeJob]>()
      .mockImplementation(async job => {
        expect(job.brushSettings?.flowSeedSpacing).toBe(24);
        expect(job.seed).toBe(42);
        expect(job.dynamicParams?.spacing).toBe(24);
        expect(job.pendingGizmo).toBe(true);
        return stubResult;
      });

    const scheduler = new ShapeFillScheduler({ fieldGenerator: { generate }, cacheResultsByDefault: false });

    scheduler.dispatchJobUpdate({
      jobId: baseJob.id,
      brushSettingsPatch: { flowSeedSpacing: 24 },
      seed: 42,
      params: { spacing: 24, pendingGizmo: 1 },
    });

    const result = await scheduler.queueJob(baseJob, { priority: 'preview', cacheResult: false });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.job.brushSettings?.flowSeedSpacing).toBe(24);
    expect(result.job.seed).toBe(42);
    expect(result.job.dynamicParams?.spacing).toBe(24);
    expect(result.job.pendingGizmo).toBe(true);

    result.release();
  });

  it('applies job updates when serving cached results', async () => {
    const stubResult = makeStubResult(baseJob.id);
    const generate = jest.fn().mockResolvedValue(stubResult);
    const scheduler = new ShapeFillScheduler({ fieldGenerator: { generate }, cacheResultsByDefault: false });

    const first = await scheduler.queueJob(baseJob, { priority: 'preview', cacheResult: true });
    first.release();
    expect(generate).toHaveBeenCalledTimes(1);

    scheduler.dispatchJobUpdate({
      jobId: baseJob.id,
      brushSettingsPatch: { flowSeedSpacing: 42 },
      params: { pendingGizmo: 1 },
    });

    const second = await scheduler.queueJob(baseJob, { priority: 'preview', reuseCache: true });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(second.diagnostics.fromCache).toBe(true);
    expect(second.job.brushSettings?.flowSeedSpacing).toBe(42);
    expect(second.job.pendingGizmo).toBe(true);
    second.release();
  });

  it('stores CPU field entries for reuse', () => {
    const scheduler = new ShapeFillScheduler();
    const field = { field: [[1]], cols: 1, rows: 1 };
    scheduler.setCpuField('cpu-job', field);
    expect(scheduler.getCpuField<typeof field>('cpu-job')).toBe(field);
    scheduler.invalidate('cpu-job');
    expect(scheduler.getCpuField<typeof field>('cpu-job')).toBeUndefined();
  });
});
