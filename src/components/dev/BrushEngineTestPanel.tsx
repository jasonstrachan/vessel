/**
 * Visual test panel for comparing brush engine implementations
 * Shows side-by-side comparison of old vs new
 */

import React, { useRef, useEffect, useState } from 'react';
// Import the raw implementations directly to bypass the adapter
import { useBrushEngine } from '@/hooks/useBrushEngine';
import { useBrushEngineSimplified } from '@/hooks/useBrushEngineSimplified';

export const BrushEngineTestPanel: React.FC = () => {
  const oldCanvasRef = useRef<HTMLCanvasElement>(null);
  const newCanvasRef = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 500, y: 60 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [testResults, setTestResults] = useState<{
    test: string;
    oldTime: number;
    newTime: number;
    difference: string;
  }[]>([]);
  
  const oldEngine = useBrushEngine();
  const newEngine = useBrushEngineSimplified();
  
  // Only render in development
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }
  
  const runTest = (testName: string, testFn: (engine: any, ctx: CanvasRenderingContext2D) => void) => {
    const oldCtx = oldCanvasRef.current?.getContext('2d');
    const newCtx = newCanvasRef.current?.getContext('2d');
    
    if (!oldCtx || !newCtx) return;
    
    // Clear canvases
    oldCtx.clearRect(0, 0, 300, 300);
    newCtx.clearRect(0, 0, 300, 300);
    
    // Run old implementation
    const oldStart = performance.now();
    testFn(oldEngine, oldCtx);
    const oldTime = performance.now() - oldStart;
    
    // Run new implementation
    const newStart = performance.now();
    testFn(newEngine, newCtx);
    const newTime = performance.now() - newStart;
    
    // Calculate difference
    const diff = ((newTime - oldTime) / oldTime * 100).toFixed(1);
    const difference = newTime > oldTime ? `+${diff}%` : `${diff}%`;
    
    // Update results
    setTestResults(prev => [...prev, {
      test: testName,
      oldTime,
      newTime,
      difference
    }]);
  };
  
  const runAllTests = () => {
    setTestResults([]);
    
    // Test 1: Simple stroke
    runTest('Simple Stroke', (engine, ctx) => {
      // Old engine uses renderBrushStroke, new uses drawBrush
      if (engine.renderBrushStroke) {
        engine.renderBrushStroke(ctx, { x: 50, y: 50 }, { x: 250, y: 250 }, { pressure: 1 });
      } else if (engine.drawBrush) {
        engine.drawBrush(ctx, { x: 50, y: 50 }, { x: 250, y: 250 }, { pressure: 1 });
      }
    });
    
    // Test 2: Multiple strokes
    setTimeout(() => {
      runTest('Multiple Strokes', (engine, ctx) => {
        for (let i = 0; i < 10; i++) {
          const y = 30 + i * 25;
          if (engine.renderBrushStroke) {
            engine.renderBrushStroke(ctx, { x: 30, y }, { x: 270, y }, { pressure: 0.5 + i * 0.05 });
          } else if (engine.drawBrush) {
            engine.drawBrush(ctx, { x: 30, y }, { x: 270, y }, { pressure: 0.5 + i * 0.05 });
          }
        }
      });
    }, 100);
    
    // Test 3: Pressure variation
    setTimeout(() => {
      runTest('Pressure Variation', (engine, ctx) => {
        const points = [];
        for (let i = 0; i <= 20; i++) {
          const t = i / 20;
          const x = 50 + t * 200;
          const y = 150 + Math.sin(t * Math.PI * 2) * 50;
          const pressure = 0.3 + t * 0.7;
          
          if (i > 0) {
            if (engine.renderBrushStroke) {
              engine.renderBrushStroke(ctx, points[i - 1], { x, y }, { pressure });
            } else if (engine.drawBrush) {
              engine.drawBrush(ctx, points[i - 1], { x, y }, { pressure });
            }
          }
          points.push({ x, y });
        }
      });
    }, 200);
    
    // Test 4: Grid snapping
    setTimeout(() => {
      runTest('Grid Snapping', (engine, ctx) => {
        // Would need to enable grid snapping in settings
        for (let x = 20; x < 280; x += 40) {
          for (let y = 20; y < 280; y += 40) {
            if (engine.renderBrushStroke) {
              engine.renderBrushStroke(ctx, { x, y }, { x: x + 30, y: y + 30 }, { pressure: 1 });
            } else if (engine.drawBrush) {
              engine.drawBrush(ctx, { x, y }, { x: x + 30, y: y + 30 }, { pressure: 1 });
            }
          }
        }
      });
    }, 300);
  };
  
  // Handle dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only drag from the header
    if ((e.target as HTMLElement).classList.contains('drag-handle')) {
      setIsDragging(true);
      setDragStart({
        x: e.clientX - position.x,
        y: e.clientY - position.y
      });
      e.preventDefault();
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragStart]);

  useEffect(() => {
    // Position panel on the right side after mount
    setPosition({ x: window.innerWidth - 720, y: 60 });
    // Auto-run tests on mount
    setTimeout(runAllTests, 500);
  }, []);
  
  return (
    <div 
      ref={panelRef}
      onMouseDown={handleMouseDown}
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        background: 'white',
        border: '2px solid #333',
        borderRadius: '8px',
        zIndex: 9998,
        maxWidth: '700px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        color: 'black',
        cursor: isDragging ? 'grabbing' : 'default',
        userSelect: isDragging ? 'none' : 'auto'
      }}
    >
      <div 
        className="drag-handle"
        style={{ 
          padding: '12px 16px',
          borderBottom: '1px solid #e5e5e5',
          cursor: 'grab',
          background: '#f9f9f9',
          borderRadius: '6px 6px 0 0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold', color: 'black' }}>
          🧪 Brush Engine Comparison
        </h3>
        <span style={{ fontSize: '11px', color: '#666' }}>
          (Drag to move)
        </span>
      </div>
      
      <div style={{ padding: '16px' }}>
      
      <div style={{ display: 'flex', gap: '16px', marginBottom: '12px' }}>
        <div>
          <h4 style={{ margin: '0 0 4px 0', fontSize: '12px', color: 'black' }}>Old Implementation</h4>
          <canvas
            ref={oldCanvasRef}
            width={300}
            height={300}
            style={{
              border: '1px solid #ccc',
              background: 'white'
            }}
          />
        </div>
        
        <div>
          <h4 style={{ margin: '0 0 4px 0', fontSize: '12px', color: 'black' }}>New Implementation</h4>
          <canvas
            ref={newCanvasRef}
            width={300}
            height={300}
            style={{
              border: '1px solid #ccc',
              background: 'white'
            }}
          />
        </div>
      </div>
      
      <button
        onClick={runAllTests}
        style={{
          padding: '8px 16px',
          background: '#3b82f6',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          marginBottom: '12px',
          fontSize: '14px',
          fontWeight: 'bold'
        }}
      >
        Run Tests
      </button>
      
      {testResults.length > 0 && (
        <div style={{ fontSize: '12px', fontFamily: 'monospace', color: 'black' }}>
          <h4 style={{ margin: '8px 0 4px 0', fontSize: '12px', fontWeight: 'bold', color: 'black' }}>
            Performance Results:
          </h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', color: 'black' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #ccc' }}>
                <th style={{ textAlign: 'left', padding: '4px', color: 'black' }}>Test</th>
                <th style={{ textAlign: 'right', padding: '4px', color: 'black' }}>Old (ms)</th>
                <th style={{ textAlign: 'right', padding: '4px', color: 'black' }}>New (ms)</th>
                <th style={{ textAlign: 'right', padding: '4px', color: 'black' }}>Diff</th>
              </tr>
            </thead>
            <tbody>
              {testResults.map((result, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '4px', color: 'black' }}>{result.test}</td>
                  <td style={{ textAlign: 'right', padding: '4px', color: 'black' }}>
                    {result.oldTime.toFixed(2)}
                  </td>
                  <td style={{ textAlign: 'right', padding: '4px', color: 'black' }}>
                    {result.newTime.toFixed(2)}
                  </td>
                  <td style={{
                    textAlign: 'right',
                    padding: '4px',
                    color: result.difference.startsWith('+') ? '#dc2626' : '#059669',
                    fontWeight: 'bold'
                  }}>
                    {result.difference}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          <div style={{ marginTop: '8px', fontSize: '11px', color: 'black', opacity: 0.7 }}>
            Note: Visual output should be identical. Performance may vary.
          </div>
        </div>
      )}
      </div>
    </div>
  );
};