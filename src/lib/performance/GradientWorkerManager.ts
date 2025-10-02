/**
 * Manager for gradient calculation Web Worker
 */

import { parseCssColor } from '@/utils/color/parseCssColor';

export interface GradientStop {
  position: number;
  color: string;
}

type WorkerMessageType = 'updateGradient' | 'shiftPalette' | 'applyToBuffer';

interface WorkerPayloadMap {
  updateGradient: { stops: GradientStop[] };
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

  private parseColor(color: string): { r: number; g: number; b: number; a: number } {
    return parseCssColor(color, { r: 0, g: 0, b: 0, a: 255 });
  }

  private interpolateColor(
    color1: { r: number; g: number; b: number; a: number },
    color2: { r: number; g: number; b: number; a: number },
    t: number
  ) {
    return {
      r: Math.round(color1.r + (color2.r - color1.r) * t),
      g: Math.round(color1.g + (color2.g - color1.g) * t),
      b: Math.round(color1.b + (color2.b - color1.b) * t),
      a: Math.round(color1.a + (color2.a - color1.a) * t)
    };
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
    if (!this.isSupported || !this.worker) {
      // Fallback to synchronous calculation
      return this.updateGradientSync(stops);
    }
    
    return await this.sendMessage('updateGradient', { stops });
  }

  /**
   * Shift palette in worker
   */
  async shiftPalette(offset: number): Promise<Uint8ClampedArray> {
    if (!this.isSupported || !this.worker) {
      throw new Error('Worker not available for palette shifting');
    }
    
    return await this.sendMessage('shiftPalette', { offset });
  }

  /**
   * Apply palette to index buffer in worker
   */
  async applyToBuffer(indexData: Uint8Array, offset: number = 0): Promise<Uint8ClampedArray> {
    if (!this.isSupported || !this.worker) {
      throw new Error('Worker not available for buffer application');
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
  private updateGradientSync(stops: GradientStop[]): Uint8ClampedArray {
    const paletteSize = 256;
    const colors = new Uint8ClampedArray(paletteSize * 4);
    if (stops.length === 0) {
      return colors;
    }

    const normalizedStops = [...stops].sort((a, b) => a.position - b.position);
    if (normalizedStops[0].position > 0) {
      normalizedStops.unshift({ position: 0, color: normalizedStops[0].color });
    }
    const lastIndex = normalizedStops.length - 1;
    if (normalizedStops[lastIndex].position < 1) {
      normalizedStops.push({ position: 1, color: normalizedStops[lastIndex].color });
    }
    
    // Simplified gradient generation
    for (let i = 0; i < paletteSize; i++) {
      const position = i / (paletteSize - 1);

      let leftStop = normalizedStops[0];
      let rightStop = normalizedStops[normalizedStops.length - 1];
      for (let j = 0; j < normalizedStops.length - 1; j++) {
        const current = normalizedStops[j];
        const next = normalizedStops[j + 1];
        if (position >= current.position && position <= next.position) {
          leftStop = current;
          rightStop = next;
          break;
        }
      }

      const leftColor = this.parseColor(leftStop.color);
      const rightColor = this.parseColor(rightStop.color);
      const range = rightStop.position - leftStop.position;
      const t = range === 0 ? 0 : (position - leftStop.position) / range;
      const color = this.interpolateColor(leftColor, rightColor, t);

      const idx = i * 4;
      colors[idx] = color.r;
      colors[idx + 1] = color.g;
      colors[idx + 2] = color.b;
      colors[idx + 3] = color.a;
    }
    
    return colors;
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
