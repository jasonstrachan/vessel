/**
 * UI integration component for color cycle functionality
 * Integrates RecolorPanel with existing Vessel UI structure
 */

import React, { useEffect, useState, useCallback } from 'react';
import type { Layer } from '@/types';
import { useAppStore } from '../../../stores/useAppStore';
import { AppIntegration } from '../../../lib/colorCycle/integration/AppIntegration';
import type { RecolorOptions } from '../../../lib/colorCycle/RecolorManager';
import { RecolorPanel } from '../RecolorPanel';
import { ColorCycleErrorBoundary } from '../error/ColorCycleErrorBoundary';
import { AccessibilityProvider } from '../accessibility/AccessibilityProvider';

interface ColorCycleUIProps {
  isVisible?: boolean;
  onToggleVisibility?: (visible: boolean) => void;
}

export const ColorCycleUI: React.FC<ColorCycleUIProps> = ({ 
  isVisible = false, 
  onToggleVisibility 
}) => {
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBrowser, setIsBrowser] = useState(false);

  // App store selectors
  const activeLayerId = useAppStore((state) => state.activeLayerId);
  const layers = useAppStore((state) => state.layers);

  // Find active layer
  const activeLayer = layers.find(layer => layer.id === activeLayerId) || null;

  // Check if we're in browser environment
  useEffect(() => {
    setIsBrowser(typeof window !== 'undefined');
  }, []);

  // Initialize integration only in browser
  useEffect(() => {
    if (!isBrowser) return;

    const initializeIntegration = async () => {
      try {
        const appIntegration = AppIntegration.getInstance();
        await appIntegration.initialize();
        setInitialized(true);
        setError(null);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to initialize color cycling';
        setError(errorMessage);
        console.error('Color cycle initialization failed:', err);
      }
    };

    initializeIntegration();
  }, [isBrowser]);

  // Handle panel close
  const handleClose = useCallback(() => {
    if (onToggleVisibility) {
      onToggleVisibility(false);
    }
  }, [onToggleVisibility]);

  // Handle errors from RecolorPanel
  const handlePanelError = useCallback((errorMessage: string) => {
    setError(errorMessage);
    console.error('RecolorPanel error:', errorMessage);
  }, []);

  // Don't render if not visible
  if (!isVisible) {
    return null;
  }

  // Don't render during SSR
  if (!isBrowser) {
    return null;
  }

  // Show error state
  if (error && !initialized) {
    return (
      <div className="color-cycle-ui bg-gray-800 border border-gray-600 rounded-lg p-6 w-80 text-white">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">!</span>
          </div>
          <h3 className="text-lg font-semibold">Color cycle + recolor unavailable</h3>
        </div>
        
        <div className="mb-4">
          <p className="text-sm text-gray-300 mb-2">{error}</p>
          <div className="text-xs text-gray-400">
            This may be due to browser compatibility issues or system limitations.
          </div>
        </div>
        
        <button
          onClick={handleClose}
          className="w-full px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded text-white text-sm transition-colors"
        >
          Close
        </button>
      </div>
    );
  }

  // Show loading state
  if (!initialized) {
    return (
      <div className="color-cycle-ui bg-gray-800 border border-gray-600 rounded-lg p-6 w-80 text-white">
        <div className="flex items-center gap-3">
          <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
          <div>
            <h3 className="text-lg font-semibold">Initializing Color cycle + recolor</h3>
            <p className="text-sm text-gray-300">Setting up browser optimizations...</p>
          </div>
        </div>
      </div>
    );
  }

  // Main UI
  return (
    <ColorCycleErrorBoundary
      onError={(error, errorInfo) => {
        console.error('Color Cycle Error:', error, errorInfo);
        setError(`Component error: ${error.message}`);
      }}
    >
      <AccessibilityProvider>
        <div className="color-cycle-ui">
          <RecolorPanel
            activeLayer={activeLayer}
            isVisible={true}
            onError={handlePanelError}
          />
          {error && (
            <div className="mt-2 p-2 bg-yellow-900/30 border border-yellow-500 rounded text-yellow-300 text-xs">
              {error}
            </div>
          )}
        </div>
      </AccessibilityProvider>
    </ColorCycleErrorBoundary>
  );
};

/**
 * Toggle button component for adding to existing toolbar
 */
export interface ColorCycleToggleProps {
  isActive: boolean;
  onClick: () => void;
  disabled?: boolean;
}

export const ColorCycleToggle: React.FC<ColorCycleToggleProps> = ({ 
  isActive, 
  onClick, 
  disabled = false 
}) => {
  const activeLayerId = useAppStore((state) => state.activeLayerId);
  const layers = useAppStore((state) => state.layers);
  const activeLayer = layers.find(layer => layer.id === activeLayerId);
  
  const hasRecolorCapability = Boolean(activeLayer?.colorCycleData?.canvas);

  return (
    <button
      onClick={onClick}
      disabled={disabled || !hasRecolorCapability}
      className={`
        flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors
        ${isActive 
          ? 'bg-purple-600 text-white shadow-md' 
          : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
        }
        ${(disabled || !hasRecolorCapability)
          ? 'opacity-50 cursor-not-allowed'
          : 'cursor-pointer'
        }
      `}
      title={
        !hasRecolorCapability 
          ? 'Select a layer with content to use Color cycle + recolor' 
          : 'Toggle Color cycle + recolor panel'
      }
    >
      <div className={`w-3 h-3 rounded-full ${
        isActive ? 'bg-purple-200' : 'bg-gray-500'
      } animate-pulse`} />
      <span>Color cycle + recolor</span>
    </button>
  );
};

/**
 * Status indicator component for showing color cycle health
 */
export const ColorCycleStatus: React.FC = () => {
  const [integration] = useState(() => AppIntegration.getInstance());
  const [status, setStatus] = useState(integration.getStatus());

  useEffect(() => {
    const updateStatus = () => {
      setStatus(integration.getStatus());
    };

    // Update status every 2 seconds
    const interval = setInterval(updateStatus, 2000);
    
    return () => clearInterval(interval);
  }, [integration]);

  if (!status.initialized || status.activeRecolorLayers === 0) {
    return null;
  }

  const hasIssues = status.issues.length > 0;

  return (
    <div className={`
      flex items-center gap-2 px-2 py-1 rounded text-xs
      ${hasIssues ? 'bg-yellow-900/30 text-yellow-300' : 'bg-green-900/30 text-green-300'}
    `}>
      <div className={`w-2 h-2 rounded-full ${
        hasIssues ? 'bg-yellow-400' : 'bg-green-400'
      } animate-pulse`} />
      
      <span>
        {status.activeRecolorLayers} recolor layer{status.activeRecolorLayers !== 1 ? 's' : ''}
      </span>
      
      {hasIssues && (
        <div className="ml-1" title={status.issues.join(', ')}>
          ⚠️
        </div>
      )}
    </div>
  );
};

/**
 * Hook for integrating with existing app components
 */
export const useColorCycleIntegration = () => {
  const [integration] = useState(() => AppIntegration.getInstance());
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        await integration.initialize();
        setInitialized(true);
      } catch (error) {
        console.error('Failed to initialize color cycle integration:', error);
      }
    };

    init();
  }, [integration]);

  const convertLayer = useCallback(async (layer: Layer, options?: Partial<RecolorOptions>) => {
    if (!initialized) throw new Error('Integration not initialized');
    return integration.convertLayerOptimized(layer, options);
  }, [integration, initialized]);

  const canConvert = useCallback((layer: Layer) => {
    if (!initialized) return { canConvert: false, reason: 'Not initialized' };
    return integration.canConvertLayer(layer);
  }, [integration, initialized]);

  const getRecommendedSettings = useCallback(() => {
    return integration.getRecommendedSettings();
  }, [integration]);

  const getStatus = useCallback(() => {
    return integration.getStatus();
  }, [integration]);

  return {
    initialized,
    convertLayer,
    canConvert,
    getRecommendedSettings,
    getStatus,
    integration
  };
};
