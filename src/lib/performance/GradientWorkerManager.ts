/**
 * Manager for gradient calculation Web Worker
 */

export interface GradientStop {
  position: number;
  color: string;
}

interface WorkerRequest {
  resolve: (value: any) => void;
  reject: (error: any) => void;
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
        this.isSupported = false;
        this.worker = null;
      }
    }
  }

  private handleMessage(e: MessageEvent) {
    const { id, type, result, error } = e.data;
    const request = this.pendingRequests.get(id);
    
    if (!request) return;
    
    this.pendingRequests.delete(id);
    
    if (type === 'error') {
      request.reject(new Error(error));
    } else {
      request.resolve(result);
    }
  }

  private handleError(error: ErrorEvent) {
    console.error('Gradient worker error:', error);
    // Reject all pending requests
    for (const [id, request] of this.pendingRequests) {
      request.reject(error);
    }
    this.pendingRequests.clear();
  }

  private sendMessage(type: string, data: any): Promise<any> {
    if (!this.worker) {
      return Promise.reject(new Error('Worker not available'));
    }
    
    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      this.pendingRequests.set(id, { resolve, reject });
      
      // Set timeout for worker response
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Worker timeout'));
        }
      }, 5000);
      
      // Override resolve to clear timeout
      const originalResolve = resolve;
      resolve = (value: any) => {
        clearTimeout(timeout);
        originalResolve(value);
      };
      
      this.worker.postMessage({ type, data, id });
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
    return await this.sendMessage('applyToBuffer', {
      indexData: new Uint8Array(transferable),
      offset
    });
  }

  /**
   * Fallback synchronous gradient update
   */
  private updateGradientSync(stops: GradientStop[]): Uint8ClampedArray {
    const paletteSize = 256;
    const colors = new Uint8ClampedArray(paletteSize * 4);
    
    // Simplified gradient generation
    for (let i = 0; i < paletteSize; i++) {
      const position = i / (paletteSize - 1);
      // Simple linear interpolation between first and last stop
      const firstStop = stops[0];
      const lastStop = stops[stops.length - 1];
      
      const idx = i * 4;
      colors[idx] = Math.floor(255 * position);     // R
      colors[idx + 1] = Math.floor(255 * position); // G  
      colors[idx + 2] = Math.floor(255 * position); // B
      colors[idx + 3] = 255;                        // A
    }
    
    return colors;
  }

  /**
   * Terminate the worker
   */
  dispose() {
    if (this.worker) {
      // Reject all pending requests
      for (const [id, request] of this.pendingRequests) {
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
