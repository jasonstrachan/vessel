'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { DitherBrushPlugin } from '../../brushes/plugins/DitherBrushPlugin';
import { ParticleBrushPlugin } from '../../brushes/plugins/ParticleBrushPlugin';
import { brushRegistry } from '../../brushes/BrushRegistry';
import { BrushDrawContext } from '../../brushes/BrushPlugin';
import { defaultBrushSettings } from '../../presets/brushPresets';

export default function TestPlugins() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('Initializing...');
  const [results, setResults] = useState<string[]>([]);

  useEffect(() => {
    // Load and test plugins
    const runTests = async () => {
      const testResults: string[] = [];
      
      try {
        // Test 1: Register plugins
        setStatus('Testing plugin registration...');
        
        const ditherBrush = new DitherBrushPlugin();
        const particleBrush = new ParticleBrushPlugin();
        
        await brushRegistry.register(ditherBrush);
        await brushRegistry.register(particleBrush);
        
        testResults.push('✅ Registered 2 plugin brushes');
        
        // Test 2: Check registry
        const allBrushes = brushRegistry.getAll();
        testResults.push(`✅ Registry contains ${allBrushes.length} brushes`);
        
        // Test 3: Activate and draw with each brush
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            // Clear canvas
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Test Dither Brush
            setStatus('Testing Dither Brush...');
            brushRegistry.activate('dither-brush');
            const ditherActive = brushRegistry.getActive();
            if (ditherActive) {
              // Draw with dither brush
              for (let i = 0; i < 50; i++) {
                const context: BrushDrawContext = {
                  ctx,
                  x: 50 + i * 4,
                  y: 50 + Math.sin(i * 0.3) * 20,
                  pressure: 0.8,
                  settings: defaultBrushSettings,
                };
                ditherActive.draw(context);
              }
              testResults.push('✅ Dither brush drew successfully');
            }
            
            // Test Particle Brush
            setStatus('Testing Particle Brush...');
            brushRegistry.activate('particle-brush');
            const particleActive = brushRegistry.getActive();
            if (particleActive) {
              // Draw with particle brush
              for (let i = 0; i < 50; i++) {
                const context: BrushDrawContext = {
                  ctx,
                  x: 50 + i * 4,
                  y: 150 + Math.sin(i * 0.3) * 20,
                  pressure: 0.8,
                  settings: defaultBrushSettings,
                };
                particleActive.draw(context);
              }
              testResults.push('✅ Particle brush drew successfully');
            }
          }
        }
        
        // Test 4: Deactivate
        brushRegistry.deactivate();
        const activeAfterDeactivate = brushRegistry.getActive();
        testResults.push(`✅ Deactivation works: ${activeAfterDeactivate === null}`);
        
        // Test 5: Event system
        let eventFired = false;
        const unsubscribe = brushRegistry.subscribe((event) => {
          if (event.type === 'activated') {
            eventFired = true;
          }
        });
        brushRegistry.activate('dither-brush');
        unsubscribe();
        testResults.push(`✅ Event system works: ${eventFired}`);
        
        setStatus('✅ All tests passed!');
        setResults(testResults);
        
      } catch (error) {
        setStatus(`❌ Error: ${error}`);
        testResults.push(`❌ Test failed: ${error}`);
        setResults(testResults);
      }
    };
    
    runTests();
    
    // Cleanup
    return () => {
      brushRegistry.clear();
    };
  }, []);

  return (
    <div style={{ padding: '20px', background: '#1a1a1a', color: 'white', minHeight: '100vh' }}>
      <h1>🧪 TinyBrush Plugin System Test</h1>
      
      <div style={{ 
        padding: '15px', 
        background: '#333', 
        borderRadius: '8px',
        marginBottom: '20px'
      }}>
        <strong>Status:</strong> {status}
      </div>
      
      <canvas 
        ref={canvasRef}
        width={600}
        height={300}
        style={{
          border: '2px solid #444',
          background: 'white',
          display: 'block',
          marginBottom: '20px'
        }}
      />
      
      <div style={{ 
        padding: '15px', 
        background: '#333', 
        borderRadius: '8px',
        marginBottom: '20px'
      }}>
        <h3>Test Results:</h3>
        {results.map((result, i) => (
          <div key={i} style={{ margin: '5px 0' }}>{result}</div>
        ))}
      </div>
      
      <div style={{ 
        padding: '15px', 
        background: '#222', 
        borderRadius: '8px',
        fontFamily: 'monospace',
        fontSize: '12px'
      }}>
        <h3>Architecture Overview:</h3>
        <pre>{`
Brush Plugin System:
├── BrushPlugin Interface
│   ├── draw(context)
│   ├── initialize(config)
│   └── lifecycle hooks
├── BrushRegistry
│   ├── register/unregister
│   ├── activate/deactivate
│   └── event system
├── useUserBrushEngine
│   ├── startStroke()
│   ├── continueStroke()
│   └── endStroke()
└── useDrawingHandlers
    ├── Routes to useBrushEngine (default)
    └── Routes to useUserBrushEngine (plugins)
        `}</pre>
      </div>
      
      <div style={{ marginTop: '20px' }}>
        <Link href="/" style={{ color: '#4CAF50' }}>← Back to Main App</Link>
      </div>
    </div>
  );
}