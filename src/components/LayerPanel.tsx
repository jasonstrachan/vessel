'use client';

import React from 'react';
import { useAppStore } from '../stores/useAppStore';
import { Layer } from '../types';
import { XIcon } from './icons/XIcon';

const LayerPanel = () => {
  const { 
    layers, 
    activeLayerId, 
    addLayer, 
    removeLayer, 
    updateLayer, 
    setActiveLayer 
  } = useAppStore();

  const handleAddLayer = () => {
    const newLayer: Omit<Layer, 'id' | 'order'> = {
      name: `Layer ${layers.length + 1}`,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      imageData: null,
      framebuffer: new OffscreenCanvas(800, 600)
    };
    addLayer(newLayer);
  };

  const handleDeleteLayer = (layerId: string) => {
    if (layers.length > 1) {
      removeLayer(layerId);
    }
  };

  const handleToggleVisibility = (layerId: string) => {
    const layer = layers.find(l => l.id === layerId);
    if (layer) {
      updateLayer(layerId, { visible: !layer.visible });
    }
  };

  const handleToggleLock = (layerId: string) => {
    const layer = layers.find(l => l.id === layerId);
    if (layer) {
      updateLayer(layerId, { locked: !layer.locked });
    }
  };

  const handleOpacityChange = (layerId: string, opacity: number) => {
    updateLayer(layerId, { opacity: opacity / 100 });
  };

  return (
    <div className="bg-[#2d2d2d] border-b border-[#404040] p-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-300">Layers</h3>
        <button
          onClick={handleAddLayer}
          className="w-6 h-6 bg-[#404040] hover:bg-[#505050] rounded text-xs flex items-center justify-center"
          title="Add Layer"
        >
          +
        </button>
      </div>
      
      <div className="space-y-1">
        {layers.slice().reverse().map((layer) => (
          <div
            key={layer.id}
            className={`p-2 rounded border ${
              activeLayerId === layer.id
                ? 'bg-[#404040] border-[#606060]'
                : 'bg-[#353535] border-[#404040] hover:bg-[#383838]'
            }`}
            onClick={() => setActiveLayer(layer.id)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleVisibility(layer.id);
                  }}
                  className={`w-4 h-4 rounded text-xs ${
                    layer.visible ? 'bg-blue-500' : 'bg-gray-600'
                  }`}
                  title={layer.visible ? 'Hide Layer' : 'Show Layer'}
                >
                  {layer.visible ? '👁' : '👁‍🗨'}
                </button>
                <span className="text-xs text-gray-300 flex-1 truncate">
                  {layer.name}
                </span>
              </div>
              
              <div className="flex items-center space-x-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleLock(layer.id);
                  }}
                  className={`w-4 h-4 rounded text-xs ${
                    layer.locked ? 'bg-red-500' : 'bg-gray-600'
                  }`}
                  title={layer.locked ? 'Unlock Layer' : 'Lock Layer'}
                >
                  {layer.locked ? '🔒' : '🔓'}
                </button>
                
                {layers.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteLayer(layer.id);
                    }}
                    className="w-4 h-4 bg-red-600 hover:bg-red-700 rounded text-xs"
                    title="Delete Layer"
                  >
                    <XIcon size={12} className="text-white" />
                  </button>
                )}
              </div>
            </div>
            
            <div className="mt-1 flex items-center space-x-2">
              <span className="text-xs text-gray-400">Opacity:</span>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(layer.opacity * 100)}
                onChange={(e) => handleOpacityChange(layer.id, Number(e.target.value))}
                className="flex-1 h-1 bg-gray-600 rounded appearance-none"
                onClick={(e) => e.stopPropagation()}
              />
              <span className="text-xs text-gray-400 w-8">
                {Math.round(layer.opacity * 100)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default LayerPanel;