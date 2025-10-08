'use client';

import React from 'react';
import { Eye, EyeOff, Plus } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape, Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { LayerColorSwatches } from '@/components/MinimalLayerList';
import ProgressSlider from '@/components/ui/ProgressSlider';

const LayersPanel: React.FC = () => {
  const [layerMenuState, setLayerMenuState] = React.useState<{
    layerId: string;
    vertical: 'above' | 'below';
    horizontal: 'left' | 'right';
  } | null>(null);
  const [draggedLayerId, setDraggedLayerId] = React.useState<string | null>(null);
  const opacityPopoverRef = React.useRef<HTMLDivElement | null>(null);
  const [dragOverBottom, setDragOverBottom] = React.useState(false);

  const layers = useAppStore(state => state.layers);
  const activeLayerId = useAppStore(state => state.activeLayerId);

  const addLayer = useAppStore(state => state.addLayer);
  const removeLayer = useAppStore(state => state.removeLayer);
  const updateLayer = useAppStore(state => state.updateLayer);
  const setActiveLayer = useAppStore(state => state.setActiveLayer);
  const reorderLayers = useAppStore(state => state.reorderLayers);
  const setSelectedLayerIds = useAppStore(state => state.setSelectedLayerIds);
  const initColorCycleForLayer = useAppStore(state => state.initColorCycleForLayer);
  const setBrushSettings = useAppStore(state => state.setBrushSettings);

  const handleAddRegularLayer = React.useCallback(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;

    const newLayer: Omit<Layer, 'id' | 'order'> = {
      name: `Layer ${layers.length + 1}`,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal'
    };

    const newLayerId = addLayer(newLayer);

    if (newLayerId) {
      setActiveLayer(newLayerId);
      setSelectedLayerIds([newLayerId]);
    }
  }, [addLayer, layers.length, setActiveLayer, setSelectedLayerIds]);

  const handleAddColorCycleLayer = React.useCallback(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;

    const store = useAppStore.getState();
    const currentGradient = store.tools.brushSettings.colorCycleGradient || [
      { position: 0.0, color: '#ff0000' },
      { position: 0.17, color: '#ff7f00' },
      { position: 0.33, color: '#ffff00' },
      { position: 0.5, color: '#00ff00' },
      { position: 0.67, color: '#0000ff' },
      { position: 0.83, color: '#4b0082' },
      { position: 1.0, color: '#9400d3' }
    ];

    const newLayer: Omit<Layer, 'id' | 'order'> = {
      name: `CC Layer ${layers.filter(layer => layer.layerType === 'color-cycle').length + 1}`,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        gradient: currentGradient,
        isAnimating: true,
        brushSpeed: store.tools.brushSettings.colorCycleSpeed || 0.1
      }
    };

    const newLayerId = addLayer(newLayer);

    if (newLayerId) {
      if (store.project) {
        initColorCycleForLayer(newLayerId, store.project.width, store.project.height);
      }

      setActiveLayer(newLayerId);
      setSelectedLayerIds([newLayerId]);
      setBrushSettings({ brushShape: BrushShape.COLOR_CYCLE });
    }
  }, [addLayer, initColorCycleForLayer, layers, setActiveLayer, setBrushSettings, setSelectedLayerIds]);

  const handleDeleteLayer = React.useCallback((layerId: string) => {
    if (layers.length > 1) {
      removeLayer(layerId);
    }
  }, [layers.length, removeLayer]);

  const handleToggleVisibility = React.useCallback((layerId: string) => {
    const layer = layers.find(l => l.id === layerId);
    if (layer) {
      updateLayer(layerId, { visible: !layer.visible });
    }
  }, [layers, updateLayer]);

  const handleToggleLock = React.useCallback((layerId: string) => {
    const layer = layers.find(l => l.id === layerId);
    if (layer) {
      updateLayer(layerId, { locked: !layer.locked });
    }
  }, [layers, updateLayer]);

  const handleOpacityChange = React.useCallback((layerId: string, opacityPercent: number) => {
    updateLayer(layerId, { opacity: opacityPercent / 100 });
  }, [updateLayer]);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        layerMenuState &&
        opacityPopoverRef.current &&
        !opacityPopoverRef.current.contains(event.target as Node)
      ) {
        setLayerMenuState(null);
      }
    };

    if (layerMenuState) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }

    return undefined;
  }, [layerMenuState]);

  const handleDragStart = React.useCallback((event: React.DragEvent<HTMLDivElement>, layerId: string) => {
    setDraggedLayerId(layerId);
    event.dataTransfer.setData('text/plain', layerId);
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dragOverBottom) {
      setDragOverBottom(false);
    }
  }, [dragOverBottom]);

  const handleDrop = React.useCallback((event: React.DragEvent<HTMLDivElement>, targetLayerId: string) => {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData('text/plain');

    if (draggedId && draggedId !== targetLayerId) {
      const reversedLayers = layers.slice().reverse();
      const draggedIndex = reversedLayers.findIndex(layer => layer.id === draggedId);
      const targetIndex = reversedLayers.findIndex(layer => layer.id === targetLayerId);

      if (draggedIndex !== -1 && targetIndex !== -1) {
        const originalDraggedIndex = layers.length - 1 - draggedIndex;
        const originalTargetIndex = layers.length - 1 - targetIndex;
        reorderLayers(originalDraggedIndex, originalTargetIndex);
      }
    }

    setDraggedLayerId(null);
    setDragOverBottom(false);
  }, [layers, reorderLayers]);

  const handleDragOverBottom = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (!dragOverBottom) {
      setDragOverBottom(true);
    }
    if (draggedLayerId) {
      setDraggedLayerId(null);
    }
  }, [dragOverBottom, draggedLayerId]);

  const handleDropBottom = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData('text/plain');
    if (draggedId) {
      const originalDraggedIndex = layers.findIndex(layer => layer.id === draggedId);
      if (originalDraggedIndex !== -1) {
        reorderLayers(originalDraggedIndex, 0);
      }
    }
    setDragOverBottom(false);
    setDraggedLayerId(null);
  }, [layers, reorderLayers]);

  const handleDragEnd = React.useCallback(() => {
    setDraggedLayerId(null);
    setDragOverBottom(false);
  }, []);

  const generateGradientCSS = React.useCallback((gradient?: Array<{ position: number; color: string }>) => {
    if (!gradient || gradient.length === 0) {
      return 'linear-gradient(90deg, #888 0%, #888 100%)';
    }

    const stops = gradient
      .map(stop => `${stop.color} ${stop.position * 100}%`)
      .join(', ');

    return `linear-gradient(90deg, ${stops})`;
  }, []);

  const estimateLayerMenuPosition = React.useCallback((anchor: HTMLDivElement) => {
    const rect = anchor.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const POPOVER_WIDTH = 208; // tailwind w-52 ≈ 13rem
    const POPOVER_HEIGHT = 220; // estimated height of menu content
    const OFFSET = 8;

    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const vertical = spaceBelow >= POPOVER_HEIGHT + OFFSET || spaceBelow >= spaceAbove
      ? 'below'
      : 'above';

    const wouldOverflowRight = rect.left + POPOVER_WIDTH + OFFSET > viewportWidth;
    const horizontal = wouldOverflowRight && rect.right - POPOVER_WIDTH - OFFSET >= 0 ? 'right' : 'left';

    return { vertical, horizontal } as const;
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#141514]">
      <div className="flex-shrink-0 flex border-b border-[#404040]">
        <button
          onClick={handleAddRegularLayer}
          className="flex-1 flex items-center justify-center gap-1 py-2 border-r border-[#424242] text-[11px] text-[#D9D9D9] hover:bg-[#353535] transition-colors"
          title="Add Regular Layer"
        >
          <Plus size={14} className="text-[#D9D9D9]" />
          <span>Regular</span>
        </button>
        <button
          onClick={handleAddColorCycleLayer}
          className="flex-1 flex items-center justify-center gap-1 py-2 text-[11px] text-[#D9D9D9] hover:bg-[#353535] transition-colors"
          title="Add Color Cycle Layer"
        >
          <Plus size={14} className="text-[#D9D9D9]" />
          <span>Color cycle</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {layers.slice().reverse().map(layer => {
          const isActive = activeLayerId === layer.id;
          const isColorCycle = layer.layerType === 'color-cycle';
          const gradient = layer.colorCycleData?.gradient || layer.colorCycleData?.recolorSettings?.gradient;
          const isMenuOpen = layerMenuState?.layerId === layer.id;
          const sliderPercent = Math.round(layer.opacity * 100);

          return (
            <div
              key={layer.id}
              draggable={!isMenuOpen}
              onContextMenu={event => {
                event.preventDefault();
                const anchor = event.currentTarget as HTMLDivElement;
                const placement = estimateLayerMenuPosition(anchor);

                setLayerMenuState({
                  layerId: layer.id,
                  ...placement
                });
              }}
              className={`group relative border-b border-[#404040] ${
                isActive ? 'bg-[#3A3A42]' : 'hover:bg-[#383838]/20'
              } ${draggedLayerId === layer.id ? 'opacity-50 shadow-lg' : ''} ${
                isMenuOpen ? 'z-30' : ''
              } cursor-pointer transition-colors`}
              onClick={() => {
                setActiveLayer(layer.id);
                setLayerMenuState(null);
              }}
              onDragStart={event => handleDragStart(event, layer.id)}
              onDragOver={handleDragOver}
              onDrop={event => handleDrop(event, layer.id)}
              onDragEnd={handleDragEnd}
            >
              <div className="flex items-center px-2 py-1.5">
                <button
                  onClick={event => {
                    event.stopPropagation();
                    handleToggleVisibility(layer.id);
                  }}
                  className={`mr-1 flex h-4 w-4 items-center justify-center ${
                    layer.visible ? 'text-[#D9D9D9]' : 'text-[#666]'
                  } hover:text-white`}
                  title={layer.visible ? 'Hide Layer' : 'Show Layer'}
                >
                  {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>

                <div className="ml-2 flex items-center gap-2 w-56">
                  <div className="flex h-4 w-40 items-center">
                    {isColorCycle ? (
                      <div
                        className="h-4 w-full"
                        style={{
                          background: generateGradientCSS(gradient),
                          opacity: layer.visible ? 1 : 0.5
                        }}
                      />
                    ) : (
                      <div className="flex h-4 w-full items-center overflow-hidden">
                        <LayerColorSwatches layer={layer} visible={layer.visible} />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    {isColorCycle ? (
                      <>
                        <span className="px-1 text-[9px] leading-4 bg-[#3A3A3A] text-[#D9D9D9]">CC</span>
                        <span className="px-1 text-[9px] leading-4 bg-[#3A3A3A] text-[#D9D9D9]">
                          {layer.colorCycleData?.mode === 'recolor' ? 'Recolor' : 'Brush'}
                        </span>
                      </>
                    ) : (
                      <span className="px-1 text-[9px] leading-4 bg-[#3A3A3A] text-[#D9D9D9]">Regular</span>
                    )}
                  </div>
                </div>

                <div className="ml-2 flex items-center gap-1">
                  {layers.length > 1 && (
                    <button
                      onClick={event => {
                        event.stopPropagation();
                        handleDeleteLayer(layer.id);
                      }}
                      className="flex h-4 w-4 items-center justify-center text-[#666] transition-opacity hover:text-red-500 group-hover:opacity-100 opacity-0"
                      title="Delete Layer"
                    >
                      ×
                    </button>
                  )}
                </div>
                {isMenuOpen && (
                  <div
                    ref={opacityPopoverRef}
                    className={`absolute z-50 w-52 border border-[#666] bg-[#2A2A32] p-3 shadow-lg space-y-3 ${
                      layerMenuState.vertical === 'below' ? 'top-full mt-2' : 'bottom-full mb-2'
                    } ${layerMenuState.horizontal === 'right' ? 'right-2' : 'left-2'}`}
                    onClick={event => event.stopPropagation()}
                  >
                    <div className="space-y-3">
                      <div
                        onPointerDown={event => event.stopPropagation()}
                        onClick={event => event.stopPropagation()}
                      >
                        <ProgressSlider
                          value={sliderPercent}
                          min={0}
                          max={100}
                          step={1}
                          onChange={value => handleOpacityChange(layer.id, value)}
                          aria-label="Layer Opacity"
                        />
                      </div>
                      <button
                        onClick={event => {
                          event.stopPropagation();
                          handleToggleLock(layer.id);
                        }}
                        className={`w-full flex items-center justify-center px-2 py-1 text-sm border border-[#545454] transition-colors ${
                          layer.locked ? 'text-[#D9D9D9] bg-[#3A3A3A]' : 'text-[#B0B0B0] bg-transparent'
                        } hover:bg-[#3A3A3A]`}
                      >
                        <span>{layer.locked ? 'Unlock layer' : 'Lock layer'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div
          className={`h-3 ${dragOverBottom ? 'border-t-2 border-blue-400' : ''}`}
          onDragOver={handleDragOverBottom}
          onDragLeave={() => setDragOverBottom(false)}
          onDrop={handleDropBottom}
        />
      </div>
    </div>
  );
};

export default React.memo(LayersPanel);
