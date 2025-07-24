'use client';

import React from 'react';
import { useAppStore } from '../stores/useAppStore';
import { Layer } from '../types';
import { XIcon } from './icons/XIcon';
import Input from './ui/Input';
import { Eye, EyeOff, Lock, Unlock, Plus } from 'lucide-react';

const LayerPanel = () => {
  const { 
    layers, 
    activeLayerId, 
    project,
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
      framebuffer: project ? new OffscreenCanvas(project.width, project.height) : new OffscreenCanvas(2000, 2000)
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
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-medium text-[#D9D9D9]">Layers</h3>
        <button
          onClick={handleAddLayer}
          className="w-6 h-6 text-[#5A5A61] hover:text-[#888888] flex items-center justify-center"
          title="Add Layer"
        >
          <Plus size={16} />
        </button>
      </div>
      
      <div className="space-y-1">
        {layers.slice().reverse().map((layer) => (
          <div
            key={layer.id}
            className={`py-2 px-0 border-b border-[#404040] ${
              activeLayerId === layer.id
                ? 'border-l-2 border-l-blue-500'
                : 'border-l-2 border-l-transparent'
            } hover:bg-[#383838]/20 cursor-pointer`}
            onClick={() => setActiveLayer(layer.id)}
          >
            <div className="flex items-center justify-between px-2">
              <div className="flex items-center space-x-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleVisibility(layer.id);
                  }}
                  className={`w-4 h-4 flex items-center justify-center ${
                    layer.visible ? 'text-[#D9D9D9]' : 'text-[#666]'
                  } hover:text-[#FFFFFF]`}
                  title={layer.visible ? 'Hide Layer' : 'Show Layer'}
                >
                  {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <span className="text-base text-[#D9D9D9] flex-1 truncate">
                  {layer.name}
                </span>
              </div>
              
              <div className="flex items-center space-x-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleLock(layer.id);
                  }}
                  className={`w-4 h-4 flex items-center justify-center ${
                    layer.locked ? 'text-[#D9D9D9]' : 'text-[#666]'
                  } hover:text-[#FFFFFF]`}
                  title={layer.locked ? 'Unlock Layer' : 'Lock Layer'}
                >
                  {layer.locked ? <Lock size={14} /> : <Unlock size={14} />}
                </button>
                
                {layers.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteLayer(layer.id);
                    }}
                    className="w-4 h-4 flex items-center justify-center text-[#666] hover:text-red-500"
                    title="Delete Layer"
                  >
                    <XIcon size={12} />
                  </button>
                )}
              </div>
            </div>
            
            <div className="mt-1 flex items-center space-x-2 px-2">
              <span className="text-base text-[#D9D9D9]">Opacity:</span>
              <Input
                type="range"
                min="0"
                max="100"
                value={Math.round(layer.opacity * 100)}
                onChange={(e) => handleOpacityChange(layer.id, Number(e.target.value))}
                onClick={(e) => e.stopPropagation()}
                fullWidth
              />
              <span className="text-base text-[#D9D9D9] w-10">
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