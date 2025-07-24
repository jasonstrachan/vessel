'use client';

import React from 'react';
import { useAppStore } from '../stores/useAppStore';
import { Layer } from '../types';
import { XIcon } from './icons/XIcon';
import { Eye, EyeOff, Lock, Unlock, SlidersHorizontal } from 'lucide-react';
import { Slider } from './retroui/Slider';
import PlusButton from './ui/PlusButton';

const LayerPanel = () => {
  const [showOpacityPopover, setShowOpacityPopover] = React.useState<string | null>(null);
  const [draggedLayerId, setDraggedLayerId] = React.useState<string | null>(null);
  const opacityButtonRef = React.useRef<{ [key: string]: HTMLButtonElement | null }>({});
  const opacityPopoverRef = React.useRef<HTMLDivElement>(null);
  const { 
    layers, 
    activeLayerId, 
    project,
    addLayer, 
    removeLayer, 
    updateLayer, 
    setActiveLayer,
    reorderLayers
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

  // Handle click outside to close popover
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showOpacityPopover && 
          opacityPopoverRef.current && 
          !opacityPopoverRef.current.contains(event.target as Node)) {
        // Check if click is outside all opacity buttons
        const clickedButton = Object.values(opacityButtonRef.current).some(
          btn => btn && btn.contains(event.target as Node)
        );
        if (!clickedButton) {
          setShowOpacityPopover(null);
        }
      }
    };

    if (showOpacityPopover) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showOpacityPopover]);

  const handleDragStart = (e: React.DragEvent, layerId: string) => {
    setDraggedLayerId(layerId);
    e.dataTransfer.setData('text/plain', layerId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetLayerId: string) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    
    if (draggedId && draggedId !== targetLayerId) {
      const reversedLayers = layers.slice().reverse();
      const draggedIndex = reversedLayers.findIndex(l => l.id === draggedId);
      const targetIndex = reversedLayers.findIndex(l => l.id === targetLayerId);
      
      if (draggedIndex !== -1 && targetIndex !== -1) {
        // Convert back to original array indices
        const originalDraggedIndex = layers.length - 1 - draggedIndex;
        const originalTargetIndex = layers.length - 1 - targetIndex;
        reorderLayers(originalDraggedIndex, originalTargetIndex);
      }
    }
    
    setDraggedLayerId(null);
  };

  const handleDragEnd = () => {
    setDraggedLayerId(null);
  };

  return (
    <div className="">
      <div className="flex items-center justify-between px-4 py-2">
        <h3 className="font-medium text-[#D9D9D9]" style={{ fontSize: '14px' }}>Layers</h3>
        <PlusButton
          onClick={handleAddLayer}
          title="Add Layer"
        />
      </div>
      
      <div className="">
        {layers.slice().reverse().map((layer) => (
          <div
            key={layer.id}
            draggable
            className={`py-1 border-b border-[#404040] ${
              activeLayerId === layer.id
                ? 'bg-[#3A3A42]'
                : 'hover:bg-[#383838]/20'
            } ${
              draggedLayerId === layer.id
                ? 'opacity-50 shadow-lg'
                : ''
            } cursor-pointer transition-opacity`}
            onClick={() => setActiveLayer(layer.id)}
            onDragStart={(e) => handleDragStart(e, layer.id)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, layer.id)}
            onDragEnd={handleDragEnd}
          >
            <div className="flex items-center justify-between px-3">
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
                <span className="text-[#D9D9D9] flex-1 truncate" style={{ fontSize: '14px' }}>
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
            
            <div className="flex items-center justify-between px-3">
              <span className="text-[#999]" style={{ fontSize: '14px' }}>Opacity: {Math.round(layer.opacity * 100)}%</span>
              <div className="relative">
                <button
                  ref={(el) => { opacityButtonRef.current[layer.id] = el; }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowOpacityPopover(showOpacityPopover === layer.id ? null : layer.id);
                  }}
                  className={`p-1 rounded ${
                    showOpacityPopover === layer.id
                      ? 'text-blue-400 bg-blue-400/20'
                      : 'text-[#D9D9D9] hover:bg-[#3A3A42]'
                  }`}
                  title="Adjust opacity"
                >
                  <SlidersHorizontal size={14} />
                </button>
                
                {/* Opacity Popover */}
                {showOpacityPopover === layer.id && (
                  <div 
                    ref={opacityPopoverRef}
                    className="absolute bottom-full right-0 mb-2 w-48 p-3 bg-[#2A2A32] border border-[#666] rounded-lg shadow-lg z-50"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <label className="block text-[#D9D9D9] mb-2" style={{ fontSize: '14px' }}>
                      Opacity: {Math.round(layer.opacity * 100)}%
                    </label>
                    <Slider
                      value={[layer.opacity * 100]}
                      min={0}
                      max={100}
                      step={1}
                      onValueChange={(value) => handleOpacityChange(layer.id, value[0])}
                      aria-label="Layer Opacity"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default LayerPanel;