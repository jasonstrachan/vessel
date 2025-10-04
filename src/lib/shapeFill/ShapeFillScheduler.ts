import { FieldGenerator } from './gpu/FieldGenerator';
import { WebGPUDeviceManager } from './gpu/WebGPUDeviceManager';
import {
  FieldGeneratorConfig,
  FieldGeneratorResult,
  StrokeJob,
  StrokeJobUpdate,
  TileDescriptor,
} from './types';
import type { BrushSettings } from '@/types';

type JobPriority = 'preview' | 'final';

type ReadbackSelection = 'all' | string[];

export interface TileReadback {
  tile: TileDescriptor;
  data: Float32Array;
}

export interface ComputeDiagnostics {
  queuedAt: number;
  startedAt: number;
  completedAt: number;
  fromCache: boolean;
  readbackDurationMs?: number;
}

export interface ShapeFillSchedulerResult {
  job: StrokeJob;
  priority: JobPriority;
  fieldResult: FieldGeneratorResult | null;
  readbacks: TileReadback[];
  diagnostics: ComputeDiagnostics;
  release(): void;
}

export type ShapeFillSchedulerEvent =
  | { type: 'queued'; jobId: string; priority: JobPriority }
  | { type: 'started'; jobId: string; priority: JobPriority }
  | {
      type: 'completed';
      jobId: string;
      priority: JobPriority;
      metrics?: FieldGeneratorResult['metrics'];
      diagnostics: ComputeDiagnostics;
    }
  | { type: 'cancelled'; jobId: string; priority: JobPriority; reason: 'abort' | 'cache-hit' }
  | { type: 'failed'; jobId: string; priority: JobPriority; error: unknown }
  | { type: 'readback'; jobId: string; tileId: string; bytes: number; durationMs: number }
  | { type: 'updated'; jobId: string; update: StrokeJobUpdate };

export interface ShapeFillSchedulerConfig extends FieldGeneratorConfig {
  maxCachedResults?: number;
  cacheResultsByDefault?: boolean;
  fieldGenerator?: Pick<FieldGenerator, 'generate'>;
}

interface QueuedJob {
  job: StrokeJob;
  priority: JobPriority;
  reuseCache: boolean;
  cacheResult: boolean;
  readbackSelection: ReadbackSelection | null;
  resolve: (result: ShapeFillSchedulerResult) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  queuedAt: number;
  cancelled: boolean;
  cancelReason?: 'abort';
  abortHandler?: () => void;
}

interface CachedResult {
  result: FieldGeneratorResult;
  priority: JobPriority;
  retains: number;
}

const DEFAULT_MAX_CACHED_RESULTS = 4;

const isPreviewPriority = (priority: JobPriority): boolean => priority === 'preview';

const now = (): number => (typeof performance !== 'undefined' && typeof performance.now === 'function'
  ? performance.now()
  : Date.now());

const createAbortError = (message: string): Error => {
  if (typeof DOMException !== 'undefined') {
    return new DOMException(message, 'AbortError');
  }
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
};

export class ShapeFillScheduler {
  private readonly generator: Pick<FieldGenerator, 'generate'>;

  private readonly deviceManager: WebGPUDeviceManager;

  private readonly maxCachedResults: number;

  private readonly cacheResultsByDefault: boolean;

  private readonly queue: QueuedJob[] = [];

  private activeJob: QueuedJob | null = null;

  private readonly cache = new Map<string, CachedResult>();

  private readonly listeners = new Set<(event: ShapeFillSchedulerEvent) => void>();

  private readonly cpuFieldCache = new Map<string, unknown>();

  private readonly jobUpdates = new Map<string, StrokeJobUpdate>();

  constructor(config: ShapeFillSchedulerConfig = {}) {
    if (config.fieldGenerator) {
      this.generator = config.fieldGenerator;
    } else {
      this.generator = new FieldGenerator(config);
    }

    this.deviceManager = WebGPUDeviceManager.getInstance();
    this.maxCachedResults = config.maxCachedResults ?? DEFAULT_MAX_CACHED_RESULTS;
    this.cacheResultsByDefault = config.cacheResultsByDefault ?? false;
  }

  subscribe(listener: (event: ShapeFillSchedulerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispatchJobUpdate(update: StrokeJobUpdate): void {
    const existing = this.jobUpdates.get(update.jobId);
    const mergedParams = {
      ...(existing?.params ?? {}),
      ...(update.params ?? {}),
    };
    const mergedBrushPatch = {
      ...(existing?.brushSettingsPatch ?? {}),
      ...(update.brushSettingsPatch ?? {}),
    };

    const merged: StrokeJobUpdate = {
      jobId: update.jobId,
      brushSettingsPatch: Object.keys(mergedBrushPatch).length ? mergedBrushPatch : undefined,
      seed: update.seed ?? existing?.seed,
      params: Object.keys(mergedParams).length ? mergedParams : undefined,
    };

    this.jobUpdates.set(update.jobId, merged);
    this.emit({ type: 'updated', jobId: update.jobId, update: merged });
  }

  getJobUpdate(jobId: string): StrokeJobUpdate | undefined {
    return this.jobUpdates.get(jobId);
  }

  queueJob(
    job: StrokeJob,
    options: {
      priority?: JobPriority;
      reuseCache?: boolean;
      cacheResult?: boolean;
      readback?: ReadbackSelection | boolean;
      signal?: AbortSignal;
    } = {}
  ): Promise<ShapeFillSchedulerResult> {
    const priority = options.priority ?? 'preview';
    const reuseCache = options.reuseCache ?? true;
    const cacheResult = options.cacheResult ?? this.cacheResultsByDefault;
    const readbackSelection = options.readback === true ? 'all' : options.readback || null;

    const existingCached = reuseCache ? this.cache.get(job.id) : undefined;
    if (existingCached) {
      existingCached.retains += 1;
      const timestamp = now();
      const diagnostics: ComputeDiagnostics = {
        queuedAt: timestamp,
        startedAt: timestamp,
        completedAt: timestamp,
        fromCache: true,
      };
      const mergedJob = this.mergeJobWithUpdate(job);
      const result: ShapeFillSchedulerResult = {
        job: mergedJob,
        priority,
        fieldResult: existingCached.result,
        readbacks: [],
        diagnostics,
        release: () => {
          this.releaseCached(job.id);
        },
      };
      this.emit({ type: 'cancelled', jobId: job.id, priority, reason: 'cache-hit' });
      return Promise.resolve(result);
    }

    const queuedAt = now();

    return new Promise<ShapeFillSchedulerResult>((resolve, reject) => {
      const queuedJob: QueuedJob = {
        job,
        priority,
        reuseCache,
        cacheResult,
        readbackSelection,
        resolve,
        reject,
        signal: options.signal,
        queuedAt,
        cancelled: false,
      };

      if (options.signal) {
        if (options.signal.aborted) {
          reject(createAbortError('Job aborted before queue'));
          return;
        }
        const abortHandler = () => {
          if (queuedJob.cancelled) {
            return;
          }
          const isActive = this.activeJob === queuedJob;
          this.removeFromQueue(queuedJob);
          queuedJob.cancelled = true;
          queuedJob.cancelReason = 'abort';
          reject(createAbortError('Job aborted'));
          if (!isActive) {
            this.emit({ type: 'cancelled', jobId: job.id, priority, reason: 'abort' });
          }
        };
        queuedJob.abortHandler = abortHandler;
        options.signal.addEventListener('abort', abortHandler, { once: true });
      }

      this.cancelQueuedDuplicates(job.id, priority);
      this.queue.push(queuedJob);
      this.sortQueue();
      this.emit({ type: 'queued', jobId: job.id, priority });
      this.pumpQueue();
    });
  }

  invalidate(jobId: string): void {
    const cached = this.cache.get(jobId);
    if (cached) {
      this.cache.delete(jobId);
      try {
        cached.result.release();
      } catch (error) {
        console.warn('[ShapeFillScheduler] Failed to release cached job', jobId, error);
      }
    }
    this.cpuFieldCache.delete(jobId);
    this.jobUpdates.delete(jobId);
  }

  clearCache(): void {
    for (const jobId of this.cache.keys()) {
      this.invalidate(jobId);
    }
    this.cpuFieldCache.clear();
    this.jobUpdates.clear();
  }

  destroy(): void {
    this.clearCache();
    this.queue.length = 0;
    this.listeners.clear();
  }

  private releaseCached(jobId: string): void {
    const cached = this.cache.get(jobId);
    if (!cached) return;
    cached.retains = Math.max(0, cached.retains - 1);
  }

  private emit(event: ShapeFillSchedulerEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private removeFromQueue(target: QueuedJob): void {
    const index = this.queue.indexOf(target);
    if (index !== -1) {
      this.queue.splice(index, 1);
    }
  }

  private mergeJobWithUpdate(job: StrokeJob): StrokeJob {
    const update = this.jobUpdates.get(job.id);
    if (!update) {
      return job;
    }

    const merged: StrokeJob = {
      ...job,
    };

    if (update.seed !== undefined) {
      merged.seed = update.seed;
    }

    if (update.brushSettingsPatch) {
      const baseBrush = (job.brushSettings
        ? { ...job.brushSettings }
        : {}) as BrushSettings;
      merged.brushSettings = Object.assign(baseBrush, update.brushSettingsPatch);
    }

    if (update.params) {
      merged.dynamicParams = {
        ...(job.dynamicParams ?? {}),
        ...update.params,
      };

      if (typeof update.params.pendingGizmo === 'number') {
        merged.pendingGizmo = update.params.pendingGizmo > 0;
      }
    }

    return merged;
  }

  private cancelQueuedDuplicates(jobId: string, priority: JobPriority): void {
    if (this.activeJob && this.activeJob.job.id === jobId && this.activeJob.priority === priority) {
      this.activeJob.cancelled = true;
      this.activeJob.cancelReason = 'abort';
    }

    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const queued = this.queue[index];
      if (queued.job.id !== jobId || queued.priority !== priority) {
        continue;
      }
      this.queue.splice(index, 1);
      queued.cancelled = true;
      queued.cancelReason = 'abort';
      if (queued.signal && queued.abortHandler) {
        queued.signal.removeEventListener('abort', queued.abortHandler);
      }
      queued.reject(createAbortError('Job aborted'));
      this.emit({ type: 'cancelled', jobId, priority: queued.priority, reason: 'abort' });
    }
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => {
      if (a.priority === b.priority) {
        return a.queuedAt - b.queuedAt;
      }
      if (isPreviewPriority(a.priority) && !isPreviewPriority(b.priority)) {
        return -1;
      }
      if (!isPreviewPriority(a.priority) && isPreviewPriority(b.priority)) {
        return 1;
      }
      return a.queuedAt - b.queuedAt;
    });
  }

  private pumpQueue(): void {
    if (this.activeJob) {
      return;
    }
    const next = this.queue.shift();
    if (!next) {
      return;
    }
    if (next.signal?.aborted) {
      next.reject(createAbortError('Job aborted'));
      this.emit({ type: 'cancelled', jobId: next.job.id, priority: next.priority, reason: 'abort' });
      this.pumpQueue();
      return;
    }

    this.activeJob = next;
    this.executeJob(next)
      .then(result => {
        next.resolve(result);
      })
      .catch(error => {
        next.reject(error);
      })
      .finally(() => {
        this.activeJob = null;
        this.pumpQueue();
      });
  }

  private async executeJob(jobState: QueuedJob): Promise<ShapeFillSchedulerResult> {
    const job = this.mergeJobWithUpdate(jobState.job);
    jobState.job = job;
    this.emit({ type: 'started', jobId: job.id, priority: jobState.priority });

    const startedAt = now();

    const cancellationReason = jobState.cancelReason ?? 'abort';
    let fieldResult = await this.generator.generate(job);

    const ensureNotCancelled = (afterCaching = false): void => {
      if (!jobState.cancelled) {
        return;
      }
      if (afterCaching && jobState.cacheResult) {
        this.invalidate(job.id);
        fieldResult = null;
      } else if (fieldResult) {
        try {
          fieldResult.release();
        } catch (error) {
          console.warn('[ShapeFillScheduler] Failed to release job resources', job.id, error);
        }
        fieldResult = null;
      }
      this.emit({
        type: 'cancelled',
        jobId: job.id,
        priority: jobState.priority,
        reason: cancellationReason,
      });
      throw createAbortError('Job aborted');
    };

    ensureNotCancelled();

    if (!fieldResult) {
      const diagnostics: ComputeDiagnostics = {
        queuedAt: jobState.queuedAt,
        startedAt,
        completedAt: now(),
        fromCache: false,
      };
      const result: ShapeFillSchedulerResult = {
        job,
        priority: jobState.priority,
        fieldResult: null,
        readbacks: [],
        diagnostics,
        release: () => {},
      };
      this.emit({
        type: 'completed',
        jobId: job.id,
        priority: jobState.priority,
        diagnostics,
      });
      return result;
    }

    const readbackPayload = jobState.readbackSelection
      ? await this.captureReadbacks(fieldResult, jobState)
      : { readbacks: [], durationMs: 0 };

    ensureNotCancelled();

    if (jobState.cacheResult) {
      this.cacheResult(job.id, fieldResult, jobState.priority);
    }

    ensureNotCancelled(true);

    const completedAt = now();

    const diagnostics: ComputeDiagnostics = {
      queuedAt: jobState.queuedAt,
      startedAt,
      completedAt,
      fromCache: false,
      readbackDurationMs: readbackPayload.durationMs || undefined,
    };

    const release = () => {
      if (jobState.cacheResult) {
        this.releaseCached(job.id);
        return;
      }
      if (!fieldResult) {
        return;
      }
      try {
        fieldResult.release();
      } catch (error) {
        console.warn('[ShapeFillScheduler] Failed to release job resources', job.id, error);
      }
    };

    const result: ShapeFillSchedulerResult = {
      job,
      priority: jobState.priority,
      fieldResult,
      readbacks: readbackPayload.readbacks,
      diagnostics,
      release,
    };

    this.emit({
      type: 'completed',
      jobId: job.id,
      priority: jobState.priority,
      metrics: fieldResult?.metrics,
      diagnostics,
    });

    return result;
  }

  private cacheResult(jobId: string, result: FieldGeneratorResult, priority: JobPriority): void {
    if (this.cache.has(jobId)) {
      const cached = this.cache.get(jobId)!;
      cached.retains += 1;
      return;
    }

    if (this.cache.size >= this.maxCachedResults) {
      const [oldestKey] = this.cache.keys();
      if (oldestKey) {
        this.invalidate(oldestKey);
      }
    }

    this.cache.set(jobId, {
      result,
      priority,
      retains: 1,
    });
  }

  setCpuField(jobId: string, field: unknown): void {
    this.cpuFieldCache.set(jobId, field);
  }

  getCpuField<T>(jobId: string): T | undefined {
    return this.cpuFieldCache.get(jobId) as T | undefined;
  }

  removeCpuField(jobId: string): void {
    this.cpuFieldCache.delete(jobId);
  }

  private async captureReadbacks(
    result: FieldGeneratorResult,
    jobState: QueuedJob
  ): Promise<{ readbacks: TileReadback[]; durationMs: number }> {
    const tiles = result.tiles;
    if (!tiles.length) {
      return { readbacks: [], durationMs: 0 };
    }

    const device = await this.deviceManager.ensureDevice();
    if (!device) {
      return { readbacks: [], durationMs: 0 };
    }

    const selectedTiles = jobState.readbackSelection === 'all'
      ? tiles
      : tiles.filter(tile => jobState.readbackSelection?.includes(tile.descriptor.id));

    const readbacks: TileReadback[] = [];
    const bytesPerTexel = 4 * Float32Array.BYTES_PER_ELEMENT;
    let totalDuration = 0;

    for (const tile of selectedTiles) {
      const tileStart = now();
      const byteLength = tile.descriptor.gridWidth * tile.descriptor.gridHeight * bytesPerTexel;
      const buffer = device.createBuffer({
        label: `shape-fill-readback-${jobState.job.id}-${tile.descriptor.id}`,
        size: byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });

      const commandEncoder = device.createCommandEncoder({
        label: `shape-fill-readback-encoder-${jobState.job.id}`,
      });

      commandEncoder.copyTextureToBuffer(
        { texture: tile.distanceTexture },
        {
          buffer,
          bytesPerRow: tile.descriptor.gridWidth * bytesPerTexel,
          rowsPerImage: tile.descriptor.gridHeight,
        },
        {
          width: tile.descriptor.gridWidth,
          height: tile.descriptor.gridHeight,
          depthOrArrayLayers: 1,
        }
      );

      device.queue.submit([commandEncoder.finish()]);

      await buffer.mapAsync(GPUMapMode.READ);
      const copy = buffer.getMappedRange().slice(0);
      buffer.unmap();
      buffer.destroy();

      const data = new Float32Array(copy);
      readbacks.push({ tile: tile.descriptor, data });
      const durationMs = now() - tileStart;
      totalDuration += durationMs;
      this.emit({
        type: 'readback',
        jobId: jobState.job.id,
        tileId: tile.descriptor.id,
        bytes: byteLength,
        durationMs,
      });
    }

    return { readbacks, durationMs: totalDuration };
  }
}
