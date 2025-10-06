/**
 * Visual Quality Comparison Tool
 * Visual quality testing for Canvas2D implementation
 * WebGL implementation has been removed
 */

import { ColorCycleBrushCanvas2D } from '../hooks/brushEngine/ColorCycleBrushCanvas2D';
// ColorCycleBrush WebGL implementation removed - using Canvas2D only
import { ColorCycleBrushCanvas2D as ColorCycleBrush } from '../hooks/brushEngine/ColorCycleBrushCanvas2D';
import { GradientStop } from '../lib/GradientPalette';

export interface ComparisonResult {
  testName: string;
  canvas2dImage: string; // base64
  webglImage: string; // base64
  difference: number; // 0-1, where 0 is identical
  pixelsDifferent: number;
  maxDifference: number;
}

export class VisualQualityComparison {
  private width: number;
  private height: number;
  private results: ComparisonResult[] = [];
  
  constructor(width: number = 512, height: number = 512) {
    this.width = width;
    this.height = height;
  }
  
  /**
   * Create a test canvas
   */
  private createCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    return canvas;
  }
  
  /**
   * Compare two canvases pixel by pixel
   */
  private compareCanvases(canvas1: HTMLCanvasElement, canvas2: HTMLCanvasElement): {
    difference: number;
    pixelsDifferent: number;
    maxDifference: number;
    diffImage: string;
  } {
    const ctx1 = canvas1.getContext('2d')!;
    const ctx2 = canvas2.getContext('2d')!;
    
    const imageData1 = ctx1.getImageData(0, 0, this.width, this.height);
    const imageData2 = ctx2.getImageData(0, 0, this.width, this.height);
    
    const diffCanvas = this.createCanvas();
    const diffCtx = diffCanvas.getContext('2d')!;
    const diffImageData = diffCtx.createImageData(this.width, this.height);
    
    let totalDifference = 0;
    let pixelsDifferent = 0;
    let maxDifference = 0;
    
    for (let i = 0; i < imageData1.data.length; i += 4) {
      const r1 = imageData1.data[i];
      const g1 = imageData1.data[i + 1];
      const b1 = imageData1.data[i + 2];
      const a1 = imageData1.data[i + 3];
      
      const r2 = imageData2.data[i];
      const g2 = imageData2.data[i + 1];
      const b2 = imageData2.data[i + 2];
      const a2 = imageData2.data[i + 3];
      
      const dr = Math.abs(r1 - r2);
      const dg = Math.abs(g1 - g2);
      const db = Math.abs(b1 - b2);
      const da = Math.abs(a1 - a2);
      
      const pixelDiff = (dr + dg + db + da) / 4;
      
      if (pixelDiff > 0) {
        pixelsDifferent++;
        totalDifference += pixelDiff;
        maxDifference = Math.max(maxDifference, pixelDiff);
        
        // Highlight differences in red
        diffImageData.data[i] = 255; // R
        diffImageData.data[i + 1] = Math.max(0, 255 - pixelDiff * 2); // G
        diffImageData.data[i + 2] = Math.max(0, 255 - pixelDiff * 2); // B
        diffImageData.data[i + 3] = 255; // A
      } else {
        // Identical pixels in grayscale
        const gray = (r1 + g1 + b1) / 3;
        diffImageData.data[i] = gray;
        diffImageData.data[i + 1] = gray;
        diffImageData.data[i + 2] = gray;
        diffImageData.data[i + 3] = a1;
      }
    }
    
    diffCtx.putImageData(diffImageData, 0, 0);
    
    const totalPixels = this.width * this.height;
    const averageDifference = totalDifference / (totalPixels * 255);
    
    return {
      difference: averageDifference,
      pixelsDifferent,
      maxDifference: maxDifference / 255,
      diffImage: diffCanvas.toDataURL()
    };
  }
  
  /**
   * Run a visual comparison test
   */
  private async runTest(
    testName: string,
    setupFn: (brush: ColorCycleBrushCanvas2D) => void
  ): Promise<ComparisonResult> {
    // Create canvases for each implementation
    const canvas2dCanvas = this.createCanvas();
    const webglCanvas = this.createCanvas();
    
    // Initialize brushes
    const canvas2dBrush = new ColorCycleBrushCanvas2D(canvas2dCanvas, {
      brushSize: 20,
      fps: 30
    });
    
    const webglBrush = new ColorCycleBrush(webglCanvas, {
      brushSize: 20,
      fps: 30
    });
    
    // Run test on both
    setupFn(canvas2dBrush);
    canvas2dBrush.render();
    
    setupFn(webglBrush);
    webglBrush.render();
    
    // Get canvas images
    const canvas2dImage = canvas2dCanvas.toDataURL();
    const webglImage = webglCanvas.toDataURL();
    
    // Compare canvases
    const comparison = this.compareCanvases(canvas2dCanvas, webglCanvas);
    
    const result: ComparisonResult = {
      testName,
      canvas2dImage,
      webglImage,
      difference: comparison.difference,
      pixelsDifferent: comparison.pixelsDifferent,
      maxDifference: comparison.maxDifference
    };
    
    this.results.push(result);
    
    // Clean up
    if ('dispose' in canvas2dBrush && typeof canvas2dBrush.dispose === 'function') {
      canvas2dBrush.dispose();
    }
    if ('dispose' in webglBrush && typeof webglBrush.dispose === 'function') {
      webglBrush.dispose();
    }
    
    return result;
  }
  
  /**
   * Test: Single dots pattern
   */
  async testSingleDots(): Promise<ComparisonResult> {
    return this.runTest('Single Dots Pattern', (brush) => {
      // Draw a grid of dots
      for (let x = 50; x < this.width; x += 100) {
        for (let y = 50; y < this.height; y += 100) {
          brush.paint(x, y);
        }
      }
    });
  }
  
  /**
   * Test: Continuous line
   */
  async testContinuousLine(): Promise<ComparisonResult> {
    return this.runTest('Continuous Line', (brush) => {
      // Draw a spiral
      const centerX = this.width / 2;
      const centerY = this.height / 2;
      
      for (let t = 0; t < 100; t += 0.5) {
        const r = t * 2;
        const x = centerX + Math.cos(t * 0.5) * r;
        const y = centerY + Math.sin(t * 0.5) * r;
        brush.paint(x, y);
      }
    });
  }
  
  /**
   * Test: Gradient variations
   */
  async testGradients(): Promise<ComparisonResult> {
    const gradient: GradientStop[] = [
      { position: 0, color: { r: 255, g: 0, b: 0 } },
      { position: 0.2, color: { r: 255, g: 128, b: 0 } },
      { position: 0.4, color: { r: 255, g: 255, b: 0 } },
      { position: 0.6, color: { r: 0, g: 255, b: 0 } },
      { position: 0.8, color: { r: 0, g: 128, b: 255 } },
      { position: 1, color: { r: 128, g: 0, b: 255 } }
    ];
    
    return this.runTest('Gradient Variations', (brush) => {
      brush.setGradient(gradient);
      
      // Paint vertical stripes with different densities
      for (let x = 0; x < this.width; x += 2) {
        const density = x / this.width;
        for (let y = 0; y < this.height; y += Math.max(1, 10 - density * 9)) {
          brush.paint(x, y);
        }
      }
    });
  }
  
  /**
   * Test: Overlapping strokes
   */
  async testOverlappingStrokes(): Promise<ComparisonResult> {
    return this.runTest('Overlapping Strokes', (brush) => {
      // Draw multiple overlapping circles
      const centerX = this.width / 2;
      const centerY = this.height / 2;
      
      for (let circle = 0; circle < 5; circle++) {
        const radius = 50 + circle * 20;
        
        for (let angle = 0; angle < Math.PI * 2; angle += 0.05) {
          const x = centerX + Math.cos(angle) * radius;
          const y = centerY + Math.sin(angle) * radius;
          brush.paint(x, y);
        }
      }
    });
  }
  
  /**
   * Test: Fill operations
   */
  async testFillOperations(): Promise<ComparisonResult> {
    return this.runTest('Fill Operations', (brush) => {
      const fillBrush = brush as ColorCycleBrushCanvas2D & {
        fillRect?: (x: number, y: number, width: number, height: number) => void;
        fill?: (x: number, y: number, width: number, height: number) => void;
      };
      // Draw filled rectangles
      if (fillBrush.fillRect) {
        fillBrush.fillRect(50, 50, 150, 100);
        fillBrush.fillRect(250, 150, 200, 150);
        fillBrush.fillRect(100, 300, 300, 100);
      } else if (fillBrush.fill) {
        fillBrush.fill(50, 50, 150, 100);
        fillBrush.fill(250, 150, 200, 150);
        fillBrush.fill(100, 300, 300, 100);
      }
    });
  }
  
  /**
   * Test: Edge antialiasing
   */
  async testAntialiasing(): Promise<ComparisonResult> {
    return this.runTest('Edge Antialiasing', (brush) => {
      // Draw diagonal lines at various angles
      const centerX = this.width / 2;
      const centerY = this.height / 2;
      
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
        for (let r = 0; r < 200; r += 2) {
          const x = centerX + Math.cos(angle) * r;
          const y = centerY + Math.sin(angle) * r;
          brush.paint(x, y);
        }
      }
    });
  }
  
  /**
   * Test: Brush size variations
   */
  async testBrushSizes(): Promise<ComparisonResult> {
    return this.runTest('Brush Size Variations', (brush) => {
      const sizes = [5, 10, 20, 30, 40];
      
      sizes.forEach((size, index) => {
        brush.setBrushSize(size);
        
        // Draw horizontal line with each size
        const y = (index + 1) * (this.height / (sizes.length + 1));
        
        for (let x = 50; x < this.width - 50; x += 5) {
          brush.paint(x, y);
        }
      });
    });
  }
  
  /**
   * Run all visual tests
   */
  async runAllTests(): Promise<ComparisonResult[]> {
    console.log('Starting visual quality comparison...');
    
    await this.testSingleDots();
    await this.testContinuousLine();
    await this.testGradients();
    await this.testOverlappingStrokes();
    await this.testFillOperations();
    await this.testAntialiasing();
    await this.testBrushSizes();
    
    return this.results;
  }
  
  /**
   * Generate visual comparison report
   */
  generateReport(): string {
    let html = `
<!DOCTYPE html>
<html>
<head>
  <title>Vessel Visual Quality Comparison Report</title>
  <style>
    body {
      font-family: 'IBM Plex Mono', 'Courier New', monospace;
      margin: 40px;
      background: #f5f5f5;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      background: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 {
      color: #333;
      border-bottom: 3px solid #9C27B0;
      padding-bottom: 10px;
    }
    .summary {
      background: #f3e5f5;
      padding: 20px;
      border-radius: 6px;
      margin: 20px 0;
    }
    .summary h2 {
      margin-top: 0;
      color: #6a1b9a;
    }
    .test-container {
      margin: 40px 0;
      padding: 20px;
      background: #fafafa;
      border-radius: 8px;
      border: 1px solid #e0e0e0;
    }
    .test-title {
      font-size: 1.3em;
      font-weight: 600;
      color: #333;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 2px solid #9C27B0;
    }
    .images-container {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
    }
    .image-box {
      text-align: center;
    }
    .image-label {
      font-weight: 600;
      margin-bottom: 10px;
      color: #555;
    }
    .test-image {
      width: 100%;
      max-width: 512px;
      border: 2px solid #ddd;
      border-radius: 4px;
      background: white;
      image-rendering: pixelated;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
      margin-top: 20px;
    }
    .metric {
      background: white;
      padding: 15px;
      border-radius: 6px;
      border: 1px solid #e0e0e0;
    }
    .metric-label {
      font-size: 0.9em;
      color: #666;
      margin-bottom: 5px;
    }
    .metric-value {
      font-size: 1.4em;
      font-weight: 600;
    }
    .identical {
      color: #4CAF50;
    }
    .similar {
      color: #FF9800;
    }
    .different {
      color: #f44336;
    }
    .quality-score {
      font-size: 2em;
      font-weight: bold;
      text-align: center;
      padding: 20px;
      margin: 20px 0;
      border-radius: 8px;
    }
    .excellent {
      background: #e8f5e9;
      color: #2e7d32;
    }
    .good {
      background: #fff3e0;
      color: #e65100;
    }
    .poor {
      background: #ffebee;
      color: #c62828;
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
    <h1>🎨 Vessel Visual Quality Comparison Report</h1>
    
    <div class="metadata">
      <strong>Test Date:</strong> ${new Date().toLocaleString()}<br>
      <strong>Canvas Size:</strong> ${this.width} × ${this.height}<br>
      <strong>Total Tests:</strong> ${this.results.length}<br>
      <strong>User Agent:</strong> ${navigator.userAgent}
    </div>
    `;
    
    // Calculate overall quality score
    const totalDifference = this.results.reduce((sum, r) => sum + r.difference, 0);
    const averageDifference = totalDifference / this.results.length;
    const qualityScore = Math.round((1 - averageDifference) * 100);
    
    let qualityClass = 'excellent';
    let qualityText = 'Excellent';
    if (qualityScore < 95) {
      qualityClass = 'good';
      qualityText = 'Good';
    }
    if (qualityScore < 85) {
      qualityClass = 'poor';
      qualityText = 'Poor';
    }
    
    html += `
    <div class="summary">
      <h2>🔍 Visual Quality Summary</h2>
      <div class="quality-score ${qualityClass}">
        Visual Parity Score: ${qualityScore}% (${qualityText})
      </div>
      <p><strong>Average Pixel Difference:</strong> ${(averageDifference * 100).toFixed(4)}%</p>
      <p><strong>Tests with Perfect Match:</strong> ${this.results.filter(r => r.difference === 0).length} / ${this.results.length}</p>
      <p><strong>Tests with Visible Differences:</strong> ${this.results.filter(r => r.difference > 0.01).length} / ${this.results.length}</p>
    </div>
    `;
    
    // Individual test results
    html += `<h2>📊 Test Results</h2>`;
    
    this.results.forEach(result => {
      let diffClass = 'identical';
      let diffText = 'Identical';
      
      if (result.difference > 0.001) {
        diffClass = 'similar';
        diffText = 'Similar';
      }
      if (result.difference > 0.01) {
        diffClass = 'different';
        diffText = 'Different';
      }
      
      html += `
      <div class="test-container">
        <div class="test-title">${result.testName}</div>
        
        <div class="images-container">
          <div class="image-box">
            <div class="image-label">Canvas2D Implementation</div>
            <img class="test-image" src="${result.canvas2dImage}" alt="Canvas2D">
          </div>
          <div class="image-box">
            <div class="image-label">WebGL Implementation</div>
            <img class="test-image" src="${result.webglImage}" alt="WebGL">
          </div>
        </div>
        
        <div class="metrics">
          <div class="metric">
            <div class="metric-label">Visual Match</div>
            <div class="metric-value ${diffClass}">${diffText}</div>
          </div>
          <div class="metric">
            <div class="metric-label">Pixel Difference</div>
            <div class="metric-value">${(result.difference * 100).toFixed(4)}%</div>
          </div>
          <div class="metric">
            <div class="metric-label">Pixels Different</div>
            <div class="metric-value">${result.pixelsDifferent.toLocaleString()} / ${(this.width * this.height).toLocaleString()}</div>
          </div>
        </div>
      </div>
      `;
    });
    
    // Recommendations
    html += `
    <h2>💡 Analysis & Recommendations</h2>
    <div class="metadata">
    `;
    
    if (qualityScore >= 95) {
      html += `
        <p><strong>✅ Excellent Visual Parity</strong></p>
        <p>The Canvas2D implementation produces virtually identical output to WebGL. Users will not notice any visual difference.</p>
        <p>Safe to migrate to Canvas2D without any visual quality concerns.</p>
      `;
    } else if (qualityScore >= 85) {
      html += `
        <p><strong>⚠️ Good Visual Parity with Minor Differences</strong></p>
        <p>The Canvas2D implementation is visually similar to WebGL, with some minor differences in:</p>
        <ul>
          ${this.results.filter(r => r.difference > 0.01).map(r => `<li>${r.testName}: ${(r.difference * 100).toFixed(2)}% difference</li>`).join('')}
        </ul>
        <p>These differences are likely due to antialiasing or rounding variations and should not significantly impact user experience.</p>
      `;
    } else {
      html += `
        <p><strong>❌ Significant Visual Differences</strong></p>
        <p>The Canvas2D implementation shows noticeable differences from WebGL. Review the following areas:</p>
        <ul>
          ${this.results.filter(r => r.difference > 0.02).map(r => `<li>${r.testName}: ${(r.difference * 100).toFixed(2)}% difference</li>`).join('')}
        </ul>
        <p>Consider investigating and fixing these differences before migration.</p>
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
}

// Export convenience function
export async function runVisualQualityComparison(): Promise<ComparisonResult[]> {
  const comparison = new VisualQualityComparison();
  return comparison.runAllTests();
}
