'use client';

import React, { useState } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { Layer } from '../types';
import { Eye, EyeOff, Plus } from 'lucide-react';

const MinimalLayerList = () => {
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null);
  
  // Store subscriptions
  const layers = useAppStore(state => state.layers);
  const activeLayerId = useAppStore(state => state.activeLayerId);
  const project = useAppStore(state => state.project);
  // const currentBrush = useAppStore(state => state.tools.brushSettings.brushShape);
  const colorCycleGradient = useAppStore(state => state.tools.brushSettings.colorCycleGradient);
  
  // Actions
  const addLayer = useAppStore(state => state.addLayer);
  // const removeLayer = useAppStore(state => state.removeLayer);
  const updateLayer = useAppStore(state => state.updateLayer);
  const setActiveLayer = useAppStore(state => state.setActiveLayer);
  const reorderLayers = useAppStore(state => state.reorderLayers);
  
  // Generate gradient CSS for preview
  const generateGradientCSS = (gradient: Array<{ position: number; color: string }>) => {
    const stops = gradient
      .map(stop => `${stop.color} ${stop.position * 100}%`)
      .join(', ');
    return `linear-gradient(90deg, ${stops})`;
  };
  
  // Generate a name for CC layers based on gradient
  const generateGradientName = (gradient: Array<{ position: number; color: string }>) => {
    // Check for common gradient patterns
    const colors = gradient.map(g => g.color.toLowerCase());
    if (colors.includes('#ff0000') && colors.includes('#00ff00') && colors.includes('#0000ff')) {
      return 'Rainbow';
    }
    if (colors.includes('#ff0000') && colors.includes('#ff7f00') && colors.includes('#ffff00')) {
      return 'Fire';
    }
    if (colors.includes('#0000ff') && colors.includes('#00ffff') && colors.includes('#ffffff')) {
      return 'Ocean';
    }
    // Default to first and last colors
    return 'Gradient';
  };
  
  const handleAddLayer = () => {
    // Create a generic layer that will become typed on first stroke
    const newLayer: Omit<Layer, 'id' | 'order'> = {
      name: `Layer ${layers.length + 1}`,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      imageData: null,
      framebuffer: project 
        ? new OffscreenCanvas(project.width, project.height) 
        : new OffscreenCanvas(1920, 1080),
      // Don't set layerType - it will be determined by first stroke
    };
    const newLayerId = addLayer(newLayer);
    // Auto-select the new layer
    if (newLayerId) {
      setActiveLayer(newLayerId);
    }
  };
  
  const handleToggleVisibility = (e: React.MouseEvent, layerId: string) => {
    e.stopPropagation();
    const layer = layers.find(l => l.id === layerId);
    if (layer) {
      updateLayer(layerId, { visible: !layer.visible });
    }
  };
  
  // Handle drag start
  const handleDragStart = (e: React.DragEvent, layerId: string) => {
    setDraggedLayerId(layerId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', layerId);
    
    // Make the drag image semi-transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5';
    }
  };
  
  const handleDragEnd = (e: React.DragEvent) => {
    // Reset opacity
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
    setDraggedLayerId(null);
    setDragOverLayerId(null);
  };
  
  const handleDragOver = (e: React.DragEvent, layerId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverLayerId(layerId);
  };
  
  const handleDragLeave = () => {
    setDragOverLayerId(null);
  };
  
  const handleDrop = (e: React.DragEvent, targetLayerId: string) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    
    if (draggedId && draggedId !== targetLayerId) {
      const reversedLayers = layers.slice().reverse();
      const draggedIndex = reversedLayers.findIndex(l => l.id === draggedId);
      const targetIndex = reversedLayers.findIndex(l => l.id === targetLayerId);
      
      if (draggedIndex !== -1 && targetIndex !== -1) {
        const originalDraggedIndex = layers.length - 1 - draggedIndex;
        const originalTargetIndex = layers.length - 1 - targetIndex;
        reorderLayers(originalDraggedIndex, originalTargetIndex);
      }
    }
    
    setDraggedLayerId(null);
    setDragOverLayerId(null);
  };
  
  const handleLayerClick = (layerId: string) => {
    setActiveLayer(layerId);
  };
  
  
  return (
    <div className="absolute right-0 top-0 h-full w-[130px] bg-[#2C2C2C] border-l border-r border-[#424242] z-30 flex flex-col">
      {/* Add Layer Button at the top */}
      <div className="border-b border-[#424242] bg-[#2C2C2C]">
        <button
          onClick={handleAddLayer}
          className="w-full flex items-center justify-center py-1 hover:bg-[#353535] transition-colors"
          title="Add Layer"
        >
          <Plus size={14} className="text-[#D9D9D9]" />
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        <div className="py-1">
          {layers.slice().reverse().map((layer) => (
            <div
            key={layer.id}
            className={`
              relative group cursor-move select-none
              ${activeLayerId === layer.id ? 'bg-[#4A4A4A]' : 'hover:bg-[#353535]'}
              ${dragOverLayerId === layer.id ? 'border-t-2 border-blue-400' : ''}
              transition-all duration-150
            `}
            draggable
            onClick={() => handleLayerClick(layer.id)}
            onDragStart={(e) => handleDragStart(e, layer.id)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, layer.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, layer.id)}
          >
            <div className="flex items-center h-7 px-2">
              {/* Visibility Toggle */}
              <button
                onClick={(e) => handleToggleVisibility(e, layer.id)}
                className={`
                  w-4 h-4 mr-2 flex items-center justify-center
                  ${layer.visible ? 'text-[#D9D9D9]' : 'text-[#666]'}
                  hover:text-white
                `}
              >
                {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
              
              {/* Gradient Preview for CC Layers */}
              {layer.layerType === 'color-cycle' && layer.colorCycleData && (
                <div 
                  className="flex-1 h-4 rounded mr-1"
                  style={{
                    background: generateGradientCSS(layer.colorCycleData.gradient),
                    minWidth: '30px'
                  }}
                />
              )}
              
              {/* Layer Name */}
              {(!layer.layerType || layer.layerType === 'normal') && (
                <span className="text-[#D9D9D9] text-xs flex-1 truncate">
                  {layer.name}
                </span>
              )}
            </div>
          </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default React.memo(MinimalLayerList);