// Debug panel for testing save/load functionality
// Only visible in development mode

import React, { useState } from 'react';
import { runFullDebugCheck } from '../utils/debugUtils';

interface DebugResult {
  overallHealth: 'good' | 'warning' | 'error';
  summary: string[];
  timestamp: string;
}

const DebugPanel: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState<DebugResult | null>(null);

  const runDebugCheck = async () => {
    setIsRunning(true);
    try {
      const result = await runFullDebugCheck();
      setLastResult({
        overallHealth: result.overallHealth,
        summary: result.summary,
        timestamp: new Date().toLocaleTimeString()
      });
      
    } catch (error) {
      setLastResult({
        overallHealth: 'error',
        summary: [`Debug check failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
        timestamp: new Date().toLocaleTimeString()
      });
    } finally {
      setIsRunning(false);
    }
  };

  // Only render in development
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  const healthColor = lastResult?.overallHealth === 'good' ? 'text-green-400' : 
                      lastResult?.overallHealth === 'warning' ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="fixed top-4 left-4 z-50">
      {/* Toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded text-sm font-mono"
        title="Debug Panel"
      >
        {isOpen ? '❌' : '🔧'} Debug
      </button>

      {/* Debug panel */}
      {isOpen && (
        <div className="mt-2 bg-gray-900 border border-gray-600 rounded-lg p-4 w-80 max-h-96 overflow-y-auto">
          <div className="text-white text-sm">
            <h3 className="font-bold mb-3 text-purple-400">TinyBrush Debug Panel</h3>
            
            {/* Run debug check button */}
            <button
              onClick={runDebugCheck}
              disabled={isRunning}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white px-3 py-1 rounded text-xs mb-3 w-full"
            >
              {isRunning ? 'Running...' : 'Run Debug Check'}
            </button>

            {/* Last result */}
            {lastResult && (
              <div className="mb-3">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-gray-400 text-xs">Last Check:</span>
                  <span className="text-gray-400 text-xs">{lastResult.timestamp}</span>
                </div>
                
                <div className={`text-xs font-mono ${healthColor} mb-2`}>
                  Status: {lastResult.overallHealth.toUpperCase()}
                </div>
                
                <div className="text-xs space-y-1">
                  {lastResult.summary.map((item, index) => (
                    <div key={index} className="text-gray-300 font-mono">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick actions */}
            <div className="space-y-2 pt-2 border-t border-gray-600">
              <button
                onClick={() => {
                  if (typeof window !== 'undefined' && (window as any).tinybrushDebug) {
                    (window as any).tinybrushDebug.debugProjectState();
                  }
                }}
                className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded text-xs w-full"
              >
                Check Project State
              </button>
              
              <button
                onClick={() => {
                  if (typeof window !== 'undefined' && (window as any).tinybrushDebug) {
                    (window as any).tinybrushDebug.debugCanvasState();
                  }
                }}
                className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded text-xs w-full"
              >
                Check Canvas State
              </button>
              
              <button
                onClick={() => {
                  if (typeof window !== 'undefined' && (window as any).tinybrushDebug) {
                    (window as any).tinybrushDebug.debugSaveOperation();
                  }
                }}
                className="bg-orange-600 hover:bg-orange-700 text-white px-2 py-1 rounded text-xs w-full"
              >
                Test Save Operation
              </button>
              
              <button
                onClick={() => {
                  if (typeof window !== 'undefined' && (window as any).tinybrushDebug) {
                    (window as any).tinybrushDebug.debugLoadOperation();
                  }
                }}
                className="bg-orange-600 hover:bg-orange-700 text-white px-2 py-1 rounded text-xs w-full"
              >
                Test Load Operation
              </button>
            </div>

            {/* Console hint */}
            <div className="mt-3 pt-2 border-t border-gray-600 text-xs text-gray-400">
              <div>Console commands:</div>
              <div className="font-mono text-yellow-400">window.tinybrushDebug.*</div>
              <div className="font-mono text-yellow-400">window.tinybrushDebugCanvas.*</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DebugPanel;