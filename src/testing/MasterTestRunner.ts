/**
 * Master Test Runner
 * Comprehensive testing and reporting for Canvas2D vs WebGL migration
 */

import { ColorCycleFeatureParityTest } from './ColorCycleFeatureParityTest';
import { PerformanceBenchmark } from './PerformanceBenchmark';
import { VisualQualityComparison } from './VisualQualityComparison';
import { MemoryAnalysis } from './MemoryAnalysis';

export class MasterTestRunner {
  private parityTest: ColorCycleFeatureParityTest;
  private performanceBenchmark: PerformanceBenchmark;
  private visualComparison: VisualQualityComparison;
  private memoryAnalysis: MemoryAnalysis;
  
  constructor() {
    const canvas1 = document.createElement('canvas');
    const canvas2 = document.createElement('canvas');
    canvas1.width = 512;
    canvas1.height = 512;
    canvas2.width = 512;
    canvas2.height = 512;
    
    this.parityTest = new ColorCycleFeatureParityTest(canvas1, canvas2);
    this.performanceBenchmark = new PerformanceBenchmark();
    this.visualComparison = new VisualQualityComparison();
    this.memoryAnalysis = new MemoryAnalysis();
  }
  
  /**
   * Run all tests
   */
  async runAllTests(): Promise<{
    parity: any;
    performance: any;
    visual: any;
    memory: any;
  }> {
    console.log('🚀 Starting comprehensive Canvas2D vs WebGL testing...\n');
    
    // Feature parity tests
    console.log('📋 Running feature parity tests...');
    const parityResultsObj = await this.parityTest.runAllTests();
    const parityResults = parityResultsObj.results;
    console.log(`✅ Feature parity tests complete: ${parityResults.filter(r => r.parity).length}/${parityResults.length} passed\n`);
    
    // Performance benchmarks
    console.log('⚡ Running performance benchmarks...');
    const performanceResults = await this.performanceBenchmark.runAllBenchmarks();
    console.log(`✅ Performance benchmarks complete: ${performanceResults.length} tests run\n`);
    
    // Visual quality comparison
    console.log('🎨 Running visual quality comparison...');
    const visualResults = await this.visualComparison.runAllTests();
    console.log(`✅ Visual comparison complete: ${visualResults.length} tests run\n`);
    
    // Memory analysis
    console.log('💾 Running memory analysis...');
    const memoryResults = await this.memoryAnalysis.runAllTests();
    console.log(`✅ Memory analysis complete: ${memoryResults.length} tests run\n`);
    
    return {
      parity: parityResults,
      performance: performanceResults,
      visual: visualResults,
      memory: memoryResults
    };
  }
  
  /**
   * Generate master report
   */
  generateMasterReport(results: {
    parity: any;
    performance: any;
    visual: any;
    memory: any;
  }): string {
    // Calculate summary metrics
    const parityRate = (results.parity.filter((r: any) => r.parity).length / results.parity.length) * 100;
    
    const performanceRatio = results.performance.reduce((sum: number, r: any) => sum + r.ratio, 0) / results.performance.length;
    const performanceWinner = performanceRatio < 1 ? 'Canvas2D' : 'WebGL';
    
    const visualDifference = results.visual.reduce((sum: number, r: any) => sum + r.difference, 0) / results.visual.length;
    const visualScore = Math.round((1 - visualDifference) * 100);
    
    const memorySavings = results.memory.reduce((sum: number, r: any) => sum + r.savings.percentSaved, 0) / results.memory.length;
    
    // Determine overall recommendation
    let recommendation = '';
    let recommendationClass = '';
    
    if (parityRate >= 95 && visualScore >= 95 && memorySavings > 10) {
      recommendation = '✅ Canvas2D is recommended - Excellent compatibility with memory savings';
      recommendationClass = 'success';
    } else if (parityRate >= 90 && visualScore >= 90) {
      recommendation = '⚠️ Canvas2D is viable - Good compatibility, evaluate performance needs';
      recommendationClass = 'warning';
    } else {
      recommendation = '❌ Further optimization needed before migration';
      recommendationClass = 'danger';
    }
    
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>TinyBrush Canvas2D Migration - Master Test Report</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
    }
    .header {
      background: rgba(255, 255, 255, 0.98);
      padding: 40px;
      text-align: center;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    }
    .header h1 {
      margin: 0;
      color: #333;
      font-size: 2.5em;
    }
    .header p {
      margin: 10px 0;
      color: #666;
      font-size: 1.1em;
    }
    .container {
      max-width: 1400px;
      margin: 40px auto;
      padding: 0 20px;
    }
    .dashboard {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }
    .card {
      background: white;
      border-radius: 12px;
      padding: 25px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      transition: transform 0.3s;
    }
    .card:hover {
      transform: translateY(-5px);
      box-shadow: 0 8px 30px rgba(0,0,0,0.15);
    }
    .card-title {
      font-size: 1.1em;
      color: #666;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .card-value {
      font-size: 2.5em;
      font-weight: bold;
      margin: 10px 0;
    }
    .card-subtitle {
      color: #999;
      font-size: 0.9em;
    }
    .success { color: #4CAF50; }
    .warning { color: #FF9800; }
    .danger { color: #f44336; }
    .info { color: #2196F3; }
    
    .recommendation {
      background: white;
      border-radius: 12px;
      padding: 30px;
      margin-bottom: 40px;
      text-align: center;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    }
    .recommendation h2 {
      margin-top: 0;
      color: #333;
    }
    .recommendation-text {
      font-size: 1.4em;
      font-weight: 600;
      margin: 20px 0;
      padding: 20px;
      border-radius: 8px;
    }
    .recommendation-text.success {
      background: #e8f5e9;
      color: #2e7d32;
    }
    .recommendation-text.warning {
      background: #fff3e0;
      color: #e65100;
    }
    .recommendation-text.danger {
      background: #ffebee;
      color: #c62828;
    }
    
    .detailed-reports {
      background: white;
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    }
    .detailed-reports h2 {
      margin-top: 0;
      color: #333;
      border-bottom: 3px solid #667eea;
      padding-bottom: 10px;
    }
    .report-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin-top: 20px;
    }
    .report-link {
      display: block;
      padding: 20px;
      background: #f8f9fa;
      border-radius: 8px;
      text-decoration: none;
      color: #333;
      border: 2px solid transparent;
      transition: all 0.3s;
      text-align: center;
    }
    .report-link:hover {
      border-color: #667eea;
      background: #f3f0ff;
      transform: translateY(-2px);
    }
    .report-link-title {
      font-weight: 600;
      font-size: 1.1em;
      margin-bottom: 5px;
    }
    .report-link-desc {
      color: #666;
      font-size: 0.9em;
    }
    
    .summary-table {
      width: 100%;
      margin: 20px 0;
      border-collapse: collapse;
    }
    .summary-table th {
      background: #667eea;
      color: white;
      padding: 12px;
      text-align: left;
      font-weight: 600;
    }
    .summary-table td {
      padding: 10px 12px;
      border-bottom: 1px solid #e0e0e0;
    }
    .summary-table tr:hover {
      background: #f8f9fa;
    }
    
    .metadata {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 8px;
      margin: 20px 0;
      color: #666;
      font-size: 0.9em;
    }
    
    .icon {
      width: 24px;
      height: 24px;
      display: inline-block;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🎨 TinyBrush Canvas2D Migration Report</h1>
    <p>Comprehensive Testing Results: Canvas2D vs WebGL Implementation</p>
    <p style="color: #999; font-size: 0.9em;">${new Date().toLocaleString()}</p>
  </div>
  
  <div class="container">
    <!-- Summary Dashboard -->
    <div class="dashboard">
      <div class="card">
        <div class="card-title">
          <span>✅</span> Feature Parity
        </div>
        <div class="card-value ${parityRate >= 95 ? 'success' : parityRate >= 90 ? 'warning' : 'danger'}">
          ${parityRate.toFixed(1)}%
        </div>
        <div class="card-subtitle">
          ${results.parity.filter((r: any) => r.parity).length}/${results.parity.length} tests passed
        </div>
      </div>
      
      <div class="card">
        <div class="card-title">
          <span>⚡</span> Performance
        </div>
        <div class="card-value ${performanceRatio < 1.1 ? 'success' : performanceRatio < 1.5 ? 'warning' : 'danger'}">
          ${performanceRatio < 1 ? (1/performanceRatio).toFixed(2) + 'x' : performanceRatio.toFixed(2) + 'x'}
        </div>
        <div class="card-subtitle">
          ${performanceWinner} ${performanceRatio < 1 ? 'faster' : 'slower'} overall
        </div>
      </div>
      
      <div class="card">
        <div class="card-title">
          <span>🎨</span> Visual Quality
        </div>
        <div class="card-value ${visualScore >= 95 ? 'success' : visualScore >= 85 ? 'warning' : 'danger'}">
          ${visualScore}%
        </div>
        <div class="card-subtitle">
          Visual parity score
        </div>
      </div>
      
      <div class="card">
        <div class="card-title">
          <span>💾</span> Memory Savings
        </div>
        <div class="card-value ${memorySavings > 20 ? 'success' : memorySavings > 0 ? 'warning' : 'danger'}">
          ${Math.abs(memorySavings).toFixed(1)}%
        </div>
        <div class="card-subtitle">
          ${memorySavings > 0 ? 'Less memory used' : 'More memory used'}
        </div>
      </div>
    </div>
    
    <!-- Recommendation -->
    <div class="recommendation">
      <h2>📊 Migration Recommendation</h2>
      <div class="recommendation-text ${recommendationClass}">
        ${recommendation}
      </div>
      
      <table class="summary-table">
        <thead>
          <tr>
            <th>Criteria</th>
            <th>Canvas2D</th>
            <th>WebGL</th>
            <th>Winner</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Browser Compatibility</td>
            <td class="success">✅ Excellent</td>
            <td class="warning">⚠️ Good</td>
            <td class="success">Canvas2D</td>
          </tr>
          <tr>
            <td>Memory Usage</td>
            <td class="success">✅ ${memorySavings > 0 ? 'Lower' : 'Higher'}</td>
            <td class="${memorySavings > 0 ? 'warning' : 'success'}">
              ${memorySavings > 0 ? '⚠️ Higher' : '✅ Lower'}
            </td>
            <td class="${memorySavings > 0 ? 'success' : 'warning'}">
              ${memorySavings > 0 ? 'Canvas2D' : 'WebGL'}
            </td>
          </tr>
          <tr>
            <td>Performance</td>
            <td class="${performanceRatio < 1 ? 'success' : 'warning'}">
              ${performanceRatio < 1 ? '✅ Faster' : '⚠️ Slower'}
            </td>
            <td class="${performanceRatio > 1 ? 'success' : 'warning'}">
              ${performanceRatio > 1 ? '✅ Faster' : '⚠️ Slower'}
            </td>
            <td class="${performanceWinner === 'Canvas2D' ? 'success' : 'info'}">
              ${performanceWinner}
            </td>
          </tr>
          <tr>
            <td>Visual Quality</td>
            <td class="${visualScore >= 95 ? 'success' : 'warning'}">
              ${visualScore >= 95 ? '✅ Identical' : '⚠️ Minor differences'}
            </td>
            <td class="success">✅ Reference</td>
            <td>${visualScore >= 95 ? 'Tie' : 'WebGL'}</td>
          </tr>
          <tr>
            <td>Feature Completeness</td>
            <td class="${parityRate >= 95 ? 'success' : 'warning'}">
              ${parityRate >= 95 ? '✅ Complete' : '⚠️ ' + parityRate.toFixed(0) + '% complete'}
            </td>
            <td class="success">✅ Complete</td>
            <td>${parityRate >= 95 ? 'Tie' : 'WebGL'}</td>
          </tr>
        </tbody>
      </table>
    </div>
    
    <!-- Key Findings -->
    <div class="detailed-reports">
      <h2>🔍 Key Findings</h2>
      
      <div style="margin: 20px 0;">
        <h3>Strengths of Canvas2D Implementation:</h3>
        <ul>
          ${memorySavings > 10 ? '<li>Significant memory savings (' + memorySavings.toFixed(1) + '% reduction)</li>' : ''}
          ${parityRate >= 95 ? '<li>Full feature parity with WebGL version</li>' : ''}
          ${visualScore >= 95 ? '<li>Visually identical output</li>' : ''}
          <li>Better browser compatibility</li>
          <li>No WebGL context required</li>
          <li>Simpler implementation and maintenance</li>
        </ul>
        
        <h3>Areas for Consideration:</h3>
        <ul>
          ${performanceRatio > 1.2 ? '<li>Performance is ' + performanceRatio.toFixed(1) + 'x slower in some operations</li>' : ''}
          ${parityRate < 95 ? '<li>Some features still need implementation (' + (100-parityRate).toFixed(1) + '% missing)</li>' : ''}
          ${visualScore < 95 ? '<li>Minor visual differences detected (' + (100-visualScore) + '% variance)</li>' : ''}
          ${memorySavings < 0 ? '<li>Higher memory usage than WebGL</li>' : ''}
        </ul>
      </div>
      
      <h3>Test Coverage:</h3>
      <div class="report-grid">
        <div class="report-link">
          <div class="report-link-title">Feature Parity</div>
          <div class="report-link-desc">${results.parity.length} tests executed</div>
        </div>
        <div class="report-link">
          <div class="report-link-title">Performance</div>
          <div class="report-link-desc">${results.performance.length} benchmarks run</div>
        </div>
        <div class="report-link">
          <div class="report-link-title">Visual Quality</div>
          <div class="report-link-desc">${results.visual.length} comparisons made</div>
        </div>
        <div class="report-link">
          <div class="report-link-title">Memory Usage</div>
          <div class="report-link-desc">${results.memory.length} scenarios tested</div>
        </div>
      </div>
    </div>
    
    <!-- Metadata -->
    <div class="metadata">
      <strong>Test Environment:</strong> ${typeof navigator !== 'undefined' ? navigator.userAgent : 'Node.js'}<br>
      <strong>Test Date:</strong> ${new Date().toISOString()}<br>
      <strong>Canvas Size:</strong> Various (256×256 to 2048×2048)<br>
      <strong>Total Tests Run:</strong> ${results.parity.length + results.performance.length + results.visual.length + results.memory.length}<br>
      <strong>Test Duration:</strong> Varies by system performance
    </div>
  </div>
</body>
</html>
    `;
    
    return html;
  }
  
  /**
   * Save report to file
   */
  async saveReport(html: string, filename: string = 'canvas2d-migration-report.html'): Promise<void> {
    if (typeof window !== 'undefined') {
      // Browser environment
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      // Node.js environment
      const fs = await import('fs');
      fs.writeFileSync(filename, html, 'utf-8');
      console.log(`Report saved to ${filename}`);
    }
  }
  
  /**
   * Run complete test suite and generate report
   */
  async runAndReport(): Promise<string> {
    try {
      const results = await this.runAllTests();
      const report = this.generateMasterReport(results);
      
      // Save individual reports if needed
      const parityReport = this.parityTest.generateHTMLReport();
      const performanceReport = this.performanceBenchmark.generateReport();
      const visualReport = this.visualComparison.generateReport();
      const memoryReport = this.memoryAnalysis.generateReport();
      
      console.log('✅ All tests completed successfully!');
      console.log('\n📊 Summary:');
      console.log(`- Feature Parity: ${(results.parity.filter((r: any) => r.parity).length / results.parity.length * 100).toFixed(1)}%`);
      console.log(`- Performance: ${results.performance.length} benchmarks completed`);
      console.log(`- Visual Quality: ${results.visual.length} comparisons made`);
      console.log(`- Memory Analysis: ${results.memory.length} scenarios tested`);
      
      return report;
    } catch (error) {
      console.error('❌ Error during testing:', error);
      throw error;
    }
  }
}

// Export convenience function
export async function runMasterTestSuite(): Promise<void> {
  const runner = new MasterTestRunner();
  const report = await runner.runAndReport();
  await runner.saveReport(report);
}