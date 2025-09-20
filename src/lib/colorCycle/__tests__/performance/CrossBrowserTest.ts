/**
 * Cross-browser compatibility testing for color cycle features
 * Tests Canvas2D operations, performance characteristics, and browser-specific quirks
 */

import { ColorQuantizer } from '../../ColorQuantizer';
import { BayerDithering } from '../../dithering/BayerDithering';

export interface BrowserCapabilities {
  name: string;
  version: string;
  canvas2d: {
    supported: boolean;
    imageDataPerformance: number;
    putImageDataPerformance: number;
    getImageDataPerformance: number;
    createImageDataPerformance: number;
  };
  webgl: {
    supported: boolean;
    version?: string;
    maxTextureSize?: number;
  };
  memory: {
    supported: boolean;
    jsHeapSizeLimit?: number;
    totalJSHeapSize?: number;
    usedJSHeapSize?: number;
  };
  typedArrays: {
    uint8ArraySupported: boolean;
    uint32ArraySupported: boolean;
    performanceGood: boolean;
  };
  performance: {
    highResTimeSupported: boolean;
    nowPrecision: number;
  };
  issues: string[];
  recommendations: string[];
}

export class CrossBrowserTest {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 256;
    this.canvas.height = 256;
    this.ctx = this.canvas.getContext('2d');
  }

  /**
   * Run complete browser compatibility test
   */
  async runCompatibilityTest(): Promise<BrowserCapabilities> {
    const capabilities: BrowserCapabilities = {
      name: this.getBrowserName(),
      version: this.getBrowserVersion(),
      canvas2d: await this.testCanvas2DSupport(),
      webgl: this.testWebGLSupport(),
      memory: this.testMemoryAPIs(),
      typedArrays: this.testTypedArrays(),
      performance: this.testPerformanceAPIs(),
      issues: [],
      recommendations: []
    };

    // Analyze results and add recommendations
    this.analyzeCapabilities(capabilities);

    return capabilities;
  }

  /**
   * Test Canvas2D support and performance
   */
  private async testCanvas2DSupport() {
    const result = {
      supported: false,
      imageDataPerformance: 0,
      putImageDataPerformance: 0,
      getImageDataPerformance: 0,
      createImageDataPerformance: 0
    };

    if (!this.ctx) {
      return result;
    }

    result.supported = true;

    // Test createImageData performance
    const createStart = performance.now();
    for (let i = 0; i < 100; i++) {
      this.ctx.createImageData(256, 256);
    }
    result.createImageDataPerformance = performance.now() - createStart;

    // Test getImageData performance
    const testImageData = this.ctx.createImageData(256, 256);
    this.fillTestPattern(testImageData);
    this.ctx.putImageData(testImageData, 0, 0);

    const getStart = performance.now();
    for (let i = 0; i < 20; i++) {
      this.ctx.getImageData(0, 0, 256, 256);
    }
    result.getImageDataPerformance = performance.now() - getStart;

    // Test putImageData performance
    const putStart = performance.now();
    for (let i = 0; i < 20; i++) {
      this.ctx.putImageData(testImageData, 0, 0);
    }
    result.putImageDataPerformance = performance.now() - putStart;

    // Test overall ImageData manipulation
    const manipulationStart = performance.now();
    for (let i = 0; i < 10; i++) {
      const imageData = this.ctx.getImageData(0, 0, 256, 256);
      // Simulate color manipulation
      for (let j = 0; j < imageData.data.length; j += 4) {
        imageData.data[j] = (imageData.data[j] + i) % 256;
      }
      this.ctx.putImageData(imageData, 0, 0);
    }
    result.imageDataPerformance = performance.now() - manipulationStart;

    return result;
  }

  /**
   * Test WebGL support
   */
  private testWebGLSupport() {
    const result = {
      supported: false,
      version: undefined as string | undefined,
      maxTextureSize: undefined as number | undefined
    };

    try {
      const canvas = document.createElement('canvas');
      const gl = (canvas.getContext('webgl') as WebGLRenderingContext | null)
        ?? (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
      
      if (gl) {
        result.supported = true;
        result.version = gl.getParameter(gl.VERSION);
        result.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      }
    } catch (e) {
      // WebGL not supported
    }

    return result;
  }

  /**
   * Test memory APIs
   */
  private testMemoryAPIs() {
    const result = {
      supported: false,
      jsHeapSizeLimit: undefined as number | undefined,
      totalJSHeapSize: undefined as number | undefined,
      usedJSHeapSize: undefined as number | undefined
    };

    if ((performance as any).memory) {
      result.supported = true;
      result.jsHeapSizeLimit = (performance as any).memory.jsHeapSizeLimit;
      result.totalJSHeapSize = (performance as any).memory.totalJSHeapSize;
      result.usedJSHeapSize = (performance as any).memory.usedJSHeapSize;
    }

    return result;
  }

  /**
   * Test TypedArray support and performance
   */
  private testTypedArrays() {
    const result = {
      uint8ArraySupported: false,
      uint32ArraySupported: false,
      performanceGood: false
    };

    try {
      // Test Uint8Array
      const uint8 = new Uint8Array(1024);
      uint8[0] = 255;
      result.uint8ArraySupported = uint8[0] === 255;

      // Test Uint32Array
      const uint32 = new Uint32Array(256);
      uint32[0] = 0xFFFFFFFF;
      result.uint32ArraySupported = uint32[0] === 0xFFFFFFFF;

      // Test performance with large arrays
      const largeArray = new Uint8Array(256 * 256 * 4);
      const start = performance.now();
      for (let i = 0; i < largeArray.length; i += 4) {
        largeArray[i] = 255;
        largeArray[i + 1] = 128;
        largeArray[i + 2] = 64;
        largeArray[i + 3] = 255;
      }
      const duration = performance.now() - start;
      
      // Good performance threshold: < 50ms for 256x256 RGBA manipulation
      result.performanceGood = duration < 50;
    } catch (e) {
      // TypedArray not supported
    }

    return result;
  }

  /**
   * Test performance APIs
   */
  private testPerformanceAPIs() {
    const result = {
      highResTimeSupported: false,
      nowPrecision: 0
    };

    try {
      result.highResTimeSupported = typeof performance.now === 'function';
      
      if (result.highResTimeSupported) {
        // Test precision by measuring a small delay
        const start = performance.now();
        const iterations = 1000;
        for (let i = 0; i < iterations; i++) {
          Math.random();
        }
        const end = performance.now();
        const duration = end - start;
        
        // Estimate precision based on reasonable expectations
        result.nowPrecision = duration > 0 ? Math.floor(Math.log10(1 / duration)) : 0;
      }
    } catch (e) {
      // Performance API not supported
    }

    return result;
  }

  /**
   * Analyze capabilities and provide recommendations
   */
  private analyzeCapabilities(capabilities: BrowserCapabilities) {
    // Canvas2D issues
    if (!capabilities.canvas2d.supported) {
      capabilities.issues.push('Canvas2D not supported');
      capabilities.recommendations.push('Use fallback rendering method');
    } else {
      if (capabilities.canvas2d.imageDataPerformance > 1000) {
        capabilities.issues.push('Slow Canvas2D ImageData operations');
        capabilities.recommendations.push('Enable performance mode to reduce quality');
      }
      
      if (capabilities.canvas2d.putImageDataPerformance > 500) {
        capabilities.issues.push('Slow putImageData operations');
        capabilities.recommendations.push('Batch canvas updates');
      }
    }

    // Memory issues
    if (!capabilities.memory.supported) {
      capabilities.issues.push('Memory API not available');
      capabilities.recommendations.push('Use conservative memory management');
    } else if (capabilities.memory.jsHeapSizeLimit && capabilities.memory.jsHeapSizeLimit < 100 * 1024 * 1024) {
      capabilities.issues.push('Low memory limit detected');
      capabilities.recommendations.push('Enable aggressive memory management');
    }

    // TypedArray issues
    if (!capabilities.typedArrays.performanceGood) {
      capabilities.issues.push('Slow TypedArray performance');
      capabilities.recommendations.push('Use smaller buffer sizes');
    }

    // Performance API issues
    if (!capabilities.performance.highResTimeSupported) {
      capabilities.issues.push('High-resolution timing not available');
      capabilities.recommendations.push('Use Date.now() fallback for timing');
    } else if (capabilities.performance.nowPrecision < 2) {
      capabilities.issues.push('Low timing precision');
      capabilities.recommendations.push('Use longer benchmark durations');
    }

    // Browser-specific issues
    const browserName = capabilities.name.toLowerCase();
    
    if (browserName.includes('safari')) {
      if (!capabilities.webgl.supported) {
        capabilities.issues.push('Safari WebGL issues common');
        capabilities.recommendations.push('Test WebGL fallbacks thoroughly');
      }
      capabilities.recommendations.push('Test with different Safari versions');
    }
    
    if (browserName.includes('firefox')) {
      capabilities.recommendations.push('Firefox may have different Canvas2D performance characteristics');
    }
    
    if (browserName.includes('chrome') && capabilities.memory.supported) {
      capabilities.recommendations.push('Use Chrome memory profiling for optimization');
    }

    // Mobile browser detection
    if (this.isMobile()) {
      capabilities.issues.push('Mobile browser detected');
      capabilities.recommendations.push('Enable mobile-optimized settings');
      capabilities.recommendations.push('Reduce memory usage and canvas size');
      capabilities.recommendations.push('Test touch interactions');
    }
  }

  /**
   * Test color cycling specific functionality
   */
  async testColorCycleCompatibility(): Promise<{
    quantizationWorks: boolean;
    ditheringWorks: boolean;
    animationWorks: boolean;
    issues: string[];
  }> {
    const result = {
      quantizationWorks: false,
      ditheringWorks: false,
      animationWorks: false,
      issues: [] as string[],
    };

    let testData: ImageData | null = null;

    try {
      if (this.ctx) {
        testData = this.ctx.createImageData(64, 64);
        this.fillTestPattern(testData);
        const quantized = ColorQuantizer.quantize(testData, {
          method: 'rgb332',
          maxColors: 256,
          ditherMode: 'off',
        });
        result.quantizationWorks = quantized.indices.length > 0 && quantized.palette.length > 0;
      }

      if (!result.quantizationWorks) {
        result.issues.push('Color quantization failed');
      }
    } catch (e) {
      result.issues.push(`Quantization error: ${e}`);
    }

    try {
      if (result.quantizationWorks && testData) {
        const palette = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
          palette[i] = (255 << 24) | (i << 16) | (i << 8) | i;
        }

        const dithering = new BayerDithering();
        const dithered = dithering.dither(testData, palette);
        result.ditheringWorks = dithered.imageData.data.length > 0;
      }

      if (!result.ditheringWorks) {
        result.issues.push('Dithering failed');
      }
    } catch (e) {
      result.issues.push(`Dithering error: ${e}`);
    }

    try {
      if (result.quantizationWorks) {
        let animationWorked = false;

        const startTime = performance.now();
        const testFrame = () => {
          const elapsed = performance.now() - startTime;
          if (elapsed > 100) {
            animationWorked = true;
          } else {
            requestAnimationFrame(testFrame);
          }
        };

        await new Promise<void>((resolve) => {
          testFrame();
          setTimeout(() => {
            result.animationWorks = animationWorked;
            resolve();
          }, 200);
        });
      }

      if (!result.animationWorks) {
        result.issues.push('Animation system failed');
      }
    } catch (e) {
      result.issues.push(`Animation error: ${e}`);
    }

    return result;
  }

  /**
   * Fill ImageData with test pattern
   */
  private fillTestPattern(imageData: ImageData) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const index = i / 4;
      const x = index % imageData.width;
      const y = Math.floor(index / imageData.width);
      
      data[i] = (x * 255) / imageData.width;     // R
      data[i + 1] = (y * 255) / imageData.height; // G
      data[i + 2] = ((x + y) * 255) / (imageData.width + imageData.height); // B
      data[i + 3] = 255; // A
    }
  }

  /**
   * Get browser name
   */
  private getBrowserName(): string {
    const userAgent = navigator.userAgent;
    
    if (userAgent.includes('Chrome') && !userAgent.includes('Edge')) {
      return 'Chrome';
    } else if (userAgent.includes('Firefox')) {
      return 'Firefox';
    } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
      return 'Safari';
    } else if (userAgent.includes('Edge')) {
      return 'Edge';
    } else if (userAgent.includes('Opera') || userAgent.includes('OPR')) {
      return 'Opera';
    } else {
      return 'Unknown';
    }
  }

  /**
   * Get browser version
   */
  private getBrowserVersion(): string {
    const userAgent = navigator.userAgent;
    const browserName = this.getBrowserName();
    
    let version = 'Unknown';
    
    try {
      switch (browserName) {
        case 'Chrome':
          version = userAgent.match(/Chrome\/([0-9.]+)/)?.[1] || 'Unknown';
          break;
        case 'Firefox':
          version = userAgent.match(/Firefox\/([0-9.]+)/)?.[1] || 'Unknown';
          break;
        case 'Safari':
          version = userAgent.match(/Version\/([0-9.]+)/)?.[1] || 'Unknown';
          break;
        case 'Edge':
          version = userAgent.match(/Edge\/([0-9.]+)/)?.[1] || 'Unknown';
          break;
        case 'Opera':
          version = userAgent.match(/(?:Opera|OPR)\/([0-9.]+)/)?.[1] || 'Unknown';
          break;
      }
    } catch (e) {
      // Version detection failed
    }
    
    return version;
  }

  /**
   * Detect mobile browser
   */
  private isMobile(): boolean {
    return /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  /**
   * Format compatibility results
   */
  static formatCompatibilityReport(capabilities: BrowserCapabilities): string {
    let report = `# Browser Compatibility Report\n\n`;
    
    report += `## Browser Information\n`;
    report += `- Browser: ${capabilities.name} ${capabilities.version}\n`;
    report += `- User Agent: ${navigator.userAgent}\n\n`;
    
    report += `## Canvas2D Support\n`;
    report += `- Supported: ${capabilities.canvas2d.supported ? '✅' : '❌'}\n`;
    if (capabilities.canvas2d.supported) {
      report += `- ImageData Performance: ${capabilities.canvas2d.imageDataPerformance.toFixed(1)}ms\n`;
      report += `- putImageData Performance: ${capabilities.canvas2d.putImageDataPerformance.toFixed(1)}ms\n`;
      report += `- getImageData Performance: ${capabilities.canvas2d.getImageDataPerformance.toFixed(1)}ms\n`;
    }
    report += `\n`;
    
    report += `## WebGL Support\n`;
    report += `- Supported: ${capabilities.webgl.supported ? '✅' : '❌'}\n`;
    if (capabilities.webgl.supported) {
      report += `- Version: ${capabilities.webgl.version}\n`;
      report += `- Max Texture Size: ${capabilities.webgl.maxTextureSize}\n`;
    }
    report += `\n`;
    
    report += `## Memory APIs\n`;
    report += `- Supported: ${capabilities.memory.supported ? '✅' : '❌'}\n`;
    if (capabilities.memory.supported) {
      report += `- Heap Size Limit: ${((capabilities.memory.jsHeapSizeLimit || 0) / 1024 / 1024).toFixed(1)}MB\n`;
      report += `- Current Usage: ${((capabilities.memory.usedJSHeapSize || 0) / 1024 / 1024).toFixed(1)}MB\n`;
    }
    report += `\n`;
    
    report += `## TypedArray Support\n`;
    report += `- Uint8Array: ${capabilities.typedArrays.uint8ArraySupported ? '✅' : '❌'}\n`;
    report += `- Uint32Array: ${capabilities.typedArrays.uint32ArraySupported ? '✅' : '❌'}\n`;
    report += `- Performance: ${capabilities.typedArrays.performanceGood ? '✅' : '❌'}\n\n`;
    
    report += `## Performance APIs\n`;
    report += `- High-res timing: ${capabilities.performance.highResTimeSupported ? '✅' : '❌'}\n`;
    report += `- Timing precision: ${capabilities.performance.nowPrecision} digits\n\n`;
    
    if (capabilities.issues.length > 0) {
      report += `## ⚠️ Issues Detected\n`;
      capabilities.issues.forEach(issue => {
        report += `- ${issue}\n`;
      });
      report += `\n`;
    }
    
    if (capabilities.recommendations.length > 0) {
      report += `## 💡 Recommendations\n`;
      capabilities.recommendations.forEach(rec => {
        report += `- ${rec}\n`;
      });
      report += `\n`;
    }
    
    return report;
  }
}
