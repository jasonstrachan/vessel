/**
 * Manager for gradient calculation Web Worker
 */

import { ensurePalette, PaletteHandle } from '@/lib/colorCycle/paletteService';

export interface GradientStop {
  position: number;
  color: string;
}

type WorkerMessageType = 'updateGradient' | 'shiftPalette' | 'applyToBuffer';

interface WorkerPayloadMap {
  updateGradient: {
    stops?: GradientStop[];
    palette?: Uint8ClampedArray;
    paletteSize?: number;
    key?: string;
  };
  shiftPalette: { offset: number };
  applyToBuffer: { indexData: Uint8Array; offset: number };
}

type WorkerResponseMessage =
  | { id: number; type: 'success'; result: Uint8ClampedArray }
  | { id: number; type: 'error'; error: string };

interface WorkerRequest {
  resolve: (value: Uint8ClampedArray) => void;
  reject: (error: Error) => void;
}

export class GradientWorkerManager {
  private worker: Worker | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, WorkerRequest>();
  private isSupported: boolean;
  private lastPaletteHandle: PaletteHandle | null = null;

  constructor() {
    this.isSupported = typeof Worker !== 'undefined';
    
    if (this.isSupported) {
      try {
        this.worker = new Worker(
          new URL('../../workers/gradientWorker.ts', import.meta.url),
          { type: 'module' }
        );
        
        this.worker.onmessage = this.handleMessage.bind(this);
        this.worker.onerror = this.handleError.bind(this);
      } catch (error) {
        console.error('Failed to initialize gradient worker:', error);
        this.isSupported = false;
        this.worker = null;
      }
    }
  }

  private handleMessage(event: MessageEvent<WorkerResponseMessage>) {
    const message = event.data;
    const request = this.pendingRequests.get(message.id);

    if (!request) return;

    this.pendingRequests.delete(message.id);

    if (message.type === 'error') {
      request.reject(new Error(message.error));
    } else {
      request.resolve(message.result);
    }
  }

  private handleError(error: ErrorEvent) {
    console.error('Gradient worker error:', error);
    // Reject all pending requests
    for (const [, request] of this.pendingRequests) {
      request.reject(new Error(error.message));
    }
    this.pendingRequests.clear();
  }

  private sendMessage<T extends WorkerMessageType>(
    type: T,
    data: WorkerPayloadMap[T],
    transferables: Transferable[] = []
  ): Promise<Uint8ClampedArray> {
    const worker = this.worker;
    if (!worker) {
      return Promise.reject(new Error('Worker not available'));
    }

    return new Promise<Uint8ClampedArray>((resolve, reject) => {
      const id = this.requestId++;
      const timeoutId: ReturnType<typeof setTimeout> = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Worker timeout'));
        }
      }, 5000);

      const resolveWithCleanup = (value: Uint8ClampedArray) => {
        clearTimeout(timeoutId);
        resolve(value);
      };

      const rejectWithCleanup = (workerError: Error) => {
        clearTimeout(timeoutId);
        reject(workerError);
      };

      this.pendingRequests.set(id, {
        resolve: resolveWithCleanup,
        reject: rejectWithCleanup
      });

      worker.postMessage({ type, data, id }, transferables);
    });
  }

  /**
   * Update gradient in worker
   */
  async updateGradient(stops: GradientStop[]): Promise<Uint8ClampedArray> {
    const handle = ensurePalette({ stops });
    this.lastPaletteHandle = handle;

    if (!this.isSupported || !this.worker) {
      return new Uint8ClampedArray(handle.rgba);
    }

    const paletteCopy = new Uint8ClampedArray(handle.rgba);
    return await this.sendMessage(
      'updateGradient',
      {
        stops,
        palette: paletteCopy,
        paletteSize: handle.size,
        key: handle.key,
      },
      [paletteCopy.buffer]
    );
  }

  /**
   * Shift palette in worker
   */
  async shiftPalette(offset: number): Promise<Uint8ClampedArray> {
    if (!this.isSupported || !this.worker) {
      return this.shiftPaletteLocally(offset);
    }
    
    return await this.sendMessage('shiftPalette', { offset });
  }

  /**
   * Apply palette to index buffer in worker
   */
  async applyToBuffer(indexData: Uint8Array, offset: number = 0): Promise<Uint8ClampedArray> {
    if (!this.isSupported || !this.worker) {
      return this.applyPaletteLocally(indexData, offset);
    }
    
    // Transfer indexData to worker (zero-copy)
    const transferable = indexData.buffer.slice(0);
    return await this.sendMessage(
      'applyToBuffer',
      {
        indexData: new Uint8Array(transferable),
        offset
      },
      [transferable]
    );
  }

  /**
   * Fallback synchronous gradient update
   */
  private ensurePaletteHandle(): PaletteHandle {
    if (this.lastPaletteHandle) {
      return this.lastPaletteHandle;
    }
    this.lastPaletteHandle = ensurePalette();
    return this.lastPaletteHandle;
  }

  private shiftPaletteLocally(offset: number): Uint8ClampedArray {
    const handle = this.ensurePaletteHandle();
    const palette = handle.rgba;
    const paletteSize = Math.max(1, Math.floor(palette.length / 4));
    if (paletteSize === 0) {
      return new Uint8ClampedArray();
    }

    const normalizedOffset = ((offset % 1) + 1) % 1;
    const shift = Math.floor(normalizedOffset * paletteSize);
    if (shift === 0) {
      return new Uint8ClampedArray(palette);
    }

    const shifted = new Uint8ClampedArray(palette.length);
    for (let i = 0; i < paletteSize; i++) {
      const sourceIndex = (i + shift) % paletteSize;
      const src = sourceIndex * 4;
      const dst = i * 4;
      shifted[dst] = palette[src];
      shifted[dst + 1] = palette[src + 1];
      shifted[dst + 2] = palette[src + 2];
      shifted[dst + 3] = palette[src + 3];
    }

    return shifted;
  }

  private applyPaletteLocally(indexData: Uint8Array, offset: number): Uint8ClampedArray {
    const palette = this.shiftPaletteLocally(offset);
    const pixels = new Uint8ClampedArray(indexData.length * 4);
    const paletteSize = Math.max(1, Math.floor(palette.length / 4));

    for (let i = 0; i < indexData.length; i++) {
      const colorIndex = indexData[i];
      if (colorIndex === 0) {
        const idx = i * 4;
        pixels[idx] = 0;
        pixels[idx + 1] = 0;
        pixels[idx + 2] = 0;
        pixels[idx + 3] = 0;
        continue;
      }

      let paletteIndex = colorIndex - 1;
      if (paletteIndex < 0) {
        paletteIndex = 0;
      } else if (paletteIndex >= paletteSize) {
        paletteIndex = paletteSize - 1;
      }

      const src = paletteIndex * 4;
      const dst = i * 4;
      pixels[dst] = palette[src];
      pixels[dst + 1] = palette[src + 1];
      pixels[dst + 2] = palette[src + 2];
      pixels[dst + 3] = palette[src + 3];
    }

    return pixels;
  }

  /**
   * Terminate the worker
   */
  dispose() {
    if (this.worker) {
      // Reject all pending requests
      for (const [, request] of this.pendingRequests) {
        request.reject(new Error('Worker terminated'));
      }
      this.pendingRequests.clear();
      
      this.worker.terminate();
      this.worker = null;
    }
  }

  /**
   * Check if workers are supported
   */
  static isSupported(): boolean {
    return typeof Worker !== 'undefined';
  }
}
