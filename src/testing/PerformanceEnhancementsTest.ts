/**
 * Performance Enhancements Test
 * Compares optimized implementation against baseline
 */

import { ColorCycleBrushOptimized } from '../hooks/brushEngine/ColorCycleBrushOptimized';
import { ColorCycleBrushCanvas2D } from '../hooks/brushEngine/ColorCycleBrushCanvas2D';

export interface PerformanceTestResult {
  testName: string;
  baseline: number;
  optimized: number;
  improvement: number;
  details: any;
}

export class PerformanceEnhancementsTest {
  private results: PerformanceTestResult[] = [];

  /**
   * Run all performance tests
   */
  async runAllTests(canvas1: HTMLCanvasElement, canvas2: HTMLCanvasElement) {
    console.log('Running performance enhancement tests...');
    
    // Test 1: Rendering performance
    await this.testRenderingPerformance(canvas1, canvas2);
    
    // Test 2: Paint operation performance
    await this.testPaintPerformance(canvas1, canvas2);
    
    // Test 3: Animation frame rate
    await this.testAnimationFPS(canvas1, canvas2);
    
    // Test 4: Memory usage
    await this.testMemoryUsage(canvas1, canvas2);
    
    // Test 5: Gradient update performance
    await this.testGradientUpdatePerformance(canvas1, canvas2);
    
    return this.results;
  }

  /**
   * Test rendering performance
   */
  private async testRenderingPerformance(canvas1: HTMLCanvasElement, canvas2: HTMLCanvasElement) {
    const iterations = 100;
    
    // Baseline implementation
    const baseline = new ColorCycleBrushCanvas2D(canvas1);
    baseline.updateGradient([
      { position: 0, color: 'rgb(255, 0, 0)' },
      { position: 0.5, color: 'rgb(0, 255, 0)' },
      { position: 1, color: 'rgb(0, 0, 255)' }
    ]);
    
    // Paint some data
    for (let i = 0; i < 50; i++) {
      baseline.paint(
        Math.random() * canvas1.width,
        Math.random() * canvas1.height
      );
    }
    
    // Measure baseline rendering
    const baselineStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      await baseline.render();
    }
    const baselineTime = performance.now() - baselineStart;
    
    // Optimized implementation with all features
    const optimized = new ColorCycleBrushOptimized(canvas2, {
      useOffscreenCanvas: true,
      useWebWorkers: true,
      useWASM: true,
      useImageBitmap: true
    });
    
    await optimized.updateGradient([
      { position: 0, color: 'rgb(255, 0, 0)' },
      { position: 0.5, color: 'rgb(0, 255, 0)' },
      { position: 1, color: 'rgb(0, 0, 255)' }
    ]);
    
    // Paint same data
    for (let i = 0; i < 50; i++) {
      optimized.paint(
        Math.random() * canvas2.width,
        Math.random() * canvas2.height
      );
    }
    
    // Measure optimized rendering
    const optimizedStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      await optimized.render();
    }
    const optimizedTime = performance.now() - optimizedStart;
    
    // Calculate improvement
    const improvement = ((baselineTime - optimizedTime) / baselineTime) * 100;
    
    this.results.push({
      testName: 'Rendering Performance',
      baseline: baselineTime / iterations,
      optimized: optimizedTime / iterations,
      improvement,
      details: {
        iterations,
        totalBaselineTime: baselineTime,
        totalOptimizedTime: optimizedTime,
        performanceFeatures: optimized.getPerformanceStats()
      }
    });
    
    // Cleanup
    baseline.dispose();
    optimized.dispose();
  }

  /**
   * Test paint operation performance
   */
  private async testPaintPerformance(canvas1: HTMLCanvasElement, canvas2: HTMLCanvasElement) {
    const operations = 1000;
    
    // Baseline
    const baseline = new ColorCycleBrushCanvas2D(canvas1);
    baseline.setBrushSize(20);
    
    const baselineStart = performance.now();
    for (let i = 0; i < operations; i++) {
      baseline.paint(
        Math.random() * canvas1.width,
        Math.random() * canvas1.height
      );
    }
    const baselineTime = performance.now() - baselineStart;
    
    // Optimized with WASM
    const optimized = new ColorCycleBrushOptimized(canvas2, {
      useWASM: true
    });
    optimized.setBrushSize(20);
    
    // Wait for WASM initialization
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const optimizedStart = performance.now();
    for (let i = 0; i < operations; i++) {
      optimized.paint(
        Math.random() * canvas2.width,
        Math.random() * canvas2.height
      );
    }
    const optimizedTime = performance.now() - optimizedStart;
    
    const improvement = ((baselineTime - optimizedTime) / baselineTime) * 100;
    
    this.results.push({
      testName: 'Paint Operation Performance',
      baseline: baselineTime / operations,
      optimized: optimizedTime / operations,
      improvement,
      details: {
        operations,
        brushSize: 20,
        totalBaselineTime: baselineTime,
        totalOptimizedTime: optimizedTime
      }
    });
    
    baseline.dispose();
    optimized.dispose();
  }

  /**
   * Test animation frame rate
   */
  private async testAnimationFPS(canvas1: HTMLCanvasElement, canvas2: HTMLCanvasElement) {
    const duration = 3000; // 3 seconds
    
    // Baseline
    const baseline = new ColorCycleBrushCanvas2D(canvas1);
    baseline.updateGradient([
      { position: 0, color: 'rgb(255, 0, 0)' },
      { position: 1, color: 'rgb(0, 0, 255)' }
    ]);
    
    // Add some content
    for (let i = 0; i < 100; i++) {
      baseline.paint(
        Math.random() * canvas1.width,
        Math.random() * canvas1.height
      );
    }
    
    let baselineFrames = 0;
    baseline.startCycling();
    
    const baselineInterval = setInterval(() => {
      baselineFrames++;
    }, 16); // ~60fps target
    
    await new Promise(resolve => setTimeout(resolve, duration));
    clearInterval(baselineInterval);
    baseline.stopCycling();
    
    const baselineFPS = (baselineFrames / duration) * 1000;
    
    // Optimized
    const optimized = new ColorCycleBrushOptimized(canvas2, {
      useOffscreenCanvas: true,
      useWebWorkers: true,
      useWASM: true,
      useImageBitmap: true,
      fps: 60
    });
    
    await optimized.updateGradient([
      { position: 0, color: 'rgb(255, 0, 0)' },
      { position: 1, color: 'rgb(0, 0, 255)' }
    ]);
    
    // Add same content
    for (let i = 0; i < 100; i++) {
      optimized.paint(
        Math.random() * canvas2.width,
        Math.random() * canvas2.height
      );
    }
    
    let optimizedFrames = 0;
    optimized.startCycling();
    
    const optimizedInterval = setInterval(() => {
      optimizedFrames++;
    }, 16);
    
    await new Promise(resolve => setTimeout(resolve, duration));
    clearInterval(optimizedInterval);
    optimized.stopCycling();
    
    const optimizedFPS = (optimizedFrames / duration) * 1000;
    const improvement = ((optimizedFPS - baselineFPS) / baselineFPS) * 100;
    
    this.results.push({
      testName: 'Animation Frame Rate',
      baseline: baselineFPS,
      optimized: optimizedFPS,
      improvement,
      details: {
        duration,
        baselineFrames,
        optimizedFrames,
        targetFPS: 60
      }
    });
    
    baseline.dispose();
    optimized.dispose();
  }

  /**
   * Test memory usage
   */
  private async testMemoryUsage(canvas1: HTMLCanvasElement, canvas2: HTMLCanvasElement) {
    // Get initial memory if available
    const getMemory = () => {
      if ('memory' in performance) {
        return (performance as any).memory.usedJSHeapSize;
      }
      return 0;
    };
    
    // Force garbage collection if available
    const gc = () => {
      if ('gc' in window) {
        (window as any).gc();
      }
    };
    
    gc();
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const initialMemory = getMemory();
    
    // Baseline
    const baseline = new ColorCycleBrushCanvas2D(canvas1);
    baseline.updateGradient([
      { position: 0, color: 'rgb(255, 0, 0)' },
      { position: 1, color: 'rgb(0, 0, 255)' }
    ]);
    
    // Paint heavily
    for (let i = 0; i < 500; i++) {
      baseline.paint(
        Math.random() * canvas1.width,
        Math.random() * canvas1.height
      );
    }
    
    await baseline.render();
    const baselineMemory = getMemory() - initialMemory;
    baseline.dispose();
    
    gc();
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Optimized
    const optimized = new ColorCycleBrushOptimized(canvas2, {
      useOffscreenCanvas: true,
      useWebWorkers: true,
      useWASM: true,
      useImageBitmap: true
    });
    
    await optimized.updateGradient([
      { position: 0, color: 'rgb(255, 0, 0)' },
      { position: 1, color: 'rgb(0, 0, 255)' }
    ]);
    
    // Paint same amount
    for (let i = 0; i < 500; i++) {
      optimized.paint(
        Math.random() * canvas2.width,
        Math.random() * canvas2.height
      );
    }
    
    await optimized.render();
    const optimizedMemory = getMemory() - initialMemory;
    optimized.dispose();
    
    const improvement = ((baselineMemory - optimizedMemory) / baselineMemory) * 100;
    
    this.results.push({
      testName: 'Memory Usage',
      baseline: baselineMemory / 1024 / 1024, // Convert to MB
      optimized: optimizedMemory / 1024 / 1024,
      improvement,
      details: {
        baselineBytes: baselineMemory,
        optimizedBytes: optimizedMemory,
        paintOperations: 500
      }
    });
  }

  /**
   * Test gradient update performance
   */
  private async testGradientUpdatePerformance(canvas1: HTMLCanvasElement, canvas2: HTMLCanvasElement) {
    const updates = 50;
    
    const gradients = [
      [
        { position: 0, color: 'rgb(255, 0, 0)' },
        { position: 1, color: 'rgb(0, 0, 255)' }
      ],
      [
        { position: 0, color: 'rgb(0, 255, 0)' },
        { position: 1, color: 'rgb(255, 255, 0)' }
      ],
      [
        { position: 0, color: 'rgb(255, 0, 255)' },
        { position: 1, color: 'rgb(0, 255, 255)' }
      ]
    ];
    
    // Baseline
    const baseline = new ColorCycleBrushCanvas2D(canvas1);
    
    const baselineStart = performance.now();
    for (let i = 0; i < updates; i++) {
      baseline.updateGradient(gradients[i % gradients.length]);
    }
    const baselineTime = performance.now() - baselineStart;
    
    // Optimized with Web Workers
    const optimized = new ColorCycleBrushOptimized(canvas2, {
      useWebWorkers: true
    });
    
    const optimizedStart = performance.now();
    for (let i = 0; i < updates; i++) {
      await optimized.updateGradient(gradients[i % gradients.length]);
    }
    const optimizedTime = performance.now() - optimizedStart;
    
    const improvement = ((baselineTime - optimizedTime) / baselineTime) * 100;
    
    this.results.push({
      testName: 'Gradient Update Performance',
      baseline: baselineTime / updates,
      optimized: optimizedTime / updates,
      improvement,
      details: {
        updates,
        totalBaselineTime: baselineTime,
        totalOptimizedTime: optimizedTime,
        gradientCount: gradients.length
      }
    });
    
    baseline.dispose();
    optimized.dispose();
  }

  /**
   * Generate HTML report
   */
  generateHTMLReport(): string {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Performance Enhancements Test Report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
          h1 { color: #333; }
          .summary { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .test-result { background: white; padding: 15px; margin: 10px 0; border-radius: 8px; }
          .improvement { font-weight: bold; }
          .positive { color: green; }
          .negative { color: red; }
          .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin: 10px 0; }
          .metric { padding: 10px; background: #f9f9f9; border-radius: 4px; }
          .metric-label { font-size: 12px; color: #666; }
          .metric-value { font-size: 18px; font-weight: bold; margin-top: 5px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
          th { background: #f0f0f0; }
        </style>
      </head>
      <body>
        <h1>Performance Enhancements Test Report</h1>
        
        <div class="summary">
          <h2>Overall Performance Summary</h2>
          <div class="metrics">
            ${this.results.map(r => `
              <div class="metric">
                <div class="metric-label">${r.testName}</div>
                <div class="metric-value improvement ${r.improvement > 0 ? 'positive' : 'negative'}">
                  ${r.improvement > 0 ? '+' : ''}${r.improvement.toFixed(1)}%
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        
        <h2>Detailed Test Results</h2>
        
        ${this.results.map(r => `
          <div class="test-result">
            <h3>${r.testName}</h3>
            <table>
              <tr>
                <th>Metric</th>
                <th>Baseline</th>
                <th>Optimized</th>
                <th>Improvement</th>
              </tr>
              <tr>
                <td>Average Time (ms)</td>
                <td>${r.baseline.toFixed(3)}</td>
                <td>${r.optimized.toFixed(3)}</td>
                <td class="improvement ${r.improvement > 0 ? 'positive' : 'negative'}">
                  ${r.improvement > 0 ? '+' : ''}${r.improvement.toFixed(1)}%
                </td>
              </tr>
            </table>
            
            <details>
              <summary>Test Details</summary>
              <pre>${JSON.stringify(r.details, null, 2)}</pre>
            </details>
          </div>
        `).join('')}
        
        <div class="summary">
          <h2>Performance Features Status</h2>
          <ul>
            <li>OffscreenCanvas: ${OffscreenRenderer.isSupported() ? '✅ Supported' : '❌ Not Supported'}</li>
            <li>Web Workers: ${GradientWorkerManager.isSupported() ? '✅ Supported' : '❌ Not Supported'}</li>
            <li>WebAssembly: ${WASMAccelerator.isSupported() ? '✅ Supported' : '❌ Not Supported'}</li>
            <li>ImageBitmap: ${ImageBitmapTransfer.isSupported() ? '✅ Supported' : '❌ Not Supported'}</li>
          </ul>
        </div>
        
        <p style="text-align: center; color: #666; margin-top: 40px;">
          Generated on ${new Date().toLocaleString()}
        </p>
      </body>
      </html>
    `;
    
    return html;
  }
}

// Import statements for feature detection in report
import { OffscreenRenderer } from '../lib/performance/OffscreenRenderer';
import { GradientWorkerManager } from '../lib/performance/GradientWorkerManager';
import { WASMAccelerator } from '../lib/performance/WASMAccelerator';
import { ImageBitmapTransfer } from '../lib/performance/ImageBitmapTransfer';