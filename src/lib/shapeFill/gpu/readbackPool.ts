export interface ReadbackPoolOptions {
  size: number;
  usage?: GPUBufferUsageFlags;
  label?: string;
}

export class ReadbackPool {
  private readonly usage: GPUBufferUsageFlags;
  private readonly label?: string;
  private size: number;
  private readonly free: GPUBuffer[] = [];
  private readonly inUse = new Set<GPUBuffer>();
  private disposed = false;

  constructor(private readonly device: GPUDevice, options: ReadbackPoolOptions) {
    this.size = options.size;
    this.usage = options.usage ?? (GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
    this.label = options.label;
  }

  acquire(label?: string): GPUBuffer {
    if (this.disposed) {
      throw new Error('ReadbackPool has been disposed');
    }
    if (this.size <= 0) {
      throw new Error('ReadbackPool size must be greater than zero');
    }

    const buffer = this.free.pop() ?? this.createBuffer(label);
    this.inUse.add(buffer);
    return buffer;
  }

  async read(queue: GPUQueue, buffer: GPUBuffer): Promise<ArrayBuffer> {
    if (!this.inUse.has(buffer)) {
      throw new Error('Attempted to read a buffer that is not managed by this pool');
    }

    const extendedQueue = queue as GPUQueue & { onSubmittedWorkDone?: () => Promise<void> };
    if (typeof extendedQueue.onSubmittedWorkDone === 'function') {
      await extendedQueue.onSubmittedWorkDone();
    }

    await buffer.mapAsync(GPUMapMode.READ);
    const copy = buffer.getMappedRange().slice(0);
    buffer.unmap();

    this.inUse.delete(buffer);
    this.free.push(buffer);

    return copy;
  }

  release(buffer: GPUBuffer): void {
    if (!this.inUse.has(buffer)) {
      return;
    }
    this.inUse.delete(buffer);
    this.free.push(buffer);
  }

  resize(size: number): void {
    if (size === this.size) {
      return;
    }
    this.destroy();
    this.size = size;
    this.disposed = false;
  }

  destroy(): void {
    this.free.forEach(buffer => buffer.destroy());
    this.free.length = 0;

    this.inUse.forEach(buffer => buffer.destroy());
    this.inUse.clear();

    this.disposed = true;
  }

  private createBuffer(label?: string): GPUBuffer {
    return this.device.createBuffer({
      label: label ?? this.label,
      size: this.size,
      usage: this.usage,
    });
  }
}
