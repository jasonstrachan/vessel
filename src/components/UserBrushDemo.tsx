'use client';

import { debugLog, logError } from '@/utils/debug';
import { useEffect } from 'react';
import { useUserBrushEngine } from '../hooks/useUserBrushEngine';

/**
 * Demo component showing how to register and use user brush plugins
 */
export function UserBrushDemo() {
  const userBrushEngine = useUserBrushEngine();

  useEffect(() => {
    // Load built-in plugin brushes
    const loadBuiltinBrushes = async () => {
      try {
        // Load all built-in brushes using the registry's safe loading method
        await userBrushEngine.registry.loadAllBuiltinBrushes();
        
        // Get all registered brushes
        const allBrushes = userBrushEngine.getAllUserBrushes();
        debugLog('raw-console', 'Loaded user brushes:', allBrushes);
      } catch (error) {
        logError('Failed to load built-in brushes:', error);
      }
    };

    loadBuiltinBrushes();

    // Cleanup on unmount
    return () => {
      userBrushEngine.unregisterBrush('dither-brush');
      userBrushEngine.unregisterBrush('particle-brush');
    };
  }, [userBrushEngine]);

  return (
    <div className="p-4 bg-gray-800 rounded-lg">
      <h3 className="text-white mb-2">User Brush Plugins Loaded</h3>
      <div className="space-y-2">
        {userBrushEngine.getAllUserBrushes().map(brush => (
          <div key={brush.id} className="text-gray-300 text-sm">
            <strong>{brush.name}</strong>: {brush.description}
          </div>
        ))}
      </div>
      <p className="text-gray-400 text-xs mt-4">
        To use: Add these brushes to the brush library UI for selection
      </p>
    </div>
  );
}

export default UserBrushDemo;