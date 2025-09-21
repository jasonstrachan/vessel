/**
 * Browser compatibility layer for color cycle features
 * Provides polyfills and workarounds for browser-specific issues
 */

type PerformanceMemoryStats = {
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
  usedJSHeapSize: number;
};

const getPerformanceMemory = (): PerformanceMemoryStats | null => {
  const perf = performance as Performance & { memory?: PerformanceMemoryStats };
  const { memory } = perf;
  if (
    memory &&
    typeof memory.jsHeapSizeLimit === 'number' &&
    typeof memory.totalJSHeapSize === 'number' &&
    typeof memory.usedJSHeapSize === 'number'
  ) {
    return memory;
  }
  return null;
};

export interface CompatibilityConfig {
  enableSafariWorkarounds: boolean;
  enableFirefoxWorkarounds: boolean;
  enableMobileOptimizations: boolean;
  fallbackToSlowerMethods: boolean;
  maxCanvasSize: number;
  memoryLimitMB: number;
}

export class BrowserCompat {
  private static instance: BrowserCompat;
  private config: CompatibilityConfig;
  private browserInfo: {
    name: string;
    version: string;
    isMobile: boolean;
    hasMemoryAPI: boolean;
    hasHighResTimer: boolean;
  };

  private constructor() {
    this.browserInfo = this.detectBrowser();
    this.config = this.generateCompatConfig();
    this.applyPolyfills();
  }

  static getInstance(): BrowserCompat {
    if (!BrowserCompat.instance) {
      BrowserCompat.instance = new BrowserCompat();
    }
    return BrowserCompat.instance;
  }

  /**
   * Get compatibility configuration
   */
  getConfig(): CompatibilityConfig {
    return { ...this.config };
  }

  /**
   * Check if feature is supported
   */
  isFeatureSupported(feature: string): boolean {
    switch (feature) {
      case 'canvas2d':
        return !!document.createElement('canvas').getContext('2d');
      case 'webgl':
        try {
          const canvas = document.createElement('canvas');
          return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
        } catch {
          return false;
        }
      case 'memory-api':
        return this.browserInfo.hasMemoryAPI;
      case 'high-res-timer':
        return this.browserInfo.hasHighResTimer;
      case 'typed-arrays':
        return typeof Uint8Array !== 'undefined' && typeof Uint32Array !== 'undefined';
      case 'image-data':
        try {
          const ctx = document.createElement('canvas').getContext('2d');
          return !!(ctx && ctx.createImageData);
        } catch {
          return false;
        }
      default:
        return false;
    }
  }

  /**
   * Get optimal canvas size for current browser
   */
  getOptimalCanvasSize(requested: { width: number; height: number }): { width: number; height: number } {
    const maxSize = this.config.maxCanvasSize;
    
    let { width, height } = requested;
    
    // Scale down if too large
    if (width > maxSize || height > maxSize) {
      const scale = Math.min(maxSize / width, maxSize / height);
      width = Math.floor(width * scale);
      height = Math.floor(height * scale);
    }
    
    // Mobile optimization
    if (this.browserInfo.isMobile) {
      const mobileMax = 1024;
      if (width > mobileMax || height > mobileMax) {
        const scale = Math.min(mobileMax / width, mobileMax / height);
        width = Math.floor(width * scale);
        height = Math.floor(height * scale);
      }
    }
    
    return { width, height };
  }

  /**
   * Get safe memory limit for operations
   */
  getMemoryLimit(): number {
    const baseLimitMB = this.config.memoryLimitMB;
    
    if (this.browserInfo.hasMemoryAPI) {
      const memory = getPerformanceMemory();
      if (memory) {
        const availableMB = (memory.jsHeapSizeLimit - memory.usedJSHeapSize) / 1024 / 1024;
        return Math.min(baseLimitMB, Math.floor(availableMB * 0.5)); // Use 50% of available
      }
    }

    return baseLimitMB;
  }

  /**
   * Create ImageData with compatibility handling
   */
  createImageData(width: number, height: number): ImageData {
    try {
      // Modern method
      return new ImageData(width, height);
    } catch {
      // Fallback for older browsers
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        return ctx.createImageData(width, height);
      }
      throw new Error('Cannot create ImageData');
    }
  }

  /**
   * Optimized putImageData with browser-specific handling
   */
  putImageData(
    ctx: CanvasRenderingContext2D,
    imageData: ImageData,
    dx: number,
    dy: number
  ): void {
    if (this.config.enableSafariWorkarounds && this.browserInfo.name === 'Safari') {
      // Safari optimization: batch canvas operations
      this.safariPutImageData(ctx, imageData, dx, dy);
    } else if (this.config.enableFirefoxWorkarounds && this.browserInfo.name === 'Firefox') {
      // Firefox optimization: avoid frequent context switches
      this.firefoxPutImageData(ctx, imageData, dx, dy);
    } else {
      // Standard method
      ctx.putImageData(imageData, dx, dy);
    }
  }

  /**
   * High-resolution timer with fallback
   */
  now(): number {
    if (this.browserInfo.hasHighResTimer) {
      return performance.now();
    }
    return Date.now();
  }

  /**
   * Memory usage with fallback
   */
  getMemoryUsage(): number {
    if (this.browserInfo.hasMemoryAPI) {
      const memory = getPerformanceMemory();
      if (memory) {
        return memory.usedJSHeapSize;
      }
    }

    // Fallback: use timestamp as approximate indicator
    return Date.now();
  }

  /**
   * Detect browser and version
   */
  private detectBrowser() {
    const userAgent = navigator.userAgent;
    
    let name = 'Unknown';
    let version = 'Unknown';
    
    if (userAgent.includes('Chrome') && !userAgent.includes('Edge')) {
      name = 'Chrome';
      version = userAgent.match(/Chrome\/([0-9.]+)/)?.[1] || 'Unknown';
    } else if (userAgent.includes('Firefox')) {
      name = 'Firefox';
      version = userAgent.match(/Firefox\/([0-9.]+)/)?.[1] || 'Unknown';
    } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
      name = 'Safari';
      version = userAgent.match(/Version\/([0-9.]+)/)?.[1] || 'Unknown';
    } else if (userAgent.includes('Edge')) {
      name = 'Edge';
      version = userAgent.match(/Edge\/([0-9.]+)/)?.[1] || 'Unknown';
    }
    
    return {
      name,
      version,
      isMobile: /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent),
      hasMemoryAPI: getPerformanceMemory() !== null,
      hasHighResTimer: typeof performance.now === 'function'
    };
  }

  /**
   * Generate compatibility configuration based on browser
   */
  private generateCompatConfig(): CompatibilityConfig {
    const config: CompatibilityConfig = {
      enableSafariWorkarounds: false,
      enableFirefoxWorkarounds: false,
      enableMobileOptimizations: false,
      fallbackToSlowerMethods: false,
      maxCanvasSize: 4096,
      memoryLimitMB: 512
    };

    // Browser-specific configurations
    switch (this.browserInfo.name) {
      case 'Safari':
        config.enableSafariWorkarounds = true;
        config.maxCanvasSize = 2048; // Safari has lower canvas limits
        config.memoryLimitMB = 256;
        break;
        
      case 'Firefox':
        config.enableFirefoxWorkarounds = true;
        config.maxCanvasSize = 4096;
        config.memoryLimitMB = 512;
        break;
        
      case 'Chrome':
        config.maxCanvasSize = 8192;
        config.memoryLimitMB = 1024;
        break;
        
      case 'Edge':
        config.maxCanvasSize = 4096;
        config.memoryLimitMB = 512;
        break;
        
      default:
        config.fallbackToSlowerMethods = true;
        config.maxCanvasSize = 2048;
        config.memoryLimitMB = 256;
    }

    // Mobile optimizations
    if (this.browserInfo.isMobile) {
      config.enableMobileOptimizations = true;
      config.maxCanvasSize = Math.min(config.maxCanvasSize, 1024);
      config.memoryLimitMB = Math.min(config.memoryLimitMB, 128);
    }

    return config;
  }

  /**
   * Apply necessary polyfills
   */
  private applyPolyfills(): void {
    // ImageData constructor polyfill
    if (typeof ImageData === 'undefined') {
      (window as typeof window & { ImageData: typeof ImageData }).ImageData = class {
        data: Uint8ClampedArray;
        width: number;
        height: number;
        
        constructor(widthOrArray: number | Uint8ClampedArray, height?: number) {
          if (typeof widthOrArray === 'number' && height) {
            this.width = widthOrArray;
            this.height = height;
            this.data = new Uint8ClampedArray(this.width * this.height * 4);
          } else if (widthOrArray instanceof Uint8ClampedArray && height) {
            this.data = widthOrArray;
            this.width = Math.sqrt(widthOrArray.length / 4);
            this.height = height;
          } else {
            throw new Error('Invalid ImageData constructor arguments');
          }
        }
      };
    }

    // Performance.now polyfill
    if (!this.browserInfo.hasHighResTimer) {
      performance.now = () => Date.now();
    }

    // requestAnimationFrame polyfill
    if (typeof requestAnimationFrame === 'undefined') {
      (window as typeof window & { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = (callback: FrameRequestCallback) => {
        return setTimeout(() => callback(Date.now()), 1000 / 60);
      };
    }
  }

  /**
   * Safari-specific putImageData optimization
   */
  private safariPutImageData(
    ctx: CanvasRenderingContext2D,
    imageData: ImageData,
    dx: number,
    dy: number
  ): void {
    try {
      // Safari performs better with smaller chunks
      const chunkSize = 512;
      if (imageData.width > chunkSize || imageData.height > chunkSize) {
        // Split into smaller chunks
        for (let y = 0; y < imageData.height; y += chunkSize) {
          for (let x = 0; x < imageData.width; x += chunkSize) {
            const chunkWidth = Math.min(chunkSize, imageData.width - x);
            const chunkHeight = Math.min(chunkSize, imageData.height - y);
            
            if (chunkWidth > 0 && chunkHeight > 0) {
              ctx.putImageData(
                imageData,
                dx + x,
                dy + y,
                x,
                y,
                chunkWidth,
                chunkHeight
              );
            }
          }
        }
      } else {
        ctx.putImageData(imageData, dx, dy);
      }
    } catch {
      // Fallback to standard method
      ctx.putImageData(imageData, dx, dy);
    }
  }

  /**
   * Firefox-specific putImageData optimization
   */
  private firefoxPutImageData(
    ctx: CanvasRenderingContext2D,
    imageData: ImageData,
    dx: number,
    dy: number
  ): void {
    try {
      // Firefox optimization: minimize context state changes
      ctx.save();
      ctx.putImageData(imageData, dx, dy);
      ctx.restore();
    } catch {
      // Fallback to standard method
      ctx.putImageData(imageData, dx, dy);
    }
  }

  /**
   * Get recommended settings for current browser
   */
  getRecommendedSettings(): {
    maxAnimationFPS: number;
    preferredQuantization: 'rgb332' | 'oklab-median-cut';
    enableDithering: boolean;
    maxConcurrentLayers: number;
    bufferPoolSize: number;
  } {
    const base = {
      maxAnimationFPS: 60,
      preferredQuantization: 'oklab-median-cut' as const,
      enableDithering: true,
      maxConcurrentLayers: 10,
      bufferPoolSize: 20
    };

    if (this.browserInfo.isMobile) {
      return {
        maxAnimationFPS: 30,
        preferredQuantization: 'rgb332',
        enableDithering: false,
        maxConcurrentLayers: 3,
        bufferPoolSize: 5
      };
    }

    if (this.browserInfo.name === 'Safari') {
      return {
        ...base,
        maxAnimationFPS: 30,
        preferredQuantization: 'rgb332',
        maxConcurrentLayers: 5,
        bufferPoolSize: 10
      };
    }

    if (!this.browserInfo.hasMemoryAPI) {
      return {
        ...base,
        maxAnimationFPS: 30,
        maxConcurrentLayers: 5,
        bufferPoolSize: 10
      };
    }

    return base;
  }
}
