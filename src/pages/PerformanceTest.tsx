/**
 * Performance Test Page
 * Demonstrates the performance enhancements
 */

import React, { useRef, useState, useEffect } from 'react';
import { PerformanceEnhancementsTest } from '../testing/PerformanceEnhancementsTest';

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
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Performance Enhancements Test</h1>
      
      <div className="mb-6">
        <button
          onClick={runTests}
          disabled={isRunning}
          className="px-6 py-2 bg-blue-500 text-white rounded-lg disabled:opacity-50"
        >
          {isRunning ? 'Running Tests...' : 'Run Performance Tests'}
        </button>
        
        {results.length > 0 && (
          <button
            onClick={downloadReport}
            className="ml-4 px-6 py-2 bg-green-500 text-white rounded-lg"
          >
            Download Report
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <h3 className="text-lg font-semibold mb-2">Baseline Canvas</h3>
          <canvas
            ref={canvas1Ref}
            width={512}
            height={384}
            className="border border-gray-300"
          />
        </div>
        <div>
          <h3 className="text-lg font-semibold mb-2">Optimized Canvas</h3>
          <canvas
            ref={canvas2Ref}
            width={512}
            height={384}
            className="border border-gray-300"
          />
        </div>
      </div>

      {results.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-2xl font-bold mb-4">Test Results</h2>
          
          <div className="space-y-4">
            {results.map((result, idx) => (
              <div key={idx} className="border-b pb-4">
                <h3 className="text-lg font-semibold">{result.testName}</h3>
                <div className="grid grid-cols-3 gap-4 mt-2">
                  <div>
                    <span className="text-gray-600">Baseline:</span>
                    <span className="ml-2 font-mono">{result.baseline.toFixed(3)}ms</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Optimized:</span>
                    <span className="ml-2 font-mono">{result.optimized.toFixed(3)}ms</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Improvement:</span>
                    <span className={`ml-2 font-bold ${result.improvement > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {result.improvement > 0 ? '+' : ''}{result.improvement.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}