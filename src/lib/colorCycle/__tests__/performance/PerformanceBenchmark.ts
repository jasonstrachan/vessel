/**
 * Performance benchmark suite for color cycle recolor system
 * Tests quantization, animation, and memory performance across browsers
 */

import { ColorQuantizer } from '../../ColorQuantizer';
import { RecolorAnimationController } from '../../RecolorAnimationController';
import { MedianCut } from '../../quantization/MedianCut';
import { SpatialColorHash } from '../../optimization/SpatialColorHash';
import { BayerDithering } from '../../dithering/BayerDithering';
import { OKLabConverter } from '../../colorSpace/OKLabConverter';

type BenchmarkDetails = Record<string, unknown>;

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

type RecolorAnimationControllerInternal = RecolorAnimationController & {
  updateFrame: (...args: unknown[]) => void;
};

export interface BenchmarkResult {
  name: string;
  duration: number;
  memoryDelta: number;
  iterations: number;
  averageTime: number;
  minTime: number;
  maxTime: number;
  throughput?: number;
  details?: BenchmarkDetails;
}

export interface BenchmarkSuite {
  name: string;
  results: BenchmarkResult[];
  systemInfo: {
    userAgent: string;
    canvas2DSupport: boolean;
    webGLSupport: boolean;
    memoryInfo: PerformanceMemoryStats | null;
  };
}

export class PerformanceBenchmark {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 512;
    this.ctx = this.canvas.getContext('2d')!;
  }

  /**
   * Run complete benchmark suite
   */
  async runFullSuite(): Promise<BenchmarkSuite> {
    const results: BenchmarkResult[] = [];

    // Core quantization benchmarks
    results.push(await this.benchmarkRGB332Quantization());
    results.push(await this.benchmarkMedianCutQuantization());
    results.push(await this.benchmarkSpatialHashLookup());
    results.push(await this.benchmarkBayerDithering());

    // Color space conversion benchmarks
    results.push(await this.benchmarkOKLabConversion());
    results.push(await this.benchmarkColorAnalysis());

    // Animation performance benchmarks
    results.push(await this.benchmarkAnimationFrames());
    results.push(await this.benchmarkMemoryPressure());

    // Real-world workflow benchmarks
    results.push(await this.benchmarkFullPipeline());

    return {
      name: 'Color Cycle Performance Suite',
      results,
      systemInfo: this.getSystemInfo()
    };
  }

  /**
   * Benchmark RGB332 quantization performance
   */
  private async benchmarkRGB332Quantization(): Promise<BenchmarkResult> {
    const imageData = this.generateTestImage(512, 512);
    const iterations = 50;
    const times: number[] = [];
    
    const startMemory = this.getMemoryUsage();

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      
      ColorQuantizer.quantize(imageData, {
        method: 'rgb332',
        ditherMode: 'off',
        maxColors: 256
      });
      
      const end = performance.now();
      times.push(end - start);
    }

    const endMemory = this.getMemoryUsage();
    const totalPixels = imageData.width * imageData.height * iterations;

    return {
      name: 'RGB332 Quantization',
      duration: times.reduce((a, b) => a + b, 0),
      memoryDelta: endMemory - startMemory,
      iterations,
      averageTime: times.reduce((a, b) => a + b, 0) / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      throughput: totalPixels / (times.reduce((a, b) => a + b, 0) / 1000), // pixels/sec
      details: {
        imageSize: `${imageData.width}x${imageData.height}`,
        algorithm: 'RGB332',
        totalPixels
      }
    };
  }

  /**
   * Benchmark median cut quantization performance
   */
  private async benchmarkMedianCutQuantization(): Promise<BenchmarkResult> {
    const imageData = this.generateTestImage(256, 256); // Smaller for median cut
    const medianCut = new MedianCut();
    const iterations = 10;
    const times: number[] = [];
    
    const startMemory = this.getMemoryUsage();

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      medianCut.quantize(imageData);
      const end = performance.now();
      times.push(end - start);
    }

    const endMemory = this.getMemoryUsage();

    return {
      name: 'Median Cut Quantization',
      duration: times.reduce((a, b) => a + b, 0),
      memoryDelta: endMemory - startMemory,
      iterations,
      averageTime: times.reduce((a, b) => a + b, 0) / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      details: {
        imageSize: `${imageData.width}x${imageData.height}`,
        algorithm: 'Median Cut',
        maxColors: 256
      }
    };
  }

  /**
   * Benchmark spatial hash color lookup performance
   */
  private async benchmarkSpatialHashLookup(): Promise<BenchmarkResult> {
    const palette = this.generateTestPalette(256);
    const spatialHash = new SpatialColorHash();
    spatialHash.buildHash(palette);
    const iterations = 10000;
    const times: number[] = [];

    const startMemory = this.getMemoryUsage();

    for (let i = 0; i < iterations; i++) {
      const r = Math.floor(Math.random() * 256);
      const g = Math.floor(Math.random() * 256);
      const b = Math.floor(Math.random() * 256);

      const start = performance.now();
      spatialHash.findNearestColor(r, g, b);
      const end = performance.now();
      times.push(end - start);
    }

    const endMemory = this.getMemoryUsage();

    return {
      name: 'Spatial Hash Lookup',
      duration: times.reduce((a, b) => a + b, 0),
      memoryDelta: endMemory - startMemory,
      iterations,
      averageTime: times.reduce((a, b) => a + b, 0) / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      throughput: iterations / (times.reduce((a, b) => a + b, 0) / 1000), // lookups/sec
      details: {
        paletteSize: palette.length,
        algorithm: 'Spatial Hash Grid'
      }
    };
  }

  /**
   * Benchmark Bayer dithering performance
   */
  private async benchmarkBayerDithering(): Promise<BenchmarkResult> {
    const imageData = this.generateTestImage(256, 256);
    const palette = this.generateTestPalette(256);
    const iterations = 20;
    const times: number[] = [];

    const startMemory = this.getMemoryUsage();
    const dithering = new BayerDithering();

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      dithering.dither(imageData, palette);
      const end = performance.now();
      times.push(end - start);
    }

    const endMemory = this.getMemoryUsage();

    return {
      name: 'Bayer Dithering',
      duration: times.reduce((a, b) => a + b, 0),
      memoryDelta: endMemory - startMemory,
      iterations,
      averageTime: times.reduce((a, b) => a + b, 0) / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      details: {
        imageSize: `${imageData.width}x${imageData.height}`,
        matrixSize: '4x4',
        paletteSize: palette.length
      }
    };
  }

  /**
   * Benchmark OKLab color space conversion
   */
  private async benchmarkOKLabConversion(): Promise<BenchmarkResult> {
    const iterations = 10000;
    const times: number[] = [];

    const startMemory = this.getMemoryUsage();

    for (let i = 0; i < iterations; i++) {
      const rgb = {
        r: Math.floor(Math.random() * 256),
        g: Math.floor(Math.random() * 256),
        b: Math.floor(Math.random() * 256)
      };

      const start = performance.now();
      const oklab = OKLabConverter.rgbToOKLab(rgb);
      OKLabConverter.oklabToRGB(oklab);
      const end = performance.now();
      times.push(end - start);
    }

    const endMemory = this.getMemoryUsage();

    return {
      name: 'OKLab Conversion',
      duration: times.reduce((a, b) => a + b, 0),
      memoryDelta: endMemory - startMemory,
      iterations,
      averageTime: times.reduce((a, b) => a + b, 0) / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      throughput: iterations * 2 / (times.reduce((a, b) => a + b, 0) / 1000), // conversions/sec
      details: {
        operations: 'RGB->OKLab->RGB roundtrip'
      }
    };
  }

  /**
   * Benchmark color analysis performance
   */
  private async benchmarkColorAnalysis(): Promise<BenchmarkResult> {
    const imageData = this.generateTestImage(512, 512);
    const iterations = 10;
    const times: number[] = [];

    const startMemory = this.getMemoryUsage();

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      OKLabConverter.analyzeImageColors(imageData, 1000);
      const end = performance.now();
      times.push(end - start);
    }

    const endMemory = this.getMemoryUsage();

    return {
      name: 'Color Analysis',
      duration: times.reduce((a, b) => a + b, 0),
      memoryDelta: endMemory - startMemory,
      iterations,
      averageTime: times.reduce((a, b) => a + b, 0) / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      details: {
        imageSize: `${imageData.width}x${imageData.height}`,
        sampleCount: 1000
      }
    };
  }

  /**
   * Benchmark animation frame performance
   */
  private async benchmarkAnimationFrames(): Promise<BenchmarkResult> {
    const imageData = this.generateTestImage(256, 256);
    const quantized = ColorQuantizer.quantize(imageData, {
      method: 'rgb332',
      maxColors: 256
    });

    const controller = new RecolorAnimationController();
    const controllerInternal = controller as RecolorAnimationControllerInternal;

    const gradient = [
      { position: 0, color: '#ff0000' },
      { position: 0.5, color: '#00ff00' },
      { position: 1, color: '#0000ff' }
    ];

    const iterations = 100;
    const times: number[] = [];
    const startMemory = this.getMemoryUsage();

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      controllerInternal.updateFrame(quantized.indices, quantized.palette, gradient, imageData);
      const end = performance.now();
      times.push(end - start);
    }

    const endMemory = this.getMemoryUsage();

    return {
      name: 'Animation Frames',
      duration: times.reduce((a, b) => a + b, 0),
      memoryDelta: endMemory - startMemory,
      iterations,
      averageTime: times.reduce((a, b) => a + b, 0) / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      throughput: iterations / (times.reduce((a, b) => a + b, 0) / 1000), // frames/sec
      details: {
        imageSize: `${imageData.width}x${imageData.height}`,
        fps: 30,
        cycleColors: 16
      }
    };
  }

  /**
   * Benchmark memory pressure handling
   */
  private async benchmarkMemoryPressure(): Promise<BenchmarkResult> {
    const iterations = 50;
    const times: number[] = [];
    const memorySnapshots: number[] = [];

    const startMemory = this.getMemoryUsage();
    const globalWithGC = globalThis as typeof globalThis & { gc?: () => void };
    memorySnapshots.push(startMemory);

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      
      // Simulate heavy memory usage
      const imageData = this.generateTestImage(512, 512);
      ColorQuantizer.quantize(imageData, {
        method: 'rgb332',
        maxColors: 256
      });
      
      // Force garbage collection opportunity
      if (i % 10 === 0 && typeof globalWithGC.gc === 'function') {
        globalWithGC.gc();
      }
      
      const end = performance.now();
      times.push(end - start);
      memorySnapshots.push(this.getMemoryUsage());
    }

    const endMemory = this.getMemoryUsage();

    return {
      name: 'Memory Pressure',
      duration: times.reduce((a, b) => a + b, 0),
      memoryDelta: endMemory - startMemory,
      iterations,
      averageTime: times.reduce((a, b) => a + b, 0) / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      details: {
        peakMemory: Math.max(...memorySnapshots),
        memoryVariance: this.calculateVariance(memorySnapshots),
        gcAvailable: typeof globalWithGC.gc === 'function'
      }
    };
  }

  /**
   * Benchmark full pipeline performance
   */
  private async benchmarkFullPipeline(): Promise<BenchmarkResult> {
    const iterations = 10;
    const times: number[] = [];

    const startMemory = this.getMemoryUsage();

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      
      // Full workflow: generate -> quantize -> animate
      const imageData = this.generateTestImage(256, 256);
      const quantized = ColorQuantizer.quantize(imageData, {
        method: 'rgb332',
        ditherMode: 'bayer4',
        maxColors: 256
      });
      
      const controller = new RecolorAnimationController();
      const controllerInternal = controller as RecolorAnimationControllerInternal;
      
      const gradient = [
        { position: 0, color: '#ff0000' },
        { position: 1, color: '#0000ff' }
      ];
      
      // Simulate 10 animation frames
      for (let frame = 0; frame < 10; frame++) {
        controllerInternal.updateFrame(quantized.indices, quantized.palette, gradient, imageData);
      }
      
      const end = performance.now();
      times.push(end - start);
    }

    const endMemory = this.getMemoryUsage();

    return {
      name: 'Full Pipeline',
      duration: times.reduce((a, b) => a + b, 0),
      memoryDelta: endMemory - startMemory,
      iterations,
      averageTime: times.reduce((a, b) => a + b, 0) / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      details: {
        workflow: 'Generate->Quantize->Dither->Animate(10 frames)',
        imageSize: '256x256',
        quantization: 'RGB332 + Bayer4'
      }
    };
  }

  /**
   * Generate test image with varying colors
   */
  private generateTestImage(width: number, height: number): ImageData {
    const imageData = new ImageData(width, height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const x = (i / 4) % width;
      const y = Math.floor((i / 4) / width);
      
      data[i] = Math.floor(Math.sin(x * 0.01) * 127 + 128);     // R
      data[i + 1] = Math.floor(Math.sin(y * 0.01) * 127 + 128); // G
      data[i + 2] = Math.floor(Math.sin((x + y) * 0.005) * 127 + 128); // B
      data[i + 3] = 255; // A
    }

    return imageData;
  }

  /**
   * Generate test palette
   */
  private generateTestPalette(size: number): Uint32Array {
    const palette = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      const r = Math.floor(Math.random() * 256);
      const g = Math.floor(Math.random() * 256);
      const b = Math.floor(Math.random() * 256);
      palette[i] = (255 << 24) | (b << 16) | (g << 8) | r;
    }
    return palette;
  }

  /**
   * Get memory usage (approximate)
   */
  private getMemoryUsage(): number {
    const memory = getPerformanceMemory();
    if (memory) {
      return memory.usedJSHeapSize;
    }
    return Date.now(); // Fallback for timing-based approximation
  }

  /**
   * Calculate variance of array
   */
  private calculateVariance(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
  }

  /**
   * Get system information
   */
  private getSystemInfo() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    const memory = getPerformanceMemory();

    return {
      userAgent: navigator.userAgent,
      canvas2DSupport: !!canvas.getContext('2d'),
      webGLSupport: !!gl,
      memoryInfo: memory
    };
  }

  /**
   * Format benchmark results for display
   */
  static formatResults(suite: BenchmarkSuite): string {
    let output = `# ${suite.name}\n\n`;
    
    output += `## System Information\n`;
    output += `- User Agent: ${suite.systemInfo.userAgent}\n`;
    output += `- Canvas2D Support: ${suite.systemInfo.canvas2DSupport}\n`;
    output += `- WebGL Support: ${suite.systemInfo.webGLSupport}\n`;
    if (suite.systemInfo.memoryInfo) {
      output += `- JS Heap Limit: ${(suite.systemInfo.memoryInfo.jsHeapSizeLimit / 1024 / 1024).toFixed(1)}MB\n`;
    }
    output += `\n`;

    output += `## Performance Results\n\n`;
    
    for (const result of suite.results) {
      output += `### ${result.name}\n`;
      output += `- Average Time: ${result.averageTime.toFixed(2)}ms\n`;
      output += `- Min/Max: ${result.minTime.toFixed(2)}ms / ${result.maxTime.toFixed(2)}ms\n`;
      output += `- Iterations: ${result.iterations}\n`;
      output += `- Memory Delta: ${(result.memoryDelta / 1024).toFixed(1)}KB\n`;
      if (result.throughput) {
        output += `- Throughput: ${result.throughput.toFixed(0)} ops/sec\n`;
      }
      if (result.details) {
        output += `- Details: ${JSON.stringify(result.details, null, 2)}\n`;
      }
      output += `\n`;
    }

    return output;
  }
}
