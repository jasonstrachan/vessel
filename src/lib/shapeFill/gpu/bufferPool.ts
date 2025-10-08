const makeKey = (size: number, usage: GPUBufferUsageFlags): string => `${size}:${usage}`;

/**
 * Minimal GPUBuffer pool used to recycle frequently allocated uniform buffers.
 * Callers are responsible for ensuring buffers are no longer in-flight before
 * releasing them back into the pool.
 */
export class GpuBufferPool {
  private readonly buffers = new Map<string, GPUBuffer[]>();

  acquire(device: GPUDevice, size: number, usage: GPUBufferUsageFlags, label?: string): GPUBuffer {
    const key = makeKey(size, usage);
    const list = this.buffers.get(key);
    if (list && list.length > 0) {
      return list.pop()!;
    }
    return device.createBuffer({ label, size, usage });
  }

  release(buffer: GPUBuffer, size: number, usage: GPUBufferUsageFlags): void {
    const key = makeKey(size, usage);
    const list = this.buffers.get(key);
    if (list) {
      list.push(buffer);
    } else {
      this.buffers.set(key, [buffer]);
    }
  }

  dispose(): void {
    for (const list of this.buffers.values()) {
      for (const buffer of list) {
        buffer.destroy();
      }
    }
    this.buffers.clear();
  }
}
