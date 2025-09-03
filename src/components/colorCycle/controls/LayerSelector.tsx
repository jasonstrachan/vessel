/**
 * LayerSelector - Clean layer selection component with status indicators
 */

import React from 'react';
import { Layer } from '../../../types';

export interface LayerSelectorProps {
  layers: Layer[];
  activeLayer: Layer | null;
  onLayerChange: (layer: Layer) => void;
  mode: 'brush' | 'recolor';
}

export const LayerSelector: React.FC<LayerSelectorProps> = ({
  layers,
  activeLayer,
  onLayerChange,
  mode
}) => {
  const getLayerStatus = (layer: Layer) => {
    if (mode === 'brush') {
      return layer.layerType === 'color-cycle' && layer.colorCycleData?.mode === 'brush'
        ? 'active' : 'available';
    } else {
      if (layer.colorCycleData?.mode === 'recolor' && layer.colorCycleData.recolorSettings?.indexBuffer) {
        return 'processed';
      }
      return 'available';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-blue-400';
      case 'processed': return 'text-green-400';
      default: return 'text-gray-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active': return '●';
      case 'processed': return '✓';
      default: return '○';
    }
  };

  return (
    <div className="layer-selector">
      <label className="block text-sm font-medium text-gray-300 mb-2">
        Layer
      </label>
      
      {layers.length === 0 ? (
        <div className="p-3 bg-gray-700 rounded text-sm text-gray-400 text-center">
          No layers available
        </div>
      ) : (
        <div className="bg-gray-700 rounded-lg border border-gray-600 max-h-32 overflow-y-auto">
          {layers.map((layer) => {
            const status = getLayerStatus(layer);
            const isActive = activeLayer?.id === layer.id;
            
            return (
              <button
                key={layer.id}
                type="button"
                onClick={() => onLayerChange(layer)}
                className={`
                  w-full px-3 py-2 text-left text-sm transition-colors
                  flex items-center justify-between
                  border-b border-gray-600 last:border-b-0
                  ${isActive 
                    ? 'bg-blue-600 text-white' 
                    : 'hover:bg-gray-600 text-gray-300'
                  }
                `}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span 
                    className={`${getStatusColor(status)} text-xs`}
                    title={`Status: ${status}`}
                  >
                    {getStatusIcon(status)}
                  </span>
                  <span className="truncate">{layer.name}</span>
                </div>
                
                <div className="flex items-center gap-1 text-xs text-gray-400">
                  {layer.imageData && (
                    <span>
                      {layer.imageData.width}×{layer.imageData.height}
                    </span>
                  )}
                  {!layer.visible && (
                    <span title="Layer is hidden">👁️‍🗨️</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
      
      {/* Status Legend */}
      <div className="mt-2 text-xs text-gray-500">
        <div className="flex gap-4">
          <span className="flex items-center gap-1">
            <span className="text-gray-400">○</span>
            Available
          </span>
          {mode === 'brush' && (
            <span className="flex items-center gap-1">
              <span className="text-blue-400">●</span>
              Active
            </span>
          )}
          {mode === 'recolor' && (
            <span className="flex items-center gap-1">
              <span className="text-green-400">✓</span>
              Processed
            </span>
          )}
        </div>
      </div>
    </div>
  );
};