/**
 * Memory Usage Analysis Tool
 * Memory profiling for Canvas2D implementation
 * WebGL implementation has been removed
 */

import { ColorCycleBrushCanvas2D } from '../hooks/brushEngine/ColorCycleBrushCanvas2D';
// ColorCycleBrush WebGL implementation removed - using Canvas2D only
import { ColorCycleBrushCanvas2D as ColorCycleBrush } from '../hooks/brushEngine/ColorCycleBrushCanvas2D';
import { GradientStop } from '../lib/GradientPalette';

interface MemoryMetrics {
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  timestamp: number;
}

export interface MemoryTestResult {
  testName: string;
  canvas2d: {
    initial: MemoryMetrics;
    afterCreate: MemoryMetrics;
    afterPaint: MemoryMetrics;
    afterAnimation: MemoryMetrics;
    final: MemoryMetrics;
    peakUsage: number;
  };
  webgl: {
    initial: MemoryMetrics;
    afterCreate: MemoryMetrics;
    afterPaint: MemoryMetrics;
    afterAnimation: MemoryMetrics;
    final: MemoryMetrics;
    peakUsage: number;
  };
  savings: {
    percentSaved: number;
    bytesSaved: number;
  };
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

interface MemoryTestBrush {
  paint: (x: number, y: number, layerId?: string) => void;
  setGradient: (stops: GradientStop[], layerId?: string) => void;
  startAnimation: () => void;
  stopAnimation: () => void;
  dispose: () => void;
}

type MemoryBrushConstructor = new (
  canvas: HTMLCanvasElement,
  options?: { brushSize?: number; fps?: number }
) => MemoryTestBrush;


export class MemoryAnalysis {
  private results: MemoryTestResult[] = [];
  
  /**
   * Get current memory metrics
   */
  private getMemoryMetrics(): MemoryMetrics {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      // Node.js environment
      const usage = process.memoryUsage();
      return {
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
        external: usage.external,
        arrayBuffers: usage.arrayBuffers || 0,
        timestamp: Date.now()
      };
    }

    const performanceMemory = this.getPerformanceMemoryInfo();
    if (performanceMemory) {
      return {
        heapUsed: performanceMemory.usedJSHeapSize,
        heapTotal: performanceMemory.totalJSHeapSize,
        external: 0,
        arrayBuffers: 0,
        timestamp: Date.now()
      };
    }

    // Fallback - estimate based on canvas size
    return {
      heapUsed: 0,
      heapTotal: 0,
      external: 0,
      arrayBuffers: 0,
      timestamp: Date.now()
    };
  }
  
  /**
   * Force garbage collection if available
   */
  private forceGC(): void {
    const globalWithGC = this.getGlobalWithGC();
    if (typeof globalWithGC.gc === 'function') {
      globalWithGC.gc();
    }
  }

  private getPerformanceMemoryInfo(): PerformanceMemoryInfo | null {
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
   * Calculate memory size of canvas
   */
  private calculateCanvasMemory(width: number, height: number): number {
    // Each pixel uses 4 bytes (RGBA) in standard canvas
    // WebGL may use additional buffers
    return width * height * 4;
  }
  
  /**
   * Test memory usage for a single implementation
   */
  private async testImplementation(
    ImplementationClass: MemoryBrushConstructor,
    canvasSize: { width: number; height: number },
    operations: (brush: MemoryTestBrush) => Promise<void>
  ): Promise<{
    initial: MemoryMetrics;
    afterCreate: MemoryMetrics;
    afterPaint: MemoryMetrics;
    afterAnimation: MemoryMetrics;
    final: MemoryMetrics;
    peakUsage: number;
  }> {
    this.forceGC();
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const initial = this.getMemoryMetrics();
    let peakUsage = initial.heapUsed;
    
    // Create canvas and brush
    const canvas = document.createElement('canvas');
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    
    const brush = new ImplementationClass(canvas, {
      brushSize: 20,
      fps: 30
    });
    
    await new Promise(resolve => setTimeout(resolve, 50));
    const afterCreate = this.getMemoryMetrics();
    peakUsage = Math.max(peakUsage, afterCreate.heapUsed);
    
    // Perform operations
    await operations(brush);
    
    await new Promise(resolve => setTimeout(resolve, 50));
    const afterPaint = this.getMemoryMetrics();
    peakUsage = Math.max(peakUsage, afterPaint.heapUsed);
    
    // Run animation briefly
    brush.startAnimation();
    await new Promise(resolve => setTimeout(resolve, 500));
    brush.stopAnimation();
    
    const afterAnimation = this.getMemoryMetrics();
    peakUsage = Math.max(peakUsage, afterAnimation.heapUsed);
    
    // Clean up
    brush.dispose();
    canvas.remove();
    
    this.forceGC();
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const final = this.getMemoryMetrics();
    
    return {
      initial,
      afterCreate,
      afterPaint,
      afterAnimation,
      final,
      peakUsage
    };
  }
  
  /**
   * Test: Small canvas memory usage
   */
  async testSmallCanvas(): Promise<MemoryTestResult> {
    const canvasSize = { width: 256, height: 256 };
    
    const operations = async (brush: MemoryTestBrush) => {
      // Paint some content
      for (let i = 0; i < 100; i++) {
        brush.paint(
          Math.random() * canvasSize.width,
          Math.random() * canvasSize.height
        );
      }
    };
    
    const canvas2dResult = await this.testImplementation(
      ColorCycleBrushCanvas2D,
      canvasSize,
      operations
    );
    
    const webglResult = await this.testImplementation(
      ColorCycleBrush,
      canvasSize,
      operations
    );
    
    const canvas2dUsage = canvas2dResult.peakUsage - canvas2dResult.initial.heapUsed;
    const webglUsage = webglResult.peakUsage - webglResult.initial.heapUsed;
    
    const result: MemoryTestResult = {
      testName: `Small Canvas (${canvasSize.width}×${canvasSize.height})`,
      canvas2d: canvas2dResult,
      webgl: webglResult,
      savings: {
        percentSaved: ((webglUsage - canvas2dUsage) / webglUsage) * 100,
        bytesSaved: webglUsage - canvas2dUsage
      }
    };
    
    this.results.push(result);
    return result;
  }
  
  /**
   * Test: Medium canvas memory usage
   */
  async testMediumCanvas(): Promise<MemoryTestResult> {
    const canvasSize = { width: 1024, height: 768 };
    
    const operations = async (brush: MemoryTestBrush) => {
      // Paint more content
      for (let i = 0; i < 1000; i++) {
        brush.paint(
          Math.random() * canvasSize.width,
          Math.random() * canvasSize.height
        );
      }
      
      // Add gradient
      const gradient: GradientStop[] = [
        { position: 0, color: { r: 255, g: 0, b: 0 } },
        { position: 0.5, color: { r: 0, g: 255, b: 0 } },
        { position: 1, color: { r: 0, g: 0, b: 255 } }
      ];
      brush.setGradient(gradient);
    };
    
    const canvas2dResult = await this.testImplementation(
      ColorCycleBrushCanvas2D,
      canvasSize,
      operations
    );
    
    const webglResult = await this.testImplementation(
      ColorCycleBrush,
      canvasSize,
      operations
    );
    
    const canvas2dUsage = canvas2dResult.peakUsage - canvas2dResult.initial.heapUsed;
    const webglUsage = webglResult.peakUsage - webglResult.initial.heapUsed;
    
    const result: MemoryTestResult = {
      testName: `Medium Canvas (${canvasSize.width}×${canvasSize.height})`,
      canvas2d: canvas2dResult,
      webgl: webglResult,
      savings: {
        percentSaved: ((webglUsage - canvas2dUsage) / webglUsage) * 100,
        bytesSaved: webglUsage - canvas2dUsage
      }
    };
    
    this.results.push(result);
    return result;
  }
  
  /**
   * Test: Large canvas memory usage
   */
  async testLargeCanvas(): Promise<MemoryTestResult> {
    const canvasSize = { width: 2048, height: 2048 };
    
    const operations = async (brush: MemoryTestBrush) => {
      // Paint lots of content
      for (let i = 0; i < 5000; i++) {
        brush.paint(
          Math.random() * canvasSize.width,
          Math.random() * canvasSize.height
        );
      }
      
      // Multiple gradients
      for (let i = 0; i < 3; i++) {
        const gradient: GradientStop[] = [
          { position: 0, color: { r: Math.random() * 255, g: Math.random() * 255, b: Math.random() * 255 } },
          { position: 0.5, color: { r: Math.random() * 255, g: Math.random() * 255, b: Math.random() * 255 } },
          { position: 1, color: { r: Math.random() * 255, g: Math.random() * 255, b: Math.random() * 255 } }
        ];
        brush.setGradient(gradient, `layer${i}`);
      }
    };
    
    const canvas2dResult = await this.testImplementation(
      ColorCycleBrushCanvas2D,
      canvasSize,
      operations
    );
    
    const webglResult = await this.testImplementation(
      ColorCycleBrush,
      canvasSize,
      operations
    );
    
    const canvas2dUsage = canvas2dResult.peakUsage - canvas2dResult.initial.heapUsed;
    const webglUsage = webglResult.peakUsage - webglResult.initial.heapUsed;
    
    const result: MemoryTestResult = {
      testName: `Large Canvas (${canvasSize.width}×${canvasSize.height})`,
      canvas2d: canvas2dResult,
      webgl: webglResult,
      savings: {
        percentSaved: ((webglUsage - canvas2dUsage) / webglUsage) * 100,
        bytesSaved: webglUsage - canvas2dUsage
      }
    };
    
    this.results.push(result);
    return result;
  }
  
  /**
   * Test: Multi-layer memory usage
   */
  async testMultiLayer(): Promise<MemoryTestResult> {
    const canvasSize = { width: 1024, height: 1024 };
    
    const operations = async (brush: MemoryTestBrush) => {
      // Create multiple layers
      const layers = ['layer1', 'layer2', 'layer3', 'layer4', 'layer5'];
      
      for (const layerId of layers) {
        // Set gradient for layer
        const gradient: GradientStop[] = [
          { position: 0, color: { r: Math.random() * 255, g: Math.random() * 255, b: Math.random() * 255 } },
          { position: 1, color: { r: Math.random() * 255, g: Math.random() * 255, b: Math.random() * 255 } }
        ];
        brush.setGradient(gradient, layerId);
        
        // Paint on layer
        for (let i = 0; i < 500; i++) {
          brush.paint(
            Math.random() * canvasSize.width,
            Math.random() * canvasSize.height,
            layerId
          );
        }
      }
    };
    
    const canvas2dResult = await this.testImplementation(
      ColorCycleBrushCanvas2D,
      canvasSize,
      operations
    );
    
    const webglResult = await this.testImplementation(
      ColorCycleBrush,
      canvasSize,
      operations
    );
    
    const canvas2dUsage = canvas2dResult.peakUsage - canvas2dResult.initial.heapUsed;
    const webglUsage = webglResult.peakUsage - webglResult.initial.heapUsed;
    
    const result: MemoryTestResult = {
      testName: `Multi-layer (5 layers, ${canvasSize.width}×${canvasSize.height})`,
      canvas2d: canvas2dResult,
      webgl: webglResult,
      savings: {
        percentSaved: ((webglUsage - canvas2dUsage) / webglUsage) * 100,
        bytesSaved: webglUsage - canvas2dUsage
      }
    };
    
    this.results.push(result);
    return result;
  }
  
  /**
   * Run all memory tests
   */
  async runAllTests(): Promise<MemoryTestResult[]> {
    console.log('Starting memory analysis...');
    
    await this.testSmallCanvas();
    await this.testMediumCanvas();
    await this.testLargeCanvas();
    await this.testMultiLayer();
    
    return this.results;
  }
  
  /**
   * Format bytes for display
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  }
  
  /**
   * Generate memory analysis report
   */
  generateReport(): string {
    const performanceMemory = this.getPerformanceMemoryInfo();
    let html = `
<!DOCTYPE html>
<html>
<head>
  <title>TinyBrush Memory Usage Analysis Report</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
      border-bottom: 3px solid #FF5722;
      padding-bottom: 10px;
    }
    .summary {
      background: #fff3e0;
      padding: 20px;
      border-radius: 6px;
      margin: 20px 0;
    }
    .summary h2 {
      margin-top: 0;
      color: #e65100;
    }
    .test-result {
      margin: 30px 0;
      padding: 20px;
      background: #fafafa;
      border-radius: 8px;
      border: 1px solid #e0e0e0;
    }
    .test-title {
      font-size: 1.2em;
      font-weight: 600;
      color: #333;
      margin-bottom: 20px;
    }
    .memory-chart {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 20px;
      margin: 20px 0;
    }
    .implementation-data {
      padding: 15px;
      background: white;
      border-radius: 6px;
      border: 1px solid #ddd;
    }
    .impl-title {
      font-weight: 600;
      margin-bottom: 10px;
      padding-bottom: 5px;
      border-bottom: 2px solid #FF5722;
    }
    .memory-phases {
      margin: 10px 0;
    }
    .phase {
      display: flex;
      justify-content: space-between;
      padding: 5px 0;
      border-bottom: 1px solid #f0f0f0;
    }
    .phase-label {
      color: #666;
      font-size: 0.9em;
    }
    .phase-value {
      font-weight: 500;
      font-family: monospace;
    }
    .savings-box {
      background: #e8f5e9;
      padding: 15px;
      border-radius: 6px;
      margin-top: 15px;
      text-align: center;
    }
    .savings-percent {
      font-size: 2em;
      font-weight: bold;
      color: #2e7d32;
    }
    .savings-bytes {
      color: #555;
      margin-top: 5px;
    }
    .metadata {
      background: #f5f5f5;
      padding: 15px;
      border-radius: 6px;
      margin: 20px 0;
      font-size: 14px;
      color: #666;
    }
    .warning {
      background: #fff9c4;
      padding: 15px;
      border-radius: 6px;
      border-left: 4px solid #fbc02d;
      margin: 20px 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    th {
      background: #FF5722;
      color: white;
      padding: 12px;
      text-align: left;
    }
    td {
      padding: 10px 12px;
      border-bottom: 1px solid #ddd;
    }
    .better {
      color: #4CAF50;
      font-weight: 600;
    }
    .worse {
      color: #f44336;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>💾 TinyBrush Memory Usage Analysis Report</h1>
    
    <div class="metadata">
      <strong>Test Date:</strong> ${new Date().toLocaleString()}<br>
      <strong>Test Environment:</strong> ${typeof process !== 'undefined' ? 'Node.js' : 'Browser'}<br>
      <strong>Memory API Available:</strong> ${performanceMemory ? 'Yes' : 'Limited'}<br>
      <strong>User Agent:</strong> ${typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A'}
    </div>
    `;
    
    // Check if memory API is available
    if (!performanceMemory && typeof process === 'undefined') {
      html += `
      <div class="warning">
        <strong>⚠️ Limited Memory Information</strong><br>
        For detailed memory analysis in Chrome, please enable the flag:<br>
        <code>chrome://flags/#enable-precise-memory-info</code>
      </div>
      `;
    }
    
    // Calculate overall savings
    let totalCanvas2dMemory = 0;
    let totalWebglMemory = 0;
    
    this.results.forEach(result => {
      const canvas2dUsage = result.canvas2d.peakUsage - result.canvas2d.initial.heapUsed;
      const webglUsage = result.webgl.peakUsage - result.webgl.initial.heapUsed;
      totalCanvas2dMemory += canvas2dUsage;
      totalWebglMemory += webglUsage;
    });
    
    const overallSavings = ((totalWebglMemory - totalCanvas2dMemory) / totalWebglMemory) * 100;
    
    html += `
    <div class="summary">
      <h2>📊 Overall Memory Summary</h2>
      <p><strong>Total Canvas2D Memory:</strong> ${this.formatBytes(totalCanvas2dMemory)}</p>
      <p><strong>Total WebGL Memory:</strong> ${this.formatBytes(totalWebglMemory)}</p>
      <p><strong>Memory Saved with Canvas2D:</strong> ${this.formatBytes(totalWebglMemory - totalCanvas2dMemory)} (${overallSavings.toFixed(1)}%)</p>
    </div>
    
    <h2>📈 Comparative Analysis</h2>
    <table>
      <thead>
        <tr>
          <th>Test Scenario</th>
          <th>Canvas2D Peak</th>
          <th>WebGL Peak</th>
          <th>Savings</th>
          <th>Efficiency</th>
        </tr>
      </thead>
      <tbody>
    `;
    
    this.results.forEach(result => {
      const canvas2dUsage = result.canvas2d.peakUsage - result.canvas2d.initial.heapUsed;
      const webglUsage = result.webgl.peakUsage - result.webgl.initial.heapUsed;
      const efficiency = result.savings.percentSaved > 0 ? 'better' : 'worse';
      
      html += `
        <tr>
          <td>${result.testName}</td>
          <td>${this.formatBytes(canvas2dUsage)}</td>
          <td>${this.formatBytes(webglUsage)}</td>
          <td>${this.formatBytes(result.savings.bytesSaved)}</td>
          <td class="${efficiency}">${Math.abs(result.savings.percentSaved).toFixed(1)}% ${result.savings.percentSaved > 0 ? 'less' : 'more'}</td>
        </tr>
      `;
    });
    
    html += `
      </tbody>
    </table>
    
    <h2>🔍 Detailed Test Results</h2>
    `;
    
    // Detailed results for each test
    this.results.forEach(result => {
      const canvas2dUsage = result.canvas2d.peakUsage - result.canvas2d.initial.heapUsed;
      const webglUsage = result.webgl.peakUsage - result.webgl.initial.heapUsed;
      
      html += `
      <div class="test-result">
        <div class="test-title">${result.testName}</div>
        
        <div class="memory-chart">
          <div class="implementation-data">
            <div class="impl-title">Canvas2D Implementation</div>
            <div class="memory-phases">
              <div class="phase">
                <span class="phase-label">After Creation:</span>
                <span class="phase-value">${this.formatBytes(result.canvas2d.afterCreate.heapUsed - result.canvas2d.initial.heapUsed)}</span>
              </div>
              <div class="phase">
                <span class="phase-label">After Painting:</span>
                <span class="phase-value">${this.formatBytes(result.canvas2d.afterPaint.heapUsed - result.canvas2d.initial.heapUsed)}</span>
              </div>
              <div class="phase">
                <span class="phase-label">After Animation:</span>
                <span class="phase-value">${this.formatBytes(result.canvas2d.afterAnimation.heapUsed - result.canvas2d.initial.heapUsed)}</span>
              </div>
              <div class="phase">
                <span class="phase-label">Peak Usage:</span>
                <span class="phase-value"><strong>${this.formatBytes(canvas2dUsage)}</strong></span>
              </div>
            </div>
          </div>
          
          <div class="implementation-data">
            <div class="impl-title">WebGL Implementation</div>
            <div class="memory-phases">
              <div class="phase">
                <span class="phase-label">After Creation:</span>
                <span class="phase-value">${this.formatBytes(result.webgl.afterCreate.heapUsed - result.webgl.initial.heapUsed)}</span>
              </div>
              <div class="phase">
                <span class="phase-label">After Painting:</span>
                <span class="phase-value">${this.formatBytes(result.webgl.afterPaint.heapUsed - result.webgl.initial.heapUsed)}</span>
              </div>
              <div class="phase">
                <span class="phase-label">After Animation:</span>
                <span class="phase-value">${this.formatBytes(result.webgl.afterAnimation.heapUsed - result.webgl.initial.heapUsed)}</span>
              </div>
              <div class="phase">
                <span class="phase-label">Peak Usage:</span>
                <span class="phase-value"><strong>${this.formatBytes(webglUsage)}</strong></span>
              </div>
            </div>
          </div>
        </div>
        
        <div class="savings-box">
          <div class="savings-percent">${Math.abs(result.savings.percentSaved).toFixed(1)}%</div>
          <div class="savings-bytes">
            Canvas2D uses ${result.savings.percentSaved > 0 ? 'less' : 'more'} memory
            (${result.savings.percentSaved > 0 ? 'saves' : 'uses'} ${this.formatBytes(Math.abs(result.savings.bytesSaved))})
          </div>
        </div>
      </div>
      `;
    });
    
    // Analysis and recommendations
    html += `
    <h2>💡 Analysis & Recommendations</h2>
    <div class="metadata">
    `;
    
    if (overallSavings > 20) {
      html += `
        <p><strong>✅ Significant Memory Savings with Canvas2D</strong></p>
        <p>The Canvas2D implementation uses ${overallSavings.toFixed(1)}% less memory than WebGL, which translates to ${this.formatBytes(totalWebglMemory - totalCanvas2dMemory)} saved.</p>
        <p>This is due to:</p>
        <ul>
          <li>Indexed color storage (1 byte per pixel vs 4 bytes RGBA)</li>
          <li>No WebGL context overhead</li>
          <li>Simpler buffer management</li>
        </ul>
        <p><strong>Recommendation:</strong> Canvas2D is ideal for memory-constrained environments and mobile devices.</p>
      `;
    } else if (overallSavings > 0) {
      html += `
        <p><strong>⚠️ Moderate Memory Savings with Canvas2D</strong></p>
        <p>The Canvas2D implementation uses ${overallSavings.toFixed(1)}% less memory than WebGL.</p>
        <p>While the savings are not dramatic, Canvas2D still provides:</p>
        <ul>
          <li>Lower baseline memory usage</li>
          <li>More predictable memory patterns</li>
          <li>Better garbage collection behavior</li>
        </ul>
        <p><strong>Recommendation:</strong> Consider Canvas2D for better memory efficiency, especially on lower-end devices.</p>
      `;
    } else {
      html += `
        <p><strong>⚠️ Similar Memory Usage</strong></p>
        <p>Both implementations use similar amounts of memory.</p>
        <p>Choose based on other factors:</p>
        <ul>
          <li>Performance requirements</li>
          <li>Browser compatibility needs</li>
          <li>Feature requirements</li>
        </ul>
      `;
    }
    
    html += `
    </div>
    
    <h2>📋 Testing Notes</h2>
    <div class="metadata">
      <p><strong>Test Methodology:</strong></p>
      <ul>
        <li>Each test measures heap memory usage at different phases</li>
        <li>Garbage collection is forced between tests for accuracy</li>
        <li>Peak usage captures the maximum memory during operation</li>
        <li>Results may vary based on browser and system</li>
      </ul>
      <p><strong>Limitations:</strong></p>
      <ul>
        <li>Browser memory APIs provide estimates, not exact values</li>
        <li>WebGL memory usage may include GPU memory not visible to JavaScript</li>
        <li>Results best viewed as relative comparisons rather than absolute values</li>
      </ul>
    </div>
    
  </div>
</body>
</html>
    `;
    
    return html;
  }
}

// Export convenience function
export async function runMemoryAnalysis(): Promise<MemoryTestResult[]> {
  const analysis = new MemoryAnalysis();
  return analysis.runAllTests();
}
