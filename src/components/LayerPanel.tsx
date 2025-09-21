'use client';

import React from 'react';
import { useAppStore } from '../stores/useAppStore';
import { Layer } from '../types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { XIcon } from './icons/XIcon';
import { Eye, EyeOff, Lock, Unlock } from 'lucide-react';
import PlusButton from './ui/PlusButton';
import { toggleGlobalColorCyclePlayback } from '@/utils/colorCyclePlayback';
import { DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT } from '../constants/canvas';

const LayerPanel = () => {
  const [showOpacityPopover, setShowOpacityPopover] = React.useState<string | null>(null);
  const [draggedLayerId, setDraggedLayerId] = React.useState<string | null>(null);
  // Derive brush-based animation from store flags
  const brushAnimating = useAppStore(state => state.layers.some(l => l.layerType === 'color-cycle' && l.colorCycleData?.mode !== 'recolor' && !!l.colorCycleData?.isAnimating));
  // External/global (recolor manager) state
  const [externalIsPlaying, setExternalIsPlaying] = React.useState<boolean>(false);
  // Effective combined state for UI
  const isAnimating = brushAnimating || externalIsPlaying;
  const opacityButtonRef = React.useRef<{ [key: string]: HTMLButtonElement | null }>({});
  const opacityPopoverRef = React.useRef<HTMLDivElement>(null);
  // Direct subscriptions to avoid object creation in selectors
  const layers = useAppStore(state => state.layers);
  const activeLayerId = useAppStore(state => state.activeLayerId);
  const project = useAppStore(state => state.project);
  const brushShape = useAppStore(state => state.tools.brushSettings.brushShape);

  // Actions (stable references)
  const addLayer = useAppStore(state => state.addLayer);
  const removeLayer = useAppStore(state => state.removeLayer);
  const updateLayer = useAppStore(state => state.updateLayer);
  const setActiveLayer = useAppStore(state => state.setActiveLayer);
  const reorderLayers = useAppStore(state => state.reorderLayers);

  const handleAddLayer = () => {
    const newLayer: Omit<Layer, 'id' | 'order'> = {
      name: `Layer ${layers.length + 1}`,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      imageData: null,
      framebuffer: project ? new OffscreenCanvas(project.width, project.height) : new OffscreenCanvas(DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT),
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal' // Explicitly set as normal
    };
    addLayer(newLayer);
  };

  const handleDeleteLayer = (layerId: string) => {
    if (layers.length > 1) {
      removeLayer(layerId);
    }
  };

  // Keep external/recolor play state in sync with unified animation event
  React.useEffect(() => {
    const handler = (e: Event) => {
      try {
        const ce = e as CustomEvent<{ isPlaying: boolean }>;
        if (typeof ce.detail?.isPlaying === 'boolean') {
          setExternalIsPlaying(ce.detail.isPlaying);
        }
      } catch {}
    };
    window.addEventListener('colorCycleAnimationState', handler as EventListener);
    return () => {
      window.removeEventListener('colorCycleAnimationState', handler as EventListener);
    };
  }, []);

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

  // No local overrides; animation state comes from store + unified event

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
                  }`}
                  title={layer.visible ? 'Hide Layer' : 'Show Layer'}
                >
                  {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <span className="text-[#D9D9D9] flex-1 truncate" style={{ fontSize: '14px' }}>
                  {layer.name}
                </span>
              </div>
              
              <div className="flex items-center space-x-1">
                <div className="relative">
                  <button
                    ref={(el) => { opacityButtonRef.current[layer.id] = el; }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowOpacityPopover(showOpacityPopover === layer.id ? null : layer.id);
                    }}
                    className="text-[#999] hover:text-[#D9D9D9] cursor-pointer"
                    style={{ fontSize: '14px' }}
                    title="Adjust opacity"
                  >
                    {Math.round(layer.opacity * 100)}%
                  </button>
                  
                  {/* Opacity Popover */}
                  {showOpacityPopover === layer.id && (
                    <div 
                      ref={opacityPopoverRef}
                      className="absolute bottom-full right-0 mb-2 w-48 p-3 bg-[#2A2A32] border border-[#666] rounded-lg shadow-lg z-50"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <label className="block text-[#D9D9D9] mb-2" style={{ fontSize: '14px' }}>{Math.round(layer.opacity * 100)}%</label>
                      <input
                        type="range"
                        className="slider w-full"
                        value={layer.opacity * 100}
                        min={0}
                        max={100}
                        step={1}
                        onChange={(e) => handleOpacityChange(layer.id, parseInt(e.target.value))}
                        aria-label="Layer Opacity"
                      />
                    </div>
                  )}
                </div>
                
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleLock(layer.id);
                  }}
                  className={`w-4 h-4 flex items-center justify-center ${
                    layer.locked ? 'text-[#D9D9D9]' : 'text-[#666]'
                  } hover:text-[#FFFFFF]`}
                  title={layer.locked ? 'Unlock Transparency' : 'Lock Transparency'}
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
          </div>
        ))}
      </div>
      
      {/* Play/Pause Button for Color Cycle Brush - placed at bottom of layers column */}
      {/* Debug: Show current brush shape */}
      <div className="px-4 py-1 text-[10px] text-[#666]">
        Current brush: {brushShape || 'none'}
      </div>
      {/* Consolidated Color Cycle play/pause: controls brush and recolor animations */}
      {true && (
        <div className="px-4 py-2 border-t border-[#404040]">
          <button
            onClick={async () => {
              const newIsAnimating = !isAnimating;
              await toggleGlobalColorCyclePlayback(newIsAnimating);
            }}
            className="w-full h-11 bg-[#D9D9D9] text-[#31313A] hover:bg-[#C4C4C4] transition-colors text-xs outline-none focus:outline-none"
          >
            <span className="text-[10px]">{isAnimating ? '⏸' : '▶'}</span>
            <span className="ml-1">{isAnimating ? 'Pause' : 'Play'}</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default React.memo(LayerPanel);
