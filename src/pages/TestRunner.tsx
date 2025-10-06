/**
 * Test Runner Page
 * UI for running Canvas2D vs WebGL migration tests
 */

import React, { useState } from 'react';
import { MasterTestRunner } from '../testing/MasterTestRunner';
import { ColorCycleFeatureParityTest } from '../testing/ColorCycleFeatureParityTest';
import { PerformanceBenchmark } from '../testing/PerformanceBenchmark';
import { VisualQualityComparison } from '../testing/VisualQualityComparison';
import { MemoryAnalysis } from '../testing/MemoryAnalysis';

type FullSuiteResults = Awaited<ReturnType<MasterTestRunner['runAllTests']>>;
type TestRunnerResults = Partial<FullSuiteResults>;

type TestSelection = 'all' | 'parity' | 'performance' | 'visual' | 'memory';

export const TestRunner: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [currentTest, setCurrentTest] = useState('');
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<TestRunnerResults | null>(null);
  const [reportHtml, setReportHtml] = useState('');
  const [selectedTest, setSelectedTest] = useState<TestSelection>('all');
  
  const runTests = async () => {
    setIsRunning(true);
    setProgress(0);
    setResults(null);
    setReportHtml('');
    
    try {
      if (selectedTest === 'all') {
        // Run all tests
        setCurrentTest('Initializing test suite...');
        const runner = new MasterTestRunner();
        
        setCurrentTest('Running feature parity tests...');
        setProgress(25);
        
        const testResults = await runner.runAllTests();
        
        setCurrentTest('Generating report...');
        setProgress(90);
        
        const report = runner.generateMasterReport(testResults);
        setReportHtml(report);
        setResults(testResults);
        
      } else if (selectedTest === 'parity') {
        setCurrentTest('Running feature parity tests...');
        const canvas1 = document.createElement('canvas');
        const canvas2 = document.createElement('canvas');
        canvas1.width = 512;
        canvas1.height = 512;
        canvas2.width = 512;
        canvas2.height = 512;
        const test = new ColorCycleFeatureParityTest(canvas1, canvas2);
        const resultsObj = await test.runAllTests();
        const report = test.generateHTMLReport();
        setReportHtml(report);
        setResults({ parity: resultsObj.results });
        
      } else if (selectedTest === 'performance') {
        setCurrentTest('Running performance benchmarks...');
        const benchmark = new PerformanceBenchmark();
        const performanceResults = await benchmark.runAllBenchmarks();
        const report = benchmark.generateReport();
        setReportHtml(report);
        setResults({ performance: performanceResults });
        
      } else if (selectedTest === 'visual') {
        setCurrentTest('Running visual quality comparison...');
        const comparison = new VisualQualityComparison();
        const visualResults = await comparison.runAllTests();
        const report = comparison.generateReport();
        setReportHtml(report);
        setResults({ visual: visualResults });
        
      } else if (selectedTest === 'memory') {
        setCurrentTest('Running memory analysis...');
        const analysis = new MemoryAnalysis();
        const memoryResults = await analysis.runAllTests();
        const report = analysis.generateReport();
        setReportHtml(report);
        setResults({ memory: memoryResults });
      }
      
      setProgress(100);
      setCurrentTest('Complete!');
      
    } catch (error: unknown) {
      console.error('Test error:', error);
      const message = error instanceof Error ? error.message : String(error);
      setCurrentTest(`Error: ${message}`);
    } finally {
      setIsRunning(false);
    }
  };
  
  const downloadReport = () => {
    if (!reportHtml) return;
    
    const blob = new Blob([reportHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vessel-${selectedTest}-report-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  const openReportInNewTab = () => {
    if (!reportHtml) return;
    
    const blob = new Blob([reportHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };
  
  return (
    <div style={{
      padding: '40px',
      maxWidth: '1200px',
      margin: '0 auto',
      fontFamily: "'IBM Plex Mono', 'Courier New', monospace"
    }}>
      <h1 style={{ color: '#333', borderBottom: '3px solid #667eea', paddingBottom: '10px' }}>
        🧪 Canvas2D Migration Test Suite
      </h1>
      
      <div style={{
        background: '#f8f9fa',
        padding: '20px',
        borderRadius: '8px',
        marginBottom: '30px'
      }}>
        <p style={{ margin: '0 0 10px 0', color: '#666' }}>
          This test suite compares the Canvas2D and WebGL implementations across multiple dimensions:
        </p>
        <ul style={{ margin: '10px 0', color: '#666' }}>
          <li>Feature parity - Ensures all features work identically</li>
          <li>Performance - Benchmarks speed differences</li>
          <li>Visual quality - Pixel-by-pixel comparison</li>
          <li>Memory usage - Analyzes memory consumption</li>
        </ul>
      </div>
      
      <div style={{ marginBottom: '30px' }}>
        <label style={{ display: 'block', marginBottom: '10px', fontWeight: '600' }}>
          Select Test Suite:
        </label>
        <select
          value={selectedTest}
          onChange={(e) => setSelectedTest(e.target.value as TestSelection)}
          disabled={isRunning}
          style={{
            padding: '10px 15px',
            fontSize: '16px',
            borderRadius: '6px',
            border: '2px solid #ddd',
            marginRight: '15px',
            minWidth: '200px'
          }}
        >
          <option value="all">🎯 All Tests (Complete Suite)</option>
          <option value="parity">📋 Feature Parity Only</option>
          <option value="performance">⚡ Performance Benchmarks Only</option>
          <option value="visual">🎨 Visual Quality Only</option>
          <option value="memory">💾 Memory Analysis Only</option>
        </select>
        
        <button
          onClick={runTests}
          disabled={isRunning}
          style={{
            padding: '10px 30px',
            fontSize: '16px',
            background: isRunning ? '#ccc' : '#667eea',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: isRunning ? 'not-allowed' : 'pointer',
            fontWeight: '600'
          }}
        >
          {isRunning ? 'Running Tests...' : 'Run Tests'}
        </button>
      </div>
      
      {isRunning && (
        <div style={{
          background: 'white',
          padding: '20px',
          borderRadius: '8px',
          marginBottom: '30px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
        }}>
          <div style={{ marginBottom: '10px', color: '#666' }}>
            {currentTest}
          </div>
          <div style={{
            width: '100%',
            height: '20px',
            background: '#e0e0e0',
            borderRadius: '10px',
            overflow: 'hidden'
          }}>
            <div style={{
              width: `${progress}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #667eea, #764ba2)',
              transition: 'width 0.3s',
              borderRadius: '10px'
            }} />
          </div>
        </div>
      )}
      
      {results && !isRunning && (
        <div style={{
          background: 'white',
          padding: '20px',
          borderRadius: '8px',
          marginBottom: '30px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ marginTop: 0, color: '#333' }}>✅ Test Results</h2>
          
          {results.parity && (
            <div style={{ marginBottom: '15px' }}>
              <strong>Feature Parity:</strong> {
                results.parity.filter(result => result.parity).length
              }/{results.parity.length} tests passed
            </div>
          )}
          
          {results.performance && (
            <div style={{ marginBottom: '15px' }}>
              <strong>Performance:</strong> {results.performance.length} benchmarks completed
            </div>
          )}
          
          {results.visual && (
            <div style={{ marginBottom: '15px' }}>
              <strong>Visual Quality:</strong> {results.visual.length} comparisons made
            </div>
          )}
          
          {results.memory && (
            <div style={{ marginBottom: '15px' }}>
              <strong>Memory Analysis:</strong> {results.memory.length} scenarios tested
            </div>
          )}
          
          <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
            <button
              onClick={openReportInNewTab}
              style={{
                padding: '10px 20px',
                background: '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: '600'
              }}
            >
              📊 View Report
            </button>
            
            <button
              onClick={downloadReport}
              style={{
                padding: '10px 20px',
                background: '#2196F3',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: '600'
              }}
            >
              💾 Download Report
            </button>
          </div>
        </div>
      )}
      
      <div style={{
        background: '#fff9c4',
        padding: '15px',
        borderRadius: '8px',
        borderLeft: '4px solid #fbc02d'
      }}>
        <strong>⚠️ Note:</strong> For accurate memory testing in Chrome, enable the flag:<br />
        <code style={{
          background: '#fff',
          padding: '2px 5px',
          borderRadius: '3px',
          fontFamily: 'monospace'
        }}>
          chrome://flags/#enable-precise-memory-info
        </code>
      </div>
    </div>
  );
};

export default TestRunner;
