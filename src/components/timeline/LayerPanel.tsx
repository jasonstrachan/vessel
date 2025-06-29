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
    <div className="w-48 bg-slate-800 border-r border-slate-700 flex flex-col">
      {/* Header */}
      <div className="h-8 bg-slate-700 border-b border-slate-600 flex items-center justify-between px-2">
        <span className="text-white text-xs font-semibold">Layers</span>
        <button
          onClick={handleAddLayer}
          className="text-green-400 hover:text-green-300 text-xs"
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
            className={`h-8 flex items-center px-2 border-b border-slate-700 cursor-pointer
              ${index === currentLayer ? 'bg-blue-600' : 'hover:bg-slate-700'}
            `}
            onClick={() => setCurrentLayer(index)}
          >
            {/* Visibility Toggle */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleLayerVisibility(index);
              }}
              className="mr-2 text-slate-400 hover:text-white"
              title="Toggle Visibility"
            >
              {layer.visible ? '👁️' : '🙈'}
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
                  className="w-full px-1 py-0 bg-slate-600 text-white text-xs border-none outline-none"
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
                className="ml-2 text-red-400 hover:text-red-300 text-xs"
                title="Delete Layer"
              >
                ×
              </button>
            )}
          </div>
        ))}

        {/* Empty State */}
        {project.layers.length === 0 && (
          <div className="p-4 text-center text-slate-500 text-xs">
            No layers. Click + to add one.
          </div>
        )}
      </div>
    </div>
  );
};