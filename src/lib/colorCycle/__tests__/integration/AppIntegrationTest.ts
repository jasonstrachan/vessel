/**
 * Automated integration testing for TinyBrush app integration
 * Tests all integration points, compatibility, and identifies issues
 */

import { AppIntegration } from '../../integration/AppIntegration';
import { ColorCycleIntegrationTest } from './ColorCycleIntegrationTest';
import { BrowserCompat } from '../../compatibility/BrowserCompat';
import type { Layer } from '@/types';
import type { IntegrationTestSuite } from './ColorCycleIntegrationTest';
import type { BenchmarkSuite } from '../performance/PerformanceBenchmark';
import type { BrowserCapabilities } from '../performance/CrossBrowserTest';
import { createMockLayer } from '../testUtils/layerFactory';

interface IntegrationIssue {
  severity: 'error' | 'warning' | 'info';
  component: string;
  message: string;
  fix?: string;
  code?: string;
}

interface AppIntegrationReport {
  timestamp: number;
  testsPassed: number;
  testsFailed: number;
  issues: IntegrationIssue[];
  fixes: string[];
  performanceMetrics: BenchmarkSuite | null;
  compatibilityReport: BrowserCapabilities | null;
  recommendations: string[];
}

export class AppIntegrationTest {
  private integration: AppIntegration;
  private browserCompat: BrowserCompat;
  private colorCycleTest: ColorCycleIntegrationTest;
  private issues: IntegrationIssue[] = [];

  constructor() {
    this.integration = AppIntegration.getInstance();
    this.browserCompat = BrowserCompat.getInstance();
    this.colorCycleTest = new ColorCycleIntegrationTest();
  }

  /**
   * Run complete app integration test suite
   */
  async runAppIntegrationTests(): Promise<AppIntegrationReport> {
    console.log('🔍 Starting App Integration Tests...');
    
    let testsPassed = 0;
    let testsFailed = 0;

    // Test 1: Basic initialization
    try {
      await this.testInitialization();
      testsPassed++;
      console.log('✅ Initialization test passed');
    } catch (error) {
      testsFailed++;
      this.addIssue('error', 'AppIntegration', `Initialization failed: ${error}`, 'Check browser compatibility and dependencies');
      console.error('❌ Initialization test failed:', error);
    }

    // Test 2: Layer compatibility detection
    try {
      await this.testLayerCompatibility();
      testsPassed++;
      console.log('✅ Layer compatibility test passed');
    } catch (error) {
      testsFailed++;
      this.addIssue('error', 'LayerCompatibility', `Layer compatibility test failed: ${error}`);
      console.error('❌ Layer compatibility test failed:', error);
    }

    // Test 3: Memory management
    try {
      await this.testMemoryManagement();
      testsPassed++;
      console.log('✅ Memory management test passed');
    } catch (error) {
      testsFailed++;
      this.addIssue('warning', 'MemoryManagement', `Memory test failed: ${error}`, 'Enable conservative memory mode');
      console.error('⚠️ Memory management test failed:', error);
    }

    // Test 4: UI integration
    try {
      await this.testUIIntegration();
      testsPassed++;
      console.log('✅ UI integration test passed');
    } catch (error) {
      testsFailed++;
      this.addIssue('error', 'UIIntegration', `UI integration failed: ${error}`, 'Check React components and props');
      console.error('❌ UI integration test failed:', error);
    }

    // Test 5: Performance under load
    try {
      await this.testPerformanceUnderLoad();
      testsPassed++;
      console.log('✅ Performance test passed');
    } catch (error) {
      testsFailed++;
      this.addIssue('warning', 'Performance', `Performance test failed: ${error}`, 'Enable performance mode');
      console.error('⚠️ Performance test failed:', error);
    }

    // Test 6: Error handling
    try {
      await this.testErrorHandling();
      testsPassed++;
      console.log('✅ Error handling test passed');
    } catch (error) {
      testsFailed++;
      this.addIssue('error', 'ErrorHandling', `Error handling test failed: ${error}`);
      console.error('❌ Error handling test failed:', error);
    }

    // Run comprehensive color cycle tests
    let colorCycleReport: IntegrationTestSuite | undefined;
    try {
      colorCycleReport = await this.colorCycleTest.runIntegrationTests();
      if (colorCycleReport.results.some(r => !r.success)) {
        testsFailed += colorCycleReport.results.filter(r => !r.success).length;
        testsPassed += colorCycleReport.results.filter(r => r.success).length;
      } else {
        testsPassed++;
      }
    } catch (error) {
      testsFailed++;
      this.addIssue('error', 'ColorCycleSystem', `Color cycle tests failed: ${error}`);
    }

    const fixes = this.generateFixes();
    const recommendations = this.generateRecommendations();

    const report: AppIntegrationReport = {
      timestamp: Date.now(),
      testsPassed,
      testsFailed,
      issues: [...this.issues],
      fixes,
      performanceMetrics: colorCycleReport?.performance || null,
      compatibilityReport: colorCycleReport?.compatibility || null,
      recommendations
    };

    console.log(`🎯 App Integration Tests Complete: ${testsPassed} passed, ${testsFailed} failed`);
    return report;
  }

  /**
   * Test basic initialization
   */
  private async testInitialization(): Promise<void> {
    // Test that integration initializes without errors
    await this.integration.initialize();

    // Test browser compatibility
    const isCanvas2DSupported = this.browserCompat.isFeatureSupported('canvas2d');
    if (!isCanvas2DSupported) {
      throw new Error('Canvas2D not supported - core functionality will fail');
    }

    // Test recommended settings retrieval
    const settings = this.integration.getRecommendedSettings();
    if (!settings || typeof settings !== 'object') {
      throw new Error('Failed to get recommended settings');
    }

    // Test status reporting
    const status = this.integration.getStatus();
    if (!status.initialized) {
      throw new Error('Integration reports as not initialized');
    }
  }

  /**
   * Test layer compatibility detection
   */
  private async testLayerCompatibility(): Promise<void> {
    // Test with valid layer
    const validCanvas = document.createElement('canvas');
    validCanvas.width = 256;
    validCanvas.height = 256;

    const validLayer = createMockLayer({
      id: 'test-valid',
      name: 'Valid Test Layer',
      layerType: 'color-cycle',
      framebuffer: validCanvas,
      colorCycleData: {
        mode: 'recolor',
        canvas: validCanvas,
      },
    });

    const validResult = this.integration.canConvertLayer(validLayer);
    if (!validResult.canConvert) {
      throw new Error(`Valid layer rejected: ${validResult.reason}`);
    }

    // Test with invalid layer (no canvas)
    const invalidLayer = createMockLayer({
      id: 'test-invalid',
      name: 'Invalid Test Layer',
      colorCycleData: undefined,
      layerType: 'normal',
    });

    const invalidResult = this.integration.canConvertLayer(invalidLayer);
    if (invalidResult.canConvert) {
      throw new Error('Invalid layer was accepted when it should be rejected');
    }

    // Test with oversized layer
    const oversizedCanvas = document.createElement('canvas');
    oversizedCanvas.width = 8192;
    oversizedCanvas.height = 8192;

    const oversizedLayer = createMockLayer({
      id: 'test-oversized',
      name: 'Oversized Test Layer',
      layerType: 'color-cycle',
      framebuffer: oversizedCanvas,
      colorCycleData: {
        mode: 'recolor',
        canvas: oversizedCanvas,
      },
    });

    const oversizedResult = this.integration.canConvertLayer(oversizedLayer);
    // This should either be rejected OR the layer should be resized
    if (oversizedResult.canConvert) {
      const optimalSize = this.browserCompat.getOptimalCanvasSize({
        width: oversizedCanvas.width,
        height: oversizedCanvas.height
      });
      
      if (optimalSize.width === oversizedCanvas.width && optimalSize.height === oversizedCanvas.height) {
        // Large layers are supported on this system
        console.log('ℹ️ System supports large canvases');
      }
    }
  }

  /**
   * Test memory management
   */
  private async testMemoryManagement(): Promise<void> {
    const startMemory = this.browserCompat.getMemoryUsage();
    const layers: Layer[] = [];

    try {
      // Create multiple test layers
      for (let i = 0; i < 3; i++) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        
        const ctx = canvas.getContext('2d')!;
        const imageData = ctx.createImageData(128, 128);
        
        // Fill with test pattern
        for (let j = 0; j < imageData.data.length; j += 4) {
          imageData.data[j] = Math.random() * 255;
          imageData.data[j + 1] = Math.random() * 255;
          imageData.data[j + 2] = Math.random() * 255;
          imageData.data[j + 3] = 255;
        }
        ctx.putImageData(imageData, 0, 0);

        const layer = createMockLayer({
          id: `memory-test-${i}`,
          name: `Memory Test Layer ${i}`,
          framebuffer: canvas,
          layerType: 'color-cycle',
          imageData,
          colorCycleData: {
            mode: 'recolor',
            canvas,
          },
        });

        // Test conversion
        await this.integration.convertLayerOptimized(layer, {
          quantizationMode: 'rgb332',
          ditherMode: 'off',
          cycleColors: 8
        });

        layers.push(layer);
      }

      const peakMemory = this.browserCompat.getMemoryUsage();
      const memoryGrowth = peakMemory - startMemory;

      // Clean up
      for (const layer of layers) {
        this.integration.cleanupLayer(layer.id);
      }

      // Check if memory growth is reasonable (< 100MB)
      if (memoryGrowth > 100 * 1024 * 1024) {
        throw new Error(`Excessive memory growth: ${(memoryGrowth / 1024 / 1024).toFixed(1)}MB`);
      }

      const endMemory = this.browserCompat.getMemoryUsage();
      const memoryRecovered = peakMemory - endMemory;
      
      // Check that most memory was recovered
      if (memoryRecovered < memoryGrowth * 0.5) {
        this.addIssue('warning', 'MemoryManagement', 
          'Memory not fully recovered after cleanup', 
          'Potential memory leak - monitor in production');
      }

    } finally {
      // Ensure cleanup even if test fails
      for (const layer of layers) {
        try {
          this.integration.cleanupLayer(layer.id);
        } catch {
          // Ignore cleanup errors in test cleanup path
        }
      }
    }
  }

  /**
   * Test UI integration components
   */
  private async testUIIntegration(): Promise<void> {
    // Test that required components can be imported and instantiated
    // This is a basic structural test since we can't do full React rendering here

    // Test ColorCycleUI component structure
    try {
      const ColorCycleUI = (await import('../../../../components/colorCycle/integration/ColorCycleUI')).ColorCycleUI;
      if (typeof ColorCycleUI !== 'function') {
        throw new Error('ColorCycleUI is not a valid React component');
      }
    } catch (error) {
      throw new Error(`Failed to import ColorCycleUI: ${error}`);
    }

    // Test RecolorPanel component structure
    try {
      const RecolorPanel = (await import('../../../../components/colorCycle/RecolorPanel')).RecolorPanel;
      if (typeof RecolorPanel !== 'function') {
        throw new Error('RecolorPanel is not a valid React component');
      }
    } catch (error) {
      throw new Error(`Failed to import RecolorPanel: ${error}`);
    }

    // Test that error boundary exists
    try {
      const ColorCycleErrorBoundary = (await import('../../../../components/colorCycle/error/ColorCycleErrorBoundary')).ColorCycleErrorBoundary;
      if (!ColorCycleErrorBoundary) {
        throw new Error('ColorCycleErrorBoundary not found');
      }
    } catch (error) {
      throw new Error(`Failed to import ColorCycleErrorBoundary: ${error}`);
    }
  }

  /**
   * Test performance under load
   */
  private async testPerformanceUnderLoad(): Promise<void> {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.createImageData(256, 256);
    
    // Create complex test pattern
    for (let i = 0; i < imageData.data.length; i += 4) {
      const pixel = i / 4;
      const x = pixel % 256;
      const y = Math.floor(pixel / 256);
      
      imageData.data[i] = Math.sin(x * 0.1) * 127 + 128;
      imageData.data[i + 1] = Math.cos(y * 0.1) * 127 + 128;
      imageData.data[i + 2] = Math.sin((x + y) * 0.05) * 127 + 128;
      imageData.data[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);

    const layer = createMockLayer({
      id: 'performance-test',
      name: 'Performance Test Layer',
      framebuffer: canvas,
      layerType: 'color-cycle',
      imageData,
      colorCycleData: {
        mode: 'recolor',
        canvas,
      },
    });

    try {
      // Test conversion performance
      const convertStart = performance.now();
      await this.integration.convertLayerOptimized(layer, {
        quantizationMode: 'rgb332',
        ditherMode: 'bayer4',
        cycleColors: 16
      });
      const convertTime = performance.now() - convertStart;

      if (convertTime > 5000) { // > 5 seconds
        this.addIssue('warning', 'Performance', 
          `Slow conversion time: ${convertTime.toFixed(0)}ms`, 
          'Consider using RGB332 mode without dithering');
      }

      // Test animation performance
      const animStart = performance.now();
      for (let i = 0; i < 30; i++) {
        this.integration.updateAllAnimations();
      }
      const animTime = performance.now() - animStart;
      const avgFrameTime = animTime / 30;

      if (avgFrameTime > 33) { // > 30 FPS
        this.addIssue('warning', 'Performance', 
          `Slow animation: ${avgFrameTime.toFixed(1)}ms per frame`, 
          'Reduce FPS or enable performance mode');
      }

    } finally {
      this.integration.cleanupLayer(layer.id);
    }
  }

  /**
   * Test error handling
   */
  private async testErrorHandling(): Promise<void> {
    // Test that errors are handled gracefully
    
    // Test with null layer
    try {
      await this.integration.convertLayerOptimized(null as unknown as Layer);
      throw new Error('Should have thrown error for null layer');
    } catch (error) {
      if (error instanceof Error && error.message.includes('null layer')) {
        throw error; // Re-throw unexpected errors
      }
      // Expected error - good!
    }

    // Test with invalid options
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    
    const layer = createMockLayer({
      id: 'error-test',
      name: 'Error Test Layer',
      framebuffer: canvas,
      layerType: 'color-cycle',
      colorCycleData: {
        mode: 'recolor',
        canvas,
      },
    });

    try {
      await this.integration.convertLayerOptimized(layer, {
        quantizationMode: 'invalid-mode' as never,
        cycleColors: -1
      });
      throw new Error('Should have thrown error for invalid options');
    } catch (error) {
      if (error instanceof Error && error.message.includes('Should have thrown')) {
        throw error; // Re-throw if our test failed
      }
      // Expected error handling - good!
    }

    // Test cleanup of non-existent layer
    try {
      this.integration.cleanupLayer('non-existent-layer');
      // Should not throw - cleanup should be safe
    } catch (error) {
      const details = error instanceof Error ? `: ${error.message}` : '';
      this.addIssue('warning', 'ErrorHandling', 
        `Cleanup of non-existent layer throws error${details}`, 
        'Make cleanup more defensive');
    }
  }

  /**
   * Add an issue to the report
   */
  private addIssue(severity: 'error' | 'warning' | 'info', component: string, message: string, fix?: string): void {
    this.issues.push({ severity, component, message, fix });
  }

  /**
   * Generate fixes for identified issues
   */
  private generateFixes(): string[] {
    const fixes = this.issues
      .filter(issue => issue.fix)
      .map(issue => `${issue.component}: ${issue.fix}`);

    // Add general fixes based on patterns
    if (this.issues.some(i => i.message.includes('memory'))) {
      fixes.push('Enable conservative memory management in browser compatibility layer');
    }

    if (this.issues.some(i => i.message.includes('performance') || i.message.includes('slow'))) {
      fixes.push('Enable performance mode by default for this system');
    }

    if (this.issues.some(i => i.message.includes('Canvas2D'))) {
      fixes.push('Add Canvas2D polyfill or fallback rendering method');
    }

    return [...new Set(fixes)]; // Remove duplicates
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(): string[] {
    const recommendations: string[] = [];

    const errorCount = this.issues.filter(i => i.severity === 'error').length;
    const warningCount = this.issues.filter(i => i.severity === 'warning').length;

    if (errorCount > 0) {
      recommendations.push(`Fix ${errorCount} critical error(s) before deployment`);
    }

    if (warningCount > 0) {
      recommendations.push(`Address ${warningCount} warning(s) for optimal performance`);
    }

    // Browser-specific recommendations
    const browserInfo = this.browserCompat.getRecommendedSettings();
    if (browserInfo.preferredQuantization === 'rgb332') {
      recommendations.push('Use RGB332 quantization as default for this browser');
    }

    if (!browserInfo.enableDithering) {
      recommendations.push('Disable dithering by default for better performance');
    }

    if (browserInfo.maxConcurrentLayers < 5) {
      recommendations.push('Limit concurrent recolor layers to improve stability');
    }

    if (this.issues.length === 0) {
      recommendations.push('All integration tests passed - system ready for deployment');
    }

    return recommendations;
  }

  /**
   * Format integration test report
   */
  static formatReport(report: AppIntegrationReport): string {
    let output = `# TinyBrush Color Cycle Integration Report\n\n`;
    output += `**Generated:** ${new Date(report.timestamp).toLocaleString()}\n`;
    output += `**Tests:** ${report.testsPassed} passed, ${report.testsFailed} failed\n\n`;

    if (report.issues.length > 0) {
      output += `## Issues Found\n\n`;
      
      const errors = report.issues.filter(i => i.severity === 'error');
      const warnings = report.issues.filter(i => i.severity === 'warning');
      const info = report.issues.filter(i => i.severity === 'info');

      if (errors.length > 0) {
        output += `### 🔴 Errors (${errors.length})\n`;
        errors.forEach(issue => {
          output += `- **${issue.component}**: ${issue.message}\n`;
          if (issue.fix) output += `  - *Fix*: ${issue.fix}\n`;
        });
        output += `\n`;
      }

      if (warnings.length > 0) {
        output += `### ⚠️ Warnings (${warnings.length})\n`;
        warnings.forEach(issue => {
          output += `- **${issue.component}**: ${issue.message}\n`;
          if (issue.fix) output += `  - *Fix*: ${issue.fix}\n`;
        });
        output += `\n`;
      }

      if (info.length > 0) {
        output += `### ℹ️ Information (${info.length})\n`;
        info.forEach(issue => {
          output += `- **${issue.component}**: ${issue.message}\n`;
        });
        output += `\n`;
      }
    }

    if (report.fixes.length > 0) {
      output += `## Recommended Fixes\n`;
      report.fixes.forEach((fix, index) => {
        output += `${index + 1}. ${fix}\n`;
      });
      output += `\n`;
    }

    if (report.recommendations.length > 0) {
      output += `## Recommendations\n`;
      report.recommendations.forEach(rec => {
        output += `- ${rec}\n`;
      });
      output += `\n`;
    }

    if (report.performanceMetrics) {
      output += `## Performance Summary\n`;
      output += `- Browser: ${report.performanceMetrics.systemInfo?.userAgent || 'Unknown'}\n`;
      output += `- Canvas2D Support: ${report.performanceMetrics.systemInfo?.canvas2DSupport ? '✅' : '❌'}\n`;
      output += `- WebGL Support: ${report.performanceMetrics.systemInfo?.webGLSupport ? '✅' : '❌'}\n`;
      output += `\n`;
    }

    return output;
  }
}
