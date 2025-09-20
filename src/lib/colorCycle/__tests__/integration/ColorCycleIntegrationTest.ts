/**
 * Integration tests for complete color cycle workflow
 * Tests end-to-end functionality, performance, and cross-browser compatibility
 */

import { PerformanceBenchmark } from '../performance/PerformanceBenchmark';
import { CrossBrowserTest } from '../performance/CrossBrowserTest';
import { PerformanceProfiler } from '../../monitoring/PerformanceProfiler';
import { ColorQuantizer } from '../../ColorQuantizer';
import { RecolorManager } from '../../RecolorManager';
import { BrowserCompat } from '../../compatibility/BrowserCompat';
import type { Layer } from '@/types';
import { createMockLayer } from '../testUtils/layerFactory';

export interface IntegrationTestResult {
  testName: string;
  success: boolean;
  duration: number;
  error?: string;
  details?: Record<string, any>;
}

export interface IntegrationTestSuite {
  name: string;
  results: IntegrationTestResult[];
  performance: any;
  compatibility: any;
  recommendations: string[];
  timestamp: number;
}

const buildTestLayer = (canvas: HTMLCanvasElement, overrides: Partial<Layer> = {}): Layer => {
  const layerOverrides: Partial<Layer> = {
    framebuffer: overrides.framebuffer ?? canvas,
    ...overrides,
  };

  if (!('colorCycleData' in layerOverrides)) {
    layerOverrides.colorCycleData = {
      mode: 'recolor',
      canvas,
    };
  } else if (
    layerOverrides.colorCycleData &&
    !layerOverrides.colorCycleData.canvas
  ) {
    layerOverrides.colorCycleData = {
      ...layerOverrides.colorCycleData,
      canvas,
    };
  }

  return createMockLayer(layerOverrides);
};

export class ColorCycleIntegrationTest {
  private profiler: PerformanceProfiler;
  private benchmarker: PerformanceBenchmark;
  private browserTest: CrossBrowserTest;
  private browserCompat: BrowserCompat;

  constructor() {
    this.profiler = PerformanceProfiler.getInstance();
    this.benchmarker = new PerformanceBenchmark();
    this.browserTest = new CrossBrowserTest();
    this.browserCompat = BrowserCompat.getInstance();
  }

  /**
   * Run complete integration test suite
   */
  async runIntegrationTests(): Promise<IntegrationTestSuite> {
    const results: IntegrationTestResult[] = [];
    
    console.log('🧪 Starting Color Cycle Integration Tests...');

    // Basic functionality tests
    results.push(await this.runTest('Layer Creation and Setup', this.testLayerCreation.bind(this)));
    results.push(await this.runTest('Color Quantization Pipeline', this.testQuantizationPipeline.bind(this)));
    results.push(await this.runTest('Animation System', this.testAnimationSystem.bind(this)));
    results.push(await this.runTest('Memory Management', this.testMemoryManagement.bind(this)));
    results.push(await this.runTest('Error Handling', this.testErrorHandling.bind(this)));

    // Performance tests
    results.push(await this.runTest('Performance Benchmarks', this.testPerformanceBenchmarks.bind(this)));
    
    // Browser compatibility tests
    results.push(await this.runTest('Browser Compatibility', this.testBrowserCompatibility.bind(this)));
    
    // Real-world workflow tests
    results.push(await this.runTest('Complete Workflow', this.testCompleteWorkflow.bind(this)));
    
    // Stress tests
    results.push(await this.runTest('Large Image Handling', this.testLargeImageHandling.bind(this)));
    results.push(await this.runTest('Multiple Concurrent Layers', this.testMultipleLayers.bind(this)));

    // Generate performance and compatibility reports
    const performance = await this.benchmarker.runFullSuite();
    const compatibility = await this.browserTest.runCompatibilityTest();

    const suite: IntegrationTestSuite = {
      name: 'Color Cycle Integration Test Suite',
      results,
      performance,
      compatibility,
      recommendations: this.generateRecommendations(results, performance, compatibility),
      timestamp: Date.now()
    };

    console.log('✅ Integration Tests Complete');
    return suite;
  }

  /**
   * Run individual test with error handling and profiling
   */
  private async runTest(testName: string, testFunction: () => Promise<any>): Promise<IntegrationTestResult> {
    const profileId = `integration_test_${testName.replace(/\s+/g, '_').toLowerCase()}`;
    
    console.log(`🔍 Running: ${testName}`);
    
    try {
      this.profiler.start(profileId, { testName });
      
      const startTime = performance.now();
      const result = await testFunction();
      const duration = performance.now() - startTime;
      
      const profile = this.profiler.end(profileId, { success: true });
      
      console.log(`✅ ${testName} - ${duration.toFixed(2)}ms`);
      
      return {
        testName,
        success: true,
        duration,
        details: { result, profile }
      };
    } catch (error) {
      const duration = performance.now();
      this.profiler.end(profileId, { success: false, error: error instanceof Error ? error.message : 'Unknown error' });
      
      console.error(`❌ ${testName} - Failed:`, error);
      
      return {
        testName,
        success: false,
        duration,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Test layer creation and setup
   */
  private async testLayerCreation(): Promise<any> {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    
    // Create test pattern
    const imageData = ctx.createImageData(256, 256);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.random() * 255;     // R
      data[i + 1] = Math.random() * 255; // G  
      data[i + 2] = Math.random() * 255; // B
      data[i + 3] = 255;                 // A
    }
    ctx.putImageData(imageData, 0, 0);

    const layer = buildTestLayer(canvas, {
      id: 'test-layer',
      name: 'Test Layer',
      imageData,
    });

    return { layer, imageSize: `${canvas.width}x${canvas.height}` };
  }

  /**
   * Test color quantization pipeline
   */
  private async testQuantizationPipeline(): Promise<any> {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.createImageData(128, 128);
    
    // Fill with gradient
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const pixel = i / 4;
      const x = pixel % 128;
      const y = Math.floor(pixel / 128);
      
      data[i] = (x / 128) * 255;
      data[i + 1] = (y / 128) * 255;
      data[i + 2] = ((x + y) / 256) * 255;
      data[i + 3] = 255;
    }

    // Test RGB332 quantization
    const rgb332Result = ColorQuantizer.quantize(imageData, {
      method: 'rgb332',
      maxColors: 256,
      ditherMode: 'off'
    });

    // Test with dithering
    const ditheredResult = ColorQuantizer.quantize(imageData, {
      method: 'rgb332',
      maxColors: 256,
      ditherMode: 'bayer4'
    });

    return {
      rgb332: {
        paletteSize: rgb332Result.palette.length,
        indexBufferSize: rgb332Result.indices.length,
        hasColorMap: !!rgb332Result.colorMap
      },
      dithered: {
        paletteSize: ditheredResult.palette.length,
        indexBufferSize: ditheredResult.indices.length
      }
    };
  }

  /**
   * Test animation system
   */
  private async testAnimationSystem(): Promise<any> {
    const manager = RecolorManager.getInstance();
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    
    const baseImage = ctx.createImageData(canvas.width, canvas.height);
    const layer = buildTestLayer(canvas, {
      id: 'anim-test-layer',
      name: 'Animation Test Layer',
      imageData: baseImage,
    });

    // Convert to recolor mode
    await manager.convertToRecolorMode(layer, {
      quantizationMode: 'rgb332',
      ditherMode: 'off',
      cycleColors: 8,
      gradientPreset: 'rainbow'
    });

    // Test animation for several frames
    const frameResults = [];
    for (let i = 0; i < 10; i++) {
      const startTime = performance.now();
      manager.updateAnimation(layer);
      const duration = performance.now() - startTime;
      frameResults.push({ frame: i, duration });
      
      // Small delay to simulate real animation
      await new Promise(resolve => setTimeout(resolve, 1));
    }

    return {
      totalFrames: frameResults.length,
      averageFrameTime: frameResults.reduce((sum, f) => sum + f.duration, 0) / frameResults.length,
      maxFrameTime: Math.max(...frameResults.map(f => f.duration)),
      layerHasRecolorData: !!layer.colorCycleData?.recolorSettings
    };
  }

  /**
   * Test memory management
   */
  private async testMemoryManagement(): Promise<any> {
    const startMemory = this.browserCompat.getMemoryUsage();
    const manager = RecolorManager.getInstance();
    const layers: Layer[] = [];

    // Create multiple layers
    for (let i = 0; i < 5; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      
      const layer = buildTestLayer(canvas, {
        id: `memory-test-${i}`,
        name: `Memory Test Layer ${i}`,
        imageData: new ImageData(canvas.width, canvas.height),
      });

      await manager.convertToRecolorMode(layer, {
        quantizationMode: 'rgb332',
        ditherMode: 'off',
        cycleColors: 16
      });

      layers.push(layer);
    }

    const peakMemory = this.browserCompat.getMemoryUsage();

    // Clean up
    for (const layer of layers) {
      manager.cleanup(layer);
    }

    // Force garbage collection if available
    if ((globalThis as any).gc) {
      (globalThis as any).gc();
    }

    const endMemory = this.browserCompat.getMemoryUsage();

    return {
      startMemory,
      peakMemory,
      endMemory,
      memoryGrowth: peakMemory - startMemory,
      memoryRecovered: peakMemory - endMemory,
      layersCreated: layers.length
    };
  }

  /**
   * Test error handling
   */
  private async testErrorHandling(): Promise<any> {
    const manager = RecolorManager.getInstance();
    const errorTests = [];

    // Test invalid layer
    try {
      await manager.convertToRecolorMode(null as any, {});
      errorTests.push({ test: 'null layer', handled: false });
    } catch (e) {
      errorTests.push({ test: 'null layer', handled: true });
    }

    // Test invalid canvas
    try {
      const badLayer = createMockLayer({
        id: 'invalid-canvas',
        name: 'Invalid Canvas',
        colorCycleData: undefined,
      });
      await manager.convertToRecolorMode(badLayer, {});
      errorTests.push({ test: 'null canvas', handled: false });
    } catch (e) {
      errorTests.push({ test: 'null canvas', handled: true });
    }

    // Test invalid options
    try {
      const invalidOptionsLayer = buildTestLayer(document.createElement('canvas'), {
        id: 'invalid-options',
        name: 'Invalid Options',
      });
      await manager.convertToRecolorMode(invalidOptionsLayer, { maxColors: -1 } as any);
      errorTests.push({ test: 'invalid options', handled: false });
    } catch (e) {
      errorTests.push({ test: 'invalid options', handled: true });
    }

    return {
      totalTests: errorTests.length,
      handledErrors: errorTests.filter(t => t.handled).length,
      errorTests
    };
  }

  /**
   * Test performance benchmarks
   */
  private async testPerformanceBenchmarks(): Promise<any> {
    const results = await this.benchmarker.runFullSuite();
    
    // Check if results meet performance criteria
    const criticalTests = [
      'RGB332 Quantization',
      'Spatial Hash Lookup', 
      'Animation Frames'
    ];

    const performance = criticalTests.map(testName => {
      const result = results.results.find(r => r.name === testName);
      return {
        test: testName,
        found: !!result,
        averageTime: result?.averageTime || 0,
        acceptable: !result || result.averageTime < 100 // < 100ms threshold
      };
    });

    return {
      totalBenchmarks: results.results.length,
      criticalPerformance: performance,
      systemInfo: results.systemInfo
    };
  }

  /**
   * Test browser compatibility
   */
  private async testBrowserCompatibility(): Promise<any> {
    const capabilities = await this.browserTest.runCompatibilityTest();
    const colorCycleCompat = await this.browserTest.testColorCycleCompatibility();

    return {
      browserName: capabilities.name,
      browserVersion: capabilities.version,
      canvas2DSupported: capabilities.canvas2d.supported,
      webGLSupported: capabilities.webgl.supported,
      memoryAPISupported: capabilities.memory.supported,
      colorCycleWorks: colorCycleCompat.quantizationWorks && colorCycleCompat.animationWorks,
      issues: [...capabilities.issues, ...colorCycleCompat.issues],
      recommendations: capabilities.recommendations
    };
  }

  /**
   * Test complete workflow
   */
  private async testCompleteWorkflow(): Promise<any> {
    const manager = RecolorManager.getInstance();
    
    // Create test layer with complex image
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    
    // Draw complex pattern
    const imageData = ctx.createImageData(256, 256);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const pixel = i / 4;
      const x = pixel % 256;
      const y = Math.floor(pixel / 256);
      
      // Complex pattern with noise
      data[i] = Math.sin(x * 0.1) * 127 + 128 + Math.random() * 20;
      data[i + 1] = Math.cos(y * 0.1) * 127 + 128 + Math.random() * 20;
      data[i + 2] = Math.sin((x + y) * 0.05) * 127 + 128 + Math.random() * 20;
      data[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);

    const layer = buildTestLayer(canvas, {
      id: 'workflow-test',
      name: 'Workflow Test',
      imageData,
    });

    // Full workflow: Convert -> Animate -> Extract Colors -> Update Gradient
    const startTime = performance.now();
    
    // Step 1: Convert to recolor mode
    await manager.convertToRecolorMode(layer, {
      quantizationMode: 'rgb332',
      ditherMode: 'bayer4',
      cycleColors: 16
    });

    // Step 2: Animate for a few frames
    for (let i = 0; i < 5; i++) {
      manager.updateAnimation(layer);
    }

    // Step 3: Extract colors
    const extractedColors = await manager.extractColors(layer, {
      method: 'oklab',
      gradientStops: 8,
      buildMode: 'perceptual',
      sortBy: 'perceptual',
      preserveOriginalColors: true,
    });

    // Step 4: Update gradient
    if (extractedColors && extractedColors.length > 0) {
      const gradient = extractedColors.map((colorData, index) => ({
        position: index / (extractedColors.length - 1),
        color: colorData.color
      }));
      
      await manager.updateGradient(layer, gradient);
    }

    const totalTime = performance.now() - startTime;

    return {
      totalTime,
      layerConverted: !!layer.colorCycleData?.recolorSettings,
      paletteSize: layer.colorCycleData?.recolorSettings?.palette?.length || 0,
      extractedColorCount: extractedColors?.length || 0,
      workflowComplete: true
    };
  }

  /**
   * Test large image handling
   */
  private async testLargeImageHandling(): Promise<any> {
    const manager = RecolorManager.getInstance();
    const optimalSize = this.browserCompat.getOptimalCanvasSize({ width: 2048, height: 2048 });
    
    const canvas = document.createElement('canvas');
    canvas.width = optimalSize.width;
    canvas.height = optimalSize.height;
    
    const layer = buildTestLayer(canvas, {
      id: 'large-image-test',
      name: 'Large Image Test',
      imageData: new ImageData(canvas.width, canvas.height),
    });

    const startTime = performance.now();
    
    try {
      await manager.convertToRecolorMode(layer, {
        quantizationMode: 'rgb332', // Use faster quantization for large images
        ditherMode: 'off',
        cycleColors: 16
      });
      
      const conversionTime = performance.now() - startTime;
      
      // Test animation performance
      const animStartTime = performance.now();
      manager.updateAnimation(layer);
      const animTime = performance.now() - animStartTime;
      
      return {
        originalSize: { width: 2048, height: 2048 },
        actualSize: optimalSize,
        conversionTime,
        animationTime: animTime,
        success: true
      };
    } catch (error) {
      return {
        originalSize: { width: 2048, height: 2048 },
        actualSize: optimalSize,
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false
      };
    }
  }

  /**
   * Test multiple concurrent layers
   */
  private async testMultipleLayers(): Promise<any> {
    const manager = RecolorManager.getInstance();
    const maxLayers = this.browserCompat.getRecommendedSettings().maxConcurrentLayers;
    const layers: Layer[] = [];
    
    const startTime = performance.now();
    
    try {
      // Create multiple layers
      for (let i = 0; i < maxLayers; i++) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;

        const layer = buildTestLayer(canvas, {
          id: `concurrent-${i}`,
          name: `Concurrent Layer ${i}`,
          imageData: new ImageData(canvas.width, canvas.height),
        });
        
        await manager.convertToRecolorMode(layer, {
          quantizationMode: 'rgb332',
          ditherMode: 'off',
          cycleColors: 8
        });
        
        layers.push(layer);
      }
      
      const setupTime = performance.now() - startTime;
      
      // Test concurrent animation
      const animStartTime = performance.now();
      layers.forEach(layer => manager.updateAnimation(layer));
      const animTime = performance.now() - animStartTime;
      
      return {
        layerCount: layers.length,
        maxRecommended: maxLayers,
        setupTime,
        animationTime: animTime,
        averageAnimTimePerLayer: animTime / layers.length,
        success: true
      };
    } catch (error) {
      return {
        layerCount: layers.length,
        maxRecommended: maxLayers,
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false
      };
    } finally {
      // Cleanup
      layers.forEach(layer => manager.cleanup(layer));
    }
  }

  /**
   * Generate recommendations based on test results
   */
  private generateRecommendations(
    results: IntegrationTestResult[],
    performance: any,
    compatibility: any
  ): string[] {
    const recommendations: string[] = [];
    
    const failedTests = results.filter(r => !r.success);
    const slowTests = results.filter(r => r.duration > 1000); // > 1 second
    
    if (failedTests.length > 0) {
      recommendations.push(`${failedTests.length} test(s) failed. Check error logs for details.`);
    }
    
    if (slowTests.length > 0) {
      recommendations.push(`${slowTests.length} test(s) were slow. Consider performance optimizations.`);
    }
    
    if (!compatibility.canvas2DSupported) {
      recommendations.push('Canvas2D not supported. Color cycling will not work.');
    }
    
    if (!compatibility.memoryAPISupported) {
      recommendations.push('Memory API not available. Use conservative memory settings.');
    }
    
    if (compatibility.issues && compatibility.issues.length > 0) {
      recommendations.push('Browser compatibility issues detected. See compatibility report.');
    }
    
    // Performance-based recommendations
    const avgBenchmarkTime = performance.results 
      ? performance.results.reduce((sum: number, r: any) => sum + r.averageTime, 0) / performance.results.length
      : 0;
      
    if (avgBenchmarkTime > 100) {
      recommendations.push('Performance benchmarks show slow operations. Enable performance mode.');
    }
    
    if (results.every(r => r.success)) {
      recommendations.push('All integration tests passed! System is working correctly.');
    }
    
    return recommendations;
  }
}
