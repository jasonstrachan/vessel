'use client';

import React, { useState, useCallback, memo, useEffect, useRef } from 'react';
import { shallow } from 'zustand/shallow';
import { Eye, EyeOff, X } from 'lucide-react';
import { useAppStore, selectSequentialPlaybackActive } from '@/stores/useAppStore';
import {
  selectLayers,
  selectActiveLayerId,
  selectSelectedLayerIds,
  selectLayerIdsDescending,
} from '@/stores/selectors/layersSelectors';
import { Layer, BrushShape } from '../types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { LayerAlignmentControls } from '@/components/panels/AlignmentPanel';
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

type LayerRowState = {
  layer: Layer | null;
  isActive: boolean;
  isSelected: boolean;
};

type LayerRowProps = {
  layerId: string;
  canDeleteLayer: boolean;
  onLayerClick: (event: React.MouseEvent, layerId: string) => void;
  onToggleVisibility: (event: React.MouseEvent, layerId: string) => void;
  onDragStart: (event: React.DragEvent, layerId: string) => void;
  onDragEnd: (event: React.DragEvent) => void;
  onRemoveLayer: (layerId: string) => void;
  generateGradientCSS: (gradient: Array<{ position: number; color: string }> | undefined) => string;
};

const useLayerRowState = (layerId: string): LayerRowState =>
  useAppStore(
    useCallback(
      (state) => ({
        layer: state.layers.find((l) => l.id === layerId) ?? null,
        isActive: state.activeLayerId === layerId,
        isSelected: state.selectedLayerIds.includes(layerId),
      }),
      [layerId]
    ),
    shallow
  );

const LayerRow = memo<LayerRowProps>(
  ({
    layerId,
    canDeleteLayer,
    onLayerClick,
    onToggleVisibility,
    onDragStart,
    onDragEnd,
    onRemoveLayer,
    generateGradientCSS,
  }) => {
    const { layer, isActive, isSelected } = useLayerRowState(layerId);

    if (!layer) {
      return null;
    }
    const isHighlighted = isActive || isSelected;

    const rowClassName = `
      relative group cursor-move select-none rounded-sm transition-all duration-150 border-l-4
      ${isHighlighted ? 'bg-[#E8F2FF] text-[#0F172A] border-[#0EA5E9] shadow-[0_0_0_1px_rgba(14,165,233,0.20),inset_4px_0_0_#0EA5E922]' : 'hover:bg-[#353535] text-[#D9D9D9] border-transparent'}
    `;

    const renderColorPreview = () => {
      if (layer.layerType === 'color-cycle') {
        const ccGradient = layer.colorCycleData?.gradient || layer.colorCycleData?.recolorSettings?.gradient;
        if (ccGradient && ccGradient.length > 0) {
          return (
            <div
              className="flex-1 h-4 rounded mr-1"
              style={{
                background: generateGradientCSS(ccGradient),
                minWidth: '30px',
                opacity: layer.visible ? 1 : 0.5,
              }}
              title={`${layer.name} - ${ccGradient.length} stops`}
            />
          );
        }

        return (
          <div
            className="flex-1 h-4 rounded mr-1"
            style={{
              background: '#555',
              minWidth: '30px',
              opacity: layer.visible ? 1 : 0.5,
            }}
            title={layer.name}
          />
        );
      }

      if (layer.layerType === 'normal') {
        return <LayerColorSwatches layer={layer} visible={layer.visible} />;
      }

      return (
        <span className="text-[#D9D9D9] text-xs flex-1 truncate">
          {layer.name}
        </span>
      );
    };

    return (
      <div
        className={rowClassName}
        draggable
        onClick={(event) => onLayerClick(event, layer.id)}
        onDragStart={(event) => onDragStart(event, layer.id)}
        onDragEnd={onDragEnd}
      >
        {isSelected && (
          <div className={`absolute left-0 top-0 h-full w-[6px] ${isActive ? 'bg-[#0EA5E9]' : 'bg-[#5EC7FF]'} opacity-90 pointer-events-none`} />
        )}
        <div className="relative flex items-center h-7 pl-2 pr-8">
          <button
            onClick={(event) => onToggleVisibility(event, layer.id)}
            className={`
              w-4 h-4 mr-2 flex items-center justify-center
              ${layer.visible ? 'text-[#D9D9D9]' : 'text-[#666]'}
              hover:text-white
            `}
          >
            {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>

          {renderColorPreview()}

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
            onClick={(event) => {
              event.stopPropagation();
              if (!canDeleteLayer) {
                return;
              }
              onRemoveLayer(layer.id);
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onDragStart={(event) => event.preventDefault()}
            draggable={false}
            disabled={!canDeleteLayer}
            aria-label={`Remove ${layer.name}`}
          >
            <X size={12} />
          </button>
        </div>
      </div>
    );
  }
);

LayerRow.displayName = 'LayerRow';

const DropSlot: React.FC<{
  index: number;
  onDragOverIndex: (i: number) => void;
  onDropAtIndex: (i: number) => void;
  renderPreview: (i: number) => React.ReactNode;
  isActive: boolean;
}> = ({ index, onDragOverIndex, onDropAtIndex, renderPreview, isActive }) => {
  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    onDragOverIndex(index);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onDropAtIndex(index);
  };

  return (
    <div
      className="relative min-h-[16px] overflow-visible"
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isActive && (
        <>
          <div className="absolute left-2 right-2 top-1/2 -translate-y-1/2 h-[2px] rounded-full bg-[#5EC7FF] shadow-[0_0_8px_rgba(94,199,255,0.9)] pointer-events-none" />
          <div className="mt-3">{renderPreview(index)}</div>
        </>
      )}
    </div>
  );
};

const MinimalLayerList = () => {
  const [dropIndicatorIndex, setDropIndicatorIndex] = useState<number | null>(null);
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const desiredPlaying = useAppStore((state) => state.colorCyclePlayback.desiredPlaying);
  const suspendDepth = useAppStore((state) => state.colorCyclePlayback.suspendDepth);
  const playColorCycle = useAppStore((state) => state.playColorCycle);
  const pauseColorCycle = useAppStore((state) => state.pauseColorCycle);
  const forceResumeColorCycle = useAppStore((state) => state.forceResumeColorCycle);
  const sequentialPlaybackActive = useAppStore(selectSequentialPlaybackActive);
  const effectivePlaying = desiredPlaying && suspendDepth === 0;
  const isPlaybackRunning = effectivePlaying || sequentialPlaybackActive;
  const isSuspended = desiredPlaying && suspendDepth > 0;
  
  // Store subscriptions
  const displayedLayerIds = useAppStore(selectLayerIdsDescending, shallow);
  const activeLayerId = useAppStore(selectActiveLayerId);
  const layersRef = useStoreSelectorRef(selectLayers);
  const selectedLayerIdsRef = useStoreSelectorRef(selectSelectedLayerIds);
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
  const setBrushSettings = useAppStore((state) => state.setBrushSettings);
  const canDeleteLayer = displayedLayerIds.length > 1;
  
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

  const resetDragState = useCallback(() => {
    setDropIndicatorIndex(null);
    setDraggedLayerId(null);
  }, []);

  const convertDisplayIndexToStoreIndex = useCallback((displayIndex: number | null) => {
    if (displayIndex == null) {
      return null;
    }

    if (displayIndex >= displayedLayerIds.length) {
      return 0;
    }

    const targetLayerId = displayedLayerIds[displayIndex];
    if (!targetLayerId) {
      return null;
    }

    const layers = layersRef.current;
    return layers.findIndex((layer) => layer.id === targetLayerId);
  }, [displayedLayerIds, layersRef]);

  const handleAddCCLayer = () => {
    const layersSnapshot = layersRef.current;
    // Unconditional trace to verify handler fires even when TB_DEBUG isn't set
    // quiet
    recordBreadcrumb('layers', { event: 'ui-add-cc-click', count: layersSnapshot.length, activeLayerId });
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
      name: `CC Layer ${layersSnapshot.filter(l => l.layerType === 'color-cycle').length + 1}`,
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
    const layersSnapshot = layersRef.current;
    // Unconditional trace to verify handler fires even when TB_DEBUG isn't set
    // quiet
    recordBreadcrumb('layers', { event: 'ui-add-regular-click', count: layersSnapshot.length, activeLayerId });
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
      name: `Layer ${layersSnapshot.length + 1}`,
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

  const handleAddSequentialLayer = () => {
    const layersSnapshot = layersRef.current;
    recordBreadcrumb('layers', { event: 'ui-add-sequential-click', count: layersSnapshot.length, activeLayerId });

    const makeFramebuffer = (): OffscreenCanvas | HTMLCanvasElement => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      return canvas;
    };

    const sequentialLayerCount = layersSnapshot.filter((layer) => layer.layerType === 'sequential').length;
    const frameCount = 12;
    const fps = 12;
    const durationMs = Math.round((frameCount * 1000) / fps);

    const newLayer: Omit<Layer, 'id' | 'order'> = {
      name: `Animation ${sequentialLayerCount + 1}`,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      imageData: null,
      framebuffer: makeFramebuffer(),
      alignment: createDefaultLayerAlignment(),
      layerType: 'sequential',
      sequentialData: {
        frameCount,
        fps,
        durationMs,
        events: [],
      },
    };

    const newLayerId = addLayer(newLayer);
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
  };
  
  const handleToggleVisibility = useCallback((event: React.MouseEvent, layerId: string) => {
    event.stopPropagation();
    const layers = layersRef.current;
    const targetLayer = layers.find(l => l.id === layerId);
    if (!targetLayer) {
      return;
    }

    const selection = selectedLayerIdsRef.current;
    const shouldApplyToSelection = selection.includes(layerId) && selection.length > 1;
    const layerIdsToUpdate = shouldApplyToSelection ? selection : [layerId];
    const nextVisible = !targetLayer.visible;

    layerIdsToUpdate.forEach((id) => {
      const layer = layers.find(l => l.id === id);
      if (layer && layer.visible !== nextVisible) {
        updateLayer(id, { visible: nextVisible });
      }
    });
  }, [layersRef, selectedLayerIdsRef, updateLayer]);
  
  // Handle drag start
  const commitDrop = useCallback((draggedId: string, indicatorOverride?: number | null) => {
    const layers = layersRef.current;
    const draggedIndex = layers.findIndex(l => l.id === draggedId);
    if (draggedIndex === -1) {
      return false;
    }

    const destinationIndex = convertDisplayIndexToStoreIndex(
      indicatorOverride !== undefined ? indicatorOverride : dropIndicatorIndex
    );

    if (destinationIndex == null || destinationIndex === -1) {
      return false;
    }

    if (draggedIndex !== destinationIndex) {
      reorderLayers(draggedIndex, destinationIndex);
    }

    return true;
  }, [convertDisplayIndexToStoreIndex, dropIndicatorIndex, layersRef, reorderLayers]);

  const onDragOverIndex = useCallback((index: number) => {
    if (!draggedLayerId) {
      return;
    }
    if (dropIndicatorIndex !== index) {
      setDropIndicatorIndex(index);
    }
  }, [draggedLayerId, dropIndicatorIndex]);

  const onDropAtIndex = useCallback((index: number) => {
    if (!draggedLayerId) {
      return;
    }
    commitDrop(draggedLayerId, index);
    resetDragState();
  }, [commitDrop, draggedLayerId, resetDragState]);

  // Handle drag start
  const handleDragStart = useCallback((e: React.DragEvent, layerId: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', layerId);
    setDraggedLayerId(layerId);
    
    // Make the drag image semi-transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5';
    }

    const displayIndex = displayedLayerIds.indexOf(layerId);
    if (displayIndex !== -1) {
      setDropIndicatorIndex(displayIndex + 1);
    }
  }, [displayedLayerIds]);
  
  const handleDragEnd = useCallback((e: React.DragEvent) => {
    // Reset opacity
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
    resetDragState();
  }, [resetDragState]);
  
  const handleLayerClick = useCallback((event: React.MouseEvent, layerId: string) => {
    const selection = selectedLayerIdsRef.current;

    if (event.shiftKey) {
      // Shift adds the clicked layer to the selection without removing others.
      const nextSelection = selection.includes(layerId) ? selection : [...selection, layerId];
      setSelectedLayerIds(nextSelection);
      setActiveLayer(layerId, { preserveSelection: true });
      return;
    }

    setActiveLayer(layerId);
    setSelectedLayerIds([layerId]);
  }, [selectedLayerIdsRef, setActiveLayer, setSelectedLayerIds]);

  const handleRemoveLayer = useCallback((layerId: string) => {
    removeLayer(layerId);
  }, [removeLayer]);
  
  const renderDropPreview = (index: number) => {
    const layers = layersRef.current;
    const draggedLayer = draggedLayerId
      ? layers.find((layer) => layer.id === draggedLayerId) ?? null
      : null;

    if (!draggedLayer) {
      return (
        <div className="relative h-2">
          <div className="absolute left-2 right-2 top-1/2 -translate-y-1/2 h-[2px] rounded-full bg-[#5EC7FF] shadow-[0_0_6px_rgba(94,199,255,0.8)] pointer-events-none" />
        </div>
      );
    }

    const targetLayerId = index < displayedLayerIds.length ? displayedLayerIds[index] : null;
    const targetLayer = targetLayerId
      ? layers.find((layer) => layer.id === targetLayerId) ?? null
      : null;
    const targetLabel = targetLayer ? `Before "${targetLayer.name}"` : 'Place at the bottom';
    const previewFillStyle: React.CSSProperties = (() => {
      if (draggedLayer.layerType === 'color-cycle') {
        const gradient = draggedLayer.colorCycleData?.gradient || draggedLayer.colorCycleData?.recolorSettings?.gradient;
        if (gradient && gradient.length > 0) {
          return { background: generateGradientCSS(gradient) };
        }
      }
      return { background: '#525252' };
    })();

    return (
      <div className="pointer-events-none mx-2 mb-2 rounded border border-[#5EC7FF] bg-[#101A23] px-3 py-2 text-[10px] text-[#DFF3FF] shadow-[0_0_12px_rgba(94,199,255,0.35)]">
        <div className="flex items-center gap-2">
          <span className="uppercase tracking-[0.12em] text-[#5EC7FF] text-[8px]">Drop Preview</span>
          <span className="text-[11px] text-[#F7FBFF] truncate">{draggedLayer.name}</span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-4 rounded" style={previewFillStyle} />
          {draggedLayer.layerType === 'color-cycle' ? (
            <div className="flex items-center gap-1">
              <span className={LAYER_TAG_CLASS}>CC</span>
              <span className={LAYER_TAG_CLASS}>
                {draggedLayer.colorCycleData?.mode === 'recolor' ? 'Recolor' : 'Brush'}
              </span>
            </div>
          ) : (
            <span className={LAYER_TAG_CLASS}>Layer</span>
          )}
        </div>
        <p className="mt-1 text-[#8EC9FF] uppercase tracking-[0.08em] truncate">{targetLabel}</p>
      </div>
    );
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
          +Layer
        </button>
        <button
          onClick={handleAddSequentialLayer}
          className="flex-1 flex items-center justify-center py-3 hover:bg-[#353535] transition-colors border-r border-[#424242] text-[11px] text-[#D9D9D9]"
          title="Add Animation Layer"
        >
          +Animation
        </button>
        <button
          onClick={handleAddCCLayer}
          className="flex-1 flex items-center justify-center py-3 hover:bg-[#353535] transition-colors text-[11px] text-[#D9D9D9]"
          title="Add CC Layer"
        >
          +CC
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        <div className="py-1">
          {displayedLayerIds.map((layerId, index) => (
            <React.Fragment key={layerId}>
              <DropSlot
                index={index}
                onDragOverIndex={onDragOverIndex}
                onDropAtIndex={onDropAtIndex}
                renderPreview={renderDropPreview}
                isActive={dropIndicatorIndex === index}
              />
              <LayerRow
                layerId={layerId}
                canDeleteLayer={canDeleteLayer}
                onLayerClick={handleLayerClick}
                onToggleVisibility={handleToggleVisibility}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onRemoveLayer={handleRemoveLayer}
                generateGradientCSS={generateGradientCSS}
              />
            </React.Fragment>
          ))}
          <DropSlot
            index={displayedLayerIds.length}
            onDragOverIndex={onDragOverIndex}
            onDropAtIndex={onDropAtIndex}
            renderPreview={renderDropPreview}
            isActive={dropIndicatorIndex === displayedLayerIds.length}
          />
        </div>
      </div>
      
      <div className="border-t border-[#424242]">
        <LayerAlignmentControls />

        {/* Bottom Controls: Play/Pause for Color Cycle animation only */}
        <div className="border-t border-[#424242] p-2">
          <button
            onClick={() => {
              if (isPlaybackRunning) {
                pauseColorCycle('toolbar');
                return;
              }
              playColorCycle('toolbar');
              if (suspendDepth > 0) {
                forceResumeColorCycle('toolbar');
              }
            }}
            className="w-full h-10 bg-[#D9D9D9] text-[#31313A] hover:bg-[#C4C4C4] transition-colors text-xs outline-none focus:outline-none flex items-center justify-center"
          >
            <span className="text-[10px] mr-1">{isPlaybackRunning ? '⏸' : '▶'}</span>
            <span className="text-[10px]">{isPlaybackRunning ? 'Pause' : 'Play'}</span>
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
