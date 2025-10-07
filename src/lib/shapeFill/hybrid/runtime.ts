import { Mesh, SerializedPath, WorkerMessage, WorkerResponse, Fill } from './types';

export interface PathInput {
  commands: SerializedPath['commands'];
  points: ArrayLike<number>;
}

export interface BuildParams {
  paths: PathInput[];
  fill: Fill;
  preview?: boolean;
  viewportScale?: number;
  render?: RenderContext;
}

export interface BuildResult {
  mesh: Mesh;
  preview: boolean;
  fill: Fill;
  render?: RenderContext;
}

export interface HybridRenderer {
  upload(mesh: Mesh, fill: Fill, context?: RenderContext): Promise<void> | void;
  draw(mesh: Mesh, fill: Fill, context: RenderContext | undefined, preview: boolean): void;
  destroyPreview(): void;
}

type PendingRequest = {
  resolve: (result: BuildResult) => void;
  reject: (error: Error) => void;
  preview: boolean;
  fill: Fill;
  render?: RenderContext;
};

export interface RenderTarget {
  view: GPUTextureView;
  texture: GPUTexture;
  size: { width: number; height: number };
}

export interface RenderContext {
  viewMatrix: Float32Array;
  previewTarget?: RenderTarget | null;
  finalTarget?: RenderTarget | null;
  format: GPUTextureFormat;
  textureResolver?: (id: string) => GPUTextureView | null;
  onComplete?: (target: RenderTarget, preview: boolean) => void;
}

const DEFAULT_SCALE_BUCKET = 1;

const computeScaleBucket = (scale: number | undefined): number => {
  if (!Number.isFinite(scale) || scale! <= 0) {
    return DEFAULT_SCALE_BUCKET;
  }

  const bucket = Math.pow(2, Math.round(Math.log2(scale!)));
  return Math.max(0.25, Math.min(4, bucket));
};

const resolveHybridWorkerUrl = (): string | null => {
  try {
    const meta = (0, eval)('import.meta') as { url?: string } | undefined;
    if (!meta?.url) {
      return null;
    }
    return new URL('../../../workers/hybridShapeFillWorker.ts', meta.url).href;
  } catch (error) {
    void error;
    return null;
  }
};

const toSerializedPath = (input: PathInput): SerializedPath => {
  const data = input.points instanceof Float32Array ? input.points : Float32Array.from(input.points);
  return {
    commands: input.commands,
    data,
  };
};

export class HybridShapeFillEngine {
  private worker: Worker | null = null;

  private pending = new Map<number, PendingRequest>();

  private revisionCounter = 0;

  private renderer: HybridRenderer | null = null;

  constructor(renderer?: HybridRenderer) {
    if (renderer) {
      this.renderer = renderer;
    }
  }

  setRenderer(renderer: HybridRenderer): void {
    this.renderer = renderer;
  }

  async build(params: BuildParams): Promise<BuildResult> {
    const worker = this.ensureWorker();

    const revision = ++this.revisionCounter;
    const preview = Boolean(params.preview);

    const message: WorkerMessage = {
      kind: 'build',
      revision,
      paths: params.paths.map(toSerializedPath),
      fill: params.fill,
      preview,
      scaleBucket: computeScaleBucket(params.viewportScale),
    };

    const transferables: Transferable[] = [];
    for (const path of message.paths) {
      transferables.push(path.data.buffer);
    }

    const fill = params.fill;
    const renderContext = params.render;

    return await new Promise<BuildResult>((resolve, reject) => {
      this.pending.set(revision, { resolve, reject, preview, fill, render: renderContext });
      worker.postMessage(message, transferables);
    });
  }

  attachRenderer(renderer: HybridRenderer): void {
    this.renderer = renderer;
  }

  destroyPreview(): void {
    this.renderer?.destroyPreview();
  }

  dispose(): void {
    this.pending.clear();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) {
      return this.worker;
    }

    if (typeof Worker === 'undefined') {
      throw new Error('Web Workers are not supported in this environment');
    }

    const workerUrl = resolveHybridWorkerUrl();
    if (!workerUrl) {
      throw new Error('Hybrid shape fill worker URL could not be resolved');
    }

    this.worker = new Worker(workerUrl, {
      type: 'module',
    });
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleError);
    return this.worker;
  }

  private handleMessage = (event: MessageEvent<WorkerResponse>): void => {
    const response = event.data;
    const pending = this.pending.get(response.mesh.revision);
    if (!pending) {
      return;
    }

    this.pending.delete(response.mesh.revision);

    const result: BuildResult = {
      mesh: response.mesh,
      preview: response.preview,
      fill: pending.fill,
      render: pending.render,
    };

    const renderer = this.renderer;
    if (!renderer) {
      pending.resolve(result);
      return;
    }

    try {
      const maybePromise = renderer.upload(response.mesh, pending.fill, pending.render);
      if (maybePromise && typeof (maybePromise as Promise<void>).then === 'function') {
        void (maybePromise as Promise<void>)
          .then(() => {
            renderer.draw(response.mesh, pending.fill, pending.render, response.preview);
            pending.resolve(result);
          })
          .catch(error => {
            pending.reject(error instanceof Error ? error : new Error(String(error)));
          });
        return;
      }

      renderer.draw(response.mesh, pending.fill, pending.render, response.preview);
      pending.resolve(result);
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };

  private handleError = (event: ErrorEvent): void => {
    for (const [, pending] of this.pending) {
      pending.reject(event.error ?? new Error(event.message));
    }
    this.pending.clear();
  };
}

let engineSingleton: HybridShapeFillEngine | null = null;

export const getHybridShapeFillEngine = (): HybridShapeFillEngine => {
  if (!engineSingleton) {
    engineSingleton = new HybridShapeFillEngine();
  }
  return engineSingleton;
};

export const resetHybridShapeFillEngine = (): void => {
  engineSingleton?.dispose();
  engineSingleton = null;
};
