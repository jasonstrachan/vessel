'use client';

import { useState, useEffect } from 'react';
import { useUserBrushEngine } from '../hooks/useUserBrushEngine';
import { useAppStore } from '../stores/useAppStore';
import { BrushPreset } from '../types';

/**
 * Test component for the modular brush plugin system
 * Add this to your main page to test plugin brushes
 */
export function TestPluginBrushes() {
  const userBrushEngine = useUserBrushEngine();
  const currentBrushPreset = useAppStore(state => state.currentBrushPreset);
  const selectBrushPreset = useAppStore(state => state.selectBrushPreset);
  const [pluginBrushes, setPluginBrushes] = useState<any[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [testCanvas, setTestCanvas] = useState<HTMLCanvasElement | null>(null);

  // Load plugin brushes on mount
  useEffect(() => {
    const loadPlugins = async () => {
      try {
        console.log('Loading plugin brushes...');
        
        // Check if brushes are already loaded to avoid re-registration
        const existingBrushes = userBrushEngine.getAllUserBrushes();
        if (existingBrushes.length > 0) {
          console.log('✅ Plugin brushes already loaded:', existingBrushes);
          setPluginBrushes(existingBrushes);
          setIsLoaded(true);
          return;
        }
        
        // Load all built-in plugin brushes
        await userBrushEngine.registry.loadAllBuiltinBrushes();
        
        // Get loaded brushes
        const brushes = userBrushEngine.getAllUserBrushes();
        setPluginBrushes(brushes);
        setIsLoaded(true);
        
        console.log('✅ Loaded plugin brushes:', brushes);
      } catch (error) {
        console.error('❌ Failed to load plugin brushes:', error);
        // Try to get any existing brushes
        const existingBrushes = userBrushEngine.getAllUserBrushes();
        if (existingBrushes.length > 0) {
          setPluginBrushes(existingBrushes);
          setIsLoaded(true);
        }
      }
    };

    loadPlugins();
  }, [userBrushEngine]);

  // Create test canvas for demonstration
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 100;
    canvas.style.border = '1px solid #444';
    canvas.style.background = 'white';
    setTestCanvas(canvas);
  }, []);

  // Test drawing with a plugin brush
  const testBrushDrawing = (brushId: string) => {
    if (!testCanvas) return;
    
    const ctx = testCanvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, testCanvas.width, testCanvas.height);
    
    // Activate the plugin brush
    userBrushEngine.setActiveBrush(brushId);
    
    // Draw a test stroke
    const points = [];
    for (let i = 0; i < 20; i++) {
      points.push({
        x: 20 + i * 8,
        y: 50 + Math.sin(i * 0.5) * 20,
        pressure: 0.5 + Math.sin(i * 0.3) * 0.5
      });
    }
    
    userBrushEngine.drawStroke(ctx, points);
    
    console.log(`✅ Drew test stroke with ${brushId}`);
  };

  // Create a mock brush preset for plugin brushes
  const activatePluginBrush = (brushId: string, brushName: string) => {
    // Create a pseudo-preset for the plugin brush
    const pluginPreset: BrushPreset = {
      id: brushId,
      name: brushName,
      category: 'Plugin',
      components: [], // Plugin brushes don't use components
      thumbnail: '',
      tags: ['plugin'],
      isDefault: false,
      createdAt: new Date(),
      modifiedAt: new Date(),
      isCustomBrush: true, // Mark as custom/plugin
    };
    
    // Set it as current brush using the selectBrushPreset action
    selectBrushPreset(pluginPreset);
    
    console.log(`✅ Activated plugin brush: ${brushName}`);
  };

  return (
    <div className="fixed bottom-4 right-4 bg-gray-900 p-4 rounded-lg shadow-lg z-50 max-w-sm">
      <h3 className="text-white font-bold mb-3">🧪 Plugin Brush Test Panel</h3>
      
      {/* Loading Status */}
      <div className="mb-3">
        <span className="text-sm text-gray-400">Status: </span>
        <span className={`text-sm font-bold ${isLoaded ? 'text-green-400' : 'text-yellow-400'}`}>
          {isLoaded ? '✅ Plugins Loaded' : '⏳ Loading...'}
        </span>
      </div>

      {/* Loaded Brushes List */}
      <div className="mb-3">
        <p className="text-sm text-gray-400 mb-2">Available Plugin Brushes:</p>
        <div className="space-y-2">
          {pluginBrushes.map((brush) => (
            <div key={brush.id} className="bg-gray-800 p-2 rounded">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-white text-sm font-medium">{brush.name}</p>
                  <p className="text-gray-400 text-xs">{brush.description}</p>
                </div>
                <button
                  onClick={() => {
                    activatePluginBrush(brush.id, brush.name);
                    testBrushDrawing(brush.id);
                  }}
                  className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                >
                  Test
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Test Canvas */}
      {testCanvas && (
        <div className="mb-3">
          <p className="text-sm text-gray-400 mb-2">Test Canvas:</p>
          <div ref={(el) => el && el.appendChild(testCanvas)} />
        </div>
      )}

      {/* Current Brush Info */}
      <div className="text-xs text-gray-400 border-t border-gray-700 pt-2">
        <p>Current Brush: {currentBrushPreset?.name || 'None'}</p>
        <p>Is Plugin: {currentBrushPreset && userBrushEngine.isUserBrush(currentBrushPreset.id) ? 'Yes' : 'No'}</p>
      </div>

      {/* Instructions */}
      <div className="mt-3 p-2 bg-gray-800 rounded">
        <p className="text-xs text-gray-300">
          <strong>How to test:</strong><br/>
          1. Click &quot;Test&quot; to draw with plugin brush<br/>
          2. Use main canvas with activated brush<br/>
          3. Check console for debug info<br/>
          4. Plugin brushes work alongside defaults!
        </p>
      </div>
    </div>
  );
}

export default TestPluginBrushes;