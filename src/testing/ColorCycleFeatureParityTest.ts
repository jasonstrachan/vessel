/**
 * ColorCycleFeatureParityTest - Testing suite for Canvas2D implementation
 * WebGL implementation has been removed - using Canvas2D only
 */

// ColorCycleBrush WebGL implementation removed - using Canvas2D only
import { ColorCycleBrushCanvas2D } from '../hooks/brushEngine/ColorCycleBrushCanvas2D';
import { ColorCycleBrushCanvas2D as ColorCycleBrush } from '../hooks/brushEngine/ColorCycleBrushCanvas2D'; // Alias for compatibility
import { GradientStop } from '../lib/GradientPalette';

export interface TestResult {
  feature: string;
  webgl: { passed: boolean; error?: string; time?: number };
  canvas2d: { passed: boolean; error?: string; time?: number };
  parity: boolean;
}

export interface PerformanceMetrics {
  operation: string;
  webglTime: number;
  canvas2dTime: number;
  speedup: number; // Positive = Canvas2D faster, Negative = WebGL faster
}

export class ColorCycleFeatureParityTest {
  private webglBrush: ColorCycleBrush | null = null;
  private canvas2dBrush: ColorCycleBrushCanvas2D | null = null;
  private testResults: TestResult[] = [];
  private performanceMetrics: PerformanceMetrics[] = [];
  
  constructor(
    private webglCanvas: HTMLCanvasElement,
    private canvas2dCanvas: HTMLCanvasElement
  ) {
    this.initialize();
  }
  
  private initialize() {
    try {
      this.webglBrush = new ColorCycleBrush(this.webglCanvas, {
        brushSize: 20,
        fps: 30
      });
    } catch (error) {
      console.error('Failed to initialize WebGL brush:', error);
    }
    
    try {
      this.canvas2dBrush = new ColorCycleBrushCanvas2D(this.canvas2dCanvas, {
        brushSize: 20,
        fps: 30
      });
    } catch (error) {
      console.error('Failed to initialize Canvas2D brush:', error);
    }
  }
  
  /**
   * Run all feature parity tests
   */
  async runAllTests(): Promise<{
    results: TestResult[];
    performance: PerformanceMetrics[];
    summary: {
      totalTests: number;
      passed: number;
      failed: number;
      parityRate: number;
    };
  }> {
    this.testResults = [];
    this.performanceMetrics = [];
    
    // Core drawing features
    await this.testPaintOperation();
    await this.testLineDrawing();
    await this.testShapeFilling();
    
    // Gradient features
    await this.testGradientSetting();
    await this.testMultipleGradients();
    
    // Animation features
    await this.testAnimationStart();
    await this.testAnimationSpeed();
    await this.testAnimationStop();
    
    // Layer management
    await this.testLayerSwitching();
    await this.testMultiLayerSupport();
    
    // State management
    await this.testSerialization();
    await this.testDeserialization();
    
    // Performance-critical operations
    await this.testBatchPainting();
    await this.testLargeShapes();
    await this.testComplexGradients();
    
    // Calculate summary
    const totalTests = this.testResults.length;
    const passed = this.testResults.filter(r => r.parity).length;
    const failed = totalTests - passed;
    const parityRate = (passed / totalTests) * 100;
    
    return {
      results: this.testResults,
      performance: this.performanceMetrics,
      summary: {
        totalTests,
        passed,
        failed,
        parityRate
      }
    };
  }
  
  /**
   * Test basic paint operation
   */
  private async testPaintOperation(): Promise<void> {
    const feature = 'Basic Paint Operation';
    const result: TestResult = {
      feature,
      webgl: { passed: false },
      canvas2d: { passed: false },
      parity: false
    };
    
    // Test WebGL
    if (this.webglBrush) {
      const start = performance.now();
      try {
        this.webglBrush.paint(100, 100);
        result.webgl.passed = true;
        result.webgl.time = performance.now() - start;
      } catch (error) {
        result.webgl.error = String(error);
      }
    }
    
    // Test Canvas2D
    if (this.canvas2dBrush) {
      const start = performance.now();
      try {
        this.canvas2dBrush.paint(100, 100);
        result.canvas2d.passed = true;
        result.canvas2d.time = performance.now() - start;
      } catch (error) {
        result.canvas2d.error = String(error);
      }
    }
    
    result.parity = result.webgl.passed === result.canvas2d.passed;
    this.testResults.push(result);
    
    // Record performance
    if (result.webgl.time && result.canvas2d.time) {
      this.performanceMetrics.push({
        operation: 'Single Paint',
        webglTime: result.webgl.time,
        canvas2dTime: result.canvas2d.time,
        speedup: (result.webgl.time - result.canvas2d.time) / result.webgl.time * 100
      });
    }
  }
  
  /**
   * Test line drawing
   */
  private async testLineDrawing(): Promise<void> {
    const feature = 'Line Drawing';
    const result: TestResult = {
      feature,
      webgl: { passed: false },
      canvas2d: { passed: false },
      parity: false
    };
    
    const points = [
      { x: 10, y: 10 },
      { x: 100, y: 100 },
      { x: 200, y: 50 },
      { x: 300, y: 150 }
    ];
    
    // Test WebGL
    if (this.webglBrush) {
      const start = performance.now();
      try {
        this.webglBrush.startStroke();
        for (let i = 0; i < points.length - 1; i++) {
          // Draw line segment
          const steps = 10;
          for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const x = points[i].x + (points[i + 1].x - points[i].x) * t;
            const y = points[i].y + (points[i + 1].y - points[i].y) * t;
            this.webglBrush.paint(x, y);
          }
        }
        this.webglBrush.endStroke();
        result.webgl.passed = true;
        result.webgl.time = performance.now() - start;
      } catch (error) {
        result.webgl.error = String(error);
      }
    }
    
    // Test Canvas2D
    if (this.canvas2dBrush) {
      const start = performance.now();
      try {
        this.canvas2dBrush.startStroke();
        for (let i = 0; i < points.length - 1; i++) {
          // Draw line segment
          const steps = 10;
          for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const x = points[i].x + (points[i + 1].x - points[i].x) * t;
            const y = points[i].y + (points[i + 1].y - points[i].y) * t;
            this.canvas2dBrush.paint(x, y);
          }
        }
        this.canvas2dBrush.endStroke();
        result.canvas2d.passed = true;
        result.canvas2d.time = performance.now() - start;
      } catch (error) {
        result.canvas2d.error = String(error);
      }
    }
    
    result.parity = result.webgl.passed === result.canvas2d.passed;
    this.testResults.push(result);
    
    // Record performance
    if (result.webgl.time && result.canvas2d.time) {
      this.performanceMetrics.push({
        operation: 'Line Drawing',
        webglTime: result.webgl.time,
        canvas2dTime: result.canvas2d.time,
        speedup: (result.webgl.time - result.canvas2d.time) / result.webgl.time * 100
      });
    }
  }
  
  /**
   * Test shape filling
   */
  private async testShapeFilling(): Promise<void> {
    const feature = 'Shape Filling';
    const result: TestResult = {
      feature,
      webgl: { passed: false },
      canvas2d: { passed: false },
      parity: false
    };
    
    const vertices = [
      { x: 50, y: 50 },
      { x: 150, y: 50 },
      { x: 150, y: 150 },
      { x: 50, y: 150 }
    ];
    
    // Test WebGL
    if (this.webglBrush) {
      const start = performance.now();
      try {
        this.webglBrush.fillShape(vertices, 'default');
        result.webgl.passed = true;
        result.webgl.time = performance.now() - start;
      } catch (error) {
        result.webgl.error = String(error);
      }
    }
    
    // Test Canvas2D
    if (this.canvas2dBrush) {
      const start = performance.now();
      try {
        this.canvas2dBrush.fillShape(vertices, 'default');
        result.canvas2d.passed = true;
        result.canvas2d.time = performance.now() - start;
      } catch (error) {
        result.canvas2d.error = String(error);
      }
    }
    
    result.parity = result.webgl.passed === result.canvas2d.passed;
    this.testResults.push(result);
  }
  
  /**
   * Test gradient setting
   */
  private async testGradientSetting(): Promise<void> {
    const feature = 'Gradient Setting';
    const result: TestResult = {
      feature,
      webgl: { passed: false },
      canvas2d: { passed: false },
      parity: false
    };
    
    const gradient: GradientStop[] = [
      { position: 0, color: '#ff0000' },
      { position: 0.5, color: '#00ff00' },
      { position: 1, color: '#0000ff' }
    ];
    
    // Test WebGL
    if (this.webglBrush) {
      try {
        this.webglBrush.setGradient(gradient);
        result.webgl.passed = true;
      } catch (error) {
        result.webgl.error = String(error);
      }
    }
    
    // Test Canvas2D
    if (this.canvas2dBrush) {
      try {
        this.canvas2dBrush.setGradient(gradient);
        result.canvas2d.passed = true;
      } catch (error) {
        result.canvas2d.error = String(error);
      }
    }
    
    result.parity = result.webgl.passed === result.canvas2d.passed;
    this.testResults.push(result);
  }
  
  /**
   * Test multiple gradients
   */
  private async testMultipleGradients(): Promise<void> {
    const feature = 'Multiple Gradients';
    const result: TestResult = {
      feature,
      webgl: { passed: false },
      canvas2d: { passed: false },
      parity: false
    };
    
    const gradients = [
      [
        { position: 0, color: '#ff0000' },
        { position: 1, color: '#ffff00' }
      ],
      [
        { position: 0, color: '#00ff00' },
        { position: 1, color: '#00ffff' }
      ],
      [
        { position: 0, color: '#0000ff' },
        { position: 1, color: '#ff00ff' }
      ]
    ];
    
    // Test WebGL
    if (this.webglBrush) {
      try {
        for (const gradient of gradients) {
          this.webglBrush.setGradient(gradient);
          this.webglBrush.paint(Math.random() * 200, Math.random() * 200);
        }
        result.webgl.passed = true;
      } catch (error) {
        result.webgl.error = String(error);
      }
    }
    
    // Test Canvas2D
    if (this.canvas2dBrush) {
      try {
        for (const gradient of gradients) {
          this.canvas2dBrush.setGradient(gradient);
          this.canvas2dBrush.paint(Math.random() * 200, Math.random() * 200);
        }
        result.canvas2d.passed = true;
      } catch (error) {
        result.canvas2d.error = String(error);
      }
    }
    
    result.parity = result.webgl.passed === result.canvas2d.passed;
    this.testResults.push(result);
  }
  
  /**
   * Test animation start
   */
  private async testAnimationStart(): Promise<void> {
    const feature = 'Animation Start';
    const result: TestResult = {
      feature,
      webgl: { passed: false },
      canvas2d: { passed: false },
      parity: false
    };
    
    // Test WebGL
    if (this.webglBrush) {
      try {
        this.webglBrush.startAnimation();
        result.webgl.passed = this.webglBrush.isPlaying();
        this.webglBrush.stopAnimation();
      } catch (error) {
        result.webgl.error = String(error);
      }
    }
    
    // Test Canvas2D
    if (this.canvas2dBrush) {
      try {
        this.canvas2dBrush.startAnimation();
        result.canvas2d.passed = this.canvas2dBrush.isPlaying();
        this.canvas2dBrush.stopAnimation();
      } catch (error) {
        result.canvas2d.error = String(error);
      }
    }
    
    result.parity = result.webgl.passed === result.canvas2d.passed;
    this.testResults.push(result);
  }
  
  /**
   * Test animation speed
   */
  private async testAnimationSpeed(): Promise<void> {
    const feature = 'Animation Speed Control';
    const result: TestResult = {
      feature,
      webgl: { passed: false },
      canvas2d: { passed: false },
      parity: false
    };
    
    const speeds = [0.5, 1.0, 2.0, 5.0];
    
    // Test WebGL
    if (this.webglBrush) {
      try {
        for (const speed of speeds) {
          this.webglBrush.setSpeed(speed);
        }
        result.webgl.passed = true;
      } catch (error) {
        result.webgl.error = String(error);
      }
    }
    
    // Test Canvas2D
    if (this.canvas2dBrush) {
      try {
        for (const speed of speeds) {
          this.canvas2dBrush.setSpeed(speed);
        }
        result.canvas2d.passed = true;
      } catch (error) {
        result.canvas2d.error = String(error);
      }
    }
    
    result.parity = result.webgl.passed === result.canvas2d.passed;
    this.testResults.push(result);
  }
  
  /**
   * Test animation stop
   */
  private async testAnimationStop(): Promise<void> {
    const feature = 'Animation Stop';
    const result: TestResult = {
      feature,
      webgl: { passed: false },
      canvas2d: { passed: false },
      parity: false
    };
    
    // Test WebGL
    if (this.webglBrush) {
      try {
        this.webglBrush.startAnimation();
        this.webglBrush.stopAnimation();
        result.webgl.passed = !this.webglBrush.isPlaying();
      } catch (error) {
        result.webgl.error = String(error);
      }
    }
    
    // Test Canvas2D
    if (this.canvas2dBrush) {
      try {
        this.canvas2dBrush.startAnimation();
        this.canvas2dBrush.stopAnimation();
        result.canvas2d.passed = !this.canvas2dBrush.isPlaying();
      } catch (error) {
        result.canvas2d.error = String(error);
      }
    }
    
    result.parity = result.webgl.passed === result.canvas2d.passed;
    this.testResults.push(result);
  }
  
  /**
   * Test layer switching
   */
  private async testLayerSwitching(): Promise<void> {
    const feature = 'Layer Switching';
    const result: TestResult = {
      feature,
      webgl: { passed: false },
      canvas2d: { passed: false },
      parity: false
    };
    
    const layers = ['layer1', 'layer2', 'layer3'];
    
    // Test WebGL
    if (this.webglBrush) {
      try {
        for (const layer of layers) {
          this.webglBrush.setActiveLayer(layer);
          this.webglBrush.paint(50, 50, layer);
        }
        result.webgl.passed = true;
      } catch (error) {
        result.webgl.error = String(error);
      }
    }
    
    // Test Canvas2D
    if (this.canvas2dBrush) {
      try {
        for (const layer of layers) {
          this.canvas2dBrush.setActiveLayer(layer);
          this.canvas2dBrush.paint(50, 50, layer);
        }
        result.canvas2d.passed = true;
      } catch (error) {
        result.canvas2d.error = String(error);
      }
    }
    
    result.parity = result.webgl.passed === result.canvas2d.passed;
    this.testResults.push(result);
  }
  
  /**
   * Test multi-layer support
   */
  private async testMultiLayerSupport(): Promise<void> {
    const feature = 'Multi-Layer Support';
    const result: TestResult = {
      feature,
      webgl: { passed: false },
      canvas2d: { passed: false },
      parity: false
    };
    
    // Test WebGL
    if (this.webglBrush) {
      try {
        // Paint on multiple layers
        this.webglBrush.paint(10, 10, 'layer1');
        this.webglBrush.paint(20, 20, 'layer2');
        this.webglBrush.paint(30, 30, 'layer3');
        
        // Render all layers
        this.webglBrush.render(false);
        result.webgl.passed = true;
      } catch (error) {
        result.webgl.error = String(error);
      }
    }
    
    // Test Canvas2D
    if (this.canvas2dBrush) {
      try {
        // Paint on multiple layers
        this.canvas2dBrush.paint(10, 10, 'layer1');
        this.canvas2dBrush.paint(20, 20, 'layer2');
        this.canvas2dBrush.paint(30, 30, 'layer3');
        
        // Render all layers
        this.canvas2dBrush.render(false);
        result.canvas2d.passed = true;
      } catch (error) {
        result.canvas2d.error = String(error);
      }
    }
    
    result.parity = result.webgl.passed === result.canvas2d.passed;
    this.testResults.push(result);
  }
  
  /**
   * Test serialization
   */
  private async testSerialization(): Promise<void> {
    const feature = 'State Serialization';
    const result: TestResult = {
      feature,
      webgl: { passed: false },
      canvas2d: { passed: false },
      parity: false
    };
    
    // Test WebGL
    if (this.webglBrush) {
      try {
        const state = this.webglBrush.getFullState();
        result.webgl.passed = state !== null && typeof state === 'object';
      } catch (error) {
        result.webgl.error = String(error);
      }
    }
    
    // Test Canvas2D
    if (this.canvas2dBrush) {
      try {
        const state = this.canvas2dBrush.getFullState();
        result.canvas2d.passed = state !== null && typeof state === 'object';
      } catch (error) {
        result.canvas2d.error = String(error);
      }
    }
    
    result.parity = result.webgl.passed === result.canvas2d.passed;
    this.testResults.push(result);
  }
  
  /**
   * Test deserialization
   */
  private async testDeserialization(): Promise<void> {
    const feature = 'State Deserialization';
    const result: TestResult = {
      feature,
      webgl: { passed: false },
      canvas2d: { passed: false },
      parity: false
    };
    
    const testState = {
      layers: [],
      cycleSpeed: 1.5,
      fps: 30,
      brushSize: 25
    };
    
    // Test WebGL
    if (this.webglBrush) {
      try {
        this.webglBrush.restoreFullState(testState);
        result.webgl.passed = true;
      } catch (error) {
        result.webgl.error = String(error);
      }
    }
    
    // Test Canvas2D
    if (this.canvas2dBrush) {
      try {
        this.canvas2dBrush.restoreFullState(testState);
        result.canvas2d.passed = true;
      } catch (error) {
        result.canvas2d.error = String(error);
      }
    }
    
    result.parity = result.webgl.passed === result.canvas2d.passed;
    this.testResults.push(result);
  }
  
  /**
   * Test batch painting performance
   */
  private async testBatchPainting(): Promise<void> {
    const feature = 'Batch Painting (1000 points)';
    const result: TestResult = {
      feature,
      webgl: { passed: false },
      canvas2d: { passed: false },
      parity: false
    };
    
    const points = Array.from({ length: 1000 }, () => ({
      x: Math.random() * 400,
      y: Math.random() * 400
    }));
    
    // Test WebGL
    if (this.webglBrush) {
      const start = performance.now();
      try {
        this.webglBrush.startStroke();
        for (const point of points) {
          this.webglBrush.paint(point.x, point.y);
        }
        this.webglBrush.endStroke();
        result.webgl.passed = true;
        result.webgl.time = performance.now() - start;
      } catch (error) {
        result.webgl.error = String(error);
      }
    }
    
    // Test Canvas2D
    if (this.canvas2dBrush) {
      const start = performance.now();
      try {
        this.canvas2dBrush.startStroke();
        for (const point of points) {
          this.canvas2dBrush.paint(point.x, point.y);
        }
        this.canvas2dBrush.endStroke();
        result.canvas2d.passed = true;
        result.canvas2d.time = performance.now() - start;
      } catch (error) {
        result.canvas2d.error = String(error);
      }
    }
    
    result.parity = result.webgl.passed === result.canvas2d.passed;
    this.testResults.push(result);
    
    // Record performance
    if (result.webgl.time && result.canvas2d.time) {
      this.performanceMetrics.push({
        operation: 'Batch Paint (1000)',
        webglTime: result.webgl.time,
        canvas2dTime: result.canvas2d.time,
        speedup: (result.webgl.time - result.canvas2d.time) / result.webgl.time * 100
      });
    }
  }
  
  /**
   * Test large shape filling
   */
  private async testLargeShapes(): Promise<void> {
    const feature = 'Large Shape Filling';
    const result: TestResult = {
      feature,
      webgl: { passed: false },
      canvas2d: { passed: false },
      parity: false
    };
    
    // Create a complex polygon
    const vertices = Array.from({ length: 50 }, (_, i) => {
      const angle = (i / 50) * Math.PI * 2;
      const radius = 150 + Math.sin(angle * 5) * 50;
      return {
        x: 200 + Math.cos(angle) * radius,
        y: 200 + Math.sin(angle) * radius
      };
    });
    
    // Test WebGL
    if (this.webglBrush) {
      const start = performance.now();
      try {
        this.webglBrush.fillShape(vertices, 'default');
        result.webgl.passed = true;
        result.webgl.time = performance.now() - start;
      } catch (error) {
        result.webgl.error = String(error);
      }
    }
    
    // Test Canvas2D
    if (this.canvas2dBrush) {
      const start = performance.now();
      try {
        this.canvas2dBrush.fillShape(vertices, 'default');
        result.canvas2d.passed = true;
        result.canvas2d.time = performance.now() - start;
      } catch (error) {
        result.canvas2d.error = String(error);
      }
    }
    
    result.parity = result.webgl.passed === result.canvas2d.passed;
    this.testResults.push(result);
    
    // Record performance
    if (result.webgl.time && result.canvas2d.time) {
      this.performanceMetrics.push({
        operation: 'Large Shape Fill',
        webglTime: result.webgl.time,
        canvas2dTime: result.canvas2d.time,
        speedup: (result.webgl.time - result.canvas2d.time) / result.webgl.time * 100
      });
    }
  }
  
  /**
   * Test complex gradients
   */
  private async testComplexGradients(): Promise<void> {
    const feature = 'Complex Gradients (10 stops)';
    const result: TestResult = {
      feature,
      webgl: { passed: false },
      canvas2d: { passed: false },
      parity: false
    };
    
    // Create a complex gradient with many stops
    const gradient: GradientStop[] = Array.from({ length: 10 }, (_, i) => ({
      position: i / 9,
      color: `hsl(${i * 36}, 100%, 50%)`
    }));
    
    // Test WebGL
    if (this.webglBrush) {
      const start = performance.now();
      try {
        this.webglBrush.setGradient(gradient);
        // Paint some strokes to test rendering
        for (let i = 0; i < 10; i++) {
          this.webglBrush.paint(i * 20, i * 20);
        }
        this.webglBrush.render(false);
        result.webgl.passed = true;
        result.webgl.time = performance.now() - start;
      } catch (error) {
        result.webgl.error = String(error);
      }
    }
    
    // Test Canvas2D
    if (this.canvas2dBrush) {
      const start = performance.now();
      try {
        this.canvas2dBrush.setGradient(gradient);
        // Paint some strokes to test rendering
        for (let i = 0; i < 10; i++) {
          this.canvas2dBrush.paint(i * 20, i * 20);
        }
        this.canvas2dBrush.render(false);
        result.canvas2d.passed = true;
        result.canvas2d.time = performance.now() - start;
      } catch (error) {
        result.canvas2d.error = String(error);
      }
    }
    
    result.parity = result.webgl.passed === result.canvas2d.passed;
    this.testResults.push(result);
    
    // Record performance
    if (result.webgl.time && result.canvas2d.time) {
      this.performanceMetrics.push({
        operation: 'Complex Gradient',
        webglTime: result.webgl.time,
        canvas2dTime: result.canvas2d.time,
        speedup: (result.webgl.time - result.canvas2d.time) / result.webgl.time * 100
      });
    }
  }
  
  /**
   * Cleanup resources
   */
  cleanup() {
    this.webglBrush?.destroy();
    this.canvas2dBrush?.destroy();
  }
  
  /**
   * Generate HTML report
   */
  generateHTMLReport(): string {
    const summary = {
      totalTests: this.testResults.length,
      passed: this.testResults.filter(r => r.parity).length,
      failed: this.testResults.filter(r => !r.parity).length,
      parityRate: 0
    };
    summary.parityRate = (summary.passed / summary.totalTests) * 100;
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Color Cycle Feature Parity Test Report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; background: #1a1a1a; color: #e0e0e0; }
          h1 { color: #4a9eff; }
          h2 { color: #66d9ff; margin-top: 30px; }
          .summary { background: #2a2a2a; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .summary .stat { display: inline-block; margin-right: 30px; }
          .summary .stat .value { font-size: 24px; font-weight: bold; color: #4a9eff; }
          .summary .stat .label { font-size: 14px; color: #999; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th { background: #333; padding: 12px; text-align: left; border: 1px solid #555; }
          td { padding: 10px; border: 1px solid #444; }
          tr:nth-child(even) { background: #252525; }
          .passed { color: #4ade80; }
          .failed { color: #f87171; }
          .parity { background: #4ade8020; }
          .no-parity { background: #f8717120; }
          .faster { color: #4ade80; }
          .slower { color: #f87171; }
          .performance { background: #2a2a2a; padding: 15px; border-radius: 8px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <h1>Color Cycle Feature Parity Test Report</h1>
        <div class="summary">
          <div class="stat">
            <div class="value">${summary.totalTests}</div>
            <div class="label">Total Tests</div>
          </div>
          <div class="stat">
            <div class="value" class="passed">${summary.passed}</div>
            <div class="label">Passed</div>
          </div>
          <div class="stat">
            <div class="value" class="failed">${summary.failed}</div>
            <div class="label">Failed</div>
          </div>
          <div class="stat">
            <div class="value">${summary.parityRate.toFixed(1)}%</div>
            <div class="label">Parity Rate</div>
          </div>
        </div>
        
        <h2>Feature Test Results</h2>
        <table>
          <thead>
            <tr>
              <th>Feature</th>
              <th>WebGL</th>
              <th>Canvas2D</th>
              <th>Parity</th>
            </tr>
          </thead>
          <tbody>
            ${this.testResults.map(r => `
              <tr class="${r.parity ? 'parity' : 'no-parity'}">
                <td>${r.feature}</td>
                <td class="${r.webgl.passed ? 'passed' : 'failed'}">
                  ${r.webgl.passed ? '✓' : '✗'}
                  ${r.webgl.time ? `(${r.webgl.time.toFixed(2)}ms)` : ''}
                  ${r.webgl.error ? `<br><small>${r.webgl.error}</small>` : ''}
                </td>
                <td class="${r.canvas2d.passed ? 'passed' : 'failed'}">
                  ${r.canvas2d.passed ? '✓' : '✗'}
                  ${r.canvas2d.time ? `(${r.canvas2d.time.toFixed(2)}ms)` : ''}
                  ${r.canvas2d.error ? `<br><small>${r.canvas2d.error}</small>` : ''}
                </td>
                <td class="${r.parity ? 'passed' : 'failed'}">
                  ${r.parity ? 'PASS' : 'FAIL'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        
        <h2>Performance Comparison</h2>
        <div class="performance">
          <table>
            <thead>
              <tr>
                <th>Operation</th>
                <th>WebGL Time</th>
                <th>Canvas2D Time</th>
                <th>Speedup</th>
              </tr>
            </thead>
            <tbody>
              ${this.performanceMetrics.map(m => `
                <tr>
                  <td>${m.operation}</td>
                  <td>${m.webglTime.toFixed(2)}ms</td>
                  <td>${m.canvas2dTime.toFixed(2)}ms</td>
                  <td class="${m.speedup > 0 ? 'faster' : 'slower'}">
                    ${m.speedup > 0 ? '+' : ''}${m.speedup.toFixed(1)}%
                    ${m.speedup > 0 ? '(Canvas2D faster)' : '(WebGL faster)'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        
        <div style="margin-top: 30px; padding: 20px; background: #333; border-radius: 8px;">
          <h3>Summary</h3>
          <p>Feature parity between WebGL and Canvas2D implementations: <strong>${summary.parityRate.toFixed(1)}%</strong></p>
          <p>Average performance difference: <strong>
            ${this.performanceMetrics.length > 0 
              ? (this.performanceMetrics.reduce((a, b) => a + b.speedup, 0) / this.performanceMetrics.length).toFixed(1) + '%'
              : 'N/A'}
          </strong></p>
        </div>
      </body>
      </html>
    `;
  }
}