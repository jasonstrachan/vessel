/**
 * Performance Benchmarking Tool
 * Performance benchmarking for Canvas2D implementation
 * WebGL implementation has been removed
 */

import { ColorCycleBrushCanvas2D } from '../hooks/brushEngine/ColorCycleBrushCanvas2D';
// ColorCycleBrush WebGL implementation removed - using Canvas2D only
import { ColorCycleBrushCanvas2D as ColorCycleBrush } from '../hooks/brushEngine/ColorCycleBrushCanvas2D';
import { GradientStop } from '../lib/GradientPalette';

export interface BenchmarkResult {
  name: string;
  canvas2dTime: number;
  webglTime: number;
  ratio: number; // canvas2d / webgl
  iterations: number;
}

interface MemorySnapshot {
  usedJSHeapSize?: number;
  totalJSHeapSize?: number;
  jsHeapSizeLimit?: number;
}


interface BenchmarkBrush {
  paint: (x: number, y: number, layerId?: string) => void;
  render: () => void;
  setGradient: (stops: GradientStop[], layerId?: string) => void;
  clear?: () => void;
  batchPaint?: (points: Array<{ x: number; y: number }>) => void;
  fillRect?: (x: number, y: number, width: number, height: number) => void;
  fill?: (x: number, y: number, width: number, height: number) => void;
  updateAnimation?: () => void;
  dispose?: () => void;
}

type PerformanceMemoryInfo = {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
};

interface PerformanceWithMemory extends Performance {
  memory?: PerformanceMemoryInfo;
}

type GarbageCollectableGlobal = typeof globalThis & {
  gc?: () => void;
};


export class PerformanceBenchmark {
  private canvas: HTMLCanvasElement;
  private canvas2dBrush: ColorCycleBrushCanvas2D;
  private webglBrush: ColorCycleBrush;
  private results: BenchmarkResult[] = [];
  
  constructor(width: number = 1024, height: number = 768) {
    // Create test canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    
    // Initialize both implementations
    this.canvas2dBrush = new ColorCycleBrushCanvas2D(this.canvas, {
      brushSize: 20,
      fps: 30
    });
    
    this.webglBrush = new ColorCycleBrush(this.canvas, {
      brushSize: 20,
      fps: 30
    });
  }

  private getPerformanceMemory(): PerformanceMemoryInfo | null {
    if (!('performance' in globalThis)) {
      return null;
    }

    const perf = (globalThis as { performance?: Performance }).performance;
    if (!perf) {
      return null;
    }

    const perfWithMemory: PerformanceWithMemory = perf;
    return perfWithMemory.memory ?? null;
  }

  private getGlobalWithGC(): GarbageCollectableGlobal {
    return globalThis as GarbageCollectableGlobal;
  }

  
  /**
   * Run a benchmark test
   */
  private async runTest(
    name: string,
    iterations: number,
    testFn: (brush: BenchmarkBrush) => void
  ): Promise<BenchmarkResult> {
    // Warm up both implementations
    for (let i = 0; i < 10; i++) {
      testFn(this.canvas2dBrush);
      testFn(this.webglBrush);
    }
    
    // Benchmark Canvas2D
    const canvas2dStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      testFn(this.canvas2dBrush);
    }
    const canvas2dTime = performance.now() - canvas2dStart;
    
    // Clear between tests
    this.canvas2dBrush.clear();
    
    // Benchmark WebGL
    const webglStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      testFn(this.webglBrush);
    }
    const webglTime = performance.now() - webglStart;
    
    // Clear after test
    this.webglBrush.clear();
    
    const result: BenchmarkResult = {
      name,
      canvas2dTime,
      webglTime,
      ratio: canvas2dTime / webglTime,
      iterations
    };
    
    this.results.push(result);
    return result;
  }
  
  /**
   * Benchmark single pixel painting
   */
  async benchmarkSinglePixel(): Promise<BenchmarkResult> {
    return this.runTest('Single Pixel Paint', 10000, (brush) => {
      const x = Math.random() * this.canvas.width;
      const y = Math.random() * this.canvas.height;
      brush.paint(x, y);
    });
  }
  
  /**
   * Benchmark line drawing
   */
  async benchmarkLineDrawing(): Promise<BenchmarkResult> {
    return this.runTest('Line Drawing (100 points)', 100, (brush) => {
      const startX = Math.random() * this.canvas.width;
      const startY = Math.random() * this.canvas.height;
      
      for (let i = 0; i < 100; i++) {
        const x = startX + Math.cos(i * 0.1) * 50;
        const y = startY + Math.sin(i * 0.1) * 50;
        brush.paint(x, y);
      }
    });
  }
  
  /**
   * Benchmark batch painting
   */
  async benchmarkBatchPainting(): Promise<BenchmarkResult> {
    return this.runTest('Batch Paint (50 points)', 200, (brush) => {
      const points: Array<{x: number, y: number}> = [];
      for (let i = 0; i < 50; i++) {
        points.push({
          x: Math.random() * this.canvas.width,
          y: Math.random() * this.canvas.height
        });
      }
      
      if (brush.batchPaint) {
        brush.batchPaint(points);
      } else {
        points.forEach(p => brush.paint(p.x, p.y));
      }
    });
  }
  
  /**
   * Benchmark fill operations
   */
  async benchmarkFill(): Promise<BenchmarkResult> {
    return this.runTest('Fill Rectangle (200x200)', 500, (brush) => {
      const x = Math.random() * (this.canvas.width - 200);
      const y = Math.random() * (this.canvas.height - 200);
      
      if (brush.fillRect) {
        brush.fillRect(x, y, 200, 200);
      } else if (brush.fill) {
        brush.fill(x, y, 200, 200);
      }
    });
  }
  
  /**
   * Benchmark gradient updates
   */
  async benchmarkGradientUpdate(): Promise<BenchmarkResult> {
    const gradients = [
      [
        { position: 0, color: 'rgb(255, 0, 0)' },
        { position: 0.5, color: 'rgb(0, 255, 0)' },
        { position: 1, color: 'rgb(0, 0, 255)' }
      ],
      [
        { position: 0, color: 'rgb(255, 255, 0)' },
        { position: 0.5, color: 'rgb(255, 0, 255)' },
        { position: 1, color: 'rgb(0, 255, 255)' }
      ]
    ];
    
    return this.runTest('Gradient Update', 1000, (brush) => {
      const gradient = gradients[Math.floor(Math.random() * gradients.length)];
      brush.setGradient(gradient);
    });
  }
  
  /**
   * Benchmark rendering
   */
  async benchmarkRender(): Promise<BenchmarkResult> {
    // Pre-paint some content
    for (let i = 0; i < 1000; i++) {
      const x = Math.random() * this.canvas.width;
      const y = Math.random() * this.canvas.height;
      this.canvas2dBrush.paint(x, y);
      this.webglBrush.paint(x, y);
    }
    
    return this.runTest('Render to Canvas', 100, (brush) => {
      brush.render();
    });
  }
  
  /**
   * Benchmark animation frame
   */
  async benchmarkAnimationFrame(): Promise<BenchmarkResult> {
    // Set up gradient for animation
    const gradient: GradientStop[] = [
      { position: 0, color: 'rgb(255, 0, 0)' },
      { position: 0.33, color: 'rgb(0, 255, 0)' },
      { position: 0.67, color: 'rgb(0, 0, 255)' },
      { position: 1, color: 'rgb(255, 0, 0)' }
    ];
    
    this.canvas2dBrush.setGradient(gradient);
    this.webglBrush.setGradient(gradient);
    
    // Pre-paint content
    for (let i = 0; i < 5000; i++) {
      const x = Math.random() * this.canvas.width;
      const y = Math.random() * this.canvas.height;
      this.canvas2dBrush.paint(x, y);
      this.webglBrush.paint(x, y);
    }
    
    return this.runTest('Animation Frame (with 5000 pixels)', 60, (brush) => {
      if (brush.updateAnimation) {
        brush.updateAnimation();
      } else {
        brush.render();
      }
    });
  }
  
  /**
   * Measure memory usage
   */
  async measureMemory(): Promise<{
    canvas2d: MemorySnapshot;
    webgl: MemorySnapshot;
  }> {
    const results = {
      canvas2d: {} as MemorySnapshot,
      webgl: {} as MemorySnapshot
    };

    const triggerGC = () => {
      const gcContext = this.getGlobalWithGC();
      if (typeof gcContext.gc === 'function') {
        gcContext.gc();
      }
    };

    triggerGC();

    // Measure Canvas2D memory
    const canvas2dCanvas = document.createElement('canvas');
    canvas2dCanvas.width = 2048;
    canvas2dCanvas.height = 2048;

    const canvas2dBrush = new ColorCycleBrushCanvas2D(canvas2dCanvas, {
      brushSize: 20,
      fps: 30
    });

    for (let i = 0; i < 10000; i++) {
      canvas2dBrush.paint(
        Math.random() * canvas2dCanvas.width,
        Math.random() * canvas2dCanvas.height
      );
    }

    const canvas2dMemory = this.getPerformanceMemory();
    if (canvas2dMemory) {
      results.canvas2d = {
        usedJSHeapSize: canvas2dMemory.usedJSHeapSize,
        totalJSHeapSize: canvas2dMemory.totalJSHeapSize,
        jsHeapSizeLimit: canvas2dMemory.jsHeapSizeLimit
      };
    }

    if ('dispose' in canvas2dBrush && typeof canvas2dBrush.dispose === 'function') {
      canvas2dBrush.dispose();
    }

    triggerGC();

    // Measure WebGL memory
    const webglCanvas = document.createElement('canvas');
    webglCanvas.width = 2048;
    webglCanvas.height = 2048;

    const webglBrush = new ColorCycleBrush(webglCanvas, {
      brushSize: 20,
      fps: 30
    });

    for (let i = 0; i < 10000; i++) {
      webglBrush.paint(
        Math.random() * webglCanvas.width,
        Math.random() * webglCanvas.height
      );
    }

    const webglMemory = this.getPerformanceMemory();
    if (webglMemory) {
      results.webgl = {
        usedJSHeapSize: webglMemory.usedJSHeapSize,
        totalJSHeapSize: webglMemory.totalJSHeapSize,
        jsHeapSizeLimit: webglMemory.jsHeapSizeLimit
      };
    }

    if ('dispose' in webglBrush && typeof webglBrush.dispose === 'function') {
      webglBrush.dispose();
    }

    triggerGC();

    return results;
  }
    
  /**
   * Run all benchmarks
   */
  async runAllBenchmarks(): Promise<BenchmarkResult[]> {
    console.log('Starting performance benchmarks...');
    
    await this.benchmarkSinglePixel();
    await this.benchmarkLineDrawing();
    await this.benchmarkBatchPainting();
    await this.benchmarkFill();
    await this.benchmarkGradientUpdate();
    await this.benchmarkRender();
    await this.benchmarkAnimationFrame();
    
    return this.results;
  }
  
  /**
   * Generate performance report
   */
  generateReport(): string {
    let html = `
<!DOCTYPE html>
<html>
<head>
  <title>Vessel Performance Benchmark Report</title>
  <style>
    body {
      font-family: 'IBM Plex Mono', 'Courier New', monospace;
      margin: 40px;
      background: #f5f5f5;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 {
      color: #333;
      border-bottom: 3px solid #4CAF50;
      padding-bottom: 10px;
    }
    .summary {
      background: #e8f5e9;
      padding: 20px;
      border-radius: 6px;
      margin: 20px 0;
    }
    .summary h2 {
      margin-top: 0;
      color: #2e7d32;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    th {
      background: #4CAF50;
      color: white;
      padding: 12px;
      text-align: left;
      font-weight: 600;
    }
    td {
      padding: 10px 12px;
      border-bottom: 1px solid #ddd;
    }
    tr:hover {
      background: #f5f5f5;
    }
    .faster {
      color: #4CAF50;
      font-weight: 600;
    }
    .slower {
      color: #f44336;
      font-weight: 600;
    }
    .neutral {
      color: #FF9800;
      font-weight: 600;
    }
    .chart {
      margin: 30px 0;
    }
    .bar {
      height: 30px;
      margin: 10px 0;
      border-radius: 3px;
      position: relative;
      overflow: hidden;
    }
    .bar-canvas2d {
      background: linear-gradient(90deg, #4CAF50, #45a049);
    }
    .bar-webgl {
      background: linear-gradient(90deg, #2196F3, #1976D2);
    }
    .bar-label {
      position: absolute;
      right: 10px;
      top: 50%;
      transform: translateY(-50%);
      color: white;
      font-weight: 500;
      font-size: 14px;
    }
    .test-name {
      font-weight: 600;
      margin-bottom: 5px;
      color: #333;
    }
    .metadata {
      background: #f5f5f5;
      padding: 15px;
      border-radius: 6px;
      margin: 20px 0;
      font-size: 14px;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎨 Vessel Performance Benchmark Report</h1>
    
    <div class="metadata">
      <strong>Test Date:</strong> ${new Date().toLocaleString()}<br>
      <strong>Canvas Size:</strong> ${this.canvas.width} × ${this.canvas.height}<br>
      <strong>User Agent:</strong> ${navigator.userAgent}
    </div>
    `;
    
    // Calculate summary statistics
    let canvas2dWins = 0;
    let webglWins = 0;
    let totalCanvas2dTime = 0;
    let totalWebglTime = 0;
    
    this.results.forEach(result => {
      if (result.ratio < 1) canvas2dWins++;
      else if (result.ratio > 1) webglWins++;
      totalCanvas2dTime += result.canvas2dTime;
      totalWebglTime += result.webglTime;
    });
    
    const overallRatio = totalCanvas2dTime / totalWebglTime;
    const winner = overallRatio < 1 ? 'Canvas2D' : 'WebGL';
    const winnerColor = winner === 'Canvas2D' ? '#4CAF50' : '#2196F3';
    
    html += `
    <div class="summary">
      <h2>📊 Summary</h2>
      <p><strong>Overall Winner:</strong> <span style="color: ${winnerColor}; font-size: 1.2em;">${winner}</span></p>
      <p><strong>Performance Ratio:</strong> Canvas2D is ${overallRatio < 1 ? (1 / overallRatio).toFixed(2) + 'x faster' : overallRatio.toFixed(2) + 'x slower'} than WebGL overall</p>
      <p><strong>Test Wins:</strong> Canvas2D: ${canvas2dWins}, WebGL: ${webglWins}, Tied: ${this.results.length - canvas2dWins - webglWins}</p>
      <p><strong>Total Time:</strong> Canvas2D: ${totalCanvas2dTime.toFixed(2)}ms, WebGL: ${totalWebglTime.toFixed(2)}ms</p>
    </div>
    `;
    
    // Detailed results table
    html += `
    <h2>📈 Detailed Results</h2>
    <table>
      <thead>
        <tr>
          <th>Test Name</th>
          <th>Iterations</th>
          <th>Canvas2D (ms)</th>
          <th>WebGL (ms)</th>
          <th>Ratio</th>
          <th>Winner</th>
        </tr>
      </thead>
      <tbody>
    `;
    
    this.results.forEach(result => {
      const winner = result.ratio < 1 ? 'Canvas2D' : result.ratio > 1 ? 'WebGL' : 'Tied';
      const winnerClass = result.ratio < 0.9 ? 'faster' : result.ratio > 1.1 ? 'slower' : 'neutral';
      const ratioText = result.ratio < 1 
        ? `${(1 / result.ratio).toFixed(2)}x faster`
        : result.ratio > 1
        ? `${result.ratio.toFixed(2)}x slower`
        : 'Equal';
      
      html += `
        <tr>
          <td>${result.name}</td>
          <td>${result.iterations.toLocaleString()}</td>
          <td>${result.canvas2dTime.toFixed(2)}</td>
          <td>${result.webglTime.toFixed(2)}</td>
          <td class="${winnerClass}">${ratioText}</td>
          <td class="${winnerClass}">${winner}</td>
        </tr>
      `;
    });
    
    html += `
      </tbody>
    </table>
    `;
    
    // Visual comparison chart
    html += `
    <h2>📊 Visual Comparison</h2>
    <div class="chart">
    `;
    
    this.results.forEach(result => {
      const maxTime = Math.max(result.canvas2dTime, result.webglTime);
      const canvas2dWidth = (result.canvas2dTime / maxTime) * 100;
      const webglWidth = (result.webglTime / maxTime) * 100;
      
      html += `
        <div class="test-name">${result.name}</div>
        <div class="bar bar-canvas2d" style="width: ${canvas2dWidth}%;">
          <span class="bar-label">Canvas2D: ${result.canvas2dTime.toFixed(1)}ms</span>
        </div>
        <div class="bar bar-webgl" style="width: ${webglWidth}%;">
          <span class="bar-label">WebGL: ${result.webglTime.toFixed(1)}ms</span>
        </div>
        <div style="height: 10px;"></div>
      `;
    });
    
    html += `
    </div>
    `;
    
    // Recommendations
    html += `
    <h2>💡 Recommendations</h2>
    <div class="metadata">
    `;
    
    if (overallRatio < 0.8) {
      html += `
        <p><strong>✅ Canvas2D is recommended</strong> for this system. It provides significantly better performance than WebGL.</p>
        <p>Benefits: Better browser compatibility, lower memory usage, and faster execution on this hardware.</p>
      `;
    } else if (overallRatio > 1.2) {
      html += `
        <p><strong>⚡ WebGL is recommended</strong> for this system. It provides better performance than Canvas2D.</p>
        <p>Benefits: Hardware acceleration, better performance for complex operations, especially animations.</p>
      `;
    } else {
      html += `
        <p><strong>🤝 Both implementations perform similarly</strong> on this system.</p>
        <p>Choose Canvas2D for better compatibility, or WebGL for potential performance gains with complex scenes.</p>
      `;
    }
    
    html += `
    </div>
    
  </div>
</body>
</html>
    `;
    
    return html;
  }
  
  /**
   * Clean up resources
   */
  dispose(): void {
    if ('dispose' in this.canvas2dBrush && typeof this.canvas2dBrush.dispose === 'function') {
      this.canvas2dBrush.dispose();
    }
    if ('dispose' in this.webglBrush && typeof this.webglBrush.dispose === 'function') {
      this.webglBrush.dispose();
    }
  }
}

// Export for testing
export function runPerformanceBenchmark(): Promise<BenchmarkResult[]> {
  const benchmark = new PerformanceBenchmark();
  return benchmark.runAllBenchmarks();
}
