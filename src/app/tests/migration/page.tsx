'use client';

/**
 * Migration Test Page
 * Compare Canvas2D vs WebGL implementations
 */

import React, { useState, useRef } from 'react';

type TestResult = {
  parity: boolean;
};

type BenchmarkResult = {
  ratio: number;
};

type ComparisonResult = {
  difference: number;
};

type MemoryTestResult = {
  savings: {
    percentSaved: number;
  };
};

type MigrationSummary = {
  parity?: {
    passed: number;
    total: number;
  };
  performance?: {
    averageImprovement: string;
  };
  visual?: {
    qualityScore: string;
  };
  memory?: {
    reduction: string;
  };
};

type AllTestResults = {
  parity: TestResult[];
  performance: BenchmarkResult[];
  visual: ComparisonResult[];
  memory: MemoryTestResult[];
};

type ParityTestResult = {
  results: TestResult[];
  summary?: {
    passed: number;
    totalTests: number;
  };
};

const summarizeParity = (
  results: TestResult[],
  summary?: ParityTestResult['summary']
): MigrationSummary['parity'] => {
  const passed = summary?.passed ?? results.filter(result => result.parity).length;
  const total = summary?.totalTests ?? results.length;
  return {
    passed,
    total,
  };
};

const summarizePerformance = (results: BenchmarkResult[]): MigrationSummary['performance'] => {
  if (!results.length) {
    return { averageImprovement: 'N/A' };
  }

  const averageRatio = results.reduce((sum, result) => sum + result.ratio, 0) / results.length;
  const improvement = (1 - averageRatio) * 100;
  const formatted = Number.isFinite(improvement) ? `${improvement.toFixed(1)}%` : 'N/A';

  return {
    averageImprovement: formatted,
  };
};

const summarizeVisual = (results: ComparisonResult[]): MigrationSummary['visual'] => {
  if (!results.length) {
    return { qualityScore: 'N/A' };
  }

  const averageDifference = results.reduce((sum, result) => sum + result.difference, 0) / results.length;
  const score = Math.max(0, Math.min(1, 1 - averageDifference));

  return {
    qualityScore: `${Math.round(score * 100)}%`,
  };
};

const summarizeMemory = (results: MemoryTestResult[]): MigrationSummary['memory'] => {
  if (!results.length) {
    return { reduction: 'N/A' };
  }

  const averageSavings = results.reduce((sum, result) => sum + result.savings.percentSaved, 0) / results.length;
  const formatted = Number.isFinite(averageSavings) ? `${averageSavings.toFixed(1)}%` : 'N/A';

  return {
    reduction: formatted,
  };
};

const summarizeAllResults = (results: AllTestResults): MigrationSummary => ({
  parity: summarizeParity(results.parity),
  performance: summarizePerformance(results.performance),
  visual: summarizeVisual(results.visual),
  memory: summarizeMemory(results.memory),
});

export default function MigrationTestPage() {
  const [isRunning, setIsRunning] = useState(false);
  const [currentTest, setCurrentTest] = useState('');
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<MigrationSummary | null>(null);
  const [reportHtml, setReportHtml] = useState('');
  const [selectedTest, setSelectedTest] = useState('all');
  const reportRef = useRef<HTMLIFrameElement>(null);
  
  const runTests = async () => {
    setIsRunning(true);
    setProgress(0);
    setResults(null);
    setReportHtml('');
    
    try {
      const { MasterTestRunner } = await import('@/testing/MasterTestRunner');
      const runner = new MasterTestRunner();
      
      if (selectedTest === 'all') {
        setCurrentTest('Running all migration tests...');
        setProgress(25);
        
        const testResults = await runner.runAllTests();

        setCurrentTest('Generating comprehensive report...');
        setProgress(90);

        const report = runner.generateMasterReport(testResults);
        setReportHtml(report);
        setResults(summarizeAllResults(testResults));
        
      } else {
        setCurrentTest(`Running ${selectedTest} test...`);
        setProgress(50);
        
        let summary: MigrationSummary | null = null;
        switch(selectedTest) {
          case 'parity':
            {
              const parityResults = await runner.runFeatureParityTest();
              summary = { parity: summarizeParity(parityResults.results, parityResults.summary) };
            }
            break;
          case 'performance':
            {
              const performanceResults = await runner.runPerformanceBenchmark();
              summary = { performance: summarizePerformance(performanceResults) };
            }
            break;
          case 'visual':
            {
              const visualResults = await runner.runVisualQualityComparison();
              summary = { visual: summarizeVisual(visualResults) };
            }
            break;
          case 'memory':
            {
              const memoryResults = await runner.runMemoryAnalysis();
              summary = { memory: summarizeMemory(memoryResults) };
            }
            break;
        }
        
        if (summary) {
          setResults(summary);
        }
        setCurrentTest('Test complete!');
      }
      
      setProgress(100);
    } catch (error) {
      console.error('Test failed:', error);
      setCurrentTest(`Test failed: ${(error as Error).message}`);
    } finally {
      setIsRunning(false);
    }
  };
  
  const downloadReport = () => {
    const blob = new Blob([reportHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `migration-test-report-${new Date().toISOString()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="container mx-auto px-4">
        <h1 className="text-3xl font-bold mb-6">🔄 Canvas2D vs WebGL Migration Tests</h1>
        
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Test Suite Selection</h2>
          <p className="text-gray-600 mb-4">
            Compare the new Canvas2D unified rendering pipeline against the original WebGL implementation.
            These tests verify feature parity, performance, visual quality, and memory usage.
          </p>
          
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Test Suite
              </label>
              <select
                value={selectedTest}
                onChange={(e) => setSelectedTest(e.target.value)}
                disabled={isRunning}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">🎯 All Tests (Comprehensive)</option>
                <option value="parity">✅ Feature Parity Test</option>
                <option value="performance">⚡ Performance Benchmark</option>
                <option value="visual">🎨 Visual Quality Comparison</option>
                <option value="memory">💾 Memory Usage Analysis</option>
              </select>
            </div>
            
            <div className="flex items-end">
              <button
                onClick={runTests}
                disabled={isRunning}
                className={`px-6 py-3 rounded-lg font-semibold transition-all w-full ${
                  isRunning 
                    ? 'bg-gray-400 cursor-not-allowed' 
                    : 'bg-blue-500 hover:bg-blue-600 text-white'
                }`}
              >
                {isRunning ? '⏳ Running Tests...' : '▶️ Run Selected Tests'}
              </button>
            </div>
          </div>
          
          {isRunning && (
            <div className="mt-4">
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>{currentTest}</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>
        
        {results ? (
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold">📊 Test Results</h2>
              {reportHtml && (
                <button
                  onClick={downloadReport}
                  className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-semibold transition-all"
                >
                  📥 Download Full Report
                </button>
              )}
            </div>
            
            {results.parity ? (
              <div className="mb-6 p-4 bg-blue-50 rounded-lg">
                <h3 className="text-lg font-semibold mb-2">✅ Feature Parity Results</h3>
                <p className="text-gray-700">
                  Passed: {results.parity.passed} / {results.parity.total} tests
                </p>
              </div>
            ) : null}
            
            {results.performance ? (
              <div className="mb-6 p-4 bg-yellow-50 rounded-lg">
                <h3 className="text-lg font-semibold mb-2">⚡ Performance Results</h3>
                <p className="text-gray-700">
                  Average improvement: {results.performance.averageImprovement}
                </p>
              </div>
            ) : null}
            
            {results.visual ? (
              <div className="mb-6 p-4 bg-green-50 rounded-lg">
                <h3 className="text-lg font-semibold mb-2">🎨 Visual Quality Results</h3>
                <p className="text-gray-700">
                  Quality score: {results.visual.qualityScore}
                </p>
              </div>
            ) : null}
            
            {results.memory ? (
              <div className="mb-6 p-4 bg-purple-50 rounded-lg">
                <h3 className="text-lg font-semibold mb-2">💾 Memory Usage Results</h3>
                <p className="text-gray-700">
                  Memory reduction: {results.memory.reduction}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
        
        {reportHtml && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4">📄 Detailed Report</h2>
            <iframe
              ref={reportRef}
              srcDoc={reportHtml}
              className="w-full h-96 border rounded-lg"
              title="Test Report"
            />
          </div>
        )}
        
        <div className="mt-8 grid grid-cols-2 gap-6">
          <div className="bg-blue-50 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-2">🎯 Test Descriptions</h3>
            <ul className="space-y-2 text-gray-700 text-sm">
              <li><strong>Feature Parity:</strong> Verifies all WebGL features work in Canvas2D</li>
              <li><strong>Performance:</strong> Measures speed improvements</li>
              <li><strong>Visual Quality:</strong> Pixel-perfect comparison</li>
              <li><strong>Memory Usage:</strong> Analyzes memory consumption</li>
            </ul>
          </div>
          
          <div className="bg-green-50 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-2">✨ Key Benefits</h3>
            <ul className="space-y-2 text-gray-700 text-sm">
              <li>• 75% memory reduction with indexed colors</li>
              <li>• Better browser compatibility (no WebGL required)</li>
              <li>• Simplified architecture and maintenance</li>
              <li>• Ready for future WebGPU migration</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
