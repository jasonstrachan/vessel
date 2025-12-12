'use client';

import React from 'react';
import { Eye, EyeOff, Plus } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import {
  selectLayers,
  selectActiveLayerId,
  selectSelectedLayerIds,
} from '@/stores/selectors/layersSelectors';
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

  const layers = useAppStore(selectLayers);
  const activeLayerId = useAppStore(selectActiveLayerId);
  const selectedLayerIds = useAppStore(selectSelectedLayerIds);
  const addLayer = useAppStore((state) => state.addLayer);
  const duplicateLayer = useAppStore((state) => state.duplicateLayer);
  const removeLayer = useAppStore((state) => state.removeLayer);
  const updateLayer = useAppStore((state) => state.updateLayer);
  const setActiveLayer = useAppStore((state) => state.setActiveLayer);
  const reorderLayers = useAppStore((state) => state.reorderLayers);
  const setSelectedLayerIds = useAppStore((state) => state.setSelectedLayerIds);
  const selectLayerAlpha = useAppStore((state) => state.selectLayerAlpha);
  const initColorCycleForLayer = useAppStore((state) => state.initColorCycleForLayer);
  const setReferenceLayer = useAppStore((state) => state.setReferenceLayer);
  const referenceLayerId = useAppStore((state) => state.referenceLayerId);
  const setBrushSettings = useAppStore(state => state.setBrushSettings);
  const mergeLayers = useAppStore((state) => state.mergeLayers);

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
      transparencyLocked: false,
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal'
    };

    const newLayerId = addLayer(newLayer);

    if (newLayerId && !activeLayerId) {
      setActiveLayer(newLayerId);
      setSelectedLayerIds([newLayerId]);
    }
  }, [activeLayerId, addLayer, layers.length, setActiveLayer, setSelectedLayerIds]);

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
      transparencyLocked: false,
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        gradient: currentGradient,
        isAnimating: true,
        brushSpeed: store.tools.brushSettings.colorCycleSpeed || 0.1,
        flowMode: store.tools.brushSettings.colorCycleFlowMode ?? 'reverse'
      }
    };

    const newLayerId = addLayer(newLayer);

    if (newLayerId) {
      if (store.project) {
        initColorCycleForLayer(newLayerId, store.project.width, store.project.height);
      }

      setBrushSettings({ brushShape: BrushShape.COLOR_CYCLE });

      if (!activeLayerId) {
        setActiveLayer(newLayerId);
        setSelectedLayerIds([newLayerId]);
      }
    }
  }, [activeLayerId, addLayer, initColorCycleForLayer, layers, setActiveLayer, setBrushSettings, setSelectedLayerIds]);

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

  const handleToggleTransparencyLock = React.useCallback((layerId: string) => {
    const layer = layers.find(l => l.id === layerId);
    if (layer) {
      updateLayer(layerId, { transparencyLocked: layer.transparencyLocked !== true });
    }
  }, [layers, updateLayer]);

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

  const handleRowClick = React.useCallback((event: React.MouseEvent, layerId: string) => {
    // Shift+click adds the layer to the current selection without toggling others.
    if (event.shiftKey) {
      const nextSelection = selectedLayerIds.includes(layerId)
        ? selectedLayerIds
        : [...selectedLayerIds, layerId];
      setSelectedLayerIds(nextSelection);
      setActiveLayer(layerId, { preserveSelection: true });
      setLayerMenuState(null);
      return;
    }

    // Plain click selects only this layer.
    setActiveLayer(layerId);
    setSelectedLayerIds([layerId]);
    setLayerMenuState(null);
  }, [activeLayerId, selectedLayerIds, setActiveLayer, setLayerMenuState, setSelectedLayerIds]);

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
    <div className="flex flex-col h-full min-h-0 bg-[#1A1A1A]">
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
          const isSelected = selectedLayerIds.includes(layer.id);
          const isHighlighted = isActive || isSelected;
          const isColorCycle = layer.layerType === 'color-cycle';
          const gradient = layer.colorCycleData?.gradient || layer.colorCycleData?.recolorSettings?.gradient;
          const isMenuOpen = layerMenuState?.layerId === layer.id;
          const isReferenceLayer = referenceLayerId === layer.id;
          const sliderPercent = Math.round(layer.opacity * 100);
          const rowVisualClass = isHighlighted
            ? 'bg-[#E8F2FF] text-[#0F172A] border-l-4 border-[#0EA5E9] shadow-[0_0_0_1px_rgba(14,165,233,0.25),inset_4px_0_0_#0EA5E922]'
            : 'hover:bg-[#383838]/20 text-[#D9D9D9] border-l-4 border-transparent';
          const visibleIconClass = layer.visible
            ? (isHighlighted ? 'text-[#1A1A1A]' : 'text-[#D9D9D9]')
            : (isHighlighted ? 'text-[#5A5A5A]' : 'text-[#666]');
          const badgeBackgroundClass = isHighlighted ? 'bg-[#CFCFCF]' : 'bg-[#3A3A3A]';
          const badgeTextClass = isHighlighted ? 'text-[#1A1A1A]' : 'text-[#D9D9D9]';
          const deleteButtonColor = isHighlighted ? 'text-[#5A5A5A]' : 'text-[#666]';
          const hoverDeleteColor = isHighlighted ? 'hover:text-red-600' : 'hover:text-red-500';

          return (
            <div
              key={layer.id}
              draggable={!isMenuOpen}
              onContextMenu={event => {
                event.preventDefault();
                const anchor = event.currentTarget as HTMLDivElement;
                const placement = estimateLayerMenuPosition(anchor);

                if (!selectedLayerIds.includes(layer.id)) {
                  setSelectedLayerIds([layer.id]);
                  setActiveLayer(layer.id);
                }

                setLayerMenuState({
                  layerId: layer.id,
                  ...placement
                });
              }}
              className={`group relative border-b border-[#404040] ${
                rowVisualClass
              } ${draggedLayerId === layer.id ? 'opacity-50 shadow-lg' : ''} ${
                isMenuOpen ? 'z-30' : ''
              } cursor-pointer transition-colors`}
              onClick={(event) => handleRowClick(event, layer.id)}
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
                    visibleIconClass
                  } ${isActive ? 'hover:text-[#000]' : 'hover:text-white'}`}
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
                        <span className={`px-1 text-[9px] leading-4 ${badgeBackgroundClass} ${badgeTextClass}`}>CC</span>
                        <span className={`px-1 text-[9px] leading-4 ${badgeBackgroundClass} ${badgeTextClass}`}>
                          {layer.colorCycleData?.mode === 'recolor' ? 'Recolor' : 'Brush'}
                        </span>
                        {isReferenceLayer && (
                          <span
                            className="px-1 text-[9px] leading-4 bg-[#2F3C27] text-[#C9F6B5] border border-[#47603D]"
                            title="Reference layer for sampling"
                          >
                            Reference
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className={`px-1 text-[9px] leading-4 ${badgeBackgroundClass} ${badgeTextClass}`}>Regular</span>
                        {isReferenceLayer && (
                          <span
                            className="px-1 text-[9px] leading-4 bg-[#2F3C27] text-[#C9F6B5] border border-[#47603D]"
                            title="Reference layer for sampling"
                          >
                            Reference
                          </span>
                        )}
                      </>
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
                      className={`flex h-4 w-4 items-center justify-center transition-opacity ${deleteButtonColor} ${hoverDeleteColor} group-hover:opacity-100 opacity-0`}
                      title="Delete Layer"
                    >
                      ×
                    </button>
                  )}
                </div>
                {isMenuOpen && (
                  <div
                    ref={opacityPopoverRef}
                    className={`absolute z-50 w-52 border border-[#666] bg-[#2A2A32] p-2.5 shadow-lg space-y-2 ${
                      layerMenuState.vertical === 'below' ? 'top-full mt-2' : 'bottom-full mb-2'
                    } ${layerMenuState.horizontal === 'right' ? 'right-2' : 'left-2'}`}
                    onClick={event => event.stopPropagation()}
                  >
                    <div className="space-y-1.5">
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
                          handleToggleTransparencyLock(layer.id);
                        }}
                        className={`w-full flex items-center justify-center gap-2 px-1.5 py-0.5 text-[11px] border border-[#545454] transition-colors ${
                          layer.transparencyLocked ? 'bg-[#3C3C3C] text-[#F8D866]' : 'bg-transparent text-[#B0B0B0]'
                        } hover:bg-[#3C3C3C]`}
                        aria-pressed={layer.transparencyLocked === true}
                        title={layer.transparencyLocked ? 'Unlock transparent pixels' : 'Lock transparent pixels'}
                      >
                        <span>{layer.transparencyLocked ? 'Unlock transparency' : 'Lock transparency'}</span>
                      </button>
                      <button
                        onClick={event => {
                          event.stopPropagation();
                          selectLayerAlpha(layer.id);
                          setActiveLayer(layer.id);
                          setSelectedLayerIds([layer.id]);
                          setLayerMenuState(null);
                        }}
                        className="w-full flex items-center justify-center px-1.5 py-0.5 text-[11px] border border-[#545454] text-[#B0B0B0] hover:bg-[#3A3A3A] transition-colors"
                        title="Select all non-transparent pixels on this layer"
                      >
                        <span>Select alpha</span>
                      </button>
                      <button
                        onClick={event => {
                          event.stopPropagation();
                          handleToggleLock(layer.id);
                        }}
                        className={`w-full flex items-center justify-center px-1.5 py-0.5 text-[11px] border border-[#545454] transition-colors ${
                          layer.locked ? 'text-[#D9D9D9] bg-[#3A3A3A]' : 'text-[#B0B0B0] bg-transparent'
                        } hover:bg-[#3A3A3A]`}
                      >
                        <span>{layer.locked ? 'Unlock layer' : 'Lock layer'}</span>
                      </button>
                      <button
                        onClick={event => {
                          event.stopPropagation();
                          setReferenceLayer(isReferenceLayer ? null : layer.id);
                        }}
                        className={`w-full flex items-center justify-center px-1.5 py-0.5 text-[11px] border transition-colors ${
                          isReferenceLayer
                            ? 'border-[#4C6B3C] text-[#D4F7C4] bg-[#2E3A29]'
                            : 'border-[#545454] text-[#B0B0B0] hover:bg-[#3A3A3A]'
                        }`}
                        title="Use this layer when sampling colors"
                        aria-pressed={isReferenceLayer}
                      >
                        <span>{isReferenceLayer ? 'Unmark reference layer' : 'Mark as reference layer'}</span>
                      </button>
                      <button
                        onClick={event => {
                          event.stopPropagation();
                          const duplicatedId = duplicateLayer(layer.id);
                          if (duplicatedId) {
                            setLayerMenuState(null);
                          }
                        }}
                        className="w-full flex items-center justify-center px-1.5 py-0.5 text-[11px] border border-[#545454] text-[#B0B0B0] hover:bg-[#3A3A3A] transition-colors"
                        title="Duplicate this layer"
                      >
                        <span>Duplicate layer</span>
                      </button>
                      <button
                        onClick={event => {
                          event.stopPropagation();
                          const targetIds =
                            selectedLayerIds.length > 1 && selectedLayerIds.includes(layer.id)
                              ? selectedLayerIds
                              : [layer.id];
                          mergeLayers(targetIds);
                          setLayerMenuState(null);
                        }}
                        className={`w-full flex items-center justify-center px-1.5 py-0.5 text-[11px] border transition-colors ${
                          selectedLayerIds.length > 1
                            ? 'border-[#4C6B3C] text-[#D4F7C4] bg-[#2E3A29] hover:bg-[#3A4A32]'
                            : 'border-[#3A3A3A] text-[#777] cursor-not-allowed'
                        }`}
                        disabled={selectedLayerIds.length < 2}
                        title="Merge selected layers into one"
                      >
                        <span>Merge layers</span>
                      </button>
                      <button
                        onClick={event => {
                          event.stopPropagation();
                          if (layers.length <= 1) {
                            return;
                          }
                          handleDeleteLayer(layer.id);
                          setLayerMenuState(null);
                        }}
                        className={`w-full flex items-center justify-center px-1.5 py-0.5 text-[11px] border transition-colors ${
                          layers.length > 1
                            ? 'border-[#803232] text-[#FF6B6B] hover:bg-[#3A1F1F]'
                            : 'border-[#3A3A3A] text-[#555] cursor-not-allowed'
                        }`}
                        disabled={layers.length <= 1}
                        title={layers.length > 1 ? 'Delete this layer' : 'At least one layer is required'}
                      >
                        <span>Delete layer</span>
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
