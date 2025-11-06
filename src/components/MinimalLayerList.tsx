'use client';

import React, { useState, useCallback, memo, useEffect, useRef, useMemo } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { useAppStore } from '../stores/useAppStore';
import {
  selectLayers,
  selectActiveLayerId,
  selectSelectedLayerIds,
} from '@/stores/selectors/layersSelectors';
import { Layer, BrushShape } from '../types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { LayerAlignmentControls } from '@/components/panels/AlignmentPanel';
import ProgressSlider from './ui/ProgressSlider';
import { ThrottledColorAnalyzer, ColorSwatch } from '../utils/colorAnalyzer';
import { recordBreadcrumb } from '../utils/debug';
import { useStoreSelectorRef } from '@/hooks/useStoreSelectorRef';
import { selectBrushSettings } from '@/stores/selectors/toolsSelectors';
import { selectProjectDimensions } from '@/stores/selectors/projectSelectors';
// Removed floating color cycle panel integration; panel now lives in Brush Settings

export const LAYER_TAG_CLASS = 'px-1 rounded text-[9px] leading-4 bg-[#3A3A3A] text-[#D9D9D9] border border-[#545454]';
export const LayerColorSwatches = memo<{ 
  layer: Layer;
  visible: boolean;
}>(({ layer, visible }) => {
  const [swatches, setSwatches] = useState<ColorSwatch[]>([]);
  const analyzerRef = useRef<ThrottledColorAnalyzer | undefined>(undefined);
  
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
        className="h-4 w-full"
        style={{
          backgroundColor: '#444',
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
      className="h-4 w-full"
      style={{
        background: `linear-gradient(90deg, ${gradientStops})`,
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
          }
          return (
            <span className="text-[#D9D9D9] text-xs flex-1 truncate">
              {layer.name}
            </span>
          );
        })()}

        {layer.layerType === 'color-cycle' ? (
          <div className="ml-1 flex items-center gap-1">
            <span className={LAYER_TAG_CLASS}>CC</span>
            <span className={LAYER_TAG_CLASS}>
              {layer.colorCycleData?.mode === 'recolor' ? 'Recolor' : 'Brush'}
            </span>
          </div>
        ) : (
          <div className="ml-1 flex items-center gap-1">
            <span className={LAYER_TAG_CLASS}>Layer</span>
          </div>
        )}
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

const DRAG_DEADZONE_PX = 4;

type PointerSession = {
  pointerId: number;
  target: HTMLDivElement;
  layerId: string;
  startClientY: number;
  startClientX: number;
  isDragging: boolean;
};

type LayerDragState = {
  layerId: string;
  originIndex: number;
  originDisplayIndex: number;
  pointerId: number;
  rowHeight: number;
};

const MinimalLayerList = () => {
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null);
  const [dragOverBottom, setDragOverBottom] = useState<boolean>(false);
  const [dragState, setDragState] = useState<LayerDragState | null>(null);
  const displayTargetIndexRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const pointerSessionRef = useRef<PointerSession | null>(null);
  const desiredPlaying = useAppStore((state) => state.colorCyclePlayback.desiredPlaying);
  const suspendDepth = useAppStore((state) => state.colorCyclePlayback.suspendDepth);
  const playColorCycle = useAppStore((state) => state.playColorCycle);
  const pauseColorCycle = useAppStore((state) => state.pauseColorCycle);
  const effectivePlaying = desiredPlaying && suspendDepth === 0;
  const isSuspended = desiredPlaying && suspendDepth > 0;
  
  // Store subscriptions
  const layers = useAppStore(selectLayers);
  const displayedLayers = useMemo(() => layers.slice().reverse(), [layers]);
  const activeLayerId = useAppStore(selectActiveLayerId);
  const selectedLayerIds = useAppStore(selectSelectedLayerIds);
  const brushSettings = useAppStore(selectBrushSettings);
  const globalColorCycleSpeed = brushSettings.colorCycleSpeed ?? 0.1;
  const setBrushSettings = useAppStore((state) => state.setBrushSettings);
  const brushSettingsRef = useStoreSelectorRef(selectBrushSettings);
  const projectSizeRef = useStoreSelectorRef(selectProjectDimensions);
  // Actions
  const addLayer = useAppStore((state) => state.addLayer);
  const updateLayer = useAppStore((state) => state.updateLayer);
  const setActiveLayer = useAppStore((state) => state.setActiveLayer);
  const reorderLayers = useAppStore((state) => state.reorderLayers);
  const removeLayer = useAppStore((state) => state.removeLayer);
  const setSelectedLayerIds = useAppStore((state) => state.setSelectedLayerIds);
  const initColorCycleForLayer = useAppStore((state) => state.initColorCycleForLayer);

  const activeLayer = useMemo(() => layers.find(l => l.id === activeLayerId), [layers, activeLayerId]);
  const isCCBrushLayer = activeLayer?.layerType === 'color-cycle' && activeLayer?.colorCycleData?.mode !== 'recolor';
  const colorCycleSpeedValue = isCCBrushLayer && typeof activeLayer?.colorCycleData?.brushSpeed === 'number'
    ? activeLayer.colorCycleData.brushSpeed
    : globalColorCycleSpeed;
  const canDeleteLayer = layers.length > 1;
  
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

  const resetDragIndicators = useCallback(() => {
    setDragOverLayerId(null);
    setDragOverBottom(false);
    setDragState(null);
    displayTargetIndexRef.current = null;
  }, []);

  const toStoreIndex = useCallback((displayIndex: number) => {
    return Math.max(0, layers.length - 1 - displayIndex);
  }, [layers.length]);

  const applyAxisLockedReorder = useCallback(() => {
    if (!dragState) {
      return false;
    }

    const destinationIndex = dragOverBottom
      ? 0
      : toStoreIndex(displayTargetIndexRef.current ?? dragState.originDisplayIndex);

    if (destinationIndex !== dragState.originIndex) {
      reorderLayers(dragState.originIndex, destinationIndex);
    }

    return true;
  }, [dragState, dragOverBottom, reorderLayers, toStoreIndex]);

  const updateDisplayTargetFromPointer = useCallback((clientY: number, overrideState?: LayerDragState) => {
    const state = overrideState ?? dragState;
    if (!state || !listRef.current || displayedLayers.length === 0) {
      return;
    }

    const list = listRef.current;
    const rect = list.getBoundingClientRect();
    const scrollTop = list.scrollTop;
    const offsetY = clientY - rect.top + scrollTop;
    const totalHeight = displayedLayers.length * state.rowHeight;

    if (offsetY >= totalHeight + state.rowHeight / 2) {
      displayTargetIndexRef.current = displayedLayers.length - 1;
      setDragOverLayerId(null);
      setDragOverBottom(true);
      return;
    }

    const clampedOffset = Math.max(offsetY, 0);
    const displayIndex = Math.min(
      Math.floor(clampedOffset / state.rowHeight),
      displayedLayers.length - 1
    );

    displayTargetIndexRef.current = displayIndex;
    setDragOverLayerId(displayedLayers[displayIndex]?.id ?? null);
    setDragOverBottom(false);
  }, [displayedLayers, dragState]);

  const beginPointerDrag = useCallback((session: PointerSession) => {
    const originIndex = layers.findIndex((layer) => layer.id === session.layerId);
    if (originIndex === -1) {
      return false;
    }

    const originDisplayIndex = displayedLayers.findIndex((layer) => layer.id === session.layerId);
    if (originDisplayIndex === -1) {
      return false;
    }

    const rowHeight = Math.max(1, session.target.getBoundingClientRect().height);
    const nextState: LayerDragState = {
      layerId: session.layerId,
      originIndex,
      originDisplayIndex,
      pointerId: session.pointerId,
      rowHeight,
    };

    setDragState(nextState);
    displayTargetIndexRef.current = originDisplayIndex;
    setDragOverLayerId(displayedLayers[originDisplayIndex]?.id ?? null);
    setDragOverBottom(false);
    updateDisplayTargetFromPointer(session.startClientY, nextState);
    return true;
  }, [displayedLayers, layers, updateDisplayTargetFromPointer]);
  
  const handleAddCCLayer = () => {
    // Unconditional trace to verify handler fires even when TB_DEBUG isn't set
    // quiet
    recordBreadcrumb('layers', { event: 'ui-add-cc-click', count: layers.length, activeLayerId });
    // quiet
    // Helper to create a framebuffer that works across browsers
    const makeFramebuffer = (): OffscreenCanvas | HTMLCanvasElement => {
      // Allocate tiny placeholder; resize lazily on first capture
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      return canvas;
    };
    
    // Get current gradient from brush settings or use default rainbow
    const currentGradient = brushSettingsRef.current.colorCycleGradient || [
      { position: 0.0, color: '#ff0000' },
      { position: 0.17, color: '#ff7f00' },
      { position: 0.33, color: '#ffff00' },
      { position: 0.5, color: '#00ff00' },
      { position: 0.67, color: '#0000ff' },
      { position: 0.83, color: '#4b0082' },
      { position: 1.0, color: '#9400d3' }
    ];
    const isGlobalPlaying = effectivePlaying;

    // Create a color-cycle layer
    const newLayer: Omit<Layer, 'id' | 'order'> = {
      name: `CC Layer ${layers.filter(l => l.layerType === 'color-cycle').length + 1}`,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      imageData: null,
      framebuffer: makeFramebuffer(),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle', // Color-cycle layer - cannot be converted to normal
      colorCycleData: {
        gradient: currentGradient,
        isAnimating: isGlobalPlaying,
        brushSpeed: brushSettingsRef.current.colorCycleSpeed || 0.1,
        flowMode: brushSettingsRef.current.colorCycleFlowMode ?? 'forward'
      }
    };
    // quiet

    const newLayerId = addLayer(newLayer);
    // quiet
    
    
    // Auto-select the new layer
    if (newLayerId) {
      
      // Initialize the color cycle brush for this layer BEFORE setting active
      const projectSize = projectSizeRef.current;
      if (projectSize.width > 0 && projectSize.height > 0) {
        initColorCycleForLayer(newLayerId, projectSize.width, projectSize.height);
      }

      setActiveLayer(newLayerId);
      setBrushSettings({ brushShape: BrushShape.COLOR_CYCLE });
      // quiet
    }
    // quiet
  };
  
  const handleAddRegularLayer = () => {
    // Unconditional trace to verify handler fires even when TB_DEBUG isn't set
    // quiet
    recordBreadcrumb('layers', { event: 'ui-add-regular-click', count: layers.length, activeLayerId });
    // quiet
    const makeFramebuffer = (): OffscreenCanvas | HTMLCanvasElement => {
      // Allocate tiny placeholder; resize lazily on first capture
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      return canvas;
    };
    
    // Create a regular layer
    const newLayer: Omit<Layer, 'id' | 'order'> = {
      name: `Layer ${layers.length + 1}`,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      imageData: null,
      framebuffer: makeFramebuffer(),
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal' // Regular layer - cannot be converted to CC
    };
    // quiet
    // Execute synchronously to avoid race conditions with CC layers
    // Fetch fresh state before mutating
    // quiet
    const newLayerId = addLayer(newLayer);
    // quiet

    // Auto-select the new layer
    if (newLayerId) {
      setActiveLayer(newLayerId);

      const activeBrushShape = brushSettingsRef.current.brushShape;
      if (
        activeBrushShape === BrushShape.COLOR_CYCLE ||
        activeBrushShape === BrushShape.COLOR_CYCLE_TRIANGLE
      ) {
        setBrushSettings({ brushShape: BrushShape.ROUND });
      }
    }
    // quiet
  };
  
  const handleToggleVisibility = (e: React.MouseEvent, layerId: string) => {
    e.stopPropagation();
    const targetLayer = layers.find(l => l.id === layerId);
    if (!targetLayer) {
      return;
    }

    const shouldApplyToSelection = selectedLayerIds.includes(layerId) && selectedLayerIds.length > 1;
    const layerIdsToUpdate = shouldApplyToSelection ? selectedLayerIds : [layerId];
    const nextVisible = !targetLayer.visible;

    layerIdsToUpdate.forEach((id) => {
      const layer = layers.find(l => l.id === id);
      if (layer && layer.visible !== nextVisible) {
        updateLayer(id, { visible: nextVisible });
      }
    });
  };
  
  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>, layerId: string) => {
    if (event.button !== 0 && event.pointerType !== 'touch') {
      return;
    }
    if (pointerSessionRef.current) {
      return;
    }

    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    pointerSessionRef.current = {
      pointerId: event.pointerId,
      target,
      layerId,
      startClientY: event.clientY,
      startClientX: event.clientX,
      isDragging: false,
    };
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const session = pointerSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    if (!session.isDragging) {
      const deltaY = Math.abs(event.clientY - session.startClientY);
      const deltaX = Math.abs(event.clientX - session.startClientX);
      if (deltaY >= DRAG_DEADZONE_PX && deltaY >= deltaX) {
        const started = beginPointerDrag(session);
        if (started) {
          session.isDragging = true;
          event.preventDefault();
        }
      }
      return;
    }

    event.preventDefault();
    updateDisplayTargetFromPointer(event.clientY);
  }, [beginPointerDrag, updateDisplayTargetFromPointer]);

  const finalizePointerSession = useCallback((event: React.PointerEvent<HTMLDivElement>, shouldCommit: boolean) => {
    const session = pointerSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    session.target.releasePointerCapture?.(event.pointerId);

    if (shouldCommit && session.isDragging) {
      event.preventDefault();
      applyAxisLockedReorder();
    }

    pointerSessionRef.current = null;
    resetDragIndicators();
  }, [applyAxisLockedReorder, resetDragIndicators]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    finalizePointerSession(event, true);
  }, [finalizePointerSession]);

  const handlePointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    finalizePointerSession(event, false);
  }, [finalizePointerSession]);
  
  const handleLayerClick = (event: React.MouseEvent, layerId: string) => {
    if (event.shiftKey && activeLayerId) {
      const anchorIndex = layers.findIndex(l => l.id === activeLayerId);
      const targetIndex = layers.findIndex(l => l.id === layerId);

      if (anchorIndex !== -1 && targetIndex !== -1) {
        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);
        const rangeSelection = layers.slice(start, end + 1).map(layer => layer.id);

        setActiveLayer(layerId);
        setSelectedLayerIds(rangeSelection);
        return;
      }
    }

    if (event.metaKey || event.ctrlKey) {
      const isSelected = selectedLayerIds.includes(layerId);

      if (isSelected) {
        const nextSelection = selectedLayerIds.filter(id => id !== layerId);

        if (nextSelection.length === 0) {
          setActiveLayer(layerId);
          setSelectedLayerIds([layerId]);
          return;
        }

        if (layerId === activeLayerId) {
          const nextActiveLayerId = nextSelection[nextSelection.length - 1] ?? nextSelection[0];
          setActiveLayer(nextActiveLayerId);
        }

        setSelectedLayerIds(nextSelection);
        return;
      }

      setActiveLayer(layerId);
      setSelectedLayerIds([...selectedLayerIds, layerId]);
      return;
    }

    setActiveLayer(layerId);
    setSelectedLayerIds([layerId]);
  };

  const handleRemoveLayer = (layerId: string) => {
    removeLayer(layerId);
  };
  
  
  return (
    <div className="absolute right-0 top-0 h-full w-[240px] bg-[#1A1A1A] border-l border-r border-[#424242] z-30 flex flex-col">
      {/* Add Layer Buttons at the top */}
      <div className="border-b border-[#424242] bg-[#1A1A1A] flex">
        <button
          onClick={handleAddRegularLayer}
          className="flex-1 flex items-center justify-center py-3 hover:bg-[#353535] transition-colors border-r border-[#424242] text-[11px] text-[#D9D9D9]"
          title="Add Regular Layer"
        >
          +Regular
        </button>
        <button
          onClick={handleAddCCLayer}
          className="flex-1 flex items-center justify-center py-3 hover:bg-[#353535] transition-colors text-[11px] text-[#D9D9D9]"
          title="Add Color Cycle Layer"
        >
          +Color cycle
        </button>
      </div>
      
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto"
        key={`${displayedLayers.length}-${displayedLayers.map(l => `${l.id}-${l.layerType}-${!!l.colorCycleData}`).join(',')}`}
      >
        <div className="py-1">
          {displayedLayers.map((layer) => {
            const isSelected = selectedLayerIds.includes(layer.id);
            const isActive = activeLayerId === layer.id;
            return (
              <div
                key={layer.id}
                className={`
                  relative group cursor-move select-none
                  ${isActive ? 'bg-[#4A4A4A]' : isSelected ? 'bg-[#3F3F3F]' : 'hover:bg-[#353535]'}
                  ${dragOverLayerId === layer.id ? 'border-t-2 border-blue-400' : ''}
                  transition-all duration-150
                `}
                onClick={(event) => handleLayerClick(event, layer.id)}
                onPointerDown={(event) => handlePointerDown(event, layer.id)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
              >
                <div className="relative flex items-center h-7 pl-2 pr-8">
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
                  {layer.layerType === 'color-cycle' ? (
                    <div className="ml-1 flex items-center gap-1">
                      <span className={LAYER_TAG_CLASS}>CC</span>
                      <span className={LAYER_TAG_CLASS}>
                        {layer.colorCycleData?.mode === 'recolor' ? 'Recolor' : 'Brush'}
                      </span>
                    </div>
                  ) : (
                    <div className="ml-1 flex items-center gap-1">
                      <span className={LAYER_TAG_CLASS}>Layer</span>
                    </div>
                  )}

                  <button
                    type="button"
                    className={`
                      pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto absolute right-1 top-1/2 -translate-y-1/2
                      flex items-center justify-center rounded p-1 text-[#8F8FA3]
                      transition-opacity duration-150 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100
                      hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[#8F8FA3] z-10
                      ${canDeleteLayer ? '' : 'cursor-not-allowed opacity-0'}
                    `}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!canDeleteLayer) {
                        return;
                      }
                      handleRemoveLayer(layer.id);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onDragStart={(e) => e.preventDefault()}
                    draggable={false}
                    disabled={!canDeleteLayer}
                    aria-label={`Remove ${layer.name}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            );
          })}
          {/* Bottom drop sentinel: allows dropping below the last item */}
          <div className={`h-3 ${dragOverBottom ? 'border-t-2 border-blue-400' : ''}`} />
        </div>
      </div>
      
      <div className="border-t border-[#424242]">
        <LayerAlignmentControls />

        {/* Color Cycle speed slider duplicated from brush controls for quick access */}
        <div className="border-t border-[#424242] px-2 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[#D9D9D9]" style={{ fontSize: '14px' }}>
              speed
            </span>
            <ProgressSlider
              value={colorCycleSpeedValue}
              min={0.02}
              max={1.0}
              step={0.01}
              onChange={(value) => {
                const clampedValue = Math.max(0.02, Math.min(1.0, value));
                setBrushSettings({ colorCycleSpeed: clampedValue });

                if (isCCBrushLayer && activeLayerId && activeLayer?.colorCycleData) {
                  const targetLayerIds = selectedLayerIds.length > 1 && activeLayerId && selectedLayerIds.includes(activeLayerId)
                    ? selectedLayerIds
                    : [activeLayerId];

                  targetLayerIds.forEach((layerId) => {
                    const targetLayer = layers.find(l => l.id === layerId);
                    if (targetLayer?.layerType === 'color-cycle' && targetLayer.colorCycleData) {
                      if (targetLayer.colorCycleData.brushSpeed !== clampedValue) {
                        updateLayer(layerId, {
                          colorCycleData: {
                            ...targetLayer.colorCycleData,
                            brushSpeed: clampedValue
                          }
                        });
                      }
                    }
                  });
                }
              }}
              aria-label="Color Cycle Speed"
              className="flex-1"
            />
          </div>
        </div>

        {/* Bottom Controls: Play/Pause for Color Cycle animation only */}
        <div className="border-t border-[#424242] p-2">
          <button
            onClick={() => {
              if (desiredPlaying) {
                pauseColorCycle('toolbar');
              } else {
                playColorCycle('toolbar');
              }
            }}
            className="w-full h-10 bg-[#D9D9D9] text-[#31313A] hover:bg-[#C4C4C4] transition-colors text-xs outline-none focus:outline-none flex items-center justify-center"
          >
            <span className="text-[10px] mr-1">{effectivePlaying ? '⏸' : '▶'}</span>
            <span className="text-[10px]">{effectivePlaying ? 'Pause' : 'Play'}</span>
          </button>
          {isSuspended && (
            <p className="text-center text-[#C4C4C4] text-xs mt-1">
              Suspended while busy
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default React.memo(MinimalLayerList);
