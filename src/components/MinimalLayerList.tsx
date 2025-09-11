'use client';

import React, { useState, useCallback, memo, useEffect, useRef } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { Layer, BrushShape } from '../types';
import { Eye, EyeOff, Plus } from 'lucide-react';
import { ThrottledColorAnalyzer, ColorSwatch } from '../utils/colorAnalyzer';
import { setColorCycleAnimationState } from './toolbar/BrushControls';
import { RecolorManager } from '../lib/colorCycle/RecolorManager';
// Removed floating color cycle panel integration; panel now lives in Brush Settings

// Component to display color swatches for a layer
const LayerColorSwatches = memo<{ 
  layer: Layer;
  visible: boolean;
}>(({ layer, visible }) => {
  const [swatches, setSwatches] = useState<ColorSwatch[]>([]);
  const analyzerRef = useRef<ThrottledColorAnalyzer | undefined>();
  
  useEffect(() => {
    // Create analyzer on mount
    analyzerRef.current = new ThrottledColorAnalyzer();
    
    return () => {
      // Cleanup on unmount
      analyzerRef.current?.dispose();
    };
  }, []);
  
  useEffect(() => {
    // Analyze colors when layer changes (watch version for content updates)
    if (layer.framebuffer && analyzerRef.current) {
      analyzerRef.current.analyze(
        layer.framebuffer,
        (newSwatches) => setSwatches(newSwatches),
        6 // Show top 6 colors
      );
    }
  }, [layer.framebuffer, layer.id, layer.version]);
  
  if (swatches.length === 0) {
    return (
      <div 
        className="flex-1 h-4 rounded mr-1"
        style={{
          backgroundColor: '#444',
          minWidth: '30px',
          opacity: visible ? 1 : 0.5
        }}
        title={layer.name}
      />
    );
  }
  
  // Create a gradient-like display from the color swatches
  const gradientStops = swatches
    .map((swatch, idx) => {
      const start = (idx / swatches.length) * 100;
      const end = ((idx + 1) / swatches.length) * 100;
      return `${swatch.color} ${start}%, ${swatch.color} ${end}%`;
    })
    .join(', ');
  
  return (
    <div 
      className="flex-1 h-4 rounded mr-1"
      style={{
        background: `linear-gradient(90deg, ${gradientStops})`,
        minWidth: '30px',
        opacity: visible ? 1 : 0.5
      }}
      title={layer.name}
    />
  );
});

LayerColorSwatches.displayName = 'LayerColorSwatches';

// Memoized layer item component to prevent unnecessary re-renders
const LayerItem = memo<{
  layer: Layer;
  isActive: boolean;
  isDragOver: boolean;
  onToggleVisibility: (e: React.MouseEvent, layerId: string) => void;
  onClick: (layerId: string) => void;
  onDragStart: (e: React.DragEvent, layerId: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent, layerId: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, layerId: string) => void;
  generateGradientCSS: (gradient: Array<{ position: number; color: string }> | undefined) => string;
}>(({
  layer,
  isActive,
  isDragOver,
  onToggleVisibility,
  onClick,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  generateGradientCSS
}) => {
  return (
    <div
      className={`
        relative group cursor-move select-none
        ${isActive ? 'bg-[#4A4A4A]' : 'hover:bg-[#353535]'}
        ${isDragOver ? 'border-t-2 border-blue-400' : ''}
        transition-all duration-150
      `}
      draggable
      onClick={() => onClick(layer.id)}
      onDragStart={(e) => onDragStart(e, layer.id)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onDragOver(e, layer.id)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, layer.id)}
    >
      <div className="flex items-center h-7 px-2">
        {/* Visibility Toggle */}
        <button
          onClick={(e) => onToggleVisibility(e, layer.id)}
          className={`
            w-4 h-4 mr-2 flex items-center justify-center
            ${layer.visible ? 'text-[#D9D9D9]' : 'text-[#666]'}
            hover:text-white
          `}
        >
          {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
        
        {/* Display gradient for CC layers or color swatches for normal layers */}
        {(() => {
          if (layer.layerType === 'color-cycle' && layer.colorCycleData?.gradient) {
            return (
              <div 
                className="flex-1 h-4 rounded mr-1"
                style={{
                  background: generateGradientCSS(layer.colorCycleData.gradient),
                  minWidth: '30px',
                  opacity: layer.visible ? 1 : 0.5
                }}
                title={layer.name}
              />
            );
          } else if (layer.layerType === 'normal') {
            return <LayerColorSwatches layer={layer} visible={layer.visible} />;
          } else {
            return (
              <span className="text-[#D9D9D9] text-xs flex-1 truncate">
                {layer.name}
              </span>
            );
          }
        })()}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function - only re-render if relevant props change
  const shouldSkipRender = (
    prevProps.layer.id === nextProps.layer.id &&
    prevProps.layer.name === nextProps.layer.name &&
    prevProps.layer.visible === nextProps.layer.visible &&
    prevProps.layer.layerType === nextProps.layer.layerType &&
    prevProps.isActive === nextProps.isActive &&
    prevProps.isDragOver === nextProps.isDragOver &&
    // Deep check for color cycle data
    JSON.stringify(prevProps.layer.colorCycleData?.gradient) === JSON.stringify(nextProps.layer.colorCycleData?.gradient)
  );
  
  
  return shouldSkipRender;
});

LayerItem.displayName = 'LayerItem';

const MinimalLayerList = () => {
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null);
  // Derived animation state
  const brushAnimating = useAppStore(state => state.layers.some(l => l.layerType === 'color-cycle' && l.colorCycleData?.mode !== 'recolor' && !!l.colorCycleData?.isAnimating));
  const [externalIsPlaying, setExternalIsPlaying] = useState(false);
  const isAnimating = brushAnimating || externalIsPlaying;

  // Keep local play/pause UI in sync with unified animation state
  useEffect(() => {
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
  
  // Store subscriptions
  const layers = useAppStore(state => state.layers);
  const brushShape = useAppStore(state => state.tools?.brushSettings?.brushShape);
  
  const activeLayerId = useAppStore(state => state.activeLayerId);
  const project = useAppStore(state => state.project);
  
  // Actions
  const addLayer = useAppStore(state => state.addLayer);
  const updateLayer = useAppStore(state => state.updateLayer);
  const setActiveLayer = useAppStore(state => state.setActiveLayer);
  const reorderLayers = useAppStore(state => state.reorderLayers);
  
  // Remove local overrides; animation state comes from store + unified event
  
  // Generate gradient CSS for preview
  // Memoize gradient CSS generation to prevent recalculation on every render
  const generateGradientCSS = useCallback((gradient: Array<{ position: number; color: string }> | undefined) => {
    if (!gradient || gradient.length === 0) {
      return 'linear-gradient(90deg, #888 0%, #888 100%)';
    }
    const stops = gradient
      .map(stop => `${stop.color} ${stop.position * 100}%`)
      .join(', ');
    const css = `linear-gradient(90deg, ${stops})`;
    return css;
  }, []);
  
  const handleAddCCLayer = () => {
    
    // Get current gradient from brush settings or use default rainbow
    const currentGradient = useAppStore.getState().tools.brushSettings.colorCycleGradient || [
      { position: 0.0, color: '#ff0000' },
      { position: 0.17, color: '#ff7f00' },
      { position: 0.33, color: '#ffff00' },
      { position: 0.5, color: '#00ff00' },
      { position: 0.67, color: '#0000ff' },
      { position: 0.83, color: '#4b0082' },
      { position: 1.0, color: '#9400d3' }
    ];
    
    // Create a color-cycle layer
    const newLayer: Omit<Layer, 'id' | 'order'> = {
      name: `CC Layer ${layers.filter(l => l.layerType === 'color-cycle').length + 1}`,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      imageData: null,
      framebuffer: project 
        ? new OffscreenCanvas(project.width, project.height) 
        : new OffscreenCanvas(1920, 1080),
      layerType: 'color-cycle', // Color-cycle layer - cannot be converted to normal
      colorCycleData: {
        gradient: currentGradient,
        isAnimating: true
      }
    };
    
    
    const newLayerId = addLayer(newLayer);
    
    
    // Auto-select the new layer
    if (newLayerId) {
      
      // Initialize the color cycle brush for this layer BEFORE setting active
      const state = useAppStore.getState();
      if (state.project) {
        state.initColorCycleForLayer(newLayerId, state.project.width, state.project.height);
      }
      
      // Set as active layer (this will also sync the gradient to brush settings)
      setActiveLayer(newLayerId);
      
      // IMPORTANT: Switch to CC brush mode when creating a CC layer
      // This ensures users can immediately draw on the new CC layer
      const updatedState = useAppStore.getState();
      updatedState.setBrushSettings({ brushShape: BrushShape.COLOR_CYCLE });
    }
  };
  
  const handleAddRegularLayer = () => {
    
    // Create a regular layer
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
      layerType: 'normal' // Regular layer - cannot be converted to CC
    };
    
    
    const newLayerId = addLayer(newLayer);
    
    
    // Auto-select the new layer
    if (newLayerId) {
      setActiveLayer(newLayerId);
      
      // IMPORTANT: If CC brush is selected, switch to a regular brush
      // This ensures users can immediately draw on the new regular layer
      const state = useAppStore.getState();
      if (state.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE) {
        state.setBrushSettings({ brushShape: BrushShape.ROUND });
      }
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
    
    setDragOverLayerId(null);
  };
  
  const handleLayerClick = (layerId: string) => {
    setActiveLayer(layerId);
  };
  
  
  return (
    <div className="absolute right-0 top-0 h-full w-[130px] bg-[#2C2C2C] border-l border-r border-[#424242] z-30 flex flex-col">
      {/* Add Layer Buttons at the top */}
      <div className="border-b border-[#424242] bg-[#2C2C2C] flex">
        <button
          onClick={handleAddRegularLayer}
          className="flex-1 flex items-center justify-center py-3 hover:bg-[#353535] transition-colors border-r border-[#424242]"
          title="Add Regular Layer"
        >
          <Plus size={16} className="text-[#D9D9D9]" />
          <span className="ml-1 text-[11px] text-[#D9D9D9]">Regular</span>
        </button>
        <button
          onClick={handleAddCCLayer}
          className="flex-1 flex items-center justify-center py-3 hover:bg-[#353535] transition-colors"
          title="Add Color Cycle Layer"
        >
          <Plus size={16} className="text-[#D9D9D9]" />
          <span className="ml-1 text-[11px] text-[#D9D9D9]">CC</span>
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto" key={`${layers.length}-${layers.map(l => `${l.id}-${l.layerType}-${!!l.colorCycleData}`).join(',')}`}>
        <div className="py-1">
          {layers.slice().reverse().map((layer) => {
            
            return (
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
                  
                  {/* Display gradient for CC layers (brush or recolor) or color swatches for normal layers */}
                  {(() => {
                    if (layer.layerType === 'color-cycle') {
                      const ccGradient = layer.colorCycleData?.gradient || layer.colorCycleData?.recolorSettings?.gradient;
                      if (ccGradient && ccGradient.length > 0) {
                        return (
                          <div 
                            className="flex-1 h-4 rounded mr-1" 
                            style={{
                              background: generateGradientCSS(ccGradient),
                              minWidth: '30px',
                              opacity: layer.visible ? 1 : 0.5
                            }}
                            title={`${layer.name} - ${ccGradient.length} stops`}
                          />
                        );
                      }
                      // No gradient available yet; show a neutral bar
                      return (
                        <div 
                          className="flex-1 h-4 rounded mr-1"
                          style={{
                            background: '#555',
                            minWidth: '30px',
                            opacity: layer.visible ? 1 : 0.5
                          }}
                          title={layer.name}
                        />
                      );
                    } else if (layer.layerType === 'normal') {
                      return <LayerColorSwatches layer={layer} visible={layer.visible} />;
                    } else {
                      return (
                        <span className="text-[#D9D9D9] text-xs flex-1 truncate">
                          {layer.name}
                        </span>
                      );
                    }
                  })()}

                  {/* CC badges */}
                  {layer.layerType === 'color-cycle' && (
                    <div className="ml-1 flex items-center gap-1">
                      <span className="px-1 rounded text-[9px] leading-4 bg-[#3A3A3A] text-[#D9D9D9] border border-[#545454]">CC</span>
                      {layer.colorCycleData?.mode === 'recolor' ? (
                        <span className="px-1 rounded text-[9px] leading-4 bg-[#3A3A3A] text-[#D9D9D9] border border-[#545454]">Recolor</span>
                      ) : (
                        <span className="px-1 rounded text-[9px] leading-4 bg-[#3A3A3A] text-[#D9D9D9] border border-[#545454]">Brush</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* Bottom Controls: Play/Pause for Color Cycle animation only */}
      <div className="border-t border-[#424242] p-2">
        <button
          onClick={async () => {
            const newIsAnimating = !isAnimating;

            // Brush-based color cycle (stroke/shape)
            try {
              setColorCycleAnimationState(newIsAnimating);
              const handlers = (window as any).colorCycleAnimationHandlers;
              if (handlers) {
                if (newIsAnimating) handlers.startContinuousColorCycleAnimation();
                else handlers.stopContinuousColorCycleAnimation();
              }
            } catch {}

            // Recolor & animate layers (use pause/resume to avoid resetting state)
            try {
              const rm = RecolorManager.getInstance();
              const state = useAppStore.getState();
              if (newIsAnimating) {
                const recolorLayers = state.layers.filter(l => l.layerType === 'color-cycle' && l.colorCycleData?.mode === 'recolor');
                await Promise.all(recolorLayers.map(l => rm.registerExistingLayer(l)));
              }
              if (newIsAnimating) {
                rm.resume();
                if (!rm.isAnimating()) rm.playAll();
              } else {
                rm.pause();
              }
            } catch {}

            // Update store flags for ALL brush-based CC layers so render loop respects Pause/Play globally
            try {
              const st = useAppStore.getState();
              st.layers
                .filter(l => l.layerType === 'color-cycle' && l.colorCycleData?.mode !== 'recolor')
                .forEach(l => {
                  st.updateLayer(l.id, {
                    colorCycleData: {
                      ...l.colorCycleData,
                      isAnimating: newIsAnimating
                    }
                  } as any);
                });
            } catch {}
          }}
          className="w-full h-10 bg-[#D9D9D9] text-[#31313A] hover:bg-[#C4C4C4] transition-colors text-xs outline-none focus:outline-none flex items-center justify-center"
        >
          <span className="text-[10px] mr-1">{isAnimating ? '⏸' : '▶'}</span>
          <span className="text-[10px]">{isAnimating ? 'Pause' : 'Play'}</span>
        </button>
      </div>
    </div>
  );
};

export default React.memo(MinimalLayerList);
