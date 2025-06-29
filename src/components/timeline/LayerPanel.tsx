'use client';

import { useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';

export const LayerPanel = () => {
  const {
    project,
    currentLayer,
    setCurrentLayer,
    addLayer,
    removeLayer,
    toggleLayerVisibility,
    renameLayer,
  } = useAppStore();
  
  const [editingLayer, setEditingLayer] = useState<number | null>(null);
  const [newLayerName, setNewLayerName] = useState('');

  const handleLayerRename = (layerIndex: number, newName: string) => {
    if (newName.trim()) {
      renameLayer(layerIndex, newName.trim());
    }
    setEditingLayer(null);
    setNewLayerName('');
  };

  const handleAddLayer = () => {
    const name = `Layer ${project.layers.length + 1}`;
    addLayer(name);
  };

  return (
    <div className="w-40 bg-[#2a2a2a] border-r border-[#404040] flex flex-col">
      {/* Header */}
      <div className="h-8 bg-[#3a3a3a] border-b border-[#404040] flex items-center justify-between px-2">
        <span className="text-white text-xs font-medium">LAYERS</span>
        <button
          onClick={handleAddLayer}
          className="text-[#60a5fa] hover:text-white text-xs font-bold"
          title="Add Layer"
        >
          +
        </button>
      </div>

      {/* Layers List */}
      <div className="flex-1 overflow-y-auto">
        {project.layers.map((layer, index) => (
          <div
            key={layer.id}
            className={`h-7 flex items-center px-2 border-b border-[#404040] cursor-pointer
              ${index === currentLayer ? 'bg-[#60a5fa]' : 'hover:bg-[#3a3a3a]'}
            `}
            onClick={() => setCurrentLayer(index)}
          >
            {/* Visibility Toggle */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleLayerVisibility(index);
              }}
              className="mr-2 text-[#888888] hover:text-white w-3 h-3 flex items-center justify-center"
              title="Toggle Visibility"
            >
              {layer.visible ? '●' : '○'}
            </button>

            {/* Layer Name */}
            <div className="flex-1 min-w-0">
              {editingLayer === index ? (
                <input
                  type="text"
                  value={newLayerName}
                  onChange={(e) => setNewLayerName(e.target.value)}
                  onBlur={() => handleLayerRename(index, newLayerName)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleLayerRename(index, newLayerName);
                    } else if (e.key === 'Escape') {
                      setEditingLayer(null);
                      setNewLayerName('');
                    }
                  }}
                  className="w-full px-1 py-0 bg-[#1a1a1a] text-white text-xs border-none outline-none"
                  autoFocus
                />
              ) : (
                <span
                  className="text-white text-xs truncate block"
                  onDoubleClick={() => {
                    setEditingLayer(index);
                    setNewLayerName(layer.name);
                  }}
                  title={layer.name}
                >
                  {layer.name}
                </span>
              )}
            </div>

            {/* Delete Button */}
            {project.layers.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete layer "${layer.name}"?`)) {
                    removeLayer(index);
                  }
                }}
                className="ml-1 text-[#888888] hover:text-red-400 text-xs"
                title="Delete Layer"
              >
                ×
              </button>
            )}
          </div>
        ))}

        {/* Empty State */}
        {project.layers.length === 0 && (
          <div className="p-3 text-center text-[#888888] text-xs">
            No layers. Click + to add one.
          </div>
        )}
      </div>
    </div>
  );
};