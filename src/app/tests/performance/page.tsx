'use client';

/**
 * Performance Test Page
 * Run performance benchmarks comparing Canvas2D vs WebGL implementations
 */

import React, { useRef, useState } from 'react';
import { PerformanceEnhancementsTest } from '@/testing/PerformanceEnhancementsTest';

export default function PerformanceTestPage() {
  const canvas1Ref = useRef<HTMLCanvasElement>(null);
  const canvas2Ref = useRef<HTMLCanvasElement>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [reportHTML, setReportHTML] = useState('');

  const runTests = async () => {
    if (!canvas1Ref.current || !canvas2Ref.current) return;
    
    setIsRunning(true);
    setResults([]);
    
    try {
      const test = new PerformanceEnhancementsTest();
      const testResults = await test.runAllTests(canvas1Ref.current, canvas2Ref.current);
      setResults(testResults);
      setReportHTML(test.generateHTMLReport());
    } catch (error) {
      console.error('Test failed:', error);
      alert('Test failed: ' + (error as Error).message);
    } finally {
      setIsRunning(false);
    }
  };

  const downloadReport = () => {
    const blob = new Blob([reportHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'performance-enhancements-report.html';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="container mx-auto px-4">
        <h1 className="text-3xl font-bold mb-6">🚀 2D Pipeline Performance Tests</h1>
        
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Test Controls</h2>
          <p className="text-gray-600 mb-4">
            Compare the performance of the new unified 2D rendering pipeline with optimizations 
            against the baseline Canvas2D implementation.
          </p>
          
          <div className="flex gap-4">
            <button
              onClick={runTests}
              disabled={isRunning}
              className={`px-6 py-3 rounded-lg font-semibold transition-all ${
                isRunning 
                  ? 'bg-gray-400 cursor-not-allowed' 
                  : 'bg-blue-500 hover:bg-blue-600 text-white'
              }`}
            >
              {isRunning ? '⏳ Running Tests...' : '▶️ Run Performance Tests'}
            </button>
            
            {results.length > 0 && (
              <button
                onClick={downloadReport}
                className="px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-lg font-semibold transition-all"
              >
                📥 Download Report
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-lg shadow-md p-4">
            <h3 className="text-lg font-semibold mb-2">Baseline Canvas (Canvas2D)</h3>
            <canvas
              ref={canvas1Ref}
              width={512}
              height={384}
              className="w-full border border-gray-300 rounded"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>
          <div className="bg-white rounded-lg shadow-md p-4">
            <h3 className="text-lg font-semibold mb-2">Optimized Canvas (with Enhancements)</h3>
            <canvas
              ref={canvas2Ref}
              width={512}
              height={384}
              className="w-full border border-gray-300 rounded"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>
        </div>

        {results.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-2xl font-bold mb-4">📊 Test Results</h2>
            
            <div className="space-y-4">
              {results.map((result, idx) => (
                <div key={idx} className="border-b pb-4 last:border-0">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-lg font-semibold">{result.testName}</h3>
                    <span className={`text-2xl font-bold ${
                      result.improvement > 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {result.improvement > 0 ? '⬆️' : '⬇️'} {Math.abs(result.improvement).toFixed(1)}%
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div className="bg-gray-50 p-2 rounded">
                      <span className="text-gray-600">Baseline:</span>
                      <span className="ml-2 font-mono font-semibold">{result.baseline.toFixed(3)}ms</span>
                    </div>
                    <div className="bg-gray-50 p-2 rounded">
                      <span className="text-gray-600">Optimized:</span>
                      <span className="ml-2 font-mono font-semibold">{result.optimized.toFixed(3)}ms</span>
                    </div>
                    <div className={`p-2 rounded ${
                      result.improvement > 0 ? 'bg-green-50' : 'bg-red-50'
                    }`}>
                      <span className="text-gray-600">Improvement:</span>
                      <span className={`ml-2 font-bold ${
                        result.improvement > 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {result.improvement > 0 ? '+' : ''}{result.improvement.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  
                  {result.details && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-blue-600 hover:text-blue-800">
                        View Details
                      </summary>
                      <pre className="mt-2 p-2 bg-gray-50 rounded text-xs overflow-auto">
                        {JSON.stringify(result.details, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 bg-blue-50 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-2">ℹ️ About These Tests</h3>
          <ul className="space-y-2 text-gray-700">
            <li>• <strong>Rendering Performance:</strong> Measures frame rendering speed</li>
            <li>• <strong>Paint Operations:</strong> Tests brush painting efficiency</li>
            <li>• <strong>Animation FPS:</strong> Checks animation smoothness</li>
            <li>• <strong>Memory Usage:</strong> Compares memory consumption</li>
            <li>• <strong>Gradient Updates:</strong> Tests palette switching speed</li>
          </ul>
        </div>
      </div>
    </div>
  );
}